import { ndkActions } from '../lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { walletKeys } from '../queries/queryKeyFactory'
import { USER_NWC_WALLET_LIST_KIND, USER_NWC_WALLET_LIST_LABEL } from '../queries/wallet'
import type { Wallet as UserNwcWallet } from '../lib/stores/wallet' // Using Wallet directly and aliasing

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

	// Ensure wallets are correctly structured for storage, marking them as stored on Nostr.
	const walletsToStore = params.wallets.map((wallet) => {
		const { ...rest } = wallet
		return { ...rest, storedOnNostr: true } // Explicitly mark/ensure storedOnNostr is true
	})
	const content = JSON.stringify(walletsToStore)
	const encryptedContent = await signer.encrypt(user, content)

	const event = new NDKEvent(ndk)
	event.kind = USER_NWC_WALLET_LIST_KIND
	event.created_at = Math.floor(Date.now() / 1000)
	event.content = encryptedContent
	event.tags = [
		['l', USER_NWC_WALLET_LIST_LABEL],
		['client', 'plebeian.market'],
	]

	await event.sign(signer)
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
		mutationFn: saveUserNwcWallets,
		onSuccess: (eventId, variables) => {
			toast.success('Wallets saved to Nostr successfully!')
			// Invalidate the query to refetch the latest list
			queryClient.invalidateQueries({ queryKey: walletKeys.userNwcWallets(variables.userPubkey) })
			
			// Invalidate all balance queries for the wallets being saved
			variables.wallets.forEach((wallet) => {
				if (wallet.nwcUri) {
					queryClient.invalidateQueries({ queryKey: walletKeys.nwcBalance(wallet.nwcUri) })
				}
			})
			
			// Also invalidate all balance queries to ensure fresh data
			queryClient.invalidateQueries({ queryKey: walletKeys.all })
			
			return eventId
		},
		onError: (error) => {
			console.error('Failed to save NWC wallets to Nostr:', error)
			toast.error(`Error saving wallets to Nostr: ${error.message}`)
		},
	})
}
