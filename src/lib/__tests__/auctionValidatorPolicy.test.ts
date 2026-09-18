import { describe, expect, test } from 'bun:test'
import { parseValidatorPolicyEvent } from '../schemas/auction/validatorEvents'
import { DEFAULT_MAX_SKEW_SECONDS, VALIDATOR_POLICY_KIND } from '../auction/constants'
import { DEFAULT_BID_SPAM_POLICY } from '../../server/auction-validator/spamPolicy'
import { publishValidatorPolicy } from '../../server/auction-validator/policy'

const VALIDATOR_PUBKEY = 'a'.repeat(64)

describe('validator policy publication', () => {
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
			childReplayCompletionTimeoutSec: DEFAULT_BID_SPAM_POLICY.childReplayCompletionTimeoutSec,
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
			spamPolicy: { maxBidsPerWindow: 3, maxTagCount: 9, pendingTtlSec: 30 },
		})

		const parsed = parseValidatorPolicyEvent(published)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		expect(parsed.value.policy.maxAcceptableSkewSec).toBe(45)
		// The operator's note is preserved and the boundary's own disclosure is
		// appended to it (review 5242945675 Required 4 — the published policy
		// has to say that refusals are log-only).
		expect(parsed.value.policy.notes).toStartWith('tight caps ')
		expect(parsed.value.policy.notes).toContain('refusals are log-only')
		expect(parsed.value.policy.notes).toContain('fail-closed cliff')
		expect(parsed.value.policy.admission).toMatchObject({
			enabled: true,
			maxBidsPerWindow: 3,
			maxSeenEventIds: DEFAULT_BID_SPAM_POLICY.maxSeenEventIds,
			maxTrackedChildSubscriptions: DEFAULT_BID_SPAM_POLICY.maxTrackedChildSubscriptions,
			childReplayLookbackSec: DEFAULT_BID_SPAM_POLICY.childReplayLookbackSec,
			maxTagCount: 9,
			pendingTtlSec: 30,
		})
	})

	test('declares { enabled: false } when the admission master switch is off, and the document still parses', async () => {
		let published: any
		await publishValidatorPolicy({
			signer: {
				signEvent: async (template: any) => ({
					...template,
					id: '5'.repeat(64),
					pubkey: VALIDATOR_PUBKEY,
					sig: '6'.repeat(128),
				}),
			} as any,
			relayPool: {
				publish: async (event: any) => {
					published = event
				},
			} as any,
			name: 'Local validator',
			spamPolicy: { ...DEFAULT_BID_SPAM_POLICY, admissionEnabled: false },
		})

		const parsed = parseValidatorPolicyEvent(published)
		expect(parsed.ok).toBe(true)
		if (!parsed.ok) return
		// The union member is a declared choice, not dead code: this is the
		// shape a reader gets from a validator that enforces no admission
		// limits (review 5242945675 Required 3).
		expect(parsed.value.policy.admission).toEqual({ enabled: false })
	})
})
