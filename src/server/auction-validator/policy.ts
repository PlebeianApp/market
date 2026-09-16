/**
 * Validator policy publisher — emits a kind-30441 declaration at
 * startup so bidders/sellers can see what this validator will and
 * won't accept.
 *
 * v1 dev policy is intentionally permissive: no relatr threshold,
 * no blacklist, no KYC requirement, no minimum account age. The
 * validator enforces only the protocol rules in `validateBid`.
 * Production deployments override this by passing a richer
 * `ValidatorPolicyDocument`.
 *
 * Admission (spam/DoS) limits are NOT optional in this publisher: the
 * resolved `BidSpamPolicy` is required and always serialized into the
 * document, so a reader can never be told about limits the validator
 * does not apply (review maxime-tt, required change 2).
 *
 * kind-30441 is parameterised-replaceable on `d=policy:auction:v1`,
 * so re-publishing is a no-op on relays — safe to call every startup.
 */

import type { NostrSigner } from '@contextvm/sdk'
import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { VALIDATOR_POLICY_KIND, VALIDATOR_POLICY_SCHEMA_TYPE } from '../../lib/auction/constants'
import { buildValidatorPolicyContent, buildValidatorPolicyTags } from '../../lib/auction/tagBuilders'
import type { ValidatorAdmissionLimits, ValidatorAdmissionPolicy, ValidatorPolicyDocument } from '../../lib/auction/events'
import type { BidSpamPolicy } from './spamPolicy'

/**
 * Compile-time guard that the published admission block carries EXACTLY
 * the fields the validator enforces — both directions, so a renamed or
 * removed field fails too. If `BidSpamPolicy` grows a limit, this type
 * resolves to `never` and every holder of `AdmissionPolicyFieldParity`
 * (see the policy-admission test) stops compiling until the published
 * document and the parser are updated as well.
 */
type EnforcedAdmissionField = keyof BidSpamPolicy
type PublishedAdmissionField = keyof ValidatorAdmissionLimits
export type AdmissionPolicyFieldParity = [EnforcedAdmissionField] extends [PublishedAdmissionField]
	? [PublishedAdmissionField] extends [EnforcedAdmissionField]
		? 'parity'
		: never
	: never

/**
 * The ONE mapping from the enforced policy to the published declaration.
 *
 * Deliberately a spread of the resolved object rather than a hand-written
 * field list: a limit cannot be enforced without being published, and no
 * value can be advertised that is not the one in force.
 *
 * `{ enabled: false }` is the declared no-limits state (see
 * `ValidatorAdmissionPolicy`); this mapper only ever produces the
 * `enabled: true` form because the resolver always returns concrete
 * limits. A validator that truly applies no admission checks would
 * publish `{ enabled: false }` instead — expressible, parsed, and
 * round-tripped, just not what this validator's resolver produces.
 */
export const toValidatorAdmissionPolicy = (policy: BidSpamPolicy): ValidatorAdmissionPolicy => ({
	enabled: true,
	...policy,
})

export interface PublishValidatorPolicyDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** Human-readable validator label, e.g. "Plebeian dev validator". */
	name: string
	/** Optional eligibility overrides. v1 default is fully permissive. */
	policy?: Partial<ValidatorPolicyDocument>
	/**
	 * The admission policy actually in force — resolved once in
	 * `startAuctionValidator` (explicit options > `AUCTION_VALIDATOR_*`
	 * env > `DEFAULT_BID_SPAM_POLICY`) and required here so the published
	 * document cannot drift from the enforced one.
	 */
	admission: BidSpamPolicy
}

export const publishValidatorPolicy = async (deps: PublishValidatorPolicyDeps): Promise<void> => {
	const tags = buildValidatorPolicyTags({ name: deps.name })
	const content = buildValidatorPolicyContent({
		...deps.policy,
		// Always pin the type literal — the policy doc's `type` field
		// is how parsers identify it. Putting it after the spread means
		// the caller can't accidentally override it with a wrong value.
		type: VALIDATOR_POLICY_SCHEMA_TYPE,
		// Same reasoning for the admission block: published LAST, from
		// the resolved policy, so a caller-supplied `policy.admission`
		// cannot describe limits other than the ones enforced.
		admission: toValidatorAdmissionPolicy(deps.admission),
	} as Partial<ValidatorPolicyDocument> & { type: typeof VALIDATOR_POLICY_SCHEMA_TYPE })

	const template = {
		kind: VALIDATOR_POLICY_KIND as unknown as number,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content,
	}

	const signed = await deps.signer.signEvent(template)
	await deps.relayPool.publish(signed)
}
