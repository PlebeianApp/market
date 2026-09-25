/**
 * Admission-policy disclosure coverage for the kind-30441 validator policy
 * declaration (PlebeianApp/market#1285, reviewer maxime-tt required change 2).
 *
 * The validator enforces a whole set of admission limits (rate window,
 * tracked-bid cap, pending-buffer caps, event envelope) and now serializes
 * them into the published document. Nothing but discipline held those two
 * field sets together: the declaration was a hand-written copy of the
 * enforced `BidSpamPolicy`, so a limit could be enforced without being
 * published (or advertised without being enforced) and no test would notice.
 *
 * These tests pin the contract that closes that gap:
 *
 *   - `toValidatorAdmissionPolicy` is the ONE projection from the enforced
 *     `BidSpamPolicy` to the published declaration. It is a spread, so
 *     "publish a limit the validator does not enforce" is not expressible;
 *   - the published field set is proven identical to the enforced field set
 *     at compile time (`AdmissionPolicyFieldParity`) and at runtime (the keys
 *     the real startup path publishes);
 *   - the published values are the resolved values actually in force — not
 *     the caller's partial, not the built-in defaults;
 *   - `{ enabled: false }` is a first-class, explicitly parsed declaration,
 *     and a document cannot half-declare its limits.
 *
 * No relays, no network: in-process fake pool + signer, same pattern as
 * auctionValidatorPolicy.test.ts and auctionValidatorSpamPolicyConfig.test.ts.
 */

import { describe, expect, test } from 'bun:test'
import { buildValidatorPolicyContent, buildValidatorPolicyTags } from '../auction/tagBuilders'
import { VALIDATOR_POLICY_KIND } from '../auction/constants'
import type { ValidatorAdmissionPolicy } from '../auction/events'
import { parseValidatorPolicyEvent } from '../schemas/auction/validatorEvents'
import type { NostrEventLike } from '../nostr/eventLike'
import { DEFAULT_BID_SPAM_POLICY, resolveBidSpamPolicy, type BidSpamPolicy } from '../../server/auction-validator/spamPolicy'
import { publishValidatorPolicy, toValidatorAdmissionPolicy, type AdmissionPolicyFieldParity } from '../../server/auction-validator/policy'
import { startAuctionValidator } from '../../server/auction-validator/index'

const VALIDATOR_PUBKEY = 'a'.repeat(64)
const POLICY_FIELD_COUNT = Object.keys(DEFAULT_BID_SPAM_POLICY).length

// ---------------------------------------------------------------------------
// Compile-time parity: adding a limit to the enforced policy without
// publishing it (or publishing a limit nothing enforces) fails to compile,
// so the published document cannot drift from the code.
// ---------------------------------------------------------------------------
const admissionPolicyFieldParity: AdmissionPolicyFieldParity = 'parity'

const toEvent = (content: string): NostrEventLike => ({
	id: 'f'.repeat(64),
	pubkey: VALIDATOR_PUBKEY,
	kind: VALIDATOR_POLICY_KIND as unknown as number,
	created_at: 1_700_000_000,
	content,
	tags: buildValidatorPolicyTags({ name: 'Test validator' }),
})

/** A published policy document as authored by some other validator. */
const parseContent = (content: string) => parseValidatorPolicyEvent(toEvent(content))

const admissionOf = (content: string): ValidatorAdmissionPolicy => {
	const parsed = parseContent(content)
	if (!parsed.ok) throw new Error(`policy document did not parse: ${JSON.stringify(parsed.error)}`)
	return parsed.value.policy.admission as ValidatorAdmissionPolicy
}

const publishedLimits = (admission: ValidatorAdmissionPolicy): Record<string, number> => {
	if (!admission.enabled) throw new Error('expected the limits to be declared as enabled')
	const limits: Record<string, number> = {}
	for (const [key, value] of Object.entries(admission)) {
		if (key === 'enabled') continue
		limits[key] = value as number
	}
	return limits
}

const fakePool = (published: NostrEventLike[]) => ({
	subscribe: async (_filters: unknown, _handler: unknown, onEose?: () => void) => {
		onEose?.()
		return () => undefined
	},
	publish: async (event: NostrEventLike) => void published.push(event),
})

