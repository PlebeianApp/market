import { describe, expect, test } from 'bun:test'
import {
	describeValidatorTerms,
	projectMultipartyAnnouncements,
	recipientLine,
	validatorRecipientLine,
} from '../auction/multipartyAnnouncements'
import type { ParsedMultipartyPayoutCapability, ParsedMultipartyValidatorOffer } from '../auction/multipartyAuthorization'

const NOW = 1_800_000_000
const LIVE = NOW + 86_400
const DEAD = NOW - 1

const V1 = '1'.repeat(64)
const V2 = '2'.repeat(64)
const R1 = '3'.repeat(64)
const R2 = '4'.repeat(64)

const capability = (pubkey: string, id: string, expiresAt = LIVE): ParsedMultipartyPayoutCapability =>
	({
		id,
		recipient_pubkey: pubkey,
		payout_xpub: 'xpub',
		payout_xpub_pop: 'ab'.repeat(64),
		mints: ['https://mint.example'],
		valid_from: NOW - 100,
		expires_at: expiresAt,
	}) as unknown as ParsedMultipartyPayoutCapability

const offer = (
	pubkey: string,
	id: string,
	capabilityEventId: string,
	allocationBps: number,
	expiresAt = LIVE,
): ParsedMultipartyValidatorOffer =>
	({
		id,
		validator_pubkey: pubkey,
		payout_capability_event_id: capabilityEventId,
		allocation_bps: allocationBps,
		mints: ['https://mint.example'],
		valid_from: NOW - 100,
		expires_at: expiresAt,
	}) as unknown as ParsedMultipartyValidatorOffer

const profiles = [
	{ pubkey: V1, name: 'North Relay Watch', picture: 'https://img/north.png', about: 'strict' },
	{ pubkey: V2, name: 'Süd Validation' },
	{ pubkey: R1, name: "Marta's Orchard", picture: 'https://img/marta.png' },
	{ pubkey: R2 },
]

const project = (overrides: Partial<Parameters<typeof projectMultipartyAnnouncements>[0]> = {}) =>
	projectMultipartyAnnouncements({
		capabilities: [capability(V1, 'cap-v1'), capability(V2, 'cap-v2'), capability(R1, 'cap-r1'), capability(R2, 'cap-r2')],
		offers: [offer(V1, 'off-v1', 'cap-v1', 200), offer(V2, 'off-v2', 'cap-v2', 100)],
		profiles,
		policies: [{ validatorPubkey: V1, minValidators: 3, minQuorumPercent: 67 }],
		nowUnixSeconds: NOW,
		...overrides,
	})

describe('Multiparty announcement projection', () => {
	test('splits announcements into validators and recipients', () => {
		const result = project()
		expect(result.validators.map((entry) => entry.pubkey)).toEqual([V1, V2].sort())
		expect(result.recipients.map((entry) => entry.pubkey)).toEqual([R2, R1].sort())
	})

	test('carries the name, picture and fee so the picker can show them', () => {
		const north = project().validators.find((entry) => entry.pubkey === V1)
		expect(north?.name).toBe('North Relay Watch')
		expect(north?.picture).toBe('https://img/north.png')
		expect(north?.feeBps).toBe(200)
		expect(north?.minValidators).toBe(3)
		expect(north?.minQuorumPercent).toBe(67)
		expect(north?.capabilityEventId).toBe('cap-v1')
		expect(north?.offerEventId).toBe('off-v1')
	})

	test('a pubkey appears once — as a validator when it offers, never also as a recipient', () => {
		const result = project()
		const overlap = result.validators.filter((validator) => result.recipients.some((recipient) => recipient.pubkey === validator.pubkey))
		expect(overlap).toEqual([])
	})

	test('an offer without a visible capability is not pickable', () => {
		const result = project({ capabilities: [capability(R1, 'cap-r1')] })
		expect(result.validators).toEqual([])
		expect(result.recipients.map((entry) => entry.pubkey)).toEqual([R1])
	})

	test('an offer naming a different capability than the one announced is not pickable', () => {
		const result = project({
			capabilities: [capability(V1, 'cap-v1')],
			offers: [offer(V1, 'off-v1', 'cap-other', 200)],
		})
		expect(result.validators).toEqual([])
	})

	test('expired capabilities and offers are not pickable', () => {
		const result = project({
			capabilities: [capability(V1, 'cap-v1', DEAD), capability(R1, 'cap-r1', DEAD)],
			offers: [offer(V1, 'off-v1', 'cap-v1', 200, DEAD)],
		})
		expect(result.validators).toEqual([])
		expect(result.recipients).toEqual([])
	})

	test('the newest capability wins when a pubkey announces twice', () => {
		const result = project({
			capabilities: [capability(R1, 'cap-old', NOW + 10), capability(R1, 'cap-new', LIVE)],
			offers: [],
		})
		expect(result.recipients).toHaveLength(1)
		expect(result.recipients[0]?.capabilityEventId).toBe('cap-new')
	})

	test('named entries sort before unnamed ones, deterministically', () => {
		const first = project()
		const second = project()
		expect(first.recipients.map((entry) => entry.name ?? entry.pubkey)).toEqual(
			second.recipients.map((entry) => entry.name ?? entry.pubkey),
		)
		expect(first.recipients[0]?.name).toBe("Marta's Orchard")
	})

	test('builds the exact recipient lines the form parses', () => {
		const result = project()
		const north = result.validators.find((entry) => entry.pubkey === V1)
		const marta = result.recipients.find((entry) => entry.pubkey === R1)
		expect(validatorRecipientLine(north as never)).toBe(`validator, ${V1}, 200, cap-v1, off-v1`)
		expect(validatorRecipientLine(north as never, 350)).toBe(`validator, ${V1}, 350, cap-v1, off-v1`)
		expect(recipientLine(marta as never)).toBe(`v4v, ${R1}, 100, cap-r1`)
		expect(recipientLine(marta as never, 250)).toBe(`v4v, ${R1}, 250, cap-r1`)
	})

	test('describes a validator terms in one sentence', () => {
		const north = project().validators.find((entry) => entry.pubkey === V1)
		expect(describeValidatorTerms(north as never)).toBe(
			'2.00% of the settlement · needs at least 3 validators · quorum at least 67% of the pool',
		)
		const sud = project().validators.find((entry) => entry.pubkey === V2)
		expect(describeValidatorTerms(sud as never)).toBe('1.00% of the settlement')
	})

	test('the projection is frozen and deterministic', () => {
		const result = project()
		expect(Object.isFrozen(result)).toBe(true)
		expect(Object.isFrozen(result.validators)).toBe(true)
		expect(project().validators.map((entry) => entry.pubkey)).toEqual(result.validators.map((entry) => entry.pubkey))
	})
})
