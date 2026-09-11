import { describe, expect, it, mock } from 'bun:test'
import { APP_AUCTION_DLEQ_ROLLOUT_START_AT } from '../auction/constants'
import { assertAuctionMintsSupportDleq, mintSupportsDleq } from '../auction/validation'
import { mintSupportsDleq as canonicalMintSupportsDleq } from '../cashu/mintCapability'

/**
 * DLEQ publish gate — ADR-0011 Decisions 4 (mint compatibility, fail-closed)
 * and 6 (migration by `start_at`).
 *
 * When an auction is scheduled to start at/after the rollout boundary, every
 * allowlisted mint must advertise NUT-12 DLEQ support (via `/v1/info`). Any
 * mint that does not is a hard reject with a clear error naming the mint;
 * auctions starting before the boundary are grandfathered (no network probes).
 */
describe('DLEQ publish gate (ADR-0011 Decisions 4 & 6)', () => {
	const boundary = APP_AUCTION_DLEQ_ROLLOUT_START_AT

	describe('assertAuctionMintsSupportDleq', () => {
		it('grandfathers auctions starting before the rollout boundary (no mint probes)', async () => {
			const probe = mock(async (_mintUrl: string) => false)
			await expect(assertAuctionMintsSupportDleq(boundary - 1, ['https://legacy.example'], probe)).resolves.toBeUndefined()
			expect(probe).not.toHaveBeenCalled()
		})

		it('grandfathers an unset start_at of 0 (pre-populated sentinel)', async () => {
			const probe = mock(async (_mintUrl: string) => false)
			await expect(assertAuctionMintsSupportDleq(0, ['https://legacy.example'], probe)).resolves.toBeUndefined()
			expect(probe).not.toHaveBeenCalled()
		})

		it('allows a post-rollout auction when every mint advertises DLEQ support', async () => {
			const probe = mock(async (_mintUrl: string) => true)
			await expect(assertAuctionMintsSupportDleq(boundary, ['https://a.example', 'https://b.example'], probe)).resolves.toBeUndefined()
			expect(probe).toHaveBeenCalledTimes(2)
		})

		it('rejects a post-rollout auction and names the non-DLEQ mint', async () => {
			const probe = mock(async (mintUrl: string) => mintUrl !== 'https://legacy.example')
			await expect(assertAuctionMintsSupportDleq(boundary, ['https://a.example', 'https://legacy.example'], probe)).rejects.toThrow(
				/legacy\.example/,
			)
		})

		it('reports every unsupported mint, not just the first', async () => {
			const probe = mock(async (mintUrl: string) => mintUrl === 'https://good.example')
			await expect(assertAuctionMintsSupportDleq(boundary, ['https://bad1.example', 'https://bad2.example'], probe)).rejects.toThrow(
				/bad1\.example.*bad2\.example/,
			)
		})

		it('fails closed when a mint support probe throws', async () => {
			const probe = mock(async (_mintUrl: string) => {
				throw new Error('network unreachable')
			})
			await expect(assertAuctionMintsSupportDleq(boundary, ['https://a.example'], probe)).rejects.toThrow(/NUT-12|DLEQ/)
		})

		it('allows a post-rollout auction with an empty mint allowlist (nothing to verify)', async () => {
			const probe = mock(async (_mintUrl: string) => false)
			await expect(assertAuctionMintsSupportDleq(boundary, [], probe)).resolves.toBeUndefined()
			expect(probe).not.toHaveBeenCalled()
		})
	})

	describe('mintSupportsDleq', () => {
		it('returns true when the mint advertises NUT-12 DLEQ support', async () => {
			const mintClient = { getInfo: mock(async () => ({ nuts: { '12': { supported: true } } })) }
			await expect(mintSupportsDleq('https://dleq.example', { mintClient: mintClient as never })).resolves.toBe(true)
		})

		it('returns false when the mint does not advertise NUT-12 at all', async () => {
			const mintClient = { getInfo: mock(async () => ({ nuts: { '4': {}, '5': {} } })) }
			await expect(mintSupportsDleq('https://legacy.example', { mintClient: mintClient as never })).resolves.toBe(false)
		})

		it('returns false when NUT-12 is present but explicitly disabled', async () => {
			const mintClient = { getInfo: mock(async () => ({ nuts: { '12': { supported: false } } })) }
			await expect(mintSupportsDleq('https://disabled.example', { mintClient: mintClient as never })).resolves.toBe(false)
		})

		it('fails closed (false) when the mint info fetch throws', async () => {
			const mintClient = {
				getInfo: mock(async () => {
					throw new Error('mint unreachable')
				}),
			}
			await expect(mintSupportsDleq('https://down.example', { mintClient: mintClient as never })).resolves.toBe(false)
		})

		// The auction-layer surface must be the SAME function object as the
		// canonical implementation in `../cashu/mintCapability` — otherwise a
		// duplicate (without the bounded timeout) can silently return and hang
		// the publish gate on a slow mint `/v1/info`.
		it('is the same function object as the canonical mintCapability implementation', () => {
			expect(mintSupportsDleq).toBe(canonicalMintSupportsDleq)
		})

		it('canonical probe still fails closed when a fake mint getInfo rejects', async () => {
			const mintClient = {
				getInfo: mock(async () => {
					throw new Error('mint unreachable')
				}),
			}
			await expect(canonicalMintSupportsDleq('https://down.example', { mintClient: mintClient as never })).resolves.toBe(false)
		})

		it('accepts the canonical options superset (timeoutMs) through the auction re-export', async () => {
			// Proves the auction surface is the bounded canonical probe, not the
			// old duplicate whose options were `{ mintClient? }` only: a hung
			// `/v1/info` must resolve false via the per-request timeout.
			const mintClient = {
				getInfo: () =>
					new Promise(() => {
						// never resolves — simulate a hung mint
					}),
			}
			await expect(mintSupportsDleq('https://hung.example', { mintClient: mintClient as never, timeoutMs: 20 })).resolves.toBe(false)
		})
	})
})
