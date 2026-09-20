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
 * kind-30441 is parameterised-replaceable on `d=policy:auction:v1`,
 * so re-publishing is a no-op on relays — safe to call every startup.
 */

import type { NostrSigner } from '@contextvm/sdk'
import type { ApplesauceRelayPool } from '@contextvm/sdk'
import { DEFAULT_MAX_SKEW_SECONDS, VALIDATOR_POLICY_KIND, VALIDATOR_POLICY_SCHEMA_TYPE } from '../../lib/auction/constants'
import { buildValidatorPolicyContent, buildValidatorPolicyTags } from '../../lib/auction/tagBuilders'
import type { ValidatorAdmissionLimits, ValidatorAdmissionPolicy, ValidatorPolicyDocument } from '../../lib/auction/events'
import { resolveBidSpamPolicy, type BidSpamPolicy } from './spamPolicy'

/**
 * Compile-time guard that the published admission block carries EXACTLY the
 * fields the validator enforces — both directions, so a renamed or removed
 * field fails too. If `BidSpamPolicy` grows a limit, this type resolves to
 * `never` and every holder of `AdmissionPolicyFieldParity` (see the
 * policy-admission test) stops compiling until the published document and
 * its parser are updated as well.
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
 * Deliberately a spread of the resolved policy rather than a hand-written
 * field list: the declaration carries every field of whatever `BidSpamPolicy`
 * is in force, so a limit cannot be left out of it. The companion
 * `AdmissionPolicyFieldParity` guard turns "enforced but never published" —
 * or the reverse — into a compile error at every holder, and the spread means
 * no value can be advertised other than the one in force.
 */
export const toValidatorAdmissionPolicy = (policy: BidSpamPolicy): ValidatorAdmissionPolicy => ({
	enabled: true,
	...policy,
})

export const resolvePublishedAdmissionPolicy = (policy?: BidSpamPolicy): ValidatorAdmissionPolicy =>
	toValidatorAdmissionPolicy(resolveBidSpamPolicy(policy))

export interface PublishValidatorPolicyDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** Human-readable validator label, e.g. "Plebeian dev validator". */
	name: string
	/** Optional policy overrides. v1 default is fully permissive. */
	policy?: Partial<ValidatorPolicyDocument>
	/** Effective relay-admission limits to publish in the policy document. */
	spamPolicy?: BidSpamPolicy
}

export const resolvePublishedValidatorPolicyDocument = (deps: {
	policy?: Partial<ValidatorPolicyDocument>
	spamPolicy?: BidSpamPolicy
}): ValidatorPolicyDocument => ({
	...deps.policy,
	type: VALIDATOR_POLICY_SCHEMA_TYPE,
	maxAcceptableSkewSec: deps.policy?.maxAcceptableSkewSec ?? DEFAULT_MAX_SKEW_SECONDS,
	admission: resolvePublishedAdmissionPolicy(deps.spamPolicy),
})

export const publishValidatorPolicy = async (deps: PublishValidatorPolicyDeps): Promise<void> => {
	const tags = buildValidatorPolicyTags({ name: deps.name })
	const content = buildValidatorPolicyContent(resolvePublishedValidatorPolicyDocument({ policy: deps.policy, spamPolicy: deps.spamPolicy }))

	const template = {
		kind: VALIDATOR_POLICY_KIND as unknown as number,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content,
	}

	const signed = await deps.signer.signEvent(template)
	await deps.relayPool.publish(signed)
}
