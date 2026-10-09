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
import { sanitizeAuctionValidatorRuleset, type AuctionValidatorRuleset } from '../../lib/auction/auctionValidatorPolicy'

export interface PublishValidatorPolicyDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** Human-readable validator label, e.g. "Plebeian dev validator". */
	name: string
	/** Optional policy overrides. v1 default is fully permissive. */
	policy?: Partial<ValidatorPolicyDocument>
	/** Effective relay-admission limits to publish in the policy document. */
	spamPolicy?: Partial<BidSpamPolicy>
	/**
	 * The ruleset this validator applies — what it demands of the auctions it audits.
	 *
	 * Published in the document as `minValidators` / `minQuorumPercent` so a seller can see,
	 * before publishing, whether this validator will accept their pool. The same ruleset is
	 * what the service applies when it decides an auction's policy is broken
	 * (`policyClaim.ts`), so the declaration and the enforcement cannot drift.
	 */
	ruleset?: Partial<AuctionValidatorRuleset>
}

export const resolvePublishedAdmissionPolicy = (
	policy?: Partial<BidSpamPolicy>,
	declared?: ValidatorAdmissionPolicy,
): ValidatorAdmissionPolicy => {
	if (declared?.enabled === false) return declared
	const resolved = resolveBidSpamPolicy(policy)
	return {
		enabled: true,
		maxBidsPerWindow: resolved.maxBidsPerWindow,
		rateWindowSec: resolved.rateWindowSec,
		maxTrackedChildSubscriptions: resolved.maxTrackedChildSubscriptions,
		childReplayLookbackSec: resolved.childReplayLookbackSec,
		lateSettlementObservationSec: resolved.lateSettlementObservationSec,
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
	spamPolicy?: Partial<BidSpamPolicy>
	/**
	 * The ruleset this validator applies, declared in the document as `minValidators` /
	 * `minQuorumPercent` so a seller can see whether this validator will accept their pool before
	 * publishing. Resolved through the same sanitizer the auction-level claim uses, so what is
	 * declared here and what is enforced cannot drift apart.
	 */
	ruleset?: Partial<AuctionValidatorRuleset>
}): ValidatorPolicyDocument => {
	const ruleset = sanitizeAuctionValidatorRuleset(deps.ruleset)
	return {
		...deps.policy,
		type: VALIDATOR_POLICY_SCHEMA_TYPE,
		maxAcceptableSkewSec: deps.policy?.maxAcceptableSkewSec ?? DEFAULT_MAX_SKEW_SECONDS,
		admission: resolvePublishedAdmissionPolicy(deps.spamPolicy, deps.policy?.admission),
		minValidators: ruleset.minimum_validators,
		minQuorumPercent: ruleset.minimum_quorum_percent,
	}
}

export const publishValidatorPolicy = async (deps: PublishValidatorPolicyDeps): Promise<void> => {
	const tags = buildValidatorPolicyTags({ name: deps.name })
	const content = buildValidatorPolicyContent(
		resolvePublishedValidatorPolicyDocument({ policy: deps.policy, spamPolicy: deps.spamPolicy, ruleset: deps.ruleset }),
	)

	const template = {
		kind: VALIDATOR_POLICY_KIND as unknown as number,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content,
	}

	const signed = await deps.signer.signEvent(template)
	await deps.relayPool.publish(signed)
}