const fakeSigner = {
	getPublicKey: async () => VALIDATOR_PUBKEY,
	signEvent: async (template: Record<string, unknown>) => ({
		...template,
		pubkey: VALIDATOR_PUBKEY,
		id: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	}),
}

// ---------------------------------------------------------------------------
// The projection itself
// ---------------------------------------------------------------------------

describe('toValidatorAdmissionPolicy', () => {
	test('is the single projection from the enforced policy to the document', () => {
		const mapped = toValidatorAdmissionPolicy({ ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 7 })
		expect(mapped).toEqual({ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 7 })
	})

	test('publishes every enforced field, and nothing else', () => {
		const mapped = toValidatorAdmissionPolicy(resolveBidSpamPolicy())
		expect(Object.keys(publishedLimits(mapped)).sort()).toEqual(Object.keys(DEFAULT_BID_SPAM_POLICY).sort())
		expect(Object.keys(mapped).length).toBe(POLICY_FIELD_COUNT + 1)
	})

	test('the published admission block and the enforced policy have the same fields', () => {
		// The real proof is the compile-time assertion above; this keeps it
		// referenced so the compiler evaluates it.
		expect(admissionPolicyFieldParity).toBe('parity')
	})
})

// ---------------------------------------------------------------------------
// Publication: what goes on the wire is what is in force
// ---------------------------------------------------------------------------

describe('kind-30441 admission publication', () => {
	const publish = async (spamPolicy?: BidSpamPolicy) => {
		const published: NostrEventLike[] = []
		await publishValidatorPolicy({
			signer: fakeSigner as never,
			relayPool: fakePool(published) as never,
			name: 'Local validator',
			spamPolicy,
		})
		expect(published.length).toBe(1)
		const parsed = parseValidatorPolicyEvent(published[0])
		if (!parsed.ok) throw new Error(`published policy did not parse: ${JSON.stringify(parsed.error)}`)
		const admission = parsed.value.policy.admission
		if (!admission) throw new Error('published policy carries no admission block')
		return admission
	}

	test('an unconfigured validator publishes the resolved defaults in full', async () => {
		expect(await publish()).toEqual({ enabled: true, ...DEFAULT_BID_SPAM_POLICY })
	})

	test('operator overrides are published as the values in force', async () => {
		// The publisher takes the resolved policy the validator runs with (see
		// startAuctionValidator), so the document cannot describe other limits.
		const inForce = resolveBidSpamPolicy({ maxPendingKeys: 64, maxBidsPerWindow: 5 })
		const admission = await publish(inForce)
		expect(admission).toEqual({ enabled: true, ...inForce })
		expect(admission.enabled).toBe(true)
		if (!admission.enabled) return
		expect(admission.maxPendingKeys).toBe(64)
		expect(admission.maxBidsPerWindow).toBe(5)
		// Not the caller's partial and not the built-in default.
		expect(admission.maxPendingKeys).not.toBe(DEFAULT_BID_SPAM_POLICY.maxPendingKeys)
		// Every unset limit still comes from the defaults, so the document is
		// never partially declared.
		expect(publishedLimits(admission)).toEqual({ ...inForce })
	})

	test('the startup path publishes exactly the policy its handle enforces', async () => {
		const published: NostrEventLike[] = []
		const loggedArgs: unknown[][] = []
		const handle = await startAuctionValidator({
			signer: fakeSigner as never,
			relayPool: fakePool(published) as never,
			spamPolicy: { maxPendingKeys: 64, pendingTtlSec: 300 },
			logger: {
				info: (...args: unknown[]) => void loggedArgs.push(args),
				warn: () => undefined,
				error: () => undefined,
			},
		})
		try {
			const policyEvents = published.filter((event) => event.kind === (VALIDATOR_POLICY_KIND as unknown as number))
			expect(policyEvents.length).toBe(1)
			const parsed = parseValidatorPolicyEvent(policyEvents[0])
			if (!parsed.ok) throw new Error(`published policy did not parse: ${JSON.stringify(parsed.error)}`)
			const admission = parsed.value.policy.admission
			if (!admission) throw new Error('published policy carries no admission block')

			// The published declaration and the handle the subscriber runs with
			// are the same object, field for field.
			expect(admission).toEqual({ enabled: true, ...handle.spamPolicy })
			expect(Object.keys(publishedLimits(admission)).sort()).toEqual(Object.keys(handle.spamPolicy).sort())
			expect(handle.spamPolicy.pendingTtlSec).toBe(300)

			// ...and the startup log line reports the same values.
			const admissionLogs = loggedArgs.filter((args) => String(args[0]).includes('[validator] resolved admission policy'))
			expect(admissionLogs.length).toBe(1)
			expect(admissionLogs[0][1]).toEqual({ ...handle.spamPolicy })
		} finally {
			await handle.stop()
		}
	})
})

