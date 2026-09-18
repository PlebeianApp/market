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
import type { ValidatorAdmissionPolicy, ValidatorPolicyDocument } from '../../lib/auction/events'
import { resolveBidSpamPolicy, type BidSpamPolicy } from './spamPolicy'

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

export const resolvePublishedAdmissionPolicy = (policy?: BidSpamPolicy): ValidatorAdmissionPolicy => {
	const resolved = resolveBidSpamPolicy(policy)
	return {
		enabled: true,
		maxBidsPerWindow: resolved.maxBidsPerWindow,
		rateWindowSec: resolved.rateWindowSec,
		maxTrackedChildSubscriptions: resolved.maxTrackedChildSubscriptions,
		childReplayLookbackSec: resolved.childReplayLookbackSec,
		maxTrackedBidsPerAuction: resolved.maxTrackedBidsPerAuction,
		maxSeenEventIds: resolved.maxSeenEventIds,
		maxPendingEventsPerKey: resolved.maxPendingEventsPerKey,
		maxPendingKeys: resolved.maxPendingKeys,
		maxPendingEvents: resolved.maxPendingEvents,
		pendingTtlSec: resolved.pendingTtlSec,
		maxEventBytes: resolved.maxEventBytes,
		maxTagCount: resolved.maxTagCount,
		maxNonceLength: resolved.maxNonceLength,
		maxProofCount: resolved.maxProofCount,
		maxContentBytes: resolved.maxContentBytes,
	}
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
