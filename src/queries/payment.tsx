import { useMutation, useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { paymentDetailsKeys } from './queryKeyFactory'
import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { configStore } from '@/lib/stores/config'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { nip04 } from 'nostr-tools'

/**
 * Payment method types as defined in the spec
 */
export type PaymentMethod = 'ln' | 'on-chain' | 'cashu' | 'other'

/**
 * Interface for payment details as per SPEC.md
 */
export interface PaymentDetail {
  id: string // Event ID
  paymentMethod: PaymentMethod
  paymentDetail: string // Could be bolt11, btc address, cashu token, etc.
  createdAt: number
  coordinates?: string // Optional product/collection coordinates
}

/**
 * Fetches payment details for a specific ID
 */
export const fetchPaymentDetail = async (id: string): Promise<PaymentDetail | null> => {
  try {
    const ndk = ndkActions.getNDK()
    if (!ndk) throw new Error('NDK not initialized')
    
    // Fetch the event
    const event = await ndk.fetchEvent({
      ids: [id],
    })
    
    if (!event) {
      console.log('Payment detail event not found:', id)
      return null
    }
    
    // Event should have the l tag with value 'payment_detail'
    const lTag = event.tags.find(tag => tag[0] === 'l' && tag[1] === 'payment_detail')
    if (!lTag) {
      console.log('Not a payment detail event:', id)
      return null
    }
    
    // Decrypt the content if the user has a signer
    const signer = ndkActions.getSigner()
    if (!signer) {
      console.warn('No signer available to decrypt payment details')
      return null
    }
    
    const user = await signer.user()
    if (!user) return null
    
    // Find app pubkey from the p tag or use the stored app pubkey
    const pTag = event.tags.find(tag => tag[0] === 'p')
    const appPubkey = pTag ? pTag[1] : configStore.state.config.appPublicKey
    
    if (!appPubkey) {
      console.warn('App public key not available')
      return null
    }
    
    // Decrypt the content
    let content
    try {
      // If the event author is the app, decrypt with the user's key
      // If the event author is the user, decrypt with the app's key
      const isEventFromApp = event.pubkey === appPubkey
      
      if (isEventFromApp) {
        content = await nip04.decrypt(
          appPubkey,
          user.pubkey,
          event.content
        )
      } else {
        content = await nip04.decrypt(
          user.pubkey,
          appPubkey,
          event.content
        )
      }
      
      const parsedContent = JSON.parse(content)
      
      // Find any a tag for coordinates
      const aTag = event.tags.find(tag => tag[0] === 'a')
      const coordinates = aTag ? aTag[1] : undefined
      
      return {
        id: event.id,
        paymentMethod: parsedContent.payment_method || 'other',
        paymentDetail: parsedContent.payment_detail || '',
        createdAt: event.created_at || 0,
        coordinates,
      }
    } catch (error) {
      console.error('Error decrypting payment details:', error)
      return null
    }
  } catch (error) {
    console.error('Error fetching payment detail:', error)
    return null
  }
}

/**
 * React query hook for fetching payment details
 */
export const usePaymentDetail = (id: string) => {
  return useQuery({
    queryKey: paymentDetailsKeys.details(id),
    queryFn: () => fetchPaymentDetail(id),
    enabled: !!id,
  })
}

/**
 * Fetches all payment details for a user
 */
export const fetchUserPaymentDetails = async (userPubkey: string): Promise<PaymentDetail[]> => {
  try {
    const ndk = ndkActions.getNDK()
    if (!ndk) throw new Error('NDK not initialized')
    
    // Fetch payment detail events for this user
    const events = await ndk.fetchEvents({
      kinds: [NDKKind.AppSpecificData],
      authors: [userPubkey],
      '#l': ['payment_detail'],
    })
    
    if (!events || events.size === 0) {
      console.log('No payment detail events found for user:', userPubkey)
      return []
    }
    
    // Convert events to payment details
    const paymentDetails: PaymentDetail[] = []
    const eventsArray = Array.from(events)
    
    for (const event of eventsArray) {
      const detail = await fetchPaymentDetail(event.id)
      if (detail) {
        paymentDetails.push(detail)
      }
    }
    
    return paymentDetails
  } catch (error) {
    console.error('Error fetching user payment details:', error)
    return []
  }
}

/**
 * React query hook for fetching all payment details for a user
 */
export const useUserPaymentDetails = (userPubkey: string) => {
  return useQuery({
    queryKey: paymentDetailsKeys.byPubkey(userPubkey),
    queryFn: () => fetchUserPaymentDetails(userPubkey),
    enabled: !!userPubkey,
  })
}

/**
 * Fetches payment details for a specific product or collection
 */
export const fetchProductPaymentDetails = async (
  coordinates: string,
  userPubkey?: string
): Promise<PaymentDetail[]> => {
  try {
    const ndk = ndkActions.getNDK()
    if (!ndk) throw new Error('NDK not initialized')
    
    // Set up filter object
    const filter: any = {
      kinds: [NDKKind.AppSpecificData],
      '#l': ['payment_detail'],
      '#a': [coordinates],
    }
    
    // If user pubkey is provided, add it to the filter
    if (userPubkey) {
      filter.authors = [userPubkey]
    }
    
    // Fetch payment detail events
    const events = await ndk.fetchEvents(filter)
    
    if (!events || events.size === 0) {
      return []
    }
    
    // Convert events to payment details
    const paymentDetails: PaymentDetail[] = []
    const eventsArray = Array.from(events)
    
    for (const event of eventsArray) {
      const detail = await fetchPaymentDetail(event.id)
      if (detail) {
        paymentDetails.push(detail)
      }
    }
    
    return paymentDetails
  } catch (error) {
    console.error('Error fetching product payment details:', error)
    return []
  }
}

/**
 * React query hook for fetching payment details for a specific product or collection
 */
export const useProductPaymentDetails = (coordinates: string, userPubkey?: string) => {
  return useQuery({
    queryKey: paymentDetailsKeys.byProductOrCollection(coordinates),
    queryFn: () => fetchProductPaymentDetails(coordinates, userPubkey),
    enabled: !!coordinates,
  })
}

/**
 * Interface for publishing payment details
 */
export interface PublishPaymentDetailParams {
  paymentMethod: PaymentMethod
  paymentDetail: string
  coordinates?: string // Optional product/collection coordinates
  appPubkey?: string // Optional app pubkey
}

/**
 * Publishes payment details
 */
export const publishPaymentDetail = async (params: PublishPaymentDetailParams): Promise<string> => {
  try {
    const ndk = ndkActions.getNDK()
    if (!ndk) throw new Error('NDK not initialized')
    
    const signer = ndkActions.getSigner()
    if (!signer) throw new Error('No signer available to publish payment details')
    
    // Get user 
    const user = await signer.user()
    if (!user) throw new Error('User not available')
    
    // Get app pubkey
    const appPubkey = params.appPubkey || configStore.state.config.appPublicKey
    if (!appPubkey) throw new Error('App public key not available')
    
    // Create the content object
    const contentObj = {
      payment_method: params.paymentMethod,
      payment_detail: params.paymentDetail,
    }
    
    // Encrypt content for the app
    const contentStr = JSON.stringify(contentObj)
    let encryptedContent
    
    // Encrypt to app's pubkey
    encryptedContent = await nip04.encrypt(
      user.pubkey,
      appPubkey,
      contentStr
    )
    
    // Create the event
    const event = new NDKEvent(ndk)
    event.kind = NDKKind.AppSpecificData
    event.content = encryptedContent
    event.tags = [
      ['d', uuidv4()],
      ['l', 'payment_detail'],
      ['p', appPubkey], // Reference to the app
    ]
    
    // Add coordinates if provided
    if (params.coordinates) {
      event.tags.push(['a', params.coordinates])
    }
    
    // Sign and publish
    await event.sign(signer)
    await event.publish()
    
    return event.id
  } catch (error) {
    console.error('Error publishing payment details:', error)
    throw new Error(`Failed to publish payment details: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * React query mutation hook for publishing payment details
 */
export const usePublishPaymentDetail = () => {
  return useMutation({
    mutationKey: paymentDetailsKeys.publish(),
    mutationFn: publishPaymentDetail,
    onSuccess: (eventId) => {
      toast.success('Payment details saved successfully')
      return eventId
    },
    onError: (error) => {
      console.error('Failed to publish payment details:', error)
      toast.error('Failed to save payment details')
    },
  })
} 