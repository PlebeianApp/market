import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import {
	checkMultipartyBidGate,
	checkMultipartyPublishGate,
	checkMultipartyReadStatus,
	checkMultipartySettlementGate,
	describeValidatorShortfall,
	type MultipartySettlementGateInput,
} from '../auction/multipartyCheckPoints'
import { computeMultipartyLegFloor } from '../auction/multipartyLegFloor'
import type { AuctionMultipartyCanonicalManifestRow } from '../auction/multipartyManifestWire'
import { describeBidBlock, type MultipartyParticipation } from '../auction/multipartyParticipation'
import type { MultipartyPublishReadiness } from '../auction/multipartyPublishReadiness'

const utf8 = new TextEncoder()
const hex = (value: string): string =>
	Array.from(sha256(utf8.encode(value)))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')

const PATH = 'shared-path-0001'
const SELLER = '1'.repeat(64)
const VALIDATOR = '2'.repeat(64)
const SCHEDULE_COMMITMENT = 'a'.repeat(64)
const MANIFEST_COMMITMENT = 'b'.repeat(64)

const participation = (overrides: Partial<MultipartyParticipation> = {}): MultipartyParticipation => ({
	status: 'quorum_met',
	quorum: 2,
	auditorCount: 3,
	participatingAuditors: [VALIDATOR],
	missingAuditors: [],
	disregardedAcceptances: [],
	warnings: [],
	bidAllowed: true,
	...overrides,
})

const readiness = (overrides: Partial<MultipartyPublishReadiness> = {}): MultipartyPublishReadiness => ({
	ready: true,
	scheduledCount: 2,
	confirmedPubkeys: [VALIDATOR],
	unconfirmed: [],
	warnings: [],
	blockedByObligation: false,
	...overrides,
})

const legFloor = computeMultipartyLegFloor({ auxiliaryEntryCount: 2 })

const deriveChildPubkey = (payoutXpub: string, derivationPath: string): string => hex(`${payoutXpub}|${derivationPath}`)

const rows = (): AuctionMultipartyCanonicalManifestRow[] => [
	{
		manifest_index: 0,
		role: 'seller',
		recipient_pubkey: SELLER,
		child_pubkey: deriveChildPubkey('xpub-seller', PATH),
		amount_sats: 700,
	},
	{
		manifest_index: 1,
		role: 'validator',
		recipient_pubkey: VALIDATOR,
		child_pubkey: deriveChildPubkey('xpub-validator', PATH),
		amount_sats: 300,
	},
]

const payoutXpubForRow = (row: AuctionMultipartyCanonicalManifestRow): string =>
	row.manifest_index === 0 ? 'xpub-seller' : 'xpub-validator'

const settlementInput = (overrides: Partial<MultipartySettlementGateInput> = {}): MultipartySettlementGateInput => ({
	rows: rows(),
	payoutXpubForRow,
	deriveChildPubkey,
	release: {
		derivationPath: PATH,
		scheduleCommitment: SCHEDULE_COMMITMENT,
		manifestCommitment: MANIFEST_COMMITMENT,
	},
	expectedScheduleCommitment: SCHEDULE_COMMITMENT,
	expectedManifestCommitment: MANIFEST_COMMITMENT,
	activation: { payout_schedule_commitment: SCHEDULE_COMMITMENT } as never,
	...overrides,
})

