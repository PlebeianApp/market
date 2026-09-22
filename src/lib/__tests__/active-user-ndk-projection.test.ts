import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { NDKUser } from '@/lib/nostr/ndk-events'
import type { SignerCapability } from '@/lib/nostr/signer-capability'
import { getSignerCapability, setSignerCapability } from '@/lib/nostr/signer-registry'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'

const USER_PUBKEY = 'aa'.repeat(32)
const OTHER_PUBKEY = 'bb'.repeat(32)

interface Deferred<T> {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function capability(getPublicKey: () => Promise<string>): SignerCapability {
	return {
		getPublicKey,
		signEvent: async () => {
			throw new Error('not used')
		},
	}
}

async function flushSetterContinuations(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

function resetNdkStore(): void {
	setSignerCapability(undefined)
	authStore.setState(() => ({
		user: null,
		isAuthenticated: false,
		needsDecryptionPassword: false,
		isAuthenticating: false,
		needsMigration: false,
		needsSessionUnlock: false,
	}))
	ndkStore.setState(() => ({
		ndk: null,
		zapNdk: null,
		isConnecting: false,
		isConnected: false,
		isZapNdkConnected: false,
		explicitRelayUrls: [],
		writeRelayUrls: [],
		activeNwcWalletUri: null,
		signer: undefined,
	}))
}

beforeEach(resetNdkStore)
afterEach(resetNdkStore)

describe('NDK active-user compatibility projection', () => {
	test('app-created main and zap NDK instances leave user-relay discovery to signer services', () => {
		const ndk = ndkActions.initialize([])

		expect(ndk.autoConnectUserRelays).toBe(false)
		expect(ndkActions.getZapNdk()?.autoConnectUserRelays).toBe(false)
	})

	test('projects distinct main and zap user views without rebinding the canonical authenticated user', () => {
		const mainNdk = ndkActions.initialize([])
		const zapNdk = ndkActions.getZapNdk()!
		const canonicalUser = mainNdk.getUser({ pubkey: USER_PUBKEY })
		const signer = { user: mock(async () => new NDKUser({ pubkey: USER_PUBKEY })) }

		ndkActions.publishSigner(signer as never, canonicalUser)

		expect(canonicalUser.ndk).toBe(mainNdk)
		expect(mainNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(mainNdk.activeUser?.ndk).toBe(mainNdk)
		expect(zapNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(zapNdk.activeUser?.ndk).toBe(zapNdk)
		expect(mainNdk.activeUser).not.toBe(zapNdk.activeUser)
		expect(mainNdk.activeUser).not.toBe(canonicalUser)
		expect(zapNdk.activeUser).not.toBe(canonicalUser)
	})

	test('same-pubkey late session view cannot replace signer or capability authority', async () => {
		const mainNdk = ndkActions.initialize([])
		const zapNdk = ndkActions.getZapNdk()!
		const lateViews = [deferred<NDKUser>(), deferred<NDKUser>()]
		let lateViewIndex = 0
		const signerA = { user: mock(() => lateViews[lateViewIndex++].promise) }
		const signerB = { user: mock(async () => new NDKUser({ pubkey: USER_PUBKEY })) }
		const capabilityA = capability(async () => USER_PUBKEY)
		const capabilityB = capability(async () => USER_PUBKEY)
		const canonicalUserA = mainNdk.getUser({ pubkey: USER_PUBKEY })

		setSignerCapability(capabilityA)
		authStore.setState((state) => ({ ...state, user: canonicalUserA, isAuthenticated: true }))
		ndkActions.publishSigner(signerA as never, canonicalUserA)
		ndkActions.publishSigner(undefined)
		setSignerCapability(undefined)
		authStore.setState((state) => ({ ...state, user: null, isAuthenticated: false }))
		const canonicalUserB = mainNdk.getUser({ pubkey: USER_PUBKEY })
		setSignerCapability(capabilityB)
		authStore.setState((state) => ({ ...state, user: canonicalUserB, isAuthenticated: true }))
		ndkActions.publishSigner(signerB as never, canonicalUserB)
		await flushSetterContinuations()

		lateViews[0].resolve(new NDKUser({ pubkey: USER_PUBKEY }))
		lateViews[1].resolve(new NDKUser({ pubkey: USER_PUBKEY }))
		await flushSetterContinuations()

		expect(mainNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(mainNdk.activeUser?.ndk).toBe(mainNdk)
		expect(zapNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(zapNdk.activeUser?.ndk).toBe(zapNdk)
		expect(mainNdk.signer).toBe(signerB as never)
		expect(zapNdk.signer).toBe(signerB as never)
		expect(ndkStore.state.signer).toBe(signerB as never)
		expect(getSignerCapability()).toBe(capabilityB)
		expect(authStore.state.isAuthenticated).toBe(true)
		expect(authStore.state.user?.pubkey).toBe(USER_PUBKEY)
		expect(authStore.state.user).toBe(canonicalUserB)
		expect(authStore.state.user?.ndk).toBe(mainNdk)
		expect('signer' in (mainNdk.activeUser as unknown as Record<string, unknown>)).toBe(false)
		expect('signer' in (zapNdk.activeUser as unknown as Record<string, unknown>)).toBe(false)
	})

	test('different-pubkey late continuation is repaired to the current compatibility identity', async () => {
		const mainNdk = ndkActions.initialize([])
		const zapNdk = ndkActions.getZapNdk()!
		const lateViews = [deferred<NDKUser>(), deferred<NDKUser>()]
		let lateViewIndex = 0
		const signerA = { user: mock(() => lateViews[lateViewIndex++].promise) }
		const signerB = { user: mock(async () => new NDKUser({ pubkey: OTHER_PUBKEY })) }

		ndkActions.publishSigner(signerA as never, mainNdk.getUser({ pubkey: USER_PUBKEY }))
		ndkActions.publishSigner(undefined)
		ndkActions.publishSigner(signerB as never, mainNdk.getUser({ pubkey: OTHER_PUBKEY }))
		await flushSetterContinuations()
		lateViews[0].resolve(new NDKUser({ pubkey: USER_PUBKEY }))
		lateViews[1].resolve(new NDKUser({ pubkey: USER_PUBKEY }))
		await flushSetterContinuations()

		expect(mainNdk.activeUser?.pubkey).toBe(OTHER_PUBKEY)
		expect(mainNdk.activeUser?.ndk).toBe(mainNdk)
		expect(zapNdk.activeUser?.pubkey).toBe(OTHER_PUBKEY)
		expect(zapNdk.activeUser?.ndk).toBe(zapNdk)
		expect(mainNdk.signer).toBe(signerB as never)
		expect(zapNdk.signer).toBe(signerB as never)
	})

	test('synchronous publication failure restores prior per-NDK views after queued candidate work settles', async () => {
		const mainNdk = ndkActions.initialize([])
		const zapNdk = ndkActions.getZapNdk()!
		const previousSigner = { user: mock(async () => new NDKUser({ pubkey: USER_PUBKEY })) }
		ndkActions.publishSigner(previousSigner as never, mainNdk.getUser({ pubkey: USER_PUBKEY }))
		await flushSetterContinuations()

		const candidateUserGate = deferred<NDKUser>()
		const candidateSigner = { user: mock(() => candidateUserGate.promise) }
		const signerDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(zapNdk), 'signer')!
		Object.defineProperty(zapNdk, 'signer', {
			configurable: true,
			get: () => signerDescriptor.get!.call(zapNdk),
			set: (signer) => {
				signerDescriptor.set!.call(zapNdk, signer)
				if (signer === candidateSigner) throw new Error('synchronous publication failed')
			},
		})

		try {
			expect(() => ndkActions.publishSigner(candidateSigner as never, mainNdk.getUser({ pubkey: OTHER_PUBKEY }))).toThrow(
				'synchronous publication failed',
			)
		} finally {
			delete (zapNdk as unknown as { signer?: unknown }).signer
		}

		candidateUserGate.resolve(new NDKUser({ pubkey: OTHER_PUBKEY }))
		await flushSetterContinuations()

		expect(mainNdk.signer).toBe(previousSigner as never)
		expect(zapNdk.signer).toBe(previousSigner as never)
		expect(ndkStore.state.signer).toBe(previousSigner as never)
		expect(mainNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(mainNdk.activeUser?.ndk).toBe(mainNdk)
		expect(zapNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(zapNdk.activeUser?.ndk).toBe(zapNdk)
	})

	test('a queued NDK signer setter cannot resurrect activeUser after synchronous detach', async () => {
		let signer: { user: () => Promise<{ pubkey: string; ndk?: unknown }> } | undefined
		let activeUser: { pubkey: string; ndk?: unknown } | undefined
		const activeUserListeners: Array<(user: typeof activeUser) => void> = []
		const ndk = {
			getUser({ pubkey }: { pubkey: string }) {
				return { pubkey, ndk }
			},
			get signer() {
				return signer
			},
			set signer(nextSigner: typeof signer) {
				signer = nextSigner
				void nextSigner?.user().then((user) => {
					user.ndk = ndk
					ndk.activeUser = user
				})
			},
			get activeUser() {
				return activeUser
			},
			set activeUser(user: typeof activeUser) {
				const changed = activeUser?.pubkey !== user?.pubkey
				activeUser = user
				if (changed) activeUserListeners.forEach((listener) => listener(user))
			},
			on(event: string, listener: (user: typeof activeUser) => void) {
				if (event === 'activeUser:change') activeUserListeners.push(listener)
			},
		}
		ndkStore.setState((state) => ({ ...state, ndk: ndk as never }))
		const canonicalUser = { pubkey: USER_PUBKEY }
		const userGate = deferred<typeof canonicalUser>()
		const candidateSigner = { user: mock(() => userGate.promise) }
		const publishAuthority = ndkActions.publishSigner as (signer: typeof candidateSigner | undefined, user?: typeof canonicalUser) => void

		publishAuthority(candidateSigner, canonicalUser)
		publishAuthority(undefined)
		expect(ndk.activeUser).toBeUndefined()

		userGate.resolve(canonicalUser)
		await Promise.resolve()
		await Promise.resolve()

		expect(ndk.activeUser).toBeUndefined()
	})
})
