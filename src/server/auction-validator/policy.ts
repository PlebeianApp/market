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
	/**
	 * Relay-admission limits to publish. A partial is accepted and resolved
	 * against the defaults, like every other entry point into the policy.
	 */
	spamPolicy?: Partial<BidSpamPolicy>
}

export const resolvePublishedAdmissionPolicy = (policy?: Partial<BidSpamPolicy>): ValidatorAdmissionPolicy => {
	const resolved = resolveBidSpamPolicy(policy)
	// The `{ enabled: false }` state is a protocol-declared option, so it has
	// to be reachable: the master switch decides which of the two shapes this
	// validator declares, and `spamPolicy.ts` applies exactly what is declared
	// (review 5242945675 Required 3).
	if (!resolved.admissionEnabled) return { enabled: false }
	return {
		maxBidsPerWindow: resolved.maxBidsPerWindow,
		rateWindowSec: resolved.rateWindowSec,
		maxTrackedChildSubscriptions: resolved.maxTrackedChildSubscriptions,
		childReplayLookbackSec: resolved.childReplayLookbackSec,
		childReplayCompletionTimeoutSec: resolved.childReplayCompletionTimeoutSec,
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
		enabled: true,
	}
}

/**
 * Operator-facing disclosure attached to the published kind-30441 document.
 * Every claim here is a property of this boundary that a reader cannot
 * infer from the limit numbers alone (review 5242945675): refusals are
 * log-only, the child-subscription cap is a fail-closed cliff, and the
 * late-settlement observation bound is what makes `settled_late` reachable
 * for a release published after the settlement window. An operator-supplied
 * `notes` is preserved and this text is appended to it.
 */
const ADMISSION_DISCLOSURE_NOTES = [
	'Admission refusals are log-only: this validator does not publish a refusal reason to any relay, so a refused event is indistinguishable from an unobserved one.',
	"The child-subscription fan-out cap is a fail-closed cliff: at the cap, a further auction's children are not observed at all.",
	"A closed auction's children are observed for `lateSettlementObservationSec` past its settlement window; a path release arriving after that bound is not observed and the terminal verdict stands.",
].join(' ')

export const resolvePublishedValidatorPolicyDocument = (deps: {
	policy?: Partial<ValidatorPolicyDocument>
	spamPolicy?: Partial<BidSpamPolicy>
}): ValidatorPolicyDocument => {
	const operatorNotes = deps.policy?.notes?.trim()
	return {
		...deps.policy,
		type: VALIDATOR_POLICY_SCHEMA_TYPE,
		maxAcceptableSkewSec: deps.policy?.maxAcceptableSkewSec ?? DEFAULT_MAX_SKEW_SECONDS,
		admission: resolvePublishedAdmissionPolicy(deps.spamPolicy),
		notes: operatorNotes ? `${operatorNotes} ${ADMISSION_DISCLOSURE_NOTES}` : ADMISSION_DISCLOSURE_NOTES,
	}
}

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
