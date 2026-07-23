import { describe, test, expect } from 'bun:test'
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import {
	parseLiveActivity,
	resolveLiveActivityStatus,
	deriveLiveActivityStatus,
	LIVE_ACTIVITY_KIND,
} from '@/lib/nip53'

describe('liveChat queries', () => {
	describe('resolveLiveActivityStatus', () => {
		test('before start_at → always planned, even if relay says live', () => {
			const status = resolveLiveActivityStatus('live', 2000, 3000, 1000)
			expect(status).toBe('planned')
		})

		test('after bidding cutoff → always ended, even if relay says live', () => {
			const status = resolveLiveActivityStatus('live', 1000, 3000, 4000)
			expect(status).toBe('ended')
		})

		test('within bounds + relay status → uses relay status', () => {
			expect(resolveLiveActivityStatus('live', 1000, 3000, 2000)).toBe('live')
			expect(resolveLiveActivityStatus('planned', 1000, 3000, 2000)).toBe('planned')
			expect(resolveLiveActivityStatus('ended', 1000, 3000, 2000)).toBe('ended')
		})

		test('within bounds + no relay status → derives live from timestamps', () => {
			const status = resolveLiveActivityStatus(null, 1000, 3000, 2000)
			expect(status).toBe('live')
		})

		test('missing startsAt → does not force planned (relay or derived wins)', () => {
			const status = resolveLiveActivityStatus('live', 0, 3000, 2000)
			expect(status).toBe('live')
		})

		test('missing biddingCutoffAt → falls back to relay status, does not force ended', () => {
			const status = resolveLiveActivityStatus('live', 1000, 0, 5000)
			expect(status).toBe('live')
		})

		test('relay planned status is NOT upgraded to live by timestamps alone', () => {
			// If relay explicitly says planned, and we're within time bounds,
			// we trust the relay's planned status (it may know something we don't)
			const status = resolveLiveActivityStatus('planned', 1000, 3000, 2000)
			expect(status).toBe('planned')
		})

		test('relay ended status within bounds is respected', () => {
			// If relay says ended while we're still within time bounds, trust it
			const status = resolveLiveActivityStatus('ended', 1000, 3000, 2000)
			expect(status).toBe('ended')
		})
	})

	describe('deriveLiveActivityStatus (preliminary)', () => {
		test('uses biddingCutoffAt for end boundary (not maxEndAt)', () => {
			// This test documents that deriveLiveActivityStatus is now called
			// with biddingCutoffAt, which may differ from maxEndAt when
			// settlement grace exists
			expect(deriveLiveActivityStatus(1000, 3000, 4000)).toBe('ended')
			expect(deriveLiveActivityStatus(1000, 3000, 2000)).toBe('live')
			expect(deriveLiveActivityStatus(2000, 3000, 1000)).toBe('planned')
		})
	})

	describe('stale handling', () => {
		test('status=live activity older than 1 hour stays live (no age-based mutation)', () => {
			// The stale transformation that mutated live→ended based on event
			// age was removed per review. The CVM worker's status tag
			// is authoritative; the client must not second-guess it.
			const oldEvent = {
				pubkey: 'c'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 7200, // 2 hours old
				tags: [
					['d', 'auction:abcd:old'],
					['status', 'live'],
					['title', 'Old Live Auction'],
				],
			}

			const result = parseLiveActivity(oldEvent)
			expect(result.status).toBe('live')
		})

		test('missing created_at does NOT force ended status', () => {
			// Missing created_at must not be treated as "very old" (which would
			// flip live→ended). The stale check that did this was removed.
			const noTimestampEvent = {
				pubkey: 'd'.repeat(64),
				// created_at intentionally omitted
				tags: [
					['d', 'auction:abcd:notime'],
					['status', 'live'],
					['title', 'No Timestamp'],
				],
			}

			const result = parseLiveActivity(noTimestampEvent)
			expect(result.status).toBe('live')
		})

		test('ended status is preserved as-is', () => {
			const endedEvent = {
				pubkey: 'e'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 100,
				tags: [
					['d', 'auction:abcd:ended'],
					['status', 'ended'],
					['title', 'Ended Auction'],
				],
			}

			const result = parseLiveActivity(endedEvent)
			expect(result.status).toBe('ended')
		})
	})

	describe('fetchLiveActivity anti-spoofing', () => {
		test('parseLiveActivity uses CVM-authored event correctly', () => {
			const cvmPriv = crypto.getRandomValues(new Uint8Array(32))
			const cvmPub = getPublicKey(cvmPriv)
			const sellerPriv = crypto.getRandomValues(new Uint8Array(32))
			const sellerPub = getPublicKey(sellerPriv)

			const event = {
				pubkey: cvmPub,
				tags: [
					['d', 'auction:abcd:test'],
					['status', 'live'],
					['title', 'Test'],
					['p', sellerPub, '', 'Host'],
				],
			}

			const result = parseLiveActivity(event)
			expect(result.activityOwnerPubkey).toBe(cvmPub)
			expect(result.sellerPubkey).toBe(sellerPub)
			expect(result.coord).toContain(cvmPub)
			expect(result.coord).not.toContain(sellerPub)
		})

		test('spoofed event from non-CVM author would have different activityOwnerPubkey', () => {
			const attackerPriv = crypto.getRandomValues(new Uint8Array(32))
			const attackerPub = getPublicKey(attackerPriv)
			const sellerPriv = crypto.getRandomValues(new Uint8Array(32))
			const sellerPub = getPublicKey(sellerPriv)

			const spoofedEvent = {
				pubkey: attackerPub,
				tags: [
					['d', 'auction:abcd:test'],
					['status', 'live'],
					['title', 'Fake'],
					['p', sellerPub, '', 'Host'],
				],
			}

			const result = parseLiveActivity(spoofedEvent)
			expect(result.activityOwnerPubkey).toBe(attackerPub)
			expect(result.activityOwnerPubkey).not.toBe(sellerPub)
		})
	})
})
