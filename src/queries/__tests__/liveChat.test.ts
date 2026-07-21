import { describe, test, expect, mock, spyOn } from 'bun:test'
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
})
