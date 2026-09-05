/**
 * auth.ts NIP-07 negative tests (ADR-0008 A3-3).
 *
 * When no Nostr extension is present, `loginWithExtension` must fail with a
 * clear error and leave NO partial auth state: `user` stays null,
 * `isAuthenticated` stays false, and no auto-login / user-pubkey localStorage
 * keys are written. The heavy store/UI/query deps are stubbed out so this
 * exercises the real `loginWithExtension` control flow.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const mockNdkActions = {
	getNDK: mock(() => ({})),
	setSigner: mock(() => {}),
	removeSigner: mock(() => {}),
}
const mockCartActions = {
	reconcileRemoteCartForUser: mock(() => {}),
	clear: mock(() => {}),
}
mock.module('@/lib/stores/ndk', () => ({ ndkActions: mockNdkActions }))
mock.module('@/lib/stores/cart', () => ({ cartActions: mockCartActions }))
mock.module('@/queries/products', () => ({ fetchProductsByPubkey: mock(() => Promise.resolve([])) }))
mock.module('@/components/dialogs/TermsConditionsDialog', () => ({
	hasAcceptedTerms: mock(() => true),
	TERMS_ACCEPTED_KEY: 'terms_accepted',
}))
mock.module('@/lib/stores/ui', () => ({ uiActions: { openDialog: mock(() => {}) } }))

import { authActions, authStore, NOSTR_AUTO_LOGIN, NOSTR_USER_PUBKEY } from '@/lib/stores/auth'

const realWindow = globalThis.window
const realLocalStorage = globalThis.localStorage
const memoryStorage = new Map<string, string>()

beforeEach(() => {
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
	}))
	memoryStorage.clear()
	// window present, but no injected `nostr` — the "extension missing" shape.
	globalThis.window = {} as unknown as typeof window
	globalThis.localStorage = {
		getItem: (key: string) => memoryStorage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			memoryStorage.set(key, value)
		},
		removeItem: (key: string) => {
			memoryStorage.delete(key)
		},
		clear: () => {
			memoryStorage.clear()
		},
	} as unknown as Storage
})

afterEach(() => {
	globalThis.window = realWindow
	globalThis.localStorage = realLocalStorage
})

describe('loginWithExtension (NIP-07)', () => {
	test('extension missing → login error with no partial state', async () => {
		await expect(authActions.loginWithExtension()).rejects.toThrow(/extension/i)

		expect(authStore.state.isAuthenticated).toBe(false)
		expect(authStore.state.user).toBeNull()
		expect(authStore.state.isAuthenticating).toBe(false)
		expect(localStorage.getItem(NOSTR_USER_PUBKEY)).toBeNull()
		expect(localStorage.getItem(NOSTR_AUTO_LOGIN)).toBeNull()
	})
})
