/**
 * The validator's declared ruleset must survive the whole loop: declared → published (kind
 * 30441) → parsed → applied as a ruleset.
 *
 * It did not. `ValidatorPolicyDocument` carries `minValidators` / `minQuorumPercent`, but the
 * parser's Zod schema never listed them, and Zod strips unknown keys silently — so a validator
 * could publish the pool and quorum it requires and no client could ever read them back. The
 * `satisfies z.ZodType<ValidatorPolicyDocument>` check did not catch it either, because a
 * schema whose output omits an *optional* property still satisfies the interface.
 *
 * These tests lock the loop shut, in both directions: the declaration carries the ruleset, and
 * the reader recovers it.
 */
import { describe, expect, test } from 'bun:test'
import type { EventTemplate } from 'nostr-tools'
import { auctionValidatorRulesetFromPolicy, sanitizeAuctionValidatorRuleset } from '@/lib/auction/auctionValidatorPolicy'
import { parseValidatorPolicyEvent } from '@/lib/schemas/auction/validatorEvents'
import { publishValidatorPolicy } from '@/server/auction-validator/policy'

const VALIDATOR_PK = 'a'.repeat(64)

const rawPolicyEvent = (content: Record<string, unknown>) => ({
	id: 'b'.repeat(64),
	pubkey: VALIDATOR_PK,
	kind: 30441,
	created_at: 1_700_000_000,
	tags: [
		['d', 'policy:auction:v1'],
		['name', 'Ruleset validator'],
	],
	content: JSON.stringify({ type: 'auction_validator_policy_v1', ...content }),
	sig: 'c'.repeat(128),
})

describe('a validator ruleset on the wire', () => {
	test('a declared ruleset survives parsing', () => {
		const parsed = parseValidatorPolicyEvent(rawPolicyEvent({ minValidators: 3, minQuorumPercent: 67 }))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) throw new Error('unreachable')
		expect(parsed.value.policy.minValidators).toBe(3)
		expect(parsed.value.policy.minQuorumPercent).toBe(67)
	})

	test('a policy that declares no ruleset stays silent about one', () => {
		const parsed = parseValidatorPolicyEvent(rawPolicyEvent({ relatrMinScore: 20 }))
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) throw new Error('unreachable')
		expect(parsed.value.policy.minValidators).toBeUndefined()
		expect(parsed.value.policy.minQuorumPercent).toBeUndefined()
	})

	test('a nonsensical ruleset is refused rather than honoured', () => {
		// The schema bounds the declared values; `sanitizeAuctionValidatorRuleset` is the
		// second gate at the point of use, since a policy document is untrusted data.
		expect(parseValidatorPolicyEvent(rawPolicyEvent({ minValidators: 0 })).ok).toBe(false)
		expect(parseValidatorPolicyEvent(rawPolicyEvent({ minQuorumPercent: 140 })).ok).toBe(false)
		expect(sanitizeAuctionValidatorRuleset({ minimum_validators: 0 }).minimum_validators).toBeGreaterThanOrEqual(2)
	})

	test('the document maps to the ruleset the assessment consumes', () => {
		expect(auctionValidatorRulesetFromPolicy({ minValidators: 3, minQuorumPercent: 67 })).toEqual({
			minimum_validators: 3,
			minimum_quorum_percent: 67,
		})
		// Absent fields stay absent, so the protocol default applies rather than a guess.
		expect(auctionValidatorRulesetFromPolicy({})).toEqual({})
		expect(auctionValidatorRulesetFromPolicy({ minValidators: 4 })).toEqual({ minimum_validators: 4 })
	})

	test('the service publishes the ruleset it applies', async () => {
		let signed: EventTemplate | null = null
		await publishValidatorPolicy({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) => {
					signed = template
					return { ...template, id: 'd'.repeat(64), pubkey: VALIDATOR_PK, sig: 'e'.repeat(128) } as never
				},
			} as never,
			relayPool: { publish: async () => undefined } as never,
			name: 'Ruleset validator',
			ruleset: { minimum_validators: 3, minimum_quorum_percent: 67 },
		})

		if (!signed) throw new Error('expected the policy to be signed')
		const content = JSON.parse(String((signed as EventTemplate).content)) as Record<string, unknown>
		expect(content.minValidators).toBe(3)
		expect(content.minQuorumPercent).toBe(67)

		// And the round trip: what the service published is what a reader recovers.
		const reparsed = parseValidatorPolicyEvent({
			id: 'd'.repeat(64),
			pubkey: VALIDATOR_PK,
			kind: 30441,
			created_at: 1_700_000_000,
			tags: (signed as EventTemplate).tags as string[][],
			content: String((signed as EventTemplate).content),
			sig: 'e'.repeat(128),
		})
		expect(reparsed.ok).toBe(true)
		if (!reparsed.ok) throw new Error('unreachable')
		expect(auctionValidatorRulesetFromPolicy(reparsed.value.policy)).toEqual({
			minimum_validators: 3,
			minimum_quorum_percent: 67,
		})
	})

	test('an operator ruleset below the protocol floor is raised, not published as declared', async () => {
		let signed: EventTemplate | null = null
		await publishValidatorPolicy({
			signer: {
				getPublicKey: async () => VALIDATOR_PK,
				signEvent: async (template: EventTemplate) => {
					signed = template
					return { ...template, id: 'd'.repeat(64), pubkey: VALIDATOR_PK, sig: 'e'.repeat(128) } as never
				},
			} as never,
			relayPool: { publish: async () => undefined } as never,
			name: 'Sloppy validator',
			// 40% is below the hard floor; the protocol raises it rather than announcing a
			// quorum rule that cannot be honoured.
			ruleset: { minimum_quorum_percent: 40 },
		})

		if (!signed) throw new Error('expected the policy to be signed')
		const content = JSON.parse(String((signed as EventTemplate).content)) as Record<string, unknown>
		expect(content.minQuorumPercent).toBe(sanitizeAuctionValidatorRuleset({ minimum_quorum_percent: 40 }).minimum_quorum_percent)
		expect(content.minQuorumPercent as number).toBeGreaterThan(50)
	})
})
