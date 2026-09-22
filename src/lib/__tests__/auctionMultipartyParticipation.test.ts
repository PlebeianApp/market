import { describe, expect, test } from 'bun:test'
import type { ParsedMultipartyValidatorAcceptance } from '../auction/multipartyAuthorization'
import {
	describeBidBlock,
	isValidatorVerdictCounted,
	type MultipartyParticipationRoot,
	projectMultipartyParticipation,
} from '../auction/multipartyParticipation'

const COORDINATE = `30408:${'a'.repeat(64)}:auction-1`
const COMMITMENT = 'b'.repeat(64)
const NOW = 1_800_000_000

const root = (overrides: Partial<MultipartyParticipationRoot> = {}): MultipartyParticipationRoot => ({
	coordinate: COORDINATE,
	payout_schedule_commitment: COMMITMENT,
	auditors: ['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)],
	auditor_quorum: 2,
	...overrides,
})

const acceptance = (
	validatorPubkey: string,
	overrides: Partial<ParsedMultipartyValidatorAcceptance> = {},
): ParsedMultipartyValidatorAcceptance => ({
	id: `event-${validatorPubkey.slice(0, 3)}`,
	validator_pubkey: validatorPubkey,
	auction_root_event_id: 'f'.repeat(64),
	auction_coordinate: COORDINATE,
	payout_schedule_commitment: COMMITMENT,
	schedule_index: 0,
	payout_capability_event_id: '1'.repeat(64),
	validator_offer_event_id: '2'.repeat(64),
	allocation_bps: 500,
	expires_at: NOW + 3_600,
	...overrides,
})

describe('Auction multiparty participation', () => {
	test('an auction without auditors has no gate', () => {
		const participation = projectMultipartyParticipation({
			root: root({ auditors: [], auditor_quorum: 0 }),
			acceptances: [],
			nowUnixSeconds: NOW,
		})
		expect(participation.status).toBe('not_required')
		expect(participation.bidAllowed).toBe(true)
		expect(participation.warnings).toContain('quorum_not_configured')
		expect(describeBidBlock(participation)).toBeNull()
	})

	test('quorum met allows bidding and lists who is present', () => {
		const [a, b] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(b), acceptance(a)],
			nowUnixSeconds: NOW,
		})
		expect(participation.status).toBe('quorum_met')
		expect(participation.bidAllowed).toBe(true)
		expect(participation.participatingAuditors).toEqual([a, b].sort())
		expect(participation.missingAuditors).toEqual([root().auditors[2]])
		expect(participation.quorum).toBe(2)
		expect(participation.auditorCount).toBe(3)
	})

	test('quorum not met blocks bidding and explains why', () => {
		const [a] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(a)],
			nowUnixSeconds: NOW,
		})
		expect(participation.status).toBe('quorum_not_met')
		expect(participation.bidAllowed).toBe(false)
		expect(participation.warnings).toContain('validators_missing')
		const reason = describeBidBlock(participation)
		expect(reason).toContain('quorum 2')
		expect(reason).toContain('1 confirmed')
		expect(reason).toContain('Bids may never become valid')
	})

	test('silence is a rejection: confirmations at quorum with a configured auditor absent', () => {
		const [, b, c] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root({ auditor_quorum: 3 }),
			acceptances: [acceptance(b), acceptance(c)],
			nowUnixSeconds: NOW,
		})
		expect(participation.status).toBe('quorum_not_met')
		expect(participation.missingAuditors).toHaveLength(1)
	})

	test('acceptances that do not bind to this root are disregarded, not counted', () => {
		const [a, b] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root(),
			acceptances: [
				acceptance(a, { auction_coordinate: `30408:${'9'.repeat(64)}:other` }),
				acceptance(b, { payout_schedule_commitment: 'c'.repeat(64) }),
				acceptance('9'.repeat(64)),
				acceptance(a, { expires_at: NOW }),
			],
			nowUnixSeconds: NOW,
		})
		const warnings = participation.disregardedAcceptances.map((entry) => entry.warning).sort()
		expect(warnings).toEqual([
			'acceptance_commitment_mismatch',
			'acceptance_expired',
			'acceptance_not_scheduled',
			'acceptance_root_mismatch',
		])
		expect(participation.participatingAuditors).toEqual([])
		expect(participation.status).toBe('quorum_not_met')
	})

	test('a repeated acceptance is counted once', () => {
		const [a, b] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(a), acceptance(a, { id: 'redo' }), acceptance(b)],
			nowUnixSeconds: NOW,
		})
		expect(participation.participatingAuditors).toEqual([a, b].sort())
		expect(participation.disregardedAcceptances).toHaveLength(1)
		expect(participation.disregardedAcceptances[0]?.warning).toBe('acceptance_duplicate')
	})

	test('a quorum above the auditor count is flagged and cannot be met', () => {
		const [a] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root({ auditor_quorum: 4 }),
			acceptances: [acceptance(a)],
			nowUnixSeconds: NOW,
		})
		expect(participation.warnings).toContain('quorum_exceeds_auditors')
		expect(participation.status).toBe('quorum_not_met')
	})

	test('only participating validators have their verdicts counted', () => {
		const [a, b, c] = root().auditors
		const participation = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(a), acceptance(b)],
			nowUnixSeconds: NOW,
		})
		expect(isValidatorVerdictCounted(a, participation)).toBe(true)
		expect(isValidatorVerdictCounted(b, participation)).toBe(true)
		expect(isValidatorVerdictCounted(c, participation)).toBe(false)
		expect(isValidatorVerdictCounted('9'.repeat(64), participation)).toBe(false)
	})

	test('the projection is frozen and deterministic', () => {
		const [a, b] = root().auditors
		const forward = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(a), acceptance(b)],
			nowUnixSeconds: NOW,
		})
		const reversed = projectMultipartyParticipation({
			root: root(),
			acceptances: [acceptance(b), acceptance(a)],
			nowUnixSeconds: NOW,
		})
		expect(Object.isFrozen(forward)).toBe(true)
		expect(forward.participatingAuditors).toEqual(reversed.participatingAuditors)
		expect(forward.warnings).toEqual(reversed.warnings)
	})
})
