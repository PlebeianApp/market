import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish } from '../../core/publishing'
import {
	createOrderStatusUpdateTemplate,
	createShippingStatusUpdateTemplate,
	type OrderWorkflowStatus,
	type ShippingWorkflowStatus,
} from './orderEvents'
import { getOrderRecipientPubkey, getOrderReference } from './orderReadModel'

export interface OrderEventRecord {
	id: string
	pubkey: string
	tags: string[][]
}

export interface OrderUpdateContext<SignedEvent extends SignedEventLike> extends EventPublishContext<SignedEvent> {
	/** Host lookup of the original order event; relay data is untrusted until read through the order read model. */
	loadOrder(orderEventId: string): Promise<OrderEventRecord | null>
}

/** The buyer authored the order and addresses the seller via `p`; whoever is not the actor is the counterparty. */
export function resolveOrderCounterparty(order: OrderEventRecord, actorPubkey: string): string | null {
	return actorPubkey === order.pubkey ? getOrderRecipientPubkey(order) : order.pubkey || null
}

async function resolveUpdateTarget<SignedEvent extends SignedEventLike>(context: OrderUpdateContext<SignedEvent>, orderEventId: string) {
	const order = await context.loadOrder(orderEventId)
	if (!order) throw new Error('Original order not found')
	const recipientPubkey = resolveOrderCounterparty(order, context.authorPubkey)
	if (!recipientPubkey) throw new Error('Recipient pubkey not found')
	return { recipientPubkey, orderId: getOrderReference(order) || orderEventId }
}

export interface OrderStatusUpdateInput {
	orderEventId: string
	status: OrderWorkflowStatus
	reason?: string
	tracking?: string
}

export async function publishOrderStatusUpdateWorkflow<SignedEvent extends SignedEventLike>(
	context: OrderUpdateContext<SignedEvent>,
	input: OrderStatusUpdateInput,
): Promise<SignedEvent> {
	const target = await resolveUpdateTarget(context, input.orderEventId)
	const template = createOrderStatusUpdateTemplate({ ...target, status: input.status, content: input.reason, createdAt: context.now() })
	const tags = input.tracking ? [...template.tags, ['tracking', input.tracking]] : template.tags
	return signAndPublish(context, { kind: template.kind, content: template.content, tags })
}

export interface ShippingStatusUpdateInput {
	orderEventId: string
	status: ShippingWorkflowStatus
	reason?: string
	tracking?: string
	carrier?: string
	eta?: number
}

export async function publishShippingStatusUpdateWorkflow<SignedEvent extends SignedEventLike>(
	context: OrderUpdateContext<SignedEvent>,
	input: ShippingStatusUpdateInput,
): Promise<SignedEvent> {
	const target = await resolveUpdateTarget(context, input.orderEventId)
	const template = createShippingStatusUpdateTemplate({
		...target,
		status: input.status,
		content: input.reason || `Shipping status updated to ${input.status}`,
		tracking: input.tracking,
		carrier: input.carrier,
		eta: input.eta ? input.eta.toString() : undefined,
		createdAt: context.now(),
	})
	return signAndPublish(context, template)
}
