import { describe, expect, test } from 'bun:test'
import type { MintKeys } from '@cashu/cashu-ts'
import { DleqKeysetTerminalError, fetchDleqKeysetsForBids, fetchDleqKeysetsForBidsDetailed, type DleqKeysetFetcher } from '../cashu/dleq'
import type { ParsedBidEvent } from '../auction/events'

const MINT_A = 'https://mint-a.test'
const MINT_B = 'https://mint-b.test'
const KEYSET_1 = '00deadbeef'
const KEYSET_2 = '11cafebabe'

const makeKeyset = (id: string): MintKeys => ({ id, unit: 'sat', keys: { 1: '02' + 'a'.repeat(64) } }) as MintKeys

const makeBid = (mint: string, keysetId: string, amount: number = 0): ParsedBidEvent =>
	({
		id: '1'.repeat(64),
		mint,
		amount,
		dleqProofs: [{ id: keysetId, amount: 100, C: '02' + 'b'.repeat(64), e: 'aa', s: 'bb', r: 'cc' }],
	}) as unknown as ParsedBidEvent

describe('fetchDleqKeysetsForBids (ADR-0011 Blocker 1)', () => {
	test('fetches keysets only for allowlisted mints (bounded, no beacon)', async () => {
		const fetched: string[] = []
		const fetcher: DleqKeysetFetcher = async (mintUrl, keysetId) => {
			fetched.push(`${mintUrl}:${keysetId}`)
			return makeKeyset(keysetId)
		}
		const bids = [makeBid(MINT_A, KEYSET_1), makeBid(MINT_B, KEYSET_2)]
		const allowlist = [MINT_A]

		const map = await fetchDleqKeysetsForBids(bids, allowlist, fetcher)

		// Only the allowlisted mint's keyset is fetched — the attacker-supplied
		// mint B is never contacted (ADR-0004 §5.6 beacon prevention).
		expect(fetched).toEqual([`${MINT_A}:${KEYSET_1}`])
		expect(map.get(`${MINT_A}:${KEYSET_1}`)).toBeDefined()
		expect(map.get(`${MINT_B}:${KEYSET_2}`)).toBeUndefined()
	})

	test('dedupes repeated (mint, keyset) pairs', async () => {
		const fetched: string[] = []
		const fetcher: DleqKeysetFetcher = async (mintUrl, keysetId) => {
			fetched.push(`${mintUrl}:${keysetId}`)
			return makeKeyset(keysetId)
		}
		const bids = [makeBid(MINT_A, KEYSET_1), makeBid(MINT_A, KEYSET_1)]
		const map = await fetchDleqKeysetsForBids(bids, [MINT_A], fetcher)
		expect(fetched).toEqual([`${MINT_A}:${KEYSET_1}`])
		expect(map.size).toBe(1)
	})

	test('a failed keyset fetch leaves the entry absent (evidence unavailable → pending downstream)', async () => {
		const fetcher: DleqKeysetFetcher = async () => {
			throw new Error('mint down')
		}
		const map = await fetchDleqKeysetsForBids([makeBid(MINT_A, KEYSET_1)], [MINT_A], fetcher)
		expect(map.size).toBe(0)
	})

	test('bids without dleqProofs are skipped (no fetch)', async () => {
		const fetched: string[] = []
		const fetcher: DleqKeysetFetcher = async (mintUrl, keysetId) => {
			fetched.push(`${mintUrl}:${keysetId}`)
			return makeKeyset(keysetId)
		}
		const noDleqBid = { id: '2'.repeat(64), mint: MINT_A, dleqProofs: [] } as unknown as ParsedBidEvent
		const map = await fetchDleqKeysetsForBids([noDleqBid], [MINT_A], fetcher)
		expect(fetched).toEqual([])
		expect(map.size).toBe(0)
	})
})

describe('fetchDleqKeysetsForBidsDetailed — terminal vs transient (ADR-0011 review R3)', () => {
	test('a terminal miss is reported in unknownKeysets (bid → dleq_invalid), not as pending', async () => {
		const fetcher: DleqKeysetFetcher = async () => {
			throw new DleqKeysetTerminalError('mint has no such keyset')
		}
		const acq = await fetchDleqKeysetsForBidsDetailed([makeBid(MINT_A, KEYSET_1)], [MINT_A], fetcher)
		expect(acq.keysets.size).toBe(0)
		expect([...acq.unknownKeysets]).toEqual([`${MINT_A}:${KEYSET_1}`])
	})

	test('a transient failure stays pending (absent from both collections)', async () => {
		const fetcher: DleqKeysetFetcher = async () => {
			throw new Error('mint unreachable')
		}
		const acq = await fetchDleqKeysetsForBidsDetailed([makeBid(MINT_A, KEYSET_1)], [MINT_A], fetcher)
		expect(acq.keysets.size).toBe(0)
		expect(acq.unknownKeysets.size).toBe(0)
	})

	test('cap prioritisation: higher-amount (reserve-meeting) bids are gathered before lower-amount ones', async () => {
		const fetched: string[] = []
		const fetcher: DleqKeysetFetcher = async (mintUrl, keysetId) => {
			fetched.push(`${mintUrl}:${keysetId}`)
			return makeKeyset(keysetId)
		}
		// Low-amount bid FIRST in the array; high-amount second. With a cap of 1,
		// the high-amount bid must win the single fetch slot so a keyset flood
		// cannot starve a reserve-meeting bid (review 2026-09-18).
		const bids = [makeBid(MINT_A, KEYSET_1, 100), makeBid(MINT_A, KEYSET_2, 50000)]
		const acq = await fetchDleqKeysetsForBidsDetailed(bids, [MINT_A], fetcher, { maxKeysets: 1 })
		expect(fetched).toEqual([`${MINT_A}:${KEYSET_2}`])
		expect(acq.keysets.has(`${MINT_A}:${KEYSET_2}`)).toBe(true)
		expect(acq.keysets.has(`${MINT_A}:${KEYSET_1}`)).toBe(false)
	})

	test('caps the number of distinct keysets fetched (unbounded crafted bids cannot fan out)', async () => {
		const fetched: string[] = []
		const fetcher: DleqKeysetFetcher = async (mintUrl, keysetId) => {
			fetched.push(`${mintUrl}:${keysetId}`)
			return makeKeyset(keysetId)
		}
		const bids = [makeBid(MINT_A, KEYSET_1), makeBid(MINT_A, KEYSET_2)]
		const acq = await fetchDleqKeysetsForBidsDetailed(bids, [MINT_A], fetcher, { maxKeysets: 1 })
		expect(fetched).toHaveLength(1)
		expect(acq.keysets.size).toBe(1)
		// The pair beyond the cap is left absent (pending), never a beacon.
		expect(acq.unknownKeysets.size).toBe(0)
	})
})
