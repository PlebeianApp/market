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
})

describe('completeNip46LoginHandshake', () => {
	test('caches the verified remote pubkey when the handshake call stalls', async () => {
		const signer = {
			blockUntilReady: mock(async () => {
				throw new Error('relay handshake stalled')
			}),
			userPubkey: undefined as string | undefined,
			_user: undefined as { pubkey: string } | undefined,
		}
		const user = mock(async () => signer._user ?? signer.blockUntilReady())
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const authenticatedUser = await completeNip46LoginHandshake(signer as any, 'fallback-pubkey', 1, ndk as any)

		expect(authenticatedUser?.pubkey).toBe('fallback-pubkey')
		expect(signer.userPubkey).toBe('fallback-pubkey')
		expect((signer as any)._user?.pubkey).toBe('fallback-pubkey')
		expect((await user())?.pubkey).toBe('fallback-pubkey')
		expect(signer.blockUntilReady).toHaveBeenCalledTimes(1)
	})
})
