import { afterEach, describe, expect, test } from 'bun:test'
import { fetchProductsByPubkey, productsByPubkeyQueryOptions } from '../products'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { safeNpubEncode } from '@/lib/utils'

const VALID_PUBKEY = 'a'.repeat(64)

describe('productsByPubkeyQueryOptions', () => {
	test('disables the query while the pubkey is empty', () => {
		const options = productsByPubkeyQueryOptions('', true)

		expect(options.enabled).toBe(false)
	})

	test('disables the query for a malformed pubkey', () => {
		const options = productsByPubkeyQueryOptions('not-a-valid-pubkey')

		expect(options.enabled).toBe(false)
	})

	test('enables the query for a valid hex pubkey', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)

		expect(options.enabled).toBe(true)
	})

	test('caller composition: options.enabled && isAuthenticated stays false for malformed truthy input', () => {
		// Simulates the dashboard products route combining the factory guard
		// with its own isAuthenticated condition. A truthy-but-malformed pubkey
		// must still disable the query even when isAuthenticated is true.
		const options = productsByPubkeyQueryOptions('not-hex-but-truthy')
		const combinedEnabled = options.enabled && true // isAuthenticated = true

		expect(combinedEnabled).toBe(false)
	})

	test('caller composition: options.enabled && isAuthenticated is true for valid pubkey + auth', () => {
		const options = productsByPubkeyQueryOptions(VALID_PUBKEY)
		const combinedEnabled = options.enabled && true

		expect(combinedEnabled).toBe(true)
	})
})

describe('fetchProductsByPubkey direct-call guard', () => {
	test('throws on malformed pubkey without touching NDK (zero relay I/O)', () => {
		// isValidHexKey check fires before ndkActions.getNDK() is called,
		// so no NDK instance is created and no relay request is issued.
		expect(() => fetchProductsByPubkey('not-hex')).toThrow('invalid seller pubkey')
	})

	test('throws on empty pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('')).toThrow('invalid seller pubkey')
	})

	test('throws on whitespace pubkey without touching NDK', () => {
		expect(() => fetchProductsByPubkey('   ')).toThrow('invalid seller pubkey')
	})
})

describe('safeNpubEncode', () => {
	test('returns null for empty input', () => {
		expect(safeNpubEncode('')).toBeNull()
	})

	test('returns null for whitespace input', () => {
		expect(safeNpubEncode('   ')).toBeNull()
	})

	test('returns null for truncated hex', () => {
		expect(safeNpubEncode('abc123')).toBeNull()
	})

	test('returns null for non-hex string', () => {
		expect(safeNpubEncode('not-a-valid-pubkey')).toBeNull()
	})

	test('returns npub string for valid 64-char hex pubkey', () => {
		const result = safeNpubEncode(VALID_PUBKEY)

		expect(result).not.toBeNull()
		expect(result!.startsWith('npub1')).toBe(true)
	})
})

describe('fetchEventsWithTimeout: a deadline is not an answer', () => {
	const setFakeNdk = (mode: 'eose' | 'silent' | 'close') => {
		ndkStore.setState((state) => ({
			...state,
			ndk: {
				subscribe: (_filters: unknown, opts: { onEose?: () => void }) => {
					// Async, like a real relay: the helper assigns `subscription`
					// after subscribe() returns, and onEose reads it.
					if (mode === 'eose') queueMicrotask(() => opts.onEose?.())
					if (mode === 'close') queueMicrotask(() => opts.onClose?.())
					return { stop: () => {} }
				},
			} as never,
		}))
	}

	afterEach(() => {
		ndkStore.setState((state) => ({ ...state, ndk: null }))
	})

	test('requireEose: a timeout before EOSE rejects instead of answering "none"', async () => {
		setFakeNdk('silent')

		await expect(ndkActions.fetchEventsWithTimeout({ kinds: [30402] }, { timeoutMs: 20, requireEose: true })).rejects.toThrow(
			'produced no EOSE',
		)
	})

	// Reported in review: the guard covered only the timeout path, so a
	// subscription that closed before EOSE (a relay drop) still resolved
	// whatever had arrived -- the same false answer on a different exit.
	test('requireEose: a close before EOSE rejects instead of answering "none"', async () => {
		setFakeNdk('close')

		await expect(ndkActions.fetchEventsWithTimeout({ kinds: [30402] }, { timeoutMs: 200, requireEose: true })).rejects.toThrow(
			'produced no EOSE',
		)
	})

	test('requireEose: EOSE with zero events still resolves empty (a seller with no products)', async () => {
		setFakeNdk('eose')

		const events = await ndkActions.fetchEventsWithTimeout({ kinds: [30402] }, { timeoutMs: 200, requireEose: true })

		expect(events.size).toBe(0)
	})

	test('the default is unchanged for existing callers: a timeout still resolves', async () => {
		setFakeNdk('silent')

		const events = await ndkActions.fetchEventsWithTimeout({ kinds: [30402] }, { timeoutMs: 20 })

		expect(events.size).toBe(0)
	})
})

describe('fetchProductsByPubkey: relay readiness is not an empty result', () => {
	test('rejects while the relay connection is not ready, instead of resolving []', async () => {
		ndkStore.setState((state) => ({ ...state, ndk: null }))

		await expect(fetchProductsByPubkey(VALID_PUBKEY)).rejects.toThrow('not ready yet')
	})
})
