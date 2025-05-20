import { configStore } from '@/lib/stores/config'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet } from '@nostr-dev-kit/ndk-wallet'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { nip04 } from 'nostr-tools'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { walletKeys } from './queryKeyFactory'

/**
 * Interface for wallet details as per SPEC.md
 */
export interface WalletDetail {
	id: string // Event ID
	key: string // For tracking use case (e.g., "on-chain-index")
	value: string // Value for the key (e.g., "1")
	createdAt: number // When the wallet detail was created
	paymentDetailsEvent: string // Related payment details event coordinates
}

/**
 * Fetches wallet details for a specific payment details event
 */
export const fetchWalletDetails = async (paymentDetailsEvent: string): Promise<WalletDetail | null> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const appPubkey = configStore.state.config.appPublicKey
		if (!appPubkey) throw new Error('App public key not available')

		// Fetch wallet detail events related to the payment details event
		const events = await ndk.fetchEvents({
			kinds: [NDKKind.AppSpecificData],
			authors: [appPubkey], // Wallet details are signed by the app
			'#a': [paymentDetailsEvent], // Related to this payment details event
			'#l': ['wallet_detail'],
		})

		if (!events || events.size === 0) {
			console.log('No wallet detail events found for payment details:', paymentDetailsEvent)
			return null
		}

		// Find most recent wallet detail event
		let mostRecentEvent: NDKEvent | null = null
		let mostRecentTimestamp = 0

		// Convert the Set to Array to avoid iteration issues
		const eventsArray = Array.from(events)
		for (const event of eventsArray) {
			if (event.created_at && event.created_at > mostRecentTimestamp) {
				mostRecentEvent = event
				mostRecentTimestamp = event.created_at
			}
		}

		if (!mostRecentEvent) return null

		// Decrypt the content if the user has a signer
		const signer = ndkActions.getSigner()
		if (!signer) {
			console.warn('No signer available to decrypt wallet details')
			return null
		}

		const user = await signer.user()
		if (!user) return null

		// Decrypt the content - need to use nip04 directly since it's encrypted to the user
		let content
		try {
			content = await nip04.decrypt(
				mostRecentEvent.pubkey, // App public key
				user.pubkey, // User public key
				mostRecentEvent.content,
			)
			const parsedContent = JSON.parse(content)

			return {
				id: mostRecentEvent.id,
				key: parsedContent.key || '',
				value: parsedContent.value || '',
				createdAt: mostRecentEvent.created_at || 0,
				paymentDetailsEvent,
			}
		} catch (error) {
			console.error('Error decrypting wallet details:', error)
			return null
		}
	} catch (error) {
		console.error('Error fetching wallet details:', error)
		return null
	}
}

/**
 * React query hook for fetching wallet details
 */
export const useWalletDetails = (paymentDetailsEvent: string) => {
	return useQuery({
		queryKey: walletKeys.details(paymentDetailsEvent),
		queryFn: () => fetchWalletDetails(paymentDetailsEvent),
		enabled: !!paymentDetailsEvent,
	})
}

/**
 * Interface for publishing wallet details
 */
export interface PublishWalletDetailParams {
	key: string // For tracking use case (e.g., "on-chain-index")
	value: string // Value for the key (e.g., "1")
	paymentDetailsEvent: string // Related payment details event coordinates
	userPubkey: string // User's public key to encrypt content for
}

/**
 * Publishes wallet details
 */
