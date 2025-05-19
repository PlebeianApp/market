import { useMutation, useQueryClient } from '@tanstack/react-query'
import { publishPaymentDetail } from '@/queries/payment'
import type { PaymentMethod, PublishPaymentDetailParams } from '@/queries/payment'
import { paymentDetailsKeys } from '@/queries/queryKeyFactory'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import { configStore } from '@/lib/stores/config'

/**
 * Mutation hook for publishing payment details with query invalidation
 * This wraps the query function with additional functionality
 */
export const usePublishPaymentDetailMutation = () => {
  const queryClient = useQueryClient()
  const ndk = ndkActions.getNDK()
  const signer = ndkActions.getSigner()
  
  return useMutation({
    mutationFn: async (params: PublishPaymentDetailParams) => {
      if (!ndk) throw new Error('NDK not initialized')
      if (!signer) throw new Error('No signer available')
      
      // Get app pubkey if not provided
      if (!params.appPubkey) {
        const appPubkey = configStore.state.config.appPublicKey
        if (!appPubkey) {
          throw new Error('App public key is required')
        }
        params.appPubkey = appPubkey
      }
      
      return publishPaymentDetail(params)
    },
    
    onSuccess: async (eventId, params) => {
      // Get current user pubkey
      let userPubkey = ''
      if (signer) {
        const user = await signer.user()
        if (user && user.pubkey) {
          userPubkey = user.pubkey
        }
      }
      
      // Invalidate relevant queries
      if (userPubkey) {
        queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byPubkey(userPubkey) })
      }
      
      if (params.coordinates) {
        queryClient.invalidateQueries({ queryKey: paymentDetailsKeys.byProductOrCollection(params.coordinates) })
      }
      
      toast.success('Payment details published successfully')
      return eventId
    },
    
    onError: (error) => {
      console.error('Failed to publish payment details:', error)
      toast.error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

/**
 * Helper function for creating lightning payment details
 */
export const useLightningPaymentDetailMutation = () => {
  const publishPaymentDetailMutation = usePublishPaymentDetailMutation()
  
  return useMutation({
    mutationFn: async (params: { 
      lightningAddress: string;
      coordinates?: string;
      appPubkey?: string;
    }) => {
      return publishPaymentDetailMutation.mutateAsync({
        paymentMethod: 'ln',
        paymentDetail: params.lightningAddress,
        coordinates: params.coordinates,
        appPubkey: params.appPubkey,
      })
    },
    
    onSuccess: (eventId) => {
      toast.success('Lightning payment details saved')
      return eventId
    },
    
    onError: (error) => {
      console.error('Failed to save lightning payment details:', error)
      toast.error('Failed to save lightning payment details')
    }
  })
}

/**
 * Helper function for creating on-chain payment details
 */
export const useOnChainPaymentDetailMutation = () => {
  const publishPaymentDetailMutation = usePublishPaymentDetailMutation()
  
  return useMutation({
    mutationFn: async (params: { 
      bitcoinAddress: string;
      coordinates?: string;
      appPubkey?: string;
    }) => {
      return publishPaymentDetailMutation.mutateAsync({
        paymentMethod: 'on-chain',
        paymentDetail: params.bitcoinAddress,
        coordinates: params.coordinates,
        appPubkey: params.appPubkey,
      })
    },
    
    onSuccess: (eventId) => {
      toast.success('Bitcoin address saved')
      return eventId
    },
    
    onError: (error) => {
      console.error('Failed to save bitcoin address:', error)
      toast.error('Failed to save bitcoin address')
    }
  })
}

/**
 * Helper function for creating cashu payment details
 */
export const useCashuPaymentDetailMutation = () => {
  const publishPaymentDetailMutation = usePublishPaymentDetailMutation()
  
  return useMutation({
    mutationFn: async (params: { 
      cashuToken: string;
      coordinates?: string;
      appPubkey?: string;
    }) => {
      return publishPaymentDetailMutation.mutateAsync({
        paymentMethod: 'cashu',
        paymentDetail: params.cashuToken,
        coordinates: params.coordinates,
        appPubkey: params.appPubkey,
      })
    },
    
    onSuccess: (eventId) => {
      toast.success('Ecash payment details saved')
      return eventId
    },
    
    onError: (error) => {
      console.error('Failed to save ecash payment details:', error)
      toast.error('Failed to save ecash payment details')
    }
  })
} 