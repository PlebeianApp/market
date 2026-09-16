/**
 * Auth-store `unlockVaultedSession` regression over the REAL rehydrate seam
 * (ADR-0002 B-3, P1 fix). Unlike auth-session-vault.test.ts — which mocks
 * `@/lib/nostr/nostr-connect-session` — this file does NOT mock the seam:
 * `rehydrateNostrConnectSession` → `NostrConnectSigner.fromNbunksec` → the
 * connect RPC all run for real. Only the transport factory (`defaultPool`) is
 * stubbed to return a hermetic counting transport, so no network is touched.
 *
 * This is the regression that would have caught the P1 (unwired transport on
 * restore): before the fix, `unlockVaultedSession` threw "Missing
 * subscriptionMethod" and the vaulted session could not be restored.
 *
 * The second P1 consequence is covered too: the read-ONCE legacy migration
 * (`migrateLegacySessionToVault`) runs BEFORE the rehydrate, so on the
 * unwired transport it wrapped the plaintext session, DELETED the plaintext
 * pair, and only then failed — a destructive-then-fails path, not a plain
 * broken restore. The migration branch therefore gets its own real-seam
 * regression here (auth-session-vault.test.ts covers it only against the
 * mocked rehydrate).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { ReplaySubject, Observable } from 'rxjs'
import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import type { EventTemplate, NostrEvent } from 'nostr-tools/pure'
import { decodeNbunksec, encodeNbunksec } from 'applesauce-signers/helpers'

const USER_PUBKEY = '33'.repeat(32)
const CLIENT_SK = '11'.repeat(32)
const REMOTE_SK = '22'.repeat(32)
const clientPk = getPublicKey(hexToBytes(CLIENT_SK))
const remotePk = getPublicKey(hexToBytes(REMOTE_SK))
const BUNKER_SECRET = 'bunkersecret'

const mockNdkActions = {
	getNDK: mock(() => ({ getUser: () => ({ pubkey: USER_PUBKEY }) })),
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

// Stub ONLY the transport factory. The real `rehydrateNostrConnectSession`
// (imported below, NOT mocked) uses this pool for its connect RPC.
const countingTransport = (() => {
	const incoming = new ReplaySubject<NostrEvent | string>()
	const pool = {
		subscription: (_relays: string[], _filters: unknown[]): Observable<NostrEvent | string> => incoming.asObservable(),
		publish: async (_relays: string[], event: unknown): Promise<unknown> => {
			const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(REMOTE_SK), clientPk)
			const req = JSON.parse(nip44.v2.decrypt((event as NostrEvent).content, conversationKey))
			let result: string
			if (req.method === 'get_public_key') {
				result = USER_PUBKEY
			} else if (req.method === 'sign_event') {
				const template = typeof req.params[0] === 'string' ? JSON.parse(req.params[0]) : req.params[0]
				result = JSON.stringify(finalizeEvent(template as EventTemplate, hexToBytes(USER_PUBKEY)))
			} else {
				result = 'ack'
			}
			const conv = nip44.v2.utils.getConversationKey(hexToBytes(REMOTE_SK), clientPk)
			const content = nip44.v2.encrypt(JSON.stringify({ id: req.id, result }), conv)
			incoming.next(finalizeEvent({ kind: 24133, created_at: 1_700_000_000, tags: [['p', clientPk]], content }, hexToBytes(REMOTE_SK)))
			return []
		},
	}
	return { pool }
})()

mock.module('@/lib/nostr/nostr-connect-signer', () => ({
	connectBunkerSigner: mock(() => Promise.reject(new Error('not used in this test'))),
	defaultPool: () => countingTransport.pool,
}))

import { authActions, authStore, NOSTR_AUTO_LOGIN, NOSTR_CONNECT_KEY, NOSTR_LOCAL_SIGNER_KEY } from '@/lib/stores/auth'
import { hasLegacyPlaintextSession, hasVaultedSession, saveVaultedSession, unlockVault } from '@/lib/nostr/session-vault'
import { runSignerTeardown, setSignerCapability, setSignerTeardown } from '@/lib/nostr/signer-registry'

const TEST_ITERATIONS = 1_000

const realLocalStorage = globalThis.localStorage
const memoryStorage = new Map<string, string>()

beforeEach(() => {
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		needsSessionUnlock: false,
	}))
	memoryStorage.clear()
	mockNdkActions.setSigner.mockClear()
	mockCartActions.clear.mockClear()
	setSignerCapability(undefined)
	setSignerTeardown(undefined)
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
	globalThis.localStorage = realLocalStorage
	void runSignerTeardown()
})

/** A real nbunksec session the vault wraps. */
function makeNbunksec(): string {
	return encodeNbunksec({
		pubkey: remotePk,
		local_key: CLIENT_SK,
		relays: ['wss://signer.example.com'],
		secret: BUNKER_SECRET,
	})
}

/** The legacy plaintext pair auth.ts wrote pre-B-3: client key hex + bunker URL. */
const LEGACY_BUNKER_URL = `bunker://${remotePk}?relay=wss://signer.example.com&secret=${BUNKER_SECRET}`

describe('unlockVaultedSession over the REAL rehydrate seam (P1 regression)', () => {
	test('vaulted session unlock restores identity through the real NostrConnectSigner', async () => {
		await saveVaultedSession(makeNbunksec(), 'pass', { iterations: TEST_ITERATIONS })
		memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')

		await authActions.unlockVaultedSession('pass', { minIterations: TEST_ITERATIONS })

		// The real seam ran: vault unwrapped, signer rehydrated, identity restored.
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.needsSessionUnlock).toBe(false)
		expect(authStore.state.user?.pubkey).toBe(USER_PUBKEY)
		expect(hasVaultedSession()).toBe(true)
	})
})

describe('legacy migrate-on-unlock over the REAL rehydrate seam (P1 regression)', () => {
	test('migrating the legacy plaintext pair restores identity and keeps the vault, not the plaintext', async () => {
		memoryStorage.set(NOSTR_LOCAL_SIGNER_KEY, CLIENT_SK)
		memoryStorage.set(NOSTR_CONNECT_KEY, LEGACY_BUNKER_URL)
		memoryStorage.set(NOSTR_AUTO_LOGIN, 'true')

		// Threw "Missing subscriptionMethod" before the P1 fix — AFTER the
		// migration had already purged the plaintext pair.
		const user = await authActions.unlockVaultedSession('pass', { iterations: TEST_ITERATIONS })

		expect(user.pubkey).toBe(USER_PUBKEY)
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.needsSessionUnlock).toBe(false)
		// Read-ONCE migration: the vault now holds the wrapped legacy session
		// and the plaintext pair is gone.
		expect(hasVaultedSession()).toBe(true)
		expect(hasLegacyPlaintextSession()).toBe(false)
		expect(memoryStorage.has(NOSTR_LOCAL_SIGNER_KEY)).toBe(false)
		expect(memoryStorage.has(NOSTR_CONNECT_KEY)).toBe(false)
		const nbunksec = await unlockVault(undefined, 'pass', { minIterations: TEST_ITERATIONS })
		expect(decodeNbunksec(nbunksec).local_key).toBe(CLIENT_SK)
	})
})
