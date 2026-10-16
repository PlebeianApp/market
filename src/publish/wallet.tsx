import { ndkActions } from '../lib/stores/ndk'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'
import { publishNwcWalletListWorkflow } from '@sdk/commerce/payments'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { walletKeys } from '../queries/queryKeyFactory'
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
	const context = await createNdkPublishContext(ndk, signer, async (event: NDKEvent) => {
		const publishedToRelays = await ndkActions.publishEvent(event)
		if (publishedToRelays.size === 0) throw new Error('Failed to publish NWC wallet list event to any relay.')
	})
	const event = await publishNwcWalletListWorkflow(
		{ ...context, encryptToSelf: (plaintext) => signer.encrypt(user, plaintext) },
		params.wallets,
	)

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
