import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { authActions, completeNip46LoginHandshake, NOSTR_USER_PUBKEY, persistAuthenticatedLoginState } from '../stores/auth'

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

	test('does not enable auto-login without an explicit opt-in', () => {
		persistAuthenticatedLoginState({ pubkey: 'remote-pubkey' } as any)

		expect(localStorage.getItem('nostr_auto_login')).toBeNull()
	})
})

describe('logout', () => {
	beforeEach(() => {
		const storage = createLocalStorageStub()
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
		})
	})

	test('clears the persisted user pubkey', () => {
		localStorage.setItem(NOSTR_USER_PUBKEY, 'remote-pubkey')

		authActions.logout()

		expect(localStorage.getItem(NOSTR_USER_PUBKEY)).toBeNull()
	})

	test('does not require storage to log out', () => {
		const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
		})

		try {
			expect(() => authActions.logout()).not.toThrow()
		} finally {
			Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor!)
		}
	})
})

describe('auth storage bootstrap', () => {
	beforeEach(() => {
		const storage = createLocalStorageStub()
		Object.defineProperty(globalThis, 'localStorage', {
			value: storage,
			configurable: true,
		})
	})

	test('does nothing when storage is unavailable', async () => {
		const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
		const originalConsoleError = console.error
		const consoleError = mock(() => {})
		Object.defineProperty(globalThis, 'localStorage', {
			value: undefined,
			configurable: true,
		})
		console.error = consoleError

		try {
			await authActions.getAuthFromLocalStorageAndLogin()

			expect(consoleError).not.toHaveBeenCalled()
		} finally {
			console.error = originalConsoleError
			Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor!)
		}
	})
})

describe('completeNip46LoginHandshake', () => {
	const remoteSignerPubkey = 'a'.repeat(64)
	const actualUserPubkey = 'b'.repeat(64)
	const expectedUserPubkey = 'c'.repeat(64)

	test('resolves the actual user with get_public_key after a handshake timeout', async () => {
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(() => new Promise(() => {})),
			getPublicKey: mock(async () => actualUserPubkey),
			userPubkey: undefined as string | undefined,
			_user: undefined as { pubkey: string } | undefined,
			user: mock(async function (this: { _user?: { pubkey: string } }) {
				if (!this._user) throw new Error('Remote user not ready')
				return this._user
			}),
			get userSync() {
				if (!this._user) throw new Error('Remote user not ready synchronously')
				return this._user
			},
			get pubkey() {
				if (!this.userPubkey) throw new Error('Not ready')
				return this.userPubkey
			},
			rpc: {
				eventNames: mock(() => []),
				removeAllListeners: mock(() => {}),
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, actualUserPubkey, 1, ndk as any)

		expect(loginResult?.user.pubkey).toBe(actualUserPubkey)
		expect(signer.blockUntilReady).toHaveBeenCalledTimes(1)
		expect(signer.getPublicKey).toHaveBeenCalledTimes(1)
		expect(signer.userPubkey).toBe(actualUserPubkey)
		expect(signer.bunkerPubkey).toBe(remoteSignerPubkey)
		expect(loginResult?.signer).toBe(signer as any)
		expect(loginResult?.signer.pubkey).toBe(actualUserPubkey)
		expect((signer as any)._user?.pubkey).toBe(actualUserPubkey)
		expect((await loginResult?.signer.user())?.pubkey).toBe(actualUserPubkey)
		expect(loginResult?.signer.userSync.pubkey).toBe(actualUserPubkey)
	})

	test('fails closed when get_public_key does not respond after a timeout', async () => {
		const responseEvents: string[] = []
		const removeAllListeners = mock(() => {})
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(() => {
				responseEvents.push('response-connect')
				return new Promise(() => {})
			}),
			getPublicKey: mock(() => {
				responseEvents.push('response-get_public_key')
				return new Promise(() => {})
			}),
			userPubkey: undefined as string | undefined,
			rpc: {
				eventNames: () => responseEvents,
				removeAllListeners,
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, undefined, 1, ndk as any)

		expect(loginResult).toBeNull()
		expect(signer.userPubkey).toBeUndefined()
		expect(signer.bunkerPubkey).toBe(remoteSignerPubkey)
		expect(removeAllListeners).toHaveBeenCalledWith('response-connect')
		expect(removeAllListeners).toHaveBeenCalledWith('response-get_public_key')
	})

	test('restores a configured user key when get_public_key returns a mismatch', async () => {
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(() => new Promise(() => {})),
			getPublicKey: mock(async () => {
				expect(signer.userPubkey).toBeUndefined()
				return actualUserPubkey
			}),
			userPubkey: expectedUserPubkey,
			rpc: {
				eventNames: mock(() => []),
				removeAllListeners: mock(() => {}),
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, expectedUserPubkey, 1, ndk as any)

		expect(loginResult).toBeNull()
		expect(signer.getPublicKey).toHaveBeenCalledTimes(1)
		expect(signer.userPubkey).toBe(expectedUserPubkey)
		expect(signer.bunkerPubkey).toBe(remoteSignerPubkey)
	})

	test('rejects a completed handshake that differs from the persisted expected user', async () => {
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => ({ pubkey: actualUserPubkey })),
			getPublicKey: mock(async () => actualUserPubkey),
			userPubkey: actualUserPubkey,
			rpc: {
				eventNames: mock(() => []),
				removeAllListeners: mock(() => {}),
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, expectedUserPubkey, 1, ndk as any)

		expect(loginResult).toBeNull()
		expect(signer.getPublicKey).not.toHaveBeenCalled()
		expect(signer.userPubkey).toBe(actualUserPubkey)
	})

	test('fails closed when the handshake errors before resolving the user', async () => {
		const getPublicKey = mock(async () => actualUserPubkey)
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => {
				throw new Error('relay handshake stalled')
			}),
			getPublicKey,
			userPubkey: undefined as string | undefined,
			rpc: {
				eventNames: mock(() => []),
				removeAllListeners: mock(() => {}),
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, undefined, 1, ndk as any)

		expect(loginResult).toBeNull()
		expect(getPublicKey).not.toHaveBeenCalled()
	})
})
