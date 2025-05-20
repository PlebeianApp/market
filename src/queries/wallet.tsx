import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/ndk-wallet'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { walletKeys } from './queryKeyFactory'

// Constants for User's NWC Wallet List event
export const USER_NWC_WALLET_LIST_KIND = NDKKind.AppSpecificData // Using a common kind, distinguished by label
export const USER_NWC_WALLET_LIST_LABEL = 'market_user_nwc_wallets'

// Using the Wallet interface from the local store for now.
// If it diverges, we might need a separate UserNwcWallet interface here.
export type UserNwcWallet = import('@/lib/stores/wallet').Wallet

/**
 * Fetches the user's NWC wallet list from Nostr.
 * This event is encrypted by the user for themselves.
 */
export const fetchUserNwcWallets = async (userPubkey: string): Promise<UserNwcWallet[]> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.error('NDK not initialized for fetching NWC wallets')
		throw new Error('NDK not initialized for fetching NWC wallets')
	}
	if (!userPubkey) {
		console.error('User pubkey is required to fetch NWC wallets')
		throw new Error('User pubkey is required to fetch NWC wallets')
	}

	try {
		const events = await ndk.fetchEvents({
			kinds: [USER_NWC_WALLET_LIST_KIND],
			authors: [userPubkey],
			'#l': [USER_NWC_WALLET_LIST_LABEL],
		})

		if (events.size === 0) {
			return []
		}

		let mostRecentEvent: NDKEvent | undefined
		let mostRecentTimestamp = 0
		events.forEach((event) => {
			if (event.created_at && event.created_at > mostRecentTimestamp) {
				mostRecentEvent = event
				mostRecentTimestamp = event.created_at
			}
		})

		if (!mostRecentEvent) {
			return []
		}

		let decryptedContentJson = mostRecentEvent.content
		const signer = ndkActions.getSigner()

		if (signer) {
			const ndkUserForDecryption = await signer.user()
			if (ndkUserForDecryption && mostRecentEvent.pubkey === ndkUserForDecryption.pubkey) {
				try {
					decryptedContentJson = await signer.decrypt(ndkUserForDecryption, mostRecentEvent.content)
				} catch (e) {
					console.error('Failed to decrypt NWC wallet list, attempting to parse as plaintext:', e)
				}
			} else if (mostRecentEvent.pubkey !== userPubkey) {
				console.warn("Event pubkey does not match user's pubkey, decryption might be needed differently or skipped.")
			}
		} else {
			console.warn('No signer available, cannot attempt decryption of NWC wallet list.')
		}

		const wallets = JSON.parse(decryptedContentJson) as UserNwcWallet[]
		return wallets.map((wallet: any) => ({
			id: wallet.id || '', // Ensure id is always a string, use uuidv4 if it were imported and needed for new ones
			name: wallet.name || `Wallet ${Math.floor(Math.random() * 1000)}`,
			nwcUri: wallet.nwcUri,
			pubkey: wallet.pubkey || '',
			relays: wallet.relays || [],
			storedOnNostr: true, // Fetched from Nostr, so this is true
			createdAt: wallet.createdAt || Date.now(),
			updatedAt: wallet.updatedAt || Date.now(),
		}))
	} catch (error) {
		console.error('Failed to fetch or parse NWC wallets from Nostr:', error)
		toast.error('Could not load your wallets from Nostr.')
		return [] // Return empty array on error to prevent breaking UI
	}
}

/**
 * React Query hook for fetching the user's NWC wallet list.
 */
export const useUserNwcWalletsQuery = (userPubkey: string | undefined) => {
	return useQuery<UserNwcWallet[], Error>({
		queryKey: walletKeys.userNwcWallets(userPubkey || ''),
		queryFn: () => {
			if (!userPubkey) return Promise.resolve([])
			return fetchUserNwcWallets(userPubkey)
		},
		enabled: !!userPubkey,
		// Consider staleTime or refetchOnWindowFocus based on app needs
	})
}

