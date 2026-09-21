import { describe, expect, test } from 'bun:test'
import { parseValidatorPolicyEvent } from '../schemas/auction/validatorEvents'
import { DEFAULT_MAX_SKEW_SECONDS, VALIDATOR_POLICY_KIND } from '../auction/constants'
import { DEFAULT_BID_SPAM_POLICY } from '../../server/auction-validator/spamPolicy'
import { publishValidatorPolicy, resolvePublishedValidatorPolicyDocument } from '../../server/auction-validator/policy'

const VALIDATOR_PUBKEY = 'a'.repeat(64)

describe('validator policy publication', () => {
	test('preserves an explicitly disabled admission policy', () => {
		const policy = resolvePublishedValidatorPolicyDocument({ policy: { admission: { enabled: false } } })
		expect(policy.admission).toEqual({ enabled: false })
	})

	test('publishes the effective admission policy and default skew', async () => {
		let published: any
		await publishValidatorPolicy({
			signer: {
				signEvent: async (template: any) => ({
					...template,
					id: '1'.repeat(64),
					pubkey: VALIDATOR_PUBKEY,
					sig: '2'.repeat(128),
				}),
			} as any,
			relayPool: {
				publish: async (event: any) => {
					published = event
				},
			} as any,
			name: 'Local validator',
		})

		expect(published.kind).toBe(VALIDATOR_POLICY_KIND)
		const parsed = parseValidatorPolicyEvent(published)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.policy.maxAcceptableSkewSec).toBe(DEFAULT_MAX_SKEW_SECONDS)
		expect(parsed.value.policy.admission).toEqual({
			enabled: true,
			maxBidsPerWindow: DEFAULT_BID_SPAM_POLICY.maxBidsPerWindow,
			rateWindowSec: DEFAULT_BID_SPAM_POLICY.rateWindowSec,
			maxTrackedChildSubscriptions: DEFAULT_BID_SPAM_POLICY.maxTrackedChildSubscriptions,
			childReplayLookbackSec: DEFAULT_BID_SPAM_POLICY.childReplayLookbackSec,
			lateSettlementObservationSec: DEFAULT_BID_SPAM_POLICY.lateSettlementObservationSec,
			maxTrackedBidsPerAuction: DEFAULT_BID_SPAM_POLICY.maxTrackedBidsPerAuction,
			maxSeenEventIds: DEFAULT_BID_SPAM_POLICY.maxSeenEventIds,
			maxPendingEventsPerKey: DEFAULT_BID_SPAM_POLICY.maxPendingEventsPerKey,
			maxPendingKeys: DEFAULT_BID_SPAM_POLICY.maxPendingKeys,
			maxPendingEvents: DEFAULT_BID_SPAM_POLICY.maxPendingEvents,
			pendingTtlSec: DEFAULT_BID_SPAM_POLICY.pendingTtlSec,
			maxEventBytes: DEFAULT_BID_SPAM_POLICY.maxEventBytes,
			maxTagCount: DEFAULT_BID_SPAM_POLICY.maxTagCount,
			maxNonceLength: DEFAULT_BID_SPAM_POLICY.maxNonceLength,
			maxProofCount: DEFAULT_BID_SPAM_POLICY.maxProofCount,
			maxContentBytes: DEFAULT_BID_SPAM_POLICY.maxContentBytes,
		})
	})

	test('publishes operator overrides in the admission policy', async () => {
		let published: any
		await publishValidatorPolicy({
			signer: {
				signEvent: async (template: any) => ({
					...template,
					id: '3'.repeat(64),
					pubkey: VALIDATOR_PUBKEY,
					sig: '4'.repeat(128),
				}),
			} as any,
			relayPool: {
				publish: async (event: any) => {
					published = event
				},
			} as any,
			name: 'Local validator',
			policy: { maxAcceptableSkewSec: 45, notes: 'tight caps' },
			spamPolicy: { maxBidsPerWindow: 3, maxTagCount: 9, pendingTtlSec: 30, lateSettlementObservationSec: 120 },
		})

		const parsed = parseValidatorPolicyEvent(published)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.policy.maxAcceptableSkewSec).toBe(45)
		expect(parsed.value.policy.notes).toBe('tight caps')
		expect(parsed.value.policy.admission).toMatchObject({
			enabled: true,
			maxBidsPerWindow: 3,
			maxSeenEventIds: DEFAULT_BID_SPAM_POLICY.maxSeenEventIds,
			maxTrackedChildSubscriptions: DEFAULT_BID_SPAM_POLICY.maxTrackedChildSubscriptions,
			childReplayLookbackSec: DEFAULT_BID_SPAM_POLICY.childReplayLookbackSec,
			lateSettlementObservationSec: 120,
			maxTagCount: 9,
			pendingTtlSec: 30,
		})
	})
})