// ---------------------------------------------------------------------------
// Parse: the declaration is validated, not merely accepted
// ---------------------------------------------------------------------------

describe('kind-30441 admission parse/round-trip', () => {
	test('a validator that runs no admission checks declares it, and it parses back explicitly', () => {
		const parsed = parseContent(buildValidatorPolicyContent({ admission: { enabled: false } } as never))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		expect(parsed.value.policy.admission).toEqual({ enabled: false })
		// The declaration is the whole block: no limits are implied or carried
		// alongside it.
		expect(Object.keys(parsed.value.policy.admission as object)).toEqual(['enabled'])
		expect('maxBidsPerWindow' in (parsed.value.policy.admission as object)).toBe(false)
	})

	test('eligibility fields and the admission block coexist and round-trip unchanged', () => {
		const admission = { enabled: true, ...DEFAULT_BID_SPAM_POLICY } satisfies ValidatorAdmissionPolicy
		const parsed = parseContent(
			buildValidatorPolicyContent({
				relatrMinScore: 0.1,
				requireNip05: true,
				blacklist: ['c'.repeat(64)],
				categoryAllowlist: ['art'],
				maxAcceptableSkewSec: 60,
				notes: 'scoped validator',
				admission,
			}),
		)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return

		expect(parsed.value.policy).toMatchObject({
			relatrMinScore: 0.1,
			requireNip05: true,
			blacklist: ['c'.repeat(64)],
			categoryAllowlist: ['art'],
			notes: 'scoped validator',
			admission,
		})
		expect(parsed.value.policy.admission).toEqual(admission)
	})

	test('the admission block is rejected when it half-declares limits', () => {
		// `enabled: false` means "no limits": carrying limits alongside it is a
		// contradiction, not a document to guess at.
		const contradiction = parseContent(buildValidatorPolicyContent({ admission: { enabled: false, maxBidsPerWindow: 5 } } as never))
		expect(contradiction.ok).toBe(false)

		// `enabled: true` must state every limit it claims to apply.
		expect(parseContent(buildValidatorPolicyContent({ admission: { enabled: true } } as never)).ok).toBe(false)
		expect(
			parseContent(
				buildValidatorPolicyContent({
					admission: { enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxPendingKeys: undefined },
				} as never),
			).ok,
		).toBe(false)
	})

	test('admission limits are validated, not merely accepted', () => {
		for (const bad of [
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxPendingKeys: -1 },
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, pendingTtlSec: 1.5 },
			{ enabled: true, ...DEFAULT_BID_SPAM_POLICY, maxTagCount: 'lots' },
			{ enabled: 'yes' },
		]) {
			expect(parseContent(buildValidatorPolicyContent({ admission: bad } as never)).ok).toBe(false)
		}
	})

	test('a document without an admission block still parses (older validators)', () => {
		const parsed = parseContent(buildValidatorPolicyContent({ relatrMinScore: 0.1 }))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.policy.admission).toBeUndefined()
	})

	test('a published block always parses back to itself', () => {
		// Round-trip through the parser is the reader's contract: whatever this
		// validator publishes, every reader can read back verbatim.
		const admission = admissionOf(buildValidatorPolicyContent({ admission: toValidatorAdmissionPolicy(resolveBidSpamPolicy()) }))
		expect(admission).toEqual({ enabled: true, ...DEFAULT_BID_SPAM_POLICY })
	})
})
