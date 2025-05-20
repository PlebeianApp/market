import { useMutation, useQueryClient } from '@tanstack/react-query'
import { publishWalletDetail } from '@/queries/wallet'
import type { PublishWalletDetailParams } from '@/queries/wallet'
import { walletKeys } from '@/queries/queryKeyFactory'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'

/**
 * Mutation hook for publishing wallet details with query invalidation
 * This wraps the query function with additional functionality
 */
export const usePublishWalletDetailMutation = () => {
	const queryClient = useQueryClient()
	const ndk = ndkActions.getNDK()
	const signer = ndkActions.getSigner()

	return useMutation({
		mutationFn: async (params: PublishWalletDetailParams) => {
			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available')

			// Check if the userPubkey is provided
			if (!params.userPubkey) {
				// Try to get the current user's pubkey if not provided
				const user = await signer.user()
				if (!user || !user.pubkey) {
					throw new Error('User pubkey is required')
				}
				params.userPubkey = user.pubkey
			}

			return publishWalletDetail(params)
		},

		onSuccess: (eventId, params) => {
			// Invalidate relevant queries
			queryClient.invalidateQueries({ queryKey: walletKeys.details(params.paymentDetailsEvent) })

			if (params.userPubkey) {
				queryClient.invalidateQueries({ queryKey: walletKeys.byPubkey(params.userPubkey) })
			}

			toast.success('Wallet details published successfully')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to publish wallet details:', error)
			toast.error(`Failed to publish wallet details: ${error instanceof Error ? error.message : String(error)}`)
		},
	})
}

/**
 * Helper function for creating on-chain wallet index
 * Useful for tracking the current derivation index for HD wallets
 */
export const useOnChainWalletIndexMutation = () => {
	const publishWalletDetailMutation = usePublishWalletDetailMutation()

	return useMutation({
		mutationFn: async (params: { index: number; paymentDetailsEvent: string; userPubkey?: string }) => {
			return publishWalletDetailMutation.mutateAsync({
				key: 'on-chain-index',
				value: params.index.toString(),
				paymentDetailsEvent: params.paymentDetailsEvent,
				userPubkey: params.userPubkey || '',
			})
		},

		onSuccess: (eventId) => {
			toast.success('On-chain wallet index updated')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update on-chain wallet index:', error)
			toast.error('Failed to update wallet index')
		},
	})
}

/**
 * Helper function for creating lightning wallet state
 * Useful for tracking lightning-specific wallet state
 */
export const useLightningWalletStateMutation = () => {
	const publishWalletDetailMutation = usePublishWalletDetailMutation()

	return useMutation({
		mutationFn: async (params: { stateKey: string; stateValue: string; paymentDetailsEvent: string; userPubkey?: string }) => {
			return publishWalletDetailMutation.mutateAsync({
				key: `ln-${params.stateKey}`,
				value: params.stateValue,
				paymentDetailsEvent: params.paymentDetailsEvent,
				userPubkey: params.userPubkey || '',
			})
		},

		onSuccess: (eventId) => {
			toast.success('Lightning wallet state updated')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update lightning wallet state:', error)
			toast.error('Failed to update wallet state')
		},
	})
}

/**
 * Helper function for creating ecash wallet state
 * Useful for tracking ecash-specific wallet state
 */
export const useEcashWalletStateMutation = () => {
	const publishWalletDetailMutation = usePublishWalletDetailMutation()

	return useMutation({
		mutationFn: async (params: { stateKey: string; stateValue: string; paymentDetailsEvent: string; userPubkey?: string }) => {
			return publishWalletDetailMutation.mutateAsync({
				key: `ecash-${params.stateKey}`,
				value: params.stateValue,
				paymentDetailsEvent: params.paymentDetailsEvent,
				userPubkey: params.userPubkey || '',
			})
		},

		onSuccess: (eventId) => {
			toast.success('Ecash wallet state updated')
			return eventId
		},

		onError: (error) => {
			console.error('Failed to update ecash wallet state:', error)
			toast.error('Failed to update wallet state')
		},
	})
}
