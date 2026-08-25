import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { authActions, authStore, completeNip46LoginHandshake, NOSTR_USER_PUBKEY, persistAuthenticatedLoginState } from '../stores/auth'
import { cartActions } from '../stores/cart'
import { NDKNip46Signer, NDKPrivateKeySigner } from '../nostr/ndk-events'
import { ndkActions } from '../stores/ndk'

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

	test('cleans up response listeners after a successful handshake', async () => {
		const responseEvents = ['response-existing']
		const removeAllListeners = mock(() => {})
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => {
				responseEvents.push('response-connect')
				return { pubkey: actualUserPubkey }
			}),
			userPubkey: actualUserPubkey,
			rpc: {
				eventNames: () => responseEvents,
				removeAllListeners,
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, actualUserPubkey, 1, ndk as any)

		expect(loginResult?.user.pubkey).toBe(actualUserPubkey)
		expect(removeAllListeners).toHaveBeenCalledWith('response-connect')
		expect(removeAllListeners).not.toHaveBeenCalledWith('response-existing')
	})

	test('cleans up listeners registered after the handshake timeout', async () => {
		const responseEvents = ['response-existing']
		const removeAllListeners = mock(() => {})
		let resolveReadiness!: (user: { pubkey: string }) => void
		const readiness = new Promise<{ pubkey: string }>((resolve) => {
			resolveReadiness = resolve
		})
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => {
				await readiness
				responseEvents.push('response-late')
				return { pubkey: actualUserPubkey }
			}),
			getPublicKey: mock(async () => actualUserPubkey),
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
		resolveReadiness({ pubkey: actualUserPubkey })
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(loginResult?.user.pubkey).toBe(actualUserPubkey)
		expect(removeAllListeners).toHaveBeenCalledWith('response-late')
		expect(removeAllListeners).not.toHaveBeenCalledWith('response-existing')
	})

	test('fails closed when get_public_key does not respond after a timeout', async () => {
		const responseEvents = ['response-existing']
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
		expect(removeAllListeners).not.toHaveBeenCalledWith('response-existing')
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
		const responseEvents = ['response-existing']
		const removeAllListeners = mock(() => {})
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => {
				responseEvents.push('response-connect')
				return { pubkey: actualUserPubkey }
			}),
			getPublicKey: mock(async () => actualUserPubkey),
			userPubkey: actualUserPubkey,
			rpc: {
				eventNames: () => responseEvents,
				removeAllListeners,
			},
		}
		const ndk = {
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}

		const loginResult = await completeNip46LoginHandshake(signer as any, expectedUserPubkey, 1, ndk as any)

		expect(loginResult).toBeNull()
		expect(signer.getPublicKey).not.toHaveBeenCalled()
		expect(signer.userPubkey).toBe(actualUserPubkey)
		expect(removeAllListeners).toHaveBeenCalledWith('response-connect')
		expect(removeAllListeners).not.toHaveBeenCalledWith('response-existing')
	})

	test('fails closed when the handshake errors before resolving the user', async () => {
		const getPublicKey = mock(async () => actualUserPubkey)
		const responseEvents = ['response-existing']
		const removeAllListeners = mock(() => {})
		const signer = {
			bunkerPubkey: remoteSignerPubkey,
			blockUntilReady: mock(async () => {
				responseEvents.push('response-connect')
				throw new Error('relay handshake stalled')
			}),
			getPublicKey,
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
		expect(getPublicKey).not.toHaveBeenCalled()
		expect(removeAllListeners).toHaveBeenCalledWith('response-connect')
		expect(removeAllListeners).not.toHaveBeenCalledWith('response-existing')
	})
})

describe('loginWithNip46', () => {
	const remoteSignerPubkey = 'a'.repeat(64)
	const remoteUserPubkey = 'b'.repeat(64)
	const bunkerUrl = `bunker://${remoteSignerPubkey}`
	const authInitialState = {
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		bootstrapError: null,
	}
	let localStorageDescriptor: PropertyDescriptor | undefined
	let originalGetNDK: typeof ndkActions.getNDK
	let originalSetSigner: typeof ndkActions.setSigner
	let originalReconcileRemoteCartForUser: typeof cartActions.reconcileRemoteCartForUser
	let originalBlockUntilReady: typeof NDKNip46Signer.prototype.blockUntilReady

	beforeEach(() => {
		localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
		Object.defineProperty(globalThis, 'localStorage', {
			value: createLocalStorageStub(),
			configurable: true,
		})
		authStore.setState(() => authInitialState)

		originalGetNDK = ndkActions.getNDK
		originalSetSigner = ndkActions.setSigner
		originalReconcileRemoteCartForUser = cartActions.reconcileRemoteCartForUser
		originalBlockUntilReady = NDKNip46Signer.prototype.blockUntilReady

		const debug = Object.assign(() => {}, { extend: () => debug })
		const ndk = {
			debug,
			pools: [],
			getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
		}
		;(ndkActions as any).getNDK = () => ndk
		;(cartActions as any).reconcileRemoteCartForUser = mock(async () => {})
		;(NDKNip46Signer.prototype as any).blockUntilReady = mock(async () => ({ pubkey: remoteUserPubkey }))
	})

	afterEach(() => {
		ndkActions.getNDK = originalGetNDK
		ndkActions.setSigner = originalSetSigner
		cartActions.reconcileRemoteCartForUser = originalReconcileRemoteCartForUser
		NDKNip46Signer.prototype.blockUntilReady = originalBlockUntilReady
		authStore.setState(() => authInitialState)
		Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor!)
	})

	test('waits for signer setup before exposing an authenticated session', async () => {
		let resolveSetSigner: () => void
		let notifySignerSetupStarted: () => void
		const signerSetup = new Promise<void>((resolve) => {
			resolveSetSigner = resolve
		})
		const signerSetupStarted = new Promise<void>((resolve) => {
			notifySignerSetupStarted = resolve
		})
		const setSigner = mock(() => {
			notifySignerSetupStarted()
			return signerSetup
		})
		;(ndkActions as any).setSigner = setSigner

		const login = authActions.loginWithNip46(bunkerUrl, new NDKPrivateKeySigner('1'.repeat(64)))

		await signerSetupStarted
		expect(authStore.state.isAuthenticated).toBeFalse()
		expect(localStorage.getItem(NOSTR_USER_PUBKEY)).toBeNull()

		resolveSetSigner!()
		await login

		expect(setSigner).toHaveBeenCalledTimes(1)
		expect(authStore.state.isAuthenticated).toBeTrue()
		expect(authStore.state.user?.pubkey).toBe(remoteUserPubkey)
		expect(localStorage.getItem(NOSTR_USER_PUBKEY)).toBe(remoteUserPubkey)
	})

	test('fails closed without persisting a session when signer setup rejects', async () => {
		const setupError = new Error('signer setup failed')
		const reconcileRemoteCartForUser = cartActions.reconcileRemoteCartForUser as ReturnType<typeof mock>
		;(ndkActions as any).setSigner = mock(async () => {
			throw setupError
		})

		await expect(authActions.loginWithNip46(bunkerUrl, new NDKPrivateKeySigner('1'.repeat(64)))).rejects.toThrow(setupError)

		expect(authStore.state.isAuthenticated).toBeFalse()
		expect(localStorage.getItem(NOSTR_USER_PUBKEY)).toBeNull()
		expect(reconcileRemoteCartForUser).not.toHaveBeenCalled()
	})
})
