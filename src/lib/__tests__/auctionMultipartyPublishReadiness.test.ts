import { describe, expect, test } from 'bun:test'
import { describePublishBlock, projectMultipartyPublishReadiness } from '../auction/multipartyPublishReadiness'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const NOW = 1_800_000_000

describe('Auction multiparty publish readiness', () => {
	test('every scheduled entry confirmed online means ready', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [C, A, B],
			observations: [
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
				{ pubkey: B, status: 'online', observedAtUnixSeconds: NOW },
				{ pubkey: C, status: 'online', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		expect(readiness.ready).toBe(true)
		expect(readiness.blockedByObligation).toBe(false)
		expect(readiness.confirmedPubkeys).toEqual([A, B, C])
		expect(describePublishBlock(readiness)).toBeNull()
	})

	test('an offline entry blocks publishing under the obligation', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A, B],
			observations: [
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
				{ pubkey: B, status: 'offline', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		expect(readiness.ready).toBe(false)
		expect(readiness.blockedByObligation).toBe(true)
		expect(readiness.unconfirmed).toEqual([{ pubkey: B, reason: 'offline' }])
		expect(describePublishBlock(readiness)).toContain('could not be confirmed')
	})

	test('an entry never observed, or only known as unknown, is unconfirmed', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A, B, C],
			observations: [{ pubkey: B, status: 'unknown', observedAtUnixSeconds: NOW }],
			nowUnixSeconds: NOW,
		})
		expect(readiness.unconfirmed).toEqual([
			{ pubkey: A, reason: 'not_observed' },
			{ pubkey: B, reason: 'unknown' },
			{ pubkey: C, reason: 'not_observed' },
		])
		expect(readiness.warnings).toContain('entries_unconfirmed')
	})

	test('a stale observation is unconfirmed when an age bound is supplied', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A],
			observations: [{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW - 120 }],
			nowUnixSeconds: NOW,
			maxObservationAgeSeconds: 60,
		})
		expect(readiness.unconfirmed).toEqual([{ pubkey: A, reason: 'stale' }])
		expect(readiness.ready).toBe(false)
	})

	test('the seller may override, and the override is recorded as a warning', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A],
			observations: [{ pubkey: A, status: 'offline', observedAtUnixSeconds: NOW }],
			enforce: false,
			nowUnixSeconds: NOW,
		})
		expect(readiness.ready).toBe(false)
		expect(readiness.blockedByObligation).toBe(false)
		expect(readiness.warnings).toContain('liveness_not_enforced')
		expect(describePublishBlock(readiness)).toBeNull()
	})

	test('the newest observation wins, and ties resolve to the least confirming status', () => {
		const newestWins = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A],
			observations: [
				{ pubkey: A, status: 'offline', observedAtUnixSeconds: NOW - 10 },
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		expect(newestWins.ready).toBe(true)

		const tieFailsClosed = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A],
			observations: [
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
				{ pubkey: A, status: 'offline', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		expect(tieFailsClosed.unconfirmed).toEqual([{ pubkey: A, reason: 'offline' }])
	})

	test('input order cannot change the outcome', () => {
		const forward = projectMultipartyPublishReadiness({
			scheduledPubkeys: [A, B],
			observations: [
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
				{ pubkey: B, status: 'offline', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		const reversed = projectMultipartyPublishReadiness({
			scheduledPubkeys: [B, A],
			observations: [
				{ pubkey: B, status: 'offline', observedAtUnixSeconds: NOW },
				{ pubkey: A, status: 'online', observedAtUnixSeconds: NOW },
			],
			nowUnixSeconds: NOW,
		})
		expect(forward).toEqual(reversed)
		expect(Object.isFrozen(forward)).toBe(true)
	})

	test('an auction with no scheduled entries is not ready and says so', () => {
		const readiness = projectMultipartyPublishReadiness({
			scheduledPubkeys: [],
			observations: [],
			nowUnixSeconds: NOW,
		})
		expect(readiness.ready).toBe(false)
		expect(readiness.warnings).toContain('no_scheduled_entries')
		expect(readiness.blockedByObligation).toBe(false)
	})
})