describe('Multiparty check points', () => {
	test('publish gate: allowed when every recipient is confirmed and the quorum is met', () => {
		const result = checkMultipartyPublishGate({ readiness: readiness(), participation: participation() })
		expect(result.checkpoint).toBe('publish')
		expect(result.verdict).toBe('allowed')
		expect(result.reasons).toEqual([])
		expect(result.messages).toEqual([])
		expect(result.shortfall).toBeNull()
	})

	test('publish gate: blocked by the recipient liveness obligation alone', () => {
		const result = checkMultipartyPublishGate({
			readiness: readiness({ blockedByObligation: true, ready: false, unconfirmed: [{ pubkey: VALIDATOR, reason: 'offline' }] }),
			participation: participation(),
		})
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toEqual(['publish_blocked_by_recipient_liveness'])
		expect(result.messages[0]).toContain('offline')
	})

	test('publish gate: blocks when the validator set is already short, with one shared sentence', () => {
		const short = participation({ status: 'quorum_not_met', quorum: 3, participatingAuditors: ['2'.repeat(64)] })
		const result = checkMultipartyPublishGate({ readiness: readiness(), participation: short })
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toEqual(['publish_participation_shortfall'])
		expect(result.shortfall).toContain('Configured 3 validator(s) with quorum 3')
		expect(result.shortfall).toContain('Bids may never become valid')
		expect(result.messages).toEqual([result.shortfall as string])
	})

	test('read status: blocked, with the same shortfall sentence, when the quorum is not met', () => {
		const short = participation({ status: 'quorum_not_met', quorum: 3, auditorCount: 3, participatingAuditors: [] })
		const result = checkMultipartyReadStatus({ participation: short })
		expect(result.checkpoint).toBe('read')
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toEqual(['read_quorum_not_met'])
		expect(result.messages).toEqual([describeValidatorShortfall(short) as string])
	})

	test('read status: warns while the quorum is met but unactivated, allows once activated', () => {
		const pending = checkMultipartyReadStatus({ participation: participation() })
		expect(pending.verdict).toBe('warned')
		expect(pending.reasons).toEqual([])
		expect(pending.messages[0]).toContain('not yet authorised')

		const activated = checkMultipartyReadStatus({
			participation: participation(),
			activation: { payout_schedule_commitment: SCHEDULE_COMMITMENT } as never,
		})
		expect(activated.verdict).toBe('warned')
		expect(activated.messages[0]).toContain('settlement is authorised')
	})

	test('bid gate: blocked when participation forbids bidding, using the shared sentence', () => {
		const short = participation({ status: 'quorum_not_met', quorum: 3, auditorCount: 3, bidAllowed: false })
		const result = checkMultipartyBidGate({ participation: short, legFloor, bidAmountSats: 500 })
		expect(result.checkpoint).toBe('bid')
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toEqual(['bid_not_allowed_by_participation'])
		expect(result.shortfall).toBe(describeValidatorShortfall(short) as string)
		expect(result.messages[0]).toBe(result.shortfall)
	})

	test('bid gate: blocked below the leg floor, naming the floor and the leg count', () => {
		const result = checkMultipartyBidGate({ participation: participation(), legFloor, bidAmountSats: 20 })
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toEqual(['bid_below_leg_floor'])
		expect(result.messages[0]).toContain(`at least ${legFloor.minimumBidSats} sat`)
		expect(result.messages[0]).toContain(`${legFloor.payoutLegCount} payout leg(s)`)
	})

	test('bid gate: allowed at exactly the floor and above it', () => {
		const atFloor = checkMultipartyBidGate({
			participation: participation(),
			legFloor,
			bidAmountSats: legFloor.minimumBidSats,
		})
		expect(atFloor.verdict).toBe('allowed')
		expect(atFloor.reasons).toEqual([])

		const above = checkMultipartyBidGate({
			participation: participation(),
			legFloor,
			bidAmountSats: legFloor.minimumBidSats + 1,
		})
		expect(above.verdict).toBe('allowed')
	})

	test('bid gate: requires an activation only when the caller asks it to', () => {
		const optional = checkMultipartyBidGate({ participation: participation(), legFloor, bidAmountSats: 500 })
		expect(optional.verdict).toBe('allowed')

		const required = checkMultipartyBidGate({
			participation: participation(),
			legFloor,
			bidAmountSats: 500,
			activationRequired: true,
		})
		expect(required.verdict).toBe('blocked')
		expect(required.reasons).toEqual(['bid_activation_missing'])
	})

	test('settlement gate: allows a valid release with an activation, blocks without one', () => {
		const allowed = checkMultipartySettlementGate(settlementInput())
		expect(allowed.checkpoint).toBe('settlement')
		expect(allowed.verdict).toBe('allowed')
		expect(allowed.reasons).toEqual([])

		const blocked = checkMultipartySettlementGate(settlementInput({ activation: undefined }))
		expect(blocked.verdict).toBe('blocked')
		expect(blocked.reasons).toContain('settlement_activation_missing')
	})

	test('settlement gate: blocks a griefed leg and names the manifest indexes', () => {
		const tampered = rows()
		tampered[1] = { ...(tampered[1] as AuctionMultipartyCanonicalManifestRow), child_pubkey: 'f'.repeat(64) }
		const result = checkMultipartySettlementGate(settlementInput({ rows: tampered }))
		expect(result.verdict).toBe('blocked')
		expect(result.reasons).toContain('settlement_release_invalid')
		expect(result.reasons).toContain('release_derivation_mismatch')
		expect(result.messages.some((message) => message.includes('manifest index(es) 1'))).toBe(true)
	})

	test('settlement gate: reports a missing or mismatched pre-committed path', () => {
		const missing = checkMultipartySettlementGate(settlementInput({ committedPath: hex(PATH) }))
		expect(missing.reasons).toContain('release_path_commitment_missing')
		expect(missing.messages.some((message) => message.includes('committed to a derivation path'))).toBe(true)

		const mismatched = checkMultipartySettlementGate(
			settlementInput({
				committedPath: hex(PATH),
				release: {
					derivationPath: 'a-different-path',
					scheduleCommitment: SCHEDULE_COMMITMENT,
					manifestCommitment: MANIFEST_COMMITMENT,
					pathCommitment: hex(PATH),
				},
			}),
		)
		expect(mismatched.reasons).toContain('release_path_commitment_mismatch')
	})

	test('one state produces one sentence across the publish, read and bid gates', () => {
		const short = participation({ status: 'quorum_not_met', quorum: 3, auditorCount: 3, bidAllowed: false })
		const sentence = describeValidatorShortfall(short) as string
		// The gate layer does not own a wording of its own: it delegates.
		expect(sentence).toBe(describeBidBlock(short) as string)
		expect(checkMultipartyPublishGate({ readiness: readiness(), participation: short }).shortfall).toBe(sentence)
		expect(checkMultipartyReadStatus({ participation: short }).shortfall).toBe(sentence)
		const bid = checkMultipartyBidGate({ participation: short, legFloor, bidAmountSats: 500 })
		expect(bid.shortfall).toBe(sentence)
		expect(bid.messages[0]).toBe(sentence)
	})

	test('every result is frozen and deterministic', () => {
		const first = checkMultipartyPublishGate({ readiness: readiness(), participation: participation() })
		const second = checkMultipartyPublishGate({ readiness: readiness(), participation: participation() })
		expect(Object.isFrozen(first)).toBe(true)
		expect(Object.isFrozen(first.reasons)).toBe(true)
		expect(Object.isFrozen(first.messages)).toBe(true)
		expect(first.verdict).toBe(second.verdict)
		expect(first.reasons).toEqual(second.reasons)
		expect(first.messages).toEqual(second.messages)
	})
})