export interface NwcBalance {
	balance: number // in satoshis
	timestamp: number
}

/**
 * Fetches the balance from an NWC wallet URI.
 * This function creates a temporary NDKNWCWallet instance.
 */
export const fetchNwcWalletBalance = async (nwcUri: string): Promise<NwcBalance | null> => {
	const ndkInstance = ndkActions.getNDK()
	if (!ndkInstance || !ndkInstance.signer) {
		console.error('NDK instance or signer not available for NWC balance fetch')
		toast.error('NDK setup incomplete. Cannot fetch balance.')
		return null
	}
	if (!nwcUri) {
		console.warn('NWC URI is undefined, cannot fetch balance.')
		return null
	}

	let nwcWalletInstance: NDKNWCWallet | null = null
	const nwcConnectionTimeoutDuration = 20000 // 20 seconds timeout

	try {
		nwcWalletInstance = new NDKNWCWallet(ndkInstance, { pairingCode: nwcUri })

		const readyPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(
					new Error(
						`NWC wallet connection timed out after ${nwcConnectionTimeoutDuration / 1000} seconds for URI: ${nwcUri.substring(0, 30)}...`,
					),
				)
			}, nwcConnectionTimeoutDuration)

			const onReady = async () => {
				clearTimeout(timeoutId)
				;(nwcWalletInstance as any)?.removeAllListeners('statusChanged') // Clean up status listener once ready
				try {
					await nwcWalletInstance?.updateBalance()
					resolve()
				} catch (updateBalanceError) {
					reject(updateBalanceError)
				}
			}

			const onStatusChanged = (newStatus: NDKWalletStatus) => {
				if (newStatus === ('error' as NDKWalletStatus) || newStatus === ('disconnected' as NDKWalletStatus)) {
					clearTimeout(timeoutId)
					nwcWalletInstance?.removeAllListeners('ready') // Clean up ready listener if status changes to error/disconnect
					reject(new Error(`NWC wallet status changed to ${newStatus} before becoming ready.`))
				}
			}

			nwcWalletInstance?.once('ready', onReady)
			;(nwcWalletInstance as any)?.on('statusChanged', onStatusChanged)
		})

		await readyPromise

		const balanceResponse = nwcWalletInstance.balance

		if (balanceResponse && typeof balanceResponse === 'object' && typeof balanceResponse.amount === 'number') {
			const balanceInSats = balanceResponse.amount // Use amount directly as sats
			return {
				balance: balanceInSats,
				timestamp: Date.now(),
			}
		} else if (typeof balanceResponse === 'number') {
			// If it's a direct number, assume it's already in sats based on new info
			const balanceInSats = balanceResponse
			return {
				balance: balanceInSats,
				timestamp: Date.now(),
			}
		} else {
			console.error('Failed to get balance or balance is not in expected format. Received:', balanceResponse)
			toast.error('Failed to retrieve a valid balance from the wallet.')
			return null
		}
	} catch (error: any) {
		console.error('Error fetching NWC wallet balance:', error)
		const errorMessage = error?.message || (typeof error === 'string' ? error : 'Failed to fetch balance')
		toast.error(`Balance fetch failed: ${errorMessage}`)
		return null
	} finally {
		if (nwcWalletInstance) {
			nwcWalletInstance.removeAllListeners('ready')
			;(nwcWalletInstance as any)?.removeAllListeners('statusChanged')
		}
	}
}

/**
 * React Query hook for fetching NWC wallet balance.
 */
export const useNwcWalletBalanceQuery = (nwcUri: string | undefined, enabled: boolean = false) => {
	return useQuery<NwcBalance | null, Error>({
		queryKey: walletKeys.nwcBalance(nwcUri || ''),
		queryFn: async () => {
			if (!nwcUri) return null
			return fetchNwcWalletBalance(nwcUri)
		},
		enabled: !!nwcUri && enabled,
		staleTime: 1000 * 60 * 5, // 5 minutes
		refetchOnWindowFocus: false,
	})
}
