import { ORDER_GENERAL_KIND, ORDER_PROCESS_KIND, ORDER_STATUS, PAYMENT_RECEIPT_KIND } from '@/lib/schemas/order'
import { ndkActions } from '@/lib/stores/ndk'
import { orderKeys } from '@/queries/queryKeyFactory'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'

export type OrderCreateParams = {
  productRef: string  // Product reference
  sellerPubkey: string // Seller pubkey
  quantity: number
  price: number
  currency?: string
  shippingRef?: string
  shippingAddress?: string
  notes?: string
}

/**
 * Creates a new order on the Nostr network
 */
export const createOrder = async (params: OrderCreateParams): Promise<string> => {
  const ndk = ndkActions.getNDK()
  if (!ndk) throw new Error('NDK not initialized')

  const signer = ndkActions.getSigner()
  if (!signer) throw new Error('No active user')

  const user = ndk.activeUser
  if (!user) throw new Error('No active user')

  const currency = params.currency || 'USD'
  const total = (params.price * params.quantity).toFixed(2)
  const orderId = uuidv4()

  // Create the order event
  const event = new NDKEvent(ndk)
  event.kind = ORDER_GENERAL_KIND
  event.content = params.notes || ''
  event.tags = [
    ['d', orderId],
    ['p', params.productRef],
    ['buyer', user.pubkey],
    ['seller', params.sellerPubkey],
    ['qty', params.quantity.toString()],
    ['price', params.price.toFixed(2), currency],
    ['total', total, currency],
  ]

  // Add optional tags
  if (params.shippingRef) {
    event.tags.push(['shipping', params.shippingRef])
  }
  
  if (params.shippingAddress) {
    event.tags.push(['address', params.shippingAddress])
  }

  if (params.notes) {
    event.tags.push(['notes', params.notes])
  }

  // Sign and publish the event
  await event.sign(signer)
  await event.publish()
  
  return event.id
}

/**
 * Mutation hook for creating a new order
 */
export const useCreateOrderMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createOrder,
    onSuccess: async (orderId) => {
      // Invalidate relevant queries to trigger refetching
      await queryClient.invalidateQueries({ queryKey: orderKeys.all })
      
      // Optionally invalidate specific user order queries
      const ndk = ndkActions.getNDK()
      const pubkey = ndk?.activeUser?.pubkey
      if (pubkey) {
        await queryClient.invalidateQueries({ queryKey: orderKeys.byPubkey(pubkey) })
      }

      toast.success('Order created successfully')
      return orderId
    },
    onError: (error) => {
      console.error('Failed to create order:', error)
      toast.error('Failed to create order')
    },
  })
}

export type OrderStatusUpdateParams = {
  orderEventId: string
  status: (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS]
  tracking?: string
  reason?: string
}

/**
 * Updates the status of an order on the Nostr network
 */
export const updateOrderStatus = async (params: OrderStatusUpdateParams): Promise<string> => {
  const ndk = ndkActions.getNDK()
  if (!ndk) throw new Error('NDK not initialized')

  const signer = ndkActions.getSigner()
  if (!signer) throw new Error('No active user')

  // Create the order status event
  const event = new NDKEvent(ndk)
  event.kind = ORDER_STATUS_KIND
  event.content = ''
  event.tags = [
    ['e', params.orderEventId],
    ['status', params.status],
  ]

  // Add optional tags
  if (params.tracking) {
    event.tags.push(['tracking', params.tracking])
  }
  
  if (params.reason) {
    event.tags.push(['reason', params.reason])
  }

  // Sign and publish the event
  await event.sign(signer)
  await event.publish()
  
  return event.id
}

/**
 * Mutation hook for updating order status
 */
export const useUpdateOrderStatusMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateOrderStatus,
    onSuccess: async (_, params) => {
      // Invalidate relevant queries to trigger refetching
      await queryClient.invalidateQueries({ queryKey: orderKeys.all })
      await queryClient.invalidateQueries({ queryKey: orderKeys.details(params.orderEventId) })
      
      toast.success(`Order status updated to ${params.status}`)
    },
    onError: (error) => {
      console.error('Failed to update order status:', error)
      toast.error('Failed to update order status')
    },
  })
}

export type PaymentReceiptParams = {
  orderEventId: string
  method: 'lightning' | 'onchain' | 'bolt11' | 'fiat' | 'other'
  amount: number
  currency?: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  txid?: string
  proof?: string
}

/**
 * Creates a payment receipt for an order on the Nostr network
 */
export const createPaymentReceipt = async (params: PaymentReceiptParams): Promise<string> => {
  const ndk = ndkActions.getNDK()
  if (!ndk) throw new Error('NDK not initialized')

  const signer = ndkActions.getSigner()
  if (!signer) throw new Error('No active user')

  const currency = params.currency || 'USD'

  // Create the payment receipt event
  const event = new NDKEvent(ndk)
  event.kind = PAYMENT_RECEIPT_KIND
  event.content = `Payment ${params.status} for order`
  event.tags = [
    ['e', params.orderEventId],
    ['method', params.method],
    ['amount', params.amount.toFixed(2), currency],
    ['status', params.status],
  ]

  // Add optional tags
  if (params.txid) {
    event.tags.push(['txid', params.txid])
  }
  
  if (params.proof) {
    event.tags.push(['proof', params.proof])
  }

  // Sign and publish the event
  await event.sign(signer)
  await event.publish()
  
  return event.id
}

/**
 * Mutation hook for creating a payment receipt
 */
export const useCreatePaymentReceiptMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createPaymentReceipt,
    onSuccess: async (_, params) => {
      // Invalidate relevant queries
      await queryClient.invalidateQueries({ queryKey: orderKeys.all })
      await queryClient.invalidateQueries({ queryKey: orderKeys.details(params.orderEventId) })
      
      toast.success('Payment receipt created')
    },
    onError: (error) => {
      console.error('Failed to create payment receipt:', error)
      toast.error('Failed to create payment receipt')
    },
  })
} 