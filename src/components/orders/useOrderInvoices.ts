import { getPersistedInvoicesForOrder, persistInvoicesLocally, updatePersistedInvoiceLocally } from '@/lib/utils/invoiceStorage'
import type { PaymentInvoiceData } from '@/lib/types/invoice'
import type { V4VDTO } from '@/lib/stores/cart'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useGenerateInvoiceMutation } from '@/queries/payment'
import { publishPaymentReceipt } from '@/publish/payment'
import { useQueryClient } from '@tanstack/react-query'
import { orderKeys } from '@/queries/queryKeyFactory'
import { extractPaymentMethods, getOrderId, getSellerPubkey, isPaymentCompleted, makeInvoiceKey } from './orderDetailHelpers'
import type { OrderWithRelatedEvents } from '@/queries/orders'

type InvoiceSource = 'request' | 'both'

export type InvoiceWithSource = PaymentInvoiceData & {
	source: InvoiceSource
	localCopies: PaymentInvoiceData[]
}

interface UseOrderInvoicesParams {
	order: OrderWithRelatedEvents
	sellerV4VShares: V4VDTO[]
	userPubkey?: string
}

export function useOrderInvoices({ order, sellerV4VShares, userPubkey }: UseOrderInvoicesParams) {
	const { mutateAsync: generateInvoice } = useGenerateInvoiceMutation()
	const queryClient = useQueryClient()
	const [generatingInvoices, setGeneratingInvoices] = useState<Set<string>>(new Set())
	const [localInvoices, setLocalInvoices] = useState<PaymentInvoiceData[]>([])

	const orderEvent = order.order
	const orderId = getOrderId(orderEvent)
	const sellerPubkey = getSellerPubkey(orderEvent)
	const buyerPubkey = orderEvent.pubkey
	const isBuyer = buyerPubkey === userPubkey

	// Refresh local invoices from storage
	const refreshLocalInvoices = useCallback(() => {
		if (!isBuyer || !orderId) return
		const stored = getPersistedInvoicesForOrder(orderId)
		setLocalInvoices(stored)
	}, [isBuyer, orderId])

	useEffect(() => {
		refreshLocalInvoices()
	}, [refreshLocalInvoices])

	// Build invoices from payment requests
	const invoicesFromPaymentRequests = useMemo(() => {
		const paymentReceipts = order.paymentReceipts || []

		if (!order.paymentRequests || order.paymentRequests.length === 0) {
			return []
		}

		const invoices: PaymentInvoiceData[] = []

		order.paymentRequests.forEach((paymentRequest) => {
			const amountTag = paymentRequest.tags.find((tag) => tag[0] === 'amount')
			const amount = amountTag?.[1] ? parseInt(amountTag[1], 10) : 0

			if (amount <= 0) return

			const paymentMethods = extractPaymentMethods(paymentRequest)
			const lightningPayment = paymentMethods.find((p) => p.type === 'lightning')
			const isCompleted = isPaymentCompleted(paymentRequest, paymentReceipts)

			const recipientPubkey = paymentRequest.tags.find((tag) => tag[0] === 'recipient')?.[1] || paymentRequest.pubkey
			const isSellerPayment = recipientPubkey === sellerPubkey

			let recipientName = 'Merchant'
			if (!isSellerPayment) {
				const v4vRecipient = sellerV4VShares.find((share) => share.pubkey === recipientPubkey)
				recipientName = v4vRecipient ? v4vRecipient.name : 'V4V Recipient'
			}

			const expirationTag = paymentRequest.tags.find((tag) => tag[0] === 'expiration')
			const expirationValue = expirationTag?.[1]
			const expiresAt = expirationValue ? parseInt(expirationValue, 10) : Math.floor(Date.now() / 1000) + 3600

			const lightningAddress = lightningPayment?.details || ''
			const isBolt11 = lightningAddress.toLowerCase().startsWith('lnbc') || lightningAddress.toLowerCase().startsWith('lntb')
			const actualBolt11 = isBolt11 ? lightningAddress : ''
			const actualLightningAddress = !isBolt11 ? lightningAddress : ''

			invoices.push({
				id: paymentRequest.id,
				orderId: orderId,
				bolt11: actualBolt11,
				amount,
				description: isSellerPayment ? 'Merchant Payment' : 'V4V Community Payment',
				recipientName,
				status: isCompleted ? 'paid' : expiresAt < Math.floor(Date.now() / 1000) ? 'expired' : 'pending',
				expiresAt,
				createdAt: paymentRequest.created_at || Math.floor(Date.now() / 1000),
				lightningAddress: actualLightningAddress,
				recipientPubkey,
				type: isSellerPayment ? 'merchant' : 'v4v',
			})
		})

		return invoices
	}, [order.paymentRequests, order.paymentReceipts, orderId, sellerV4VShares, sellerPubkey])

	// Map local invoices by key
	const localInvoicesByKey = useMemo(() => {
		const map: Record<string, PaymentInvoiceData[]> = {}

		localInvoices.forEach((invoice) => {
			if (invoice.orderId !== orderId) return
			const key = makeInvoiceKey(invoice)
			if (!map[key]) {
				map[key] = []
			}
			map[key].push(invoice)
		})

		Object.values(map).forEach((list) =>
			list.sort((a, b) => {
				const aTime = a.updatedAt || a.createdAt || 0
				const bTime = b.updatedAt || b.createdAt || 0
				return bTime - aTime
			}),
		)

		return map
	}, [localInvoices, orderId])

	// Enriched invoices combining request data with local storage
	const enrichedInvoices: InvoiceWithSource[] = useMemo(() => {
		return invoicesFromPaymentRequests.map((invoice) => {
			const key = makeInvoiceKey(invoice)
			const localCopies = localInvoicesByKey[key] || []
			const latestLocal = localCopies[0]

			return {
				...invoice,
				status: latestLocal?.status ?? invoice.status,
				bolt11: latestLocal?.bolt11 || invoice.bolt11,
				lightningAddress: latestLocal?.lightningAddress || invoice.lightningAddress,
				preimage: latestLocal?.preimage || invoice.preimage,
				isZap: latestLocal?.isZap ?? invoice.isZap,
				source: latestLocal ? 'both' : 'request',
				localCopies,
			}
		})
	}, [invoicesFromPaymentRequests, localInvoicesByKey])

	// Generate a new invoice
	const handleGenerateNewInvoice = useCallback(
		async (invoice: PaymentInvoiceData) => {
			setGeneratingInvoices((prev) => new Set(prev).add(invoice.id))

			try {
				const recipientPubkey = invoice.recipientPubkey || sellerPubkey
				const newInvoiceData = await generateInvoice({
					sellerPubkey: recipientPubkey,
					amountSats: invoice.amount,
					description: invoice.description || 'Payment',
					invoiceId: invoice.id,
					items: [],
					type: invoice.type === 'merchant' ? 'seller' : invoice.type,
				})

				const newPersistedInvoice: PaymentInvoiceData = {
					id: newInvoiceData.id,
					orderId,
					recipientPubkey,
					recipientName: invoice.recipientName,
					amount: invoice.amount,
					description: invoice.description,
					bolt11: newInvoiceData.bolt11 || null,
					lightningAddress: newInvoiceData.lightningAddress || invoice.lightningAddress || null,
					expiresAt: newInvoiceData.expiresAt,
					status: newInvoiceData.status === 'failed' ? 'expired' : (newInvoiceData.status as 'pending' | 'paid' | 'expired'),
					type: invoice.type,
					createdAt: Date.now(),
					isZap: newInvoiceData.isZap,
				}

				persistInvoicesLocally([newPersistedInvoice])
				refreshLocalInvoices()

				toast.success(`New invoice generated for ${invoice.recipientName}`)
			} catch (error) {
				console.error('Failed to generate new invoice:', error)
				toast.error(`Failed to generate new invoice: ${error instanceof Error ? error.message : 'Unknown error'}`)
			} finally {
				setGeneratingInvoices((prev) => {
					const newSet = new Set(prev)
					newSet.delete(invoice.id)
					return newSet
				})
			}
		},
		[orderId, sellerPubkey, generateInvoice, refreshLocalInvoices],
	)

	// Handle payment completion
	const handlePaymentComplete = useCallback(
		async (invoiceId: string, preimage: string, dialogInvoices: PaymentInvoiceData[]) => {
			toast.success('Payment completed successfully!')

			const invoice = enrichedInvoices.find((inv) => inv.id === invoiceId) || dialogInvoices.find((inv) => inv.id === invoiceId)

			if (invoice && invoice.bolt11) {
				try {
					await publishPaymentReceipt({
						invoice: {
							orderId,
							recipientPubkey: invoice.recipientPubkey,
							amount: invoice.amount,
							description: invoice.description,
							id: invoice.id,
							bolt11: invoice.bolt11,
						},
						preimage,
						bolt11: invoice.bolt11,
					})

					queryClient.invalidateQueries({ queryKey: orderKeys.details(orderId) })
				} catch (err) {
					console.error('Failed to publish payment receipt:', err)
				}
			}

			updatePersistedInvoiceLocally(orderId, invoiceId, {
				status: 'paid',
				preimage,
			})
			refreshLocalInvoices()
		},
		[orderId, enrichedInvoices, queryClient, refreshLocalInvoices],
	)

	// Handle payment failure
	const handlePaymentFailed = useCallback(
		(invoiceId: string, error: string) => {
			console.error(`Payment failed for invoice ${invoiceId}:`, error)
			toast.error(`Payment failed: ${error}`)
			updatePersistedInvoiceLocally(orderId, invoiceId, {
				status: 'expired',
			})
			refreshLocalInvoices()
		},
		[orderId, refreshLocalInvoices],
	)

	// Calculate payment statistics
	const paidInvoices = enrichedInvoices.filter((invoice) => invoice.status === 'paid')
	const incompleteInvoices = enrichedInvoices.filter((invoice) => invoice.status !== 'paid')
	const totalInvoices = enrichedInvoices.length
	const paymentProgress = totalInvoices > 0 ? (paidInvoices.length / totalInvoices) * 100 : 0

	return {
		enrichedInvoices,
		paidInvoices,
		incompleteInvoices,
		totalInvoices,
		paymentProgress,
		generatingInvoices,
		handleGenerateNewInvoice,
		handlePaymentComplete,
		handlePaymentFailed,
		refreshLocalInvoices,
	}
}
