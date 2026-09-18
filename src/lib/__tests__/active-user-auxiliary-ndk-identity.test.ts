import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { NdkSignerAdapter } from '@/lib/nostr/ndk-signer-adapter'
import type { SignerCapability } from '@/lib/nostr/signer-capability'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { createWalletNwcNdk } from '@/lib/stores/wallet'

const USER_PUBKEY = 'aa'.repeat(32)
const originalLocalStorage = globalThis.localStorage
const storage = new Map<string, string>()

beforeAll(() => {
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
			removeItem: (key: string) => storage.delete(key),
			clear: () => storage.clear(),
		},
		configurable: true,
	})
})

afterAll(() => {
	Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
})

const capability: SignerCapability = {
	getPublicKey: async () => USER_PUBKEY,
	signEvent: async () => {
		throw new Error('not used')
	},
}

async function flushSetterContinuation(): Promise<void> {
	await Promise.resolve()
	await Promise.resolve()
}

function resetStores(): void {
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

beforeEach(resetStores)
afterEach(resetStores)

describe('auxiliary authenticated NDK identity isolation', () => {
	async function authenticatedMainState() {
		const mainNdk = ndkActions.initialize([])
		const adapter = new NdkSignerAdapter(capability)
		const canonicalUser = await adapter.user()
		authStore.setState((state) => ({ ...state, user: canonicalUser, isAuthenticated: true }))
		ndkActions.publishSigner(adapter, canonicalUser)
		await flushSetterContinuation()
		return { mainNdk, adapter, canonicalUser }
	}

	async function expectIsolatedAuxiliary(auxiliaryNdk: ReturnType<typeof createWalletNwcNdk>) {
		const mainNdk = ndkActions.getNDK()!
		const zapNdk = ndkActions.getZapNdk()!
		await flushSetterContinuation()

		expect(auxiliaryNdk.autoConnectUserRelays).toBe(false)
		expect(auxiliaryNdk.activeUser?.pubkey).toBe(USER_PUBKEY)
		expect(auxiliaryNdk.activeUser?.ndk).toBe(auxiliaryNdk)
		expect(authStore.state.user?.ndk).toBe(mainNdk)
		expect(mainNdk.activeUser?.ndk).toBe(mainNdk)
		expect(zapNdk.activeUser?.ndk).toBe(zapNdk)
		expect(auxiliaryNdk.activeUser).not.toBe(authStore.state.user)
		expect(auxiliaryNdk.activeUser).not.toBe(mainNdk.activeUser)
	}

	test('cached wallet NWC constructor owns an isolated user view and no relay discovery', async () => {
		const { adapter } = await authenticatedMainState()
		const auxiliaryNdk = createWalletNwcNdk('wss://wallet.example')
		auxiliaryNdk.signer = adapter

		await expectIsolatedAuxiliary(auxiliaryNdk)
	})

	test('one-shot payment NWC constructor owns an isolated user view and no relay discovery', async () => {
		const { adapter } = await authenticatedMainState()
		const { createPaymentNwcNdk } = await import('@/publish/payment')
		const auxiliaryNdk = createPaymentNwcNdk('wss://payment.example')
		auxiliaryNdk.signer = adapter

		await expectIsolatedAuxiliary(auxiliaryNdk)
	})
})
