import { describe, expect, test } from 'bun:test'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import type {
	DemoCometStateV1,
	DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import { createLoopbackCometReader } from './demo-comet-displacement-verifier'
import {
	createDemoFridayFreshPayoutStateReader,
	demoFridayAuctionPayoutFreshnessPolicyFromEnv,
} from './demo-friday-auction-payout-freshness'

const CHAIN_ID = 'friday-chain'
const VALIDATORS_HASH = 'f'.repeat(64)
const SIGNERS = ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)]

function fixture(options: {
	chainId?: string
	stateChainId?: string
	blockTime?: number
	now?: number
} = {}) {
	const state: DemoCometStateV1 = {
		chain_id: options.stateChainId ?? CHAIN_ID,
		height: 20,
		auctions: {},
		bids: {},
		integrated_fundings: {},
		integrated_displacements: {},
	}
	const canonicalStateBytes = utf8ToBytes(JSON.stringify(state))
	const appHash = bytesToHex(sha256(canonicalStateBytes))
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return options.chainId ?? CHAIN_ID },
		async readCurrentState() {
			return {
				queryHeight: state.height,
				appHash,
				canonicalStateBytes,
				state: structuredClone(state),
			}
		},
		async readCommit(height) {
			return {
				height,
				blockTime: options.blockTime ?? 1_000,
				blockHash: 'a'.repeat(64),
				appHash,
				validatorsHash: VALIDATORS_HASH,
				commitSignerAddresses: SIGNERS,
			}
		},
		async readBlock(height) { return { height, blockHash: 'a'.repeat(64), transactions: [] } },
	}
	let now = options.now ?? 1_010
	return { reader, setNow(value: number) { now = value }, now: () => now }
}

describe('auction payout authenticated-head freshness', () => {
	test('requires both explicit deployment settings and rejects invalid bounds', () => {
		expect(demoFridayAuctionPayoutFreshnessPolicyFromEnv({})).toBeUndefined()
		for (const env of [
			{ PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS: '10' },
			{ PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS: '2' },
			{ PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS: '0', PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS: '0' },
			{ PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS: '10', PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS: '11' },
		]) {
			expect(() => demoFridayAuctionPayoutFreshnessPolicyFromEnv(env)).toThrow(/freshness/)
		}
		expect(demoFridayAuctionPayoutFreshnessPolicyFromEnv({
			PLEBEIAN_AUCTION_PAYOUT_MAX_HEAD_AGE_SECONDS: '10',
			PLEBEIAN_AUCTION_PAYOUT_MAX_FUTURE_SKEW_SECONDS: '2',
		})).toEqual({ maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 })
	})

	test('fails closed without a reviewed deployment policy before reading chain state', async () => {
		const held = fixture()
		let reads = 0
		held.reader.readChainId = async () => { reads += 1; return CHAIN_ID }
		const read = createDemoFridayFreshPayoutStateReader({
			reader: held.reader,
			chainId: CHAIN_ID,
			validatorsHash: VALIDATORS_HASH,
			policy: undefined,
			readTimeoutMs: 1_000,
			nowSeconds: held.now,
		})
		await expect(read()).rejects.toThrow(/explicit deployment freshness settings/)
		expect(reads).toBe(0)
	})

	test('accepts both exact boundaries of the reviewed 10-second/2-second policy', async () => {
		for (const blockTime of [990, 1_002]) {
			const held = fixture({ blockTime, now: 1_000 })
			const read = createDemoFridayFreshPayoutStateReader({
				reader: held.reader,
				chainId: CHAIN_ID,
				validatorsHash: VALIDATORS_HASH,
				policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
				readTimeoutMs: 1_000,
				nowSeconds: held.now,
			})
			await expect(read()).resolves.toMatchObject({
				observation: { queryHeight: 20, appHash: expect.any(String) },
				bindingCommit: { height: 21, blockTime },
			})
		}
	})

	test('rejects the first correctly authenticated but stale or future-dated head', async () => {
		for (const [blockTime, message] of [[989, /stale/], [1_003, /future-dated/]] as const) {
			const held = fixture({ blockTime, now: 1_000 })
			const read = createDemoFridayFreshPayoutStateReader({
				reader: held.reader,
				chainId: CHAIN_ID,
				validatorsHash: VALIDATORS_HASH,
				policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
				readTimeoutMs: 1_000,
				nowSeconds: held.now,
			})
			await expect(read()).rejects.toThrow(message)
		}
	})

	test('rejects reader/state chain substitution and a regressed host clock', async () => {
		for (const [held, message] of [
			[fixture({ chainId: 'other-chain' }), /reader chain differs/],
			[fixture({ stateChainId: 'other-chain' }), /state chain differs/],
		] as const) {
			const read = createDemoFridayFreshPayoutStateReader({
				reader: held.reader,
				chainId: CHAIN_ID,
				validatorsHash: VALIDATORS_HASH,
				policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
				readTimeoutMs: 1_000,
				nowSeconds: held.now,
			})
			await expect(read()).rejects.toThrow(message)
		}

		const held = fixture()
		const read = createDemoFridayFreshPayoutStateReader({
			reader: held.reader,
			chainId: CHAIN_ID,
			validatorsHash: VALIDATORS_HASH,
			policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
			readTimeoutMs: 1_000,
			nowSeconds: held.now,
		})
		await read()
		held.setNow(1_009)
		await expect(read()).rejects.toThrow(/clock is invalid or regressed/)
	})

	test('bounds a hung Comet transport, fails closed, and permits a fresh recovery read', async () => {
		const held = fixture()
		let release!: (value: string) => void
		let hang = true
		held.reader.readChainId = async (signal) => {
			if (!hang) return CHAIN_ID
			return new Promise<string>((resolve) => {
				release = resolve
				signal?.addEventListener('abort', () => {}, { once: true })
			})
		}
		const read = createDemoFridayFreshPayoutStateReader({
			reader: held.reader,
			chainId: CHAIN_ID,
			validatorsHash: VALIDATORS_HASH,
			policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
			readTimeoutMs: 5,
			nowSeconds: held.now,
		})
		await expect(read()).rejects.toThrow(/authenticated Comet read timed out/)
		hang = false
		release(CHAIN_ID)
		await expect(read()).resolves.toMatchObject({ observation: { queryHeight: 20 } })
	})

	test('propagates the end-to-end deadline into the loopback RPC fetch', async () => {
		let observedSignal: AbortSignal | undefined
		const transport = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			observedSignal = init?.signal ?? undefined
			observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true })
		})) as typeof fetch
		const read = createDemoFridayFreshPayoutStateReader({
			reader: createLoopbackCometReader('http://127.0.0.1:26657', transport),
			chainId: CHAIN_ID,
			validatorsHash: VALIDATORS_HASH,
			policy: { maximumHeadAgeSeconds: 10, maximumFutureSkewSeconds: 2 },
			readTimeoutMs: 5,
			nowSeconds: () => 1_010,
		})
		await expect(read()).rejects.toThrow(/authenticated Comet read timed out/)
		expect(observedSignal?.aborted).toBe(true)
	})
})
