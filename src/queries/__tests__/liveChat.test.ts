import { describe, test, expect } from 'bun:test'
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { parseLiveActivity, LIVE_ACTIVITY_KIND } from '@/lib/nip53'

describe('liveChat queries', () => {
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

	describe('stale handling removal', () => {
		test('status=live activity older than 1 hour stays live (no age-based mutation)', () => {
			// The stale transformation that mutated live→ended based on event
			// age was removed per PR #1149 review. The CVM worker's status tag
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
})
