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
import { VALIDATOR_POLICY_KIND, VALIDATOR_POLICY_SCHEMA_TYPE } from '../../lib/auction/constants'
import { buildValidatorPolicyContent, buildValidatorPolicyTags } from '../../lib/auction/tagBuilders'
import type { ValidatorPolicyDocument } from '../../lib/auction/events'

export interface PublishValidatorPolicyDeps {
	signer: NostrSigner
	relayPool: ApplesauceRelayPool
	/** Human-readable validator label, e.g. "Plebeian dev validator". */
	name: string
	/** Optional policy overrides. v1 default is fully permissive. */
	policy?: Partial<ValidatorPolicyDocument>
}

export const publishValidatorPolicy = async (deps: PublishValidatorPolicyDeps): Promise<void> => {
	const tags = buildValidatorPolicyTags({ name: deps.name })
	const content = buildValidatorPolicyContent({
		...deps.policy,
		// Always pin the type literal — the policy doc's `type` field
		// is how parsers identify it. Putting it after the spread means
		// the caller can't accidentally override it with a wrong value.
		type: VALIDATOR_POLICY_SCHEMA_TYPE,
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
