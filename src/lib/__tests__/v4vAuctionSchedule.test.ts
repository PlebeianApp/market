import { describe, expect, test } from 'bun:test'
import {
	PLEBIAN_MARKET_DEFAULT_BPS,
	addAuctionRow,
	allocateTotal,
	auctionRowId,
	auctionRowsFromLines,
	equalizeAuctionRows,
	lockedTotalBps,
	removeAuctionRow,
	scheduleTotalBps,
	serializeAuctionRows,
	toV4VShares,
	unpayableRows,
	updateAuctionRowAllocation,
	withPlatformDefault,
} from '@/lib/v4v/auction-schedule'

const VALIDATOR = '1'.repeat(64)
const CAP_ONE = '2'.repeat(64)
const OFFER_ONE = '3'.repeat(64)
const RECIPIENT = '4'.repeat(64)
const CAP_TWO = '5'.repeat(64)
const PLATFORM = '6'.repeat(64)

const validator = {
	pubkey: VALIDATOR,
	name: 'North Relay Watch',
	feeBps: 200,
	capabilityEventId: CAP_ONE,
	offerEventId: OFFER_ONE,
}

describe('projecting the draft into schedule rows', () => {
	test('a selected validator becomes a fixed row priced at its announced fee', () => {
		const rows = auctionRowsFromLines('', [validator])
		expect(rows).toHaveLength(1)
		expect(rows[0]?.locked).toBe(true)
		expect(rows[0]?.role).toBe('validator')
		expect(rows[0]?.bps).toBe(200)
		expect(rows[0]?.offerEventId).toBe(OFFER_ONE)
		expect(rows[0]?.lockedReason).toContain('2.00%')
	})

	test('a hand-written validator line cannot pay the validator less than it announced', () => {
		const lines = `validator, ${VALIDATOR}, 1, ${CAP_ONE}, ${OFFER_ONE}`
		const rows = auctionRowsFromLines(lines, [validator])
		expect(rows).toHaveLength(1)
		// The announced fee wins over the text, and the row stays fixed either way.
		expect(rows[0]?.bps).toBe(200)
		expect(rows[0]?.locked).toBe(true)
	})

	test('unreadable lines yield no rows instead of throwing — the resolver reports them', () => {
		expect(auctionRowsFromLines('not, a, real, line', [])).toEqual([])
	})

	test('the neutral rows carry the lock and its reason through to the editor', () => {
		const shares = toV4VShares(auctionRowsFromLines('', [validator]))
		expect(shares[0]?.locked).toBe(true)
		expect(shares[0]?.bps).toBe(200)
		expect(shares[0]?.lockedReason).toBeDefined()
	})
})

describe('serializing the schedule back into the draft', () => {
	test('a validator line keeps its offer id and a v4v line does not gain one', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 300, ${CAP_TWO}`, [validator])
		const text = serializeAuctionRows(rows)
		const lines = text.split('\n')
		expect(lines).toHaveLength(2)
		const validatorLine = lines.find((line) => line.startsWith('validator'))
		const v4vLine = lines.find((line) => line.startsWith('v4v'))
		expect(validatorLine?.split(', ')).toHaveLength(5)
		expect(validatorLine).toContain(OFFER_ONE)
		expect(v4vLine?.split(', ')).toHaveLength(4)
	})

	test('the text round-trips through the draft parser', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 300, ${CAP_TWO}`, [validator])
		const again = auctionRowsFromLines(serializeAuctionRows(rows), [validator])
		expect(again.map((row) => [row.role, row.pubkey, row.bps])).toEqual([
			['v4v', RECIPIENT, 300],
			['validator', VALIDATOR, 200],
		])
	})
})

describe('moving the total', () => {
	test('the changeable rows are rescaled and the fixed fee is left alone', () => {
		const rows = [
			...auctionRowsFromLines(`v4v, ${RECIPIENT}, 100, ${CAP_TWO}`, [validator]),
			...auctionRowsFromLines(`v4v, ${PLATFORM}, 100, ${CAP_TWO}`, []).filter(() => false),
		]
		const next = allocateTotal(rows, 1_000)
		expect(lockedTotalBps(next)).toBe(200)
		expect(scheduleTotalBps(next)).toBe(1_000)
	})

	test('a total below the fixed fees clamps up to them rather than underpaying a validator', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 100, ${CAP_TWO}`, [validator])
		const next = allocateTotal(rows, 50)
		expect(scheduleTotalBps(next)).toBe(200)
		expect(next.find((row) => row.pubkey === RECIPIENT)?.bps).toBe(0)
	})

	test('splitting the changeable rows across several keeps the parts summing to the pool', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 300, ${CAP_TWO}\nv4v, ${PLATFORM}, 300, ${CAP_TWO}`, [validator])
		const next = allocateTotal(rows, 1_000)
		expect(scheduleTotalBps(next)).toBe(1_000)
		expect(lockedTotalBps(next)).toBe(200)
	})

	test('a schedule with nothing changeable is returned untouched', () => {
		const rows = auctionRowsFromLines('', [validator])
		expect(allocateTotal(rows, 5_000)).toEqual(rows)
	})
})

describe('row edits', () => {
	test('a locked row cannot be repriced or removed', () => {
		const rows = auctionRowsFromLines('', [validator])
		expect(updateAuctionRowAllocation(rows, auctionRowId('validator', VALIDATOR), 900)).toEqual(rows)
		expect(removeAuctionRow(rows, auctionRowId('validator', VALIDATOR))).toHaveLength(1)
	})

	test('equalizing leaves the fixed fee exactly where it was', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 100, ${CAP_TWO}\nv4v, ${PLATFORM}, 900, ${CAP_TWO}`, [validator])
		const next = equalizeAuctionRows(rows, 1_000)
		expect(next.find((row) => row.pubkey === VALIDATOR)?.bps).toBe(200)
		expect(next.find((row) => row.pubkey === RECIPIENT)?.bps).toBe(400)
		expect(next.find((row) => row.pubkey === PLATFORM)?.bps).toBe(400)
	})

	test('adding an announced recipient is idempotent', () => {
		const option = { pubkey: RECIPIENT, capabilityEventId: CAP_TWO, name: "Marta's Orchard" }
		const once = addAuctionRow([], option, 300)
		expect(addAuctionRow(once, option, 500)).toEqual(once)
		expect(once[0]?.capabilityEventId).toBe(CAP_TWO)
	})
})

describe('the platform default', () => {
	test('Plebian Market is seeded once, at the product flow share', () => {
		const seeded = withPlatformDefault([], PLATFORM, CAP_TWO)
		expect(seeded).toHaveLength(1)
		expect(seeded[0]?.bps).toBe(PLEBIAN_MARKET_DEFAULT_BPS)
		expect(seeded[0]?.name).toBe('Plebian Market')
		expect(seeded[0]?.locked).toBe(false)
		// Seeding twice does not duplicate the row.
		expect(withPlatformDefault(seeded, PLATFORM, CAP_TWO)).toHaveLength(1)
	})

	test('a platform with no announced capability is still seeded, and named as unpayable', () => {
		const seeded = withPlatformDefault([], PLATFORM, undefined)
		expect(seeded).toHaveLength(1)
		const unpayable = unpayableRows(seeded)
		expect(unpayable).toHaveLength(1)
		expect(unpayable[0]?.reason).toContain('payout capability')
	})

	test('a fully announced schedule has nothing unpayable', () => {
		const rows = auctionRowsFromLines(`v4v, ${RECIPIENT}, 300, ${CAP_TWO}`, [validator])
		expect(unpayableRows(rows)).toEqual([])
	})
})
