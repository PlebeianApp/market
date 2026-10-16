import type { BuyerOrderStatus, BuyerShippingStatus } from './orderStatus'

export type OrderManagementRole = 'buyer' | 'seller' | 'other'

export interface OrderManagementActions {
	canCancel: boolean
	canConfirm: boolean
	canProcess: boolean
	canShip: boolean
	canReceive: boolean
}

/**
 * Local UI affordances only. These rules are not enforced by Nostr relays or a
 * server; consumers must not treat them as authorization or verified state.
 */
export function getOrderManagementActions(input: {
	role: OrderManagementRole
	orderStatus: BuyerOrderStatus
	shippingStatus?: BuyerShippingStatus | null
}): OrderManagementActions {
	const { role, orderStatus } = input
	const isBuyer = role === 'buyer'
	const isSeller = role === 'seller'
	const hasBeenShipped = input.shippingStatus === 'shipped'

	return {
		canCancel: orderStatus === 'pending' && (isBuyer || isSeller),
		canConfirm: isSeller && orderStatus === 'pending',
		canProcess: isSeller && orderStatus === 'confirmed',
		canShip: isSeller && orderStatus === 'processing' && !hasBeenShipped,
		canReceive: isBuyer && orderStatus === 'processing' && hasBeenShipped,
	}
}