export const publishWalletDetail = async (params: PublishWalletDetailParams): Promise<string> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const signer = ndkActions.getSigner()
		if (!signer) throw new Error('No signer available to publish wallet details')

		// Ensure we have the app's public key
		const appPubkey = configStore.state.config.appPublicKey
		if (!appPubkey) throw new Error('App public key not available')

		// We need to sign this as the app, which means we need to have the app's private key
		// For development, the signer might just be the app's key
		// In production, this would be handled by a server

		// Create the content object
		const contentObj = {
			key: params.key,
			value: params.value,
		}

		// Encrypt content for the user
		const contentStr = JSON.stringify(contentObj)
		let encryptedContent

		// Encrypt to user's pubkey - need to use nip04 directly
		encryptedContent = await nip04.encrypt(appPubkey, params.userPubkey, contentStr)

		// Create the event
		const event = new NDKEvent(ndk)
		event.kind = NDKKind.AppSpecificData
		event.content = encryptedContent
		event.tags = [
			['d', uuidv4()],
			['l', 'wallet_detail'],
			['a', params.paymentDetailsEvent], // Reference to the payment details event
		]

		// Sign and publish
		await event.sign(signer)
		await event.publish()

		return event.id
	} catch (error) {
		console.error('Error publishing wallet details:', error)
		throw new Error(`Failed to publish wallet details: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * React query mutation hook for publishing wallet details
 */
export const usePublishWalletDetail = () => {
	return useMutation({
		mutationKey: walletKeys.publish(),
		mutationFn: publishWalletDetail,
		onSuccess: (eventId) => {
			toast.success('Wallet details saved successfully')
			return eventId
		},
		onError: (error) => {
			console.error('Failed to publish wallet details:', error)
			toast.error('Failed to save wallet details')
		},
	})
}

/**
 * Fetches all wallet details for a user
 */
export const fetchUserWalletDetails = async (userPubkey: string): Promise<WalletDetail[]> => {
	try {
		const ndk = ndkActions.getNDK()
		if (!ndk) throw new Error('NDK not initialized')

		const appPubkey = configStore.state.config.appPublicKey
		if (!appPubkey) throw new Error('App public key not available')

		// First, find all payment detail events for this user
		const paymentDetailEvents = await ndk.fetchEvents({
			kinds: [NDKKind.AppSpecificData],
			authors: [userPubkey],
			'#l': ['payment_detail'],
		})

		if (!paymentDetailEvents || paymentDetailEvents.size === 0) {
			console.log('No payment detail events found for user:', userPubkey)
			return []
		}

		// For each payment detail event, fetch related wallet details
		const walletDetails: WalletDetail[] = []

		// Convert the Set to Array to avoid iteration issues
		const eventsArray = Array.from(paymentDetailEvents)
		for (const event of eventsArray) {
			const aTag = `30078:${event.pubkey}:${event.id}`
			const walletDetail = await fetchWalletDetails(aTag)
			if (walletDetail) {
				walletDetails.push(walletDetail)
			}
		}

		return walletDetails
	} catch (error) {
		console.error('Error fetching user wallet details:', error)
		return []
	}
}

/**
 * React query hook for fetching all wallet details for a user
 */
export const useUserWalletDetails = (userPubkey: string) => {
	return useQuery({
		queryKey: walletKeys.byPubkey(userPubkey),
		queryFn: () => fetchUserWalletDetails(userPubkey),
		enabled: !!userPubkey,
	})
}

// --- New NWC Wallet List Code ---

// Constants for User's NWC Wallet List event
export const USER_NWC_WALLET_LIST_KIND = NDKKind.AppSpecificData // Using a common kind, distinguished by label
export const USER_NWC_WALLET_LIST_LABEL = 'market_user_nwc_wallets'

// Using the Wallet interface from the local store for now.
// If it diverges, we might need a separate UserNwcWallet interface here.
export type UserNwcWallet = import('@/lib/stores/wallet').Wallet

/**
 * Fetches the user's NWC wallet list from Nostr.
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
			id: wallet.id || uuidv4(),
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

/**
 * Parameters for saving the user's NWC wallet list.
 */
export interface SaveUserNwcWalletsParams {
	wallets: UserNwcWallet[]
	userPubkey: string
}

/**
 * Saves the user's NWC wallet list to Nostr.
 */
export const saveUserNwcWallets = async (params: SaveUserNwcWalletsParams): Promise<string> => {
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		toast.error('NDK not initialized. Cannot save wallets to Nostr.')
		throw new Error('NDK not initialized. Cannot save wallets to Nostr.')
	}

	const signer = ndkActions.getSigner()
	if (!signer) {
		throw new Error('Signer not available for saving NWC wallets')
	}
	if (!params.userPubkey) {
		throw new Error('User pubkey is required for saving NWC wallets')
	}

	const user = await signer.user()
	if (!user) {
		toast.error('User object not found via signer. Cannot save wallets to Nostr.')
		throw new Error('User object not found via signer.')
	}

	// Prepare wallets for storage (e.g., remove any client-only flags if necessary)
	const walletsToStore = params.wallets.map((wallet) => {
		const { storedOnNostr, ...rest } = wallet // Example: remove storedOnNostr if it's client-only
		return rest
	})
	const content = JSON.stringify(walletsToStore)
	// Encrypt content by the user for themselves
	const encryptedContent = await signer.encrypt(user, content)

	const event = new NDKEvent(ndk)
	event.kind = USER_NWC_WALLET_LIST_KIND
	event.created_at = Math.floor(Date.now() / 1000)
	event.content = encryptedContent
	event.tags = [
		['l', USER_NWC_WALLET_LIST_LABEL],
		['client', 'plebeian.market'], // Or your app identifier
	]

	await event.sign(signer) // Signer here should be the user's signer
	const publishedToRelays = await event.publish()

	if (publishedToRelays.size === 0) throw new Error('Failed to publish NWC wallet list event to any relay.')

	return event.id // Return the ID of the event that was constructed and published
}

/**
 * React Query mutation hook for saving the user's NWC wallet list.
 */
export const useSaveUserNwcWalletsMutation = () => {
	const queryClient = useQueryClient()

	return useMutation<string, Error, SaveUserNwcWalletsParams>({
		// mutationKey: walletKeys.saveUserNwcWallets(), // Optional: define in queryKeyFactory
		mutationFn: saveUserNwcWallets,
		onSuccess: (eventId, variables) => {
			toast.success('Wallets saved to Nostr successfully!')
			// Invalidate the query to refetch the latest list
			queryClient.invalidateQueries({ queryKey: walletKeys.userNwcWallets(variables.userPubkey) })
			return eventId
		},
		onError: (error) => {
			console.error('Failed to save NWC wallets to Nostr:', error)
			toast.error(`Error saving wallets to Nostr: ${error.message}`)
		},
	})
}

// --- NWC Wallet Balance ---
export interface NwcBalance {
	balance: number // in satoshis
	timestamp: number
}

// Type for the data received from NWC 'balance_updated' event (if specific typing is needed)
interface NwcBalanceEventData {
	amount: number // typically in msats from NWC, might need conversion
	created_at?: number
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
	const nwcTimeoutDuration = 15000 // Define timeout duration

	try {
		nwcWalletInstance = new NDKNWCWallet(ndkInstance, { pairingCode: nwcUri, timeout: nwcTimeoutDuration })

		const readyPromise = new Promise<void>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				reject(new Error(`Timeout waiting for NWC wallet to be ready (${nwcTimeoutDuration}ms)`))
			}, nwcTimeoutDuration)

			nwcWalletInstance?.once('ready', async () => {
				clearTimeout(timeoutId)
				await nwcWalletInstance?.updateBalance()
				resolve()
			})
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
		staleTime: 1000 * 60 * 5,
		refetchOnWindowFocus: false,
	})
}
