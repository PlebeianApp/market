import { useMutation, useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { walletKeys } from './queryKeyFactory'
import { NDKEvent, NDKKind, NDKUser } from '@nostr-dev-kit/ndk'
import { configStore } from '@/lib/stores/config'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { nip04 } from 'nostr-tools'

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
        mostRecentEvent.content
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
    encryptedContent = await nip04.encrypt(
      appPubkey,
      params.userPubkey,
      contentStr
    )
    
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