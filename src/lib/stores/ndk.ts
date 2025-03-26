import NDK from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie'
import { Store } from '@tanstack/store'
import type { NDKSigner } from '@nostr-dev-kit/ndk'
import { authActions } from './auth'

interface NDKState {
	ndk: NDK | null
	isConnecting: boolean
	isConnected: boolean
	explicitRelayUrls: string[]
}

const initialState: NDKState = {
	ndk: null,
	isConnecting: false,
	isConnected: false,
	explicitRelayUrls: [],
}

export const ndkStore = new Store<NDKState>(initialState)

export const ndkActions = {
	initialize: (relays?: string[]) => {
		const state = ndkStore.state
		if (state.ndk) return state.ndk

		const dexieAdapter = new NDKCacheAdapterDexie({ dbName: 'nostr-cache' })
		const ndk = new NDK({
			cacheAdapter: dexieAdapter,
			explicitRelayUrls: relays && relays.length > 0 ? relays : [],
		})

		ndkStore.setState((state) => ({
			...state,
			ndk,
			explicitRelayUrls: relays || [],
		}))

		return ndk
	},

	connect: async (): Promise<void> => {
		const state = ndkStore.state
		if (!state.ndk || state.isConnected || state.isConnecting) return

		ndkStore.setState((state) => ({ ...state, isConnecting: true }))

		try {
			await state.ndk.connect()
			await new Promise<void>((resolve) => {
				state.ndk!.pool.on('connect', () => {
					ndkStore.setState((state) => ({ ...state, isConnected: true }))
					resolve()
				})
			})
		} finally {
			ndkStore.setState((state) => ({ ...state, isConnecting: false }))
		}
	},

	addExplicitRelay: (relayUrls: string[]): string[] => {
		const state = ndkStore.state
		if (!state.ndk) return []

		relayUrls.forEach((relayUrl) => {
			state.ndk!.addExplicitRelay(relayUrl)
		})

		const updatedUrls = [...state.explicitRelayUrls, ...relayUrls]
		ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
		return updatedUrls
	},

	setSigner: (signer: NDKSigner | undefined) => {
		const state = ndkStore.state
		if (!state.ndk) return

		state.ndk.signer = signer
		ndkStore.setState((state) => ({ ...state, signer }))
	},

	removeSigner: () => {
		const state = ndkStore.state
		if (!state.ndk) return
		state.ndk.signer = undefined
		ndkStore.setState((state) => ({ ...state, signer: undefined }))
	},

	getNDK: () => {
		return ndkStore.state.ndk
	},

	getUser: () => {
		const state = ndkStore.state
		if (!state.ndk || !state.ndk.signer) return null
		return state.ndk.signer.user
	},

	getSigner: () => {
		return ndkStore.state.ndk?.signer
	},
}

// React hook for consuming the store
export const useNDK = () => {
	return {
		...ndkStore.state,
		...ndkActions,
	}
}
