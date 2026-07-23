import { describe, test, expect } from 'bun:test'
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { parseLiveActivity, resolveLiveActivityStatus, deriveLiveActivityStatus, LIVE_ACTIVITY_KIND } from '@/lib/nip53'

describe('liveChat queries', () => {
	describe('resolveLiveActivityStatus', () => {
		test('no CVM event → status is null → chat unavailable', () => {
			const status = resolveLiveActivityStatus(null)
			expect(status).toBe(null)
		})

		test('CVM says planned → status is planned (no timestamp override)', () => {
			const status = resolveLiveActivityStatus('planned')
			expect(status).toBe('planned')
		})

		test('CVM says live → status is live (even if client clock says it should be ended)', () => {
			const status = resolveLiveActivityStatus('live')
			expect(status).toBe('live')
		})

		test('CVM says ended → status is ended', () => {
			const status = resolveLiveActivityStatus('ended')
			expect(status).toBe('ended')
		})
	})

	describe('deriveLiveActivityStatus (preliminary)', () => {
		test('uses biddingCutoffAt for end boundary (not maxEndAt)', () => {
			// This test documents that deriveLiveActivityStatus is still called
			// with biddingCutoffAt, which may differ from maxEndAt when
			// settlement grace exists - this is used for polling frequency only
			expect(deriveLiveActivityStatus(1000, 3000, 4000)).toBe('ended')
			expect(deriveLiveActivityStatus(1000, 3000, 2000)).toBe('live')
			expect(deriveLiveActivityStatus(2000, 3000, 1000)).toBe('planned')
		})
	})

	describe('stale handling', () => {
		test('stale live event shows health warning but status remains live', () => {
			// The staleness check is a UI warning only - it does NOT override the CVM status
			// This test documents the UI behavior, not the status resolution logic
			const oldEvent = {
				pubkey: 'c'.repeat(64),
				created_at: Math.floor(Date.now() / 1000) - 7200, // 2 hours old
				updated_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour old
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
			// Missing timestamps must not be treated as "very old" (which would
			// flip live→ended). The staleness warning may appear but status is preserved.
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
