import type { NDKKind } from '@nostr-dev-kit/ndk'
import { z } from 'zod'
import { iso4217Currency } from './common'

// Define order kinds as specified in the spec (NIP-17 direct messages)
export const ORDER_GENERAL_KIND = 14 as NDKKind // General communication
export const ORDER_PROCESS_KIND = 16 as NDKKind // Order processing and status updates
export const PAYMENT_RECEIPT_KIND = 17 as NDKKind // Payment receipts and verification

// Order message types (for kind 16)
export const ORDER_MESSAGE_TYPE = {
	ORDER_CREATION: '1',
	PAYMENT_REQUEST: '2',
	STATUS_UPDATE: '3',
	SHIPPING_UPDATE: '4',
} as const

// Order status values
export const ORDER_STATUS = {
	PENDING: 'pending',
	CONFIRMED: 'confirmed',
	PROCESSING: 'processing',
	COMPLETED: 'completed',
	CANCELLED: 'cancelled',
} as const

// Shipping status values
export const SHIPPING_STATUS = {
	PROCESSING: 'processing',
	SHIPPED: 'shipped',
	DELIVERED: 'delivered',
	EXCEPTION: 'exception',
} as const

// ===============================
// 1. Order Creation (Kind: 16, type: 1)
// ===============================

// Required Tags
export const OrderIdTagSchema = z.tuple([z.literal('order'), z.string()])
export const AmountTagSchema = z.tuple([z.literal('amount'), z.string().regex(/^\d+$/, 'Must be an integer')])
export const ItemTagSchema = z.tuple([
	z.literal('item'),
	z.string(), // Product reference in format 30402:<pubkey>:<d-tag>
	z.union([
		z.string().regex(/^\d+$/, 'Must be an integer'), // String representation of integer
		z.number().int().positive(), // Integer quantity
	]),
])
export const RecipientTagSchema = z.tuple([z.literal('p'), z.string()]) // Merchant's pubkey
export const SubjectTagSchema = z.tuple([z.literal('subject'), z.string()]) // Order subject
export const TypeTagSchema = z.tuple([
	z.literal('type'),
	z.enum([
		ORDER_MESSAGE_TYPE.ORDER_CREATION,
		ORDER_MESSAGE_TYPE.PAYMENT_REQUEST,
		ORDER_MESSAGE_TYPE.STATUS_UPDATE,
		ORDER_MESSAGE_TYPE.SHIPPING_UPDATE,
	]),
])

// Optional Tags
export const ShippingTagSchema = z.tuple([z.literal('shipping'), z.string()]) // Reference to shipping option
export const AddressTagSchema = z.tuple([z.literal('address'), z.string()]) // Shipping address details
export const EmailTagSchema = z.tuple([z.literal('email'), z.string().email()]) // Customer email
export const PhoneTagSchema = z.tuple([z.literal('phone'), z.string()]) // Customer phone

// Complete Order Creation Schema
export const OrderCreationSchema = z.object({
	kind: z.literal(ORDER_PROCESS_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // Order notes or special requests
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema,
				SubjectTagSchema,
				TypeTagSchema.pipe(z.tuple([z.literal('type'), z.literal(ORDER_MESSAGE_TYPE.ORDER_CREATION)])),
				OrderIdTagSchema,
				AmountTagSchema,
				ItemTagSchema,

				// Optional tags
				ShippingTagSchema,
				AddressTagSchema,
				EmailTagSchema,
				PhoneTagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'p') &&
					tags.some((tag) => tag[0] === 'subject') &&
					tags.some((tag) => tag[0] === 'type' && tag[1] === ORDER_MESSAGE_TYPE.ORDER_CREATION) &&
					tags.some((tag) => tag[0] === 'order') &&
					tags.some((tag) => tag[0] === 'amount') &&
					tags.some((tag) => tag[0] === 'item')
				)
			},
			{
				message: 'Missing required tags: p, subject, type, order, amount, item',
			},
		),
})

// ===============================
// 2. Payment Request (Kind: 16, type: 2)
// ===============================

// Additional tags for payment request
export const PaymentMethodTagSchema = z.tuple([
	z.literal('payment'),
	z.enum(['lightning', 'bitcoin', 'fiat', 'other']),
	z.string(), // Method details (invoice, address, etc.)
	z.string().optional(), // Optional proof
])
export const ExpirationTagSchema = z.tuple([z.literal('expiration'), z.string()])

// Complete Payment Request Schema (merchant to buyer)
export const PaymentRequestSchema = z.object({
	kind: z.literal(ORDER_PROCESS_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // Payment instructions and notes
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema, // Buyer's pubkey
				SubjectTagSchema,
				TypeTagSchema.pipe(z.tuple([z.literal('type'), z.literal(ORDER_MESSAGE_TYPE.PAYMENT_REQUEST)])),
				OrderIdTagSchema,
				AmountTagSchema,

				// Optional tags
				PaymentMethodTagSchema,
				ExpirationTagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'p') &&
					tags.some((tag) => tag[0] === 'subject') &&
					tags.some((tag) => tag[0] === 'type' && tag[1] === ORDER_MESSAGE_TYPE.PAYMENT_REQUEST) &&
					tags.some((tag) => tag[0] === 'order') &&
					tags.some((tag) => tag[0] === 'amount') &&
					tags.some((tag) => tag[0] === 'payment')
				)
			},
			{
				message: 'Missing required tags: p, subject, type, order, amount, payment',
			},
		),
})

