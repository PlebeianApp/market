import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { completeNip46LoginHandshake, persistAuthenticatedLoginState } from '../stores/auth'

const createLocalStorageStub = () => {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear(),
	}
}

describe('persistAuthenticatedLoginState', () => {
	beforeEach(() => {
		const storage = createLocalStorageStub()
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
		})
	})

	test('stores the remote user pubkey without changing an existing disabled auto-login preference', () => {
		localStorage.setItem('nostr_auto_login', 'false')

		persistAuthenticatedLoginState(
			{ pubkey: 'remote-pubkey' } as any,
			'local-private-key',
			'bunker://remote-pubkey?relay=wss://relay.test&secret=abc123',
		)

		expect(localStorage.getItem('nostr_user_pubkey')).toBe('remote-pubkey')
		expect(localStorage.getItem('nostr_auto_login')).toBe('false')
		expect(localStorage.getItem('nostr_local_signer_key')).toBe('local-private-key')
		expect(localStorage.getItem('nostr_connect_url')).toBe('bunker://remote-pubkey?relay=wss://relay.test&secret=abc123')
	})

	test('keeps an existing enabled auto-login preference', () => {
		localStorage.setItem('nostr_auto_login', 'true')

		persistAuthenticatedLoginState({ pubkey: 'remote-pubkey' } as any)

		expect(localStorage.getItem('nostr_auto_login')).toBe('true')
	})

	test('enables auto-login by default for a first successful login', () => {
		persistAuthenticatedLoginState({ pubkey: 'remote-pubkey' } as any)

		expect(localStorage.getItem('nostr_auto_login')).toBe('true')
	})
})

describe('completeNip46LoginHandshake', () => {
	test('wraps the fallback signer without depending on NDK private state', async () => {
		const signer = {
			blockUntilReady: mock(async () => {
				throw new Error('relay handshake stalled')
			}),
			userPubkey: undefined as string | undefined,
			rpc: {
				eventNames: mock(() => []),
				removeAllListeners: mock(() => {}),
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, 'fallback-pubkey', 1, ndk as any)

		expect(loginResult?.user.pubkey).toBe('fallback-pubkey')
		expect(signer.blockUntilReady).toHaveBeenCalledTimes(1)
		expect(signer.userPubkey).toBe('fallback-pubkey')
		expect((signer as any)._user).toBeUndefined()
		expect((await loginResult?.signer.user())?.pubkey).toBe('fallback-pubkey')
		expect(loginResult?.signer.userSync.pubkey).toBe('fallback-pubkey')
	})

	test('cancels the timed-out handshake response listener before using the fallback', async () => {
		let eventNamesCalls = 0
		const removeAllListeners = mock(() => {})
		const signer = {
			bunkerPubkey: 'bunker-pubkey',
			blockUntilReady: mock(() => new Promise(() => {})),
			userPubkey: undefined as string | undefined,
			rpc: {
				eventNames: () => (eventNamesCalls++ === 0 ? [] : ['response-connect']),
				removeAllListeners,
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, undefined, 1, ndk as any)

		expect(loginResult?.user.pubkey).toBe('bunker-pubkey')
		expect(removeAllListeners).toHaveBeenCalledWith('response-connect')
	})
})