// ===============================
// 3. Status Update (Kind: 16, type: 3)
// ===============================

// Required tags for status updates
export const StatusTagSchema = z.tuple([
	z.literal('status'),
	z.enum([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PROCESSING, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED]),
])

// Complete Status Update Schema
export const StatusUpdateSchema = z.object({
	kind: z.literal(ORDER_PROCESS_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // Human readable status update
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema, // Buyer's pubkey
				SubjectTagSchema,
				TypeTagSchema.pipe(z.tuple([z.literal('type'), z.literal(ORDER_MESSAGE_TYPE.STATUS_UPDATE)])),
				OrderIdTagSchema,
				StatusTagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'p') &&
					tags.some((tag) => tag[0] === 'subject') &&
					tags.some((tag) => tag[0] === 'type' && tag[1] === ORDER_MESSAGE_TYPE.STATUS_UPDATE) &&
					tags.some((tag) => tag[0] === 'order') &&
					tags.some((tag) => tag[0] === 'status')
				)
			},
			{
				message: 'Missing required tags: p, subject, type, order, status',
			},
		),
})

// ===============================
// 4. Shipping Update (Kind: 16, type: 4)
// ===============================

// Required tags for shipping updates
export const ShippingStatusTagSchema = z.tuple([
	z.literal('status'),
	z.enum([SHIPPING_STATUS.PROCESSING, SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.DELIVERED, SHIPPING_STATUS.EXCEPTION]),
])

// Optional tags for shipping updates
export const TrackingTagSchema = z.tuple([z.literal('tracking'), z.string()]) // Tracking information
export const CarrierTagSchema = z.tuple([z.literal('carrier'), z.string()]) // Carrier name
export const ETATagSchema = z.tuple([z.literal('eta'), z.string()]) // Expected delivery time

// Complete Shipping Update Schema
export const ShippingUpdateSchema = z.object({
	kind: z.literal(ORDER_PROCESS_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // Human readable shipping information
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema, // Buyer's pubkey
				SubjectTagSchema,
				TypeTagSchema.pipe(z.tuple([z.literal('type'), z.literal(ORDER_MESSAGE_TYPE.SHIPPING_UPDATE)])),
				OrderIdTagSchema,
				ShippingStatusTagSchema,

				// Optional tags
				TrackingTagSchema,
				CarrierTagSchema,
				ETATagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'p') &&
					tags.some((tag) => tag[0] === 'subject') &&
					tags.some((tag) => tag[0] === 'type' && tag[1] === ORDER_MESSAGE_TYPE.SHIPPING_UPDATE) &&
					tags.some((tag) => tag[0] === 'order') &&
					tags.some((tag) => tag[0] === 'status')
				)
			},
			{
				message: 'Missing required tags: p, subject, type, order, status',
			},
		),
})

// ===============================
// 5. General Communication (Kind: 14)
// ===============================

// Complete General Communication Schema
export const GeneralCommunicationSchema = z.object({
	kind: z.literal(ORDER_GENERAL_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // General communication message
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema,
				SubjectTagSchema, // Can be order ID or empty
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return tags.some((tag) => tag[0] === 'p')
			},
			{
				message: 'Missing required tag: p',
			},
		),
})

// ===============================
// 6. Payment Receipt (Kind: 17)
// ===============================

// Required tags for payment receipts
export const PaymentProofTagSchema = z.tuple([
	z.literal('payment'),
	z.enum(['lightning', 'bitcoin', 'fiat', 'other']), // Payment medium
	z.string(), // Medium reference (invoice, address, etc.)
	z.string(), // Proof (preimage, txid, etc.)
])

// Complete Payment Receipt Schema
export const PaymentReceiptSchema = z.object({
	kind: z.literal(PAYMENT_RECEIPT_KIND),
	created_at: z.number().int().positive(),
	content: z.string(), // Payment confirmation details
	tags: z
		.array(
			z.union([
				// Required tags
				RecipientTagSchema, // Merchant's pubkey
				SubjectTagSchema,
				OrderIdTagSchema,
				PaymentProofTagSchema,
				AmountTagSchema,
			]),
		)
		.refine(
			(tags) => {
				// Verify required tags are present
				return (
					tags.some((tag) => tag[0] === 'p') &&
					tags.some((tag) => tag[0] === 'subject') &&
					tags.some((tag) => tag[0] === 'order') &&
					tags.some((tag) => tag[0] === 'payment') &&
					tags.some((tag) => tag[0] === 'amount')
				)
			},
			{
				message: 'Missing required tags: p, subject, order, payment, amount',
			},
		),
})
