// @ts-nocheck
import { CartSummary } from '@/components/CartSummary'
import { CheckoutProgress } from '@/components/checkout/CheckoutProgress'
import { PaymentContent, type PaymentInvoiceData } from '@/components/checkout/PaymentContent'
import { PaymentSummary } from '@/components/checkout/PaymentSummary'
import { OrderFinalizeComponent } from '@/components/checkout/OrderFinalizeComponent'
import { ShippingAddressForm, type CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cartStore, cartActions } from '@/lib/stores/cart'
import { useWallets, parseNwcUri } from '@/lib/stores/wallet'
import { useStore } from '@tanstack/react-store'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { ChevronLeft, ChevronRight, Zap, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useInvoiceGeneration } from '@/hooks/useInvoiceGeneration'
import { createAndPublishOrder, createPaymentRequestEvent } from '@/publish/orders'
import type { OrderCreationData, PaymentRequestData } from '@/publish/orders'
import { createOrderInvoiceSet, updateInvoiceStatus } from '@/lib/utils/orderUtils'
import type { OrderInvoiceSet } from '@/lib/utils/orderUtils'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { uiActions } from '@/lib/stores/ui'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { fetchV4VShares } from '@/queries/v4v'
import { toast } from 'sonner'
import { NDKZapper, NDKEvent, type NDKTag } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet, NDKWalletStatus } from '@nostr-dev-kit/ndk-wallet'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

type CheckoutStep = 'shipping' | 'summary' | 'payment' | 'complete'

function RouteComponent() {
	const navigate = useNavigate()
	const { cart, totalInSats, totalShippingInSats, productsBySeller, sellerData, v4vShares } = useStore(cartStore)
	const { wallets, isInitialized: walletsInitialized, initialize: initializeWallets } = useWallets()
	const ndkState = useStore(ndkStore)
	const [currentStep, setCurrentStep] = useState<CheckoutStep>('shipping')
	const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0)
	const [invoices, setInvoices] = useState<PaymentInvoiceData[]>([])
	const [shippingData, setShippingData] = useState<CheckoutFormData | null>(null)

	// Reset checkout state when component mounts or cart changes
	useEffect(() => {
		setCurrentStep('shipping')
		setCurrentInvoiceIndex(0)
		setInvoices([])
		setShippingData(null)
		setOrderInvoiceSets({})
		setSpecOrderIds([])
	}, [Object.keys(cart.products).join(',')]) // Reset when cart products change

	// Initialize wallets on mount
	useEffect(() => {
		if (!walletsInitialized) {
			initializeWallets()
		}
	}, [walletsInitialized, initializeWallets])

	// Check for NWC availability based on configured wallets with valid URIs
	const nwcEnabled = useMemo(() => {
		if (!walletsInitialized) {
			return false
		}

		// Check for wallets with valid NWC URIs
		const validWallets = wallets.filter((wallet) => {
			if (!wallet.nwcUri) return false

			const parsed = parseNwcUri(wallet.nwcUri)
			return parsed !== null && parsed.pubkey && parsed.relay && parsed.secret
		})

		const hasValidWallets = validWallets.length > 0
		console.log(
			`NWC Status: initialized=${walletsInitialized}, total_wallets=${wallets.length}, valid_wallets=${validWallets.length}, enabled=${hasValidWallets}`,
		)

		if (validWallets.length > 0) {
			console.log(
				'Valid NWC wallets:',
				validWallets.map((w) => ({
					name: w.name,
					pubkey: w.pubkey.substring(0, 8) + '...',
					relay: w.relays[0] || 'unknown',
				})),
			)
		} else if (wallets.length > 0) {
			console.log(
				'Found wallets but none have valid NWC URIs:',
				wallets.map((w) => ({
					name: w.name,
					hasUri: !!w.nwcUri,
					uriValid: w.nwcUri ? parseNwcUri(w.nwcUri) !== null : false,
				})),
			)
		}

		return hasValidWallets
	}, [walletsInitialized, wallets])
	const [orderInvoiceSets, setOrderInvoiceSets] = useState<Record<string, OrderInvoiceSet>>({})
	const [specOrderIds, setSpecOrderIds] = useState<string[]>([])
	const [animationParent] = useAutoAnimate()
	const { generateInvoiceForSeller, isGenerating: isGeneratingInvoices } = useInvoiceGeneration({ fallbackToMock: true })

	const isCartEmpty = useMemo(() => {
		return Object.keys(cart.products).length === 0
	}, [cart.products])

	const hasAllShippingMethods = useMemo(() => {
		return Object.values(cart.products).every((product) => product.shippingMethodId !== null)
	}, [cart.products])

	const sellers = useMemo(() => {
		return Object.keys(productsBySeller)
	}, [productsBySeller])

	const totalInvoicesNeeded = useMemo(() => {
		const total = sellers.reduce((total, sellerPubkey) => {
			// 1 invoice for the seller + 1 invoice for each V4V recipient
			const v4vRecipients = v4vShares[sellerPubkey] || []
			const sellerTotal = 1 + v4vRecipients.length
			console.log(`Seller ${sellerPubkey.substring(0, 8)}... needs ${sellerTotal} invoices (1 merchant + ${v4vRecipients.length} V4V)`)
			return total + sellerTotal
		}, 0)
		console.log(`Total invoices needed: ${total}`)
		return total
	}, [sellers, v4vShares])

	const totalSteps = useMemo(() => {
		// shipping + summary + (actual invoices) + complete
		return 2 + invoices.length + 1
	}, [invoices.length])

	const currentStepNumber = useMemo(() => {
		switch (currentStep) {
			case 'shipping':
				return 1
			case 'summary':
				return 2
			case 'payment':
				return 3 + currentInvoiceIndex
			case 'complete':
				return totalSteps
			default:
				return 1
		}
	}, [currentStep, currentInvoiceIndex, totalSteps])

	const progress = useMemo(() => {
		return ((currentStepNumber - 1) / (totalSteps - 1)) * 100
	}, [currentStepNumber, totalSteps])

	const stepDescription = useMemo(() => {
		switch (currentStep) {
			case 'shipping':
				return 'Enter shipping address'
			case 'summary':
				return 'Review your order'
			case 'payment':
				const currentInvoice = invoices[currentInvoiceIndex]
				if (currentInvoice) {
					const invoiceTypeLabel = currentInvoice.type === 'v4v' ? 'V4V Payment' : 'Payment'
					return `${invoiceTypeLabel} ${currentInvoiceIndex + 1} of ${invoices.length}: ${currentInvoice.recipientName}`
				}
				return `Processing Lightning payments (${currentInvoiceIndex + 1} of ${invoices.length})`
			case 'complete':
				return 'Order complete'
			default:
				return 'Checkout'
		}
	}, [currentStep, currentInvoiceIndex, invoices])

	// Generate Lightning invoices when moving to payment step
	useEffect(() => {
		if (currentStep === 'payment' && invoices.length === 0 && sellers.length > 0 && !isGeneratingInvoices) {
			const generateInvoices = async () => {
				const newInvoices: PaymentInvoiceData[] = []
				let invoiceIndex = 0

				// Debug: Log all V4V shares data
				console.log('📋 Current V4V shares data:', v4vShares)
				console.log('🏪 Sellers:', sellers)
				console.log('💰 Seller data:', sellerData)

				try {
					for (const sellerPubkey of sellers) {
						const sellerProducts = productsBySeller[sellerPubkey] || []
						const data = sellerData[sellerPubkey]
						const totalAmount = data?.satsTotal || 0
						const shares = data?.shares
						const v4vRecipients = v4vShares[sellerPubkey] || []

						// Debug: Log V4V recipients for this seller
						console.log(
							`Seller ${sellerPubkey.substring(0, 8)}... has ${v4vRecipients.length} V4V recipients:`,
							v4vRecipients.map((r) => `${r.name} (${r.percentage}%)`),
						)

						// Create invoice for seller's share
						const sellerAmount = shares?.sellerAmount || totalAmount
						const sellerItems = sellerProducts.map((product) => ({
							productId: product.id,
							name: `Product ${product.id.substring(0, 8)}...`,
							amount: product.amount,
							price: Math.floor(sellerAmount / sellerProducts.length),
						}))

						console.log(`Generating invoice for seller ${sellerPubkey.substring(0, 8)}... (${sellerAmount} sats)`)

						const sellerInvoice = await generateInvoiceForSeller(
							sellerPubkey,
							sellerAmount,
							`Seller payment for ${sellerProducts.length} items`,
							`invoice-${invoiceIndex++}`,
							sellerItems,
							'seller',
						)

						// Convert to PaymentInvoiceData format
						const paymentInvoice: PaymentInvoiceData = {
							id: sellerInvoice.id,
							orderId: specOrderIds.length > 0 ? specOrderIds[0] : 'temp-order',
							recipientPubkey: sellerInvoice.sellerPubkey,
							recipientName: sellerInvoice.sellerName,
							amount: sellerInvoice.amount,
							description: `Seller payment for ${sellerProducts.length} items`,
							bolt11: sellerInvoice.bolt11 || null,
							lightningAddress: sellerInvoice.lightningAddress || null,
							expiresAt: sellerInvoice.expiresAt,
							status: sellerInvoice.status === 'failed' ? 'expired' : (sellerInvoice.status as 'pending' | 'paid' | 'expired'),
							type: 'merchant',
							createdAt: Date.now(),
						}
						newInvoices.push(paymentInvoice)

						// Create invoices for each V4V recipient
						for (const recipient of v4vRecipients) {
							// Calculate the recipient's amount based on their percentage
							const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
							const calculatedAmount = totalAmount * recipientPercentage

							// Round up to ensure minimum 1 sat for any V4V recipient with > 0% share
							const recipientAmount = recipientPercentage > 0 ? Math.max(1, Math.floor(calculatedAmount)) : 0

							console.log(
								`Processing V4V recipient ${recipient.name}: percentage=${recipient.percentage}%, calculated=${calculatedAmount.toFixed(2)}, final amount=${recipientAmount} sats`,
							)

							if (recipientAmount > 0) {
								console.log(`Generating V4V invoice for ${recipient.name} (${recipientAmount} sats)`)

								const recipientItems = [
									{
										productId: `v4v-${recipient.id}`,
										name: `V4V Share (${(recipientPercentage * 100).toFixed(1)}%)`,
										amount: 1,
										price: recipientAmount,
									},
								]

								try {
									const recipientInvoice = await generateInvoiceForSeller(
										recipient.pubkey,
										recipientAmount,
										`V4V payment to ${recipient.name}`,
										`invoice-${invoiceIndex++}`,
										recipientItems,
										'v4v',
									)

									// Convert to PaymentInvoiceData format
									const v4vPaymentInvoice: PaymentInvoiceData = {
										id: recipientInvoice.id,
										orderId: specOrderIds.length > 0 ? specOrderIds[0] : 'temp-order',
										recipientPubkey: recipient.pubkey,
										recipientName: recipient.name,
										amount: recipientAmount,
										description: `V4V payment to ${recipient.name}`,
										bolt11: recipientInvoice.bolt11 || null,
										lightningAddress: recipientInvoice.lightningAddress || null,
										expiresAt: recipientInvoice.expiresAt,
										status: recipientInvoice.status === 'failed' ? 'expired' : (recipientInvoice.status as 'pending' | 'paid' | 'expired'),
										type: 'v4v',
										createdAt: Date.now(),
									}
									newInvoices.push(v4vPaymentInvoice)
									console.log(`✅ Successfully generated V4V invoice for ${recipient.name}`)
								} catch (error) {
									console.error(`❌ Failed to generate V4V invoice for ${recipient.name}:`, error)
									// Continue processing other recipients instead of failing completely
								}
							} else {
								console.log(`⚠️ Skipping V4V recipient ${recipient.name} due to zero percentage`)
							}
						}
					}

					console.log(`Generated ${newInvoices.length} invoices`)
					setInvoices(newInvoices)
				} catch (error) {
					console.error('Failed to generate invoices:', error)
					// Fallback to empty invoices - the user can retry
					setInvoices([])
				}
			}

			generateInvoices()
		}
	}, [currentStep, sellers, productsBySeller, sellerData, v4vShares, invoices.length, isGeneratingInvoices, generateInvoiceForSeller])

	const form = useForm({
		defaultValues: {
			name: '',
			email: '',
			phone: '',
			firstLineOfAddress: '',
			zipPostcode: '',
			city: '',
			country: '',
			additionalInformation: '',
		} as CheckoutFormData,
		onSubmit: async ({ value }) => {
			if (!hasAllShippingMethods) return

			setShippingData(value)
			setCurrentStep('summary')
		},
	})

	const handlePayInvoice = async (invoiceId: string) => {
		// Mock Lightning payment processing
		setInvoices((prev) => prev.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status: 'processing' } : invoice)))

		// Simulate Lightning payment verification delay
		setTimeout(() => {
			setInvoices((prev) => prev.map((invoice) => (invoice.id === invoiceId ? { ...invoice, status: 'paid' } : invoice)))

			// Move to next invoice or complete
			if (currentInvoiceIndex < invoices.length - 1) {
				setCurrentInvoiceIndex((prev) => prev + 1)
			} else {
				setCurrentStep('complete')
				// Clear the cart after all payments are complete
				cartActions.clear()
			}
		}, 3000) // Slightly longer delay to simulate Lightning verification
	}

	// Create gamma spec compliant payment receipt (Kind 17)
	const createPaymentReceipt = async (invoiceId: string, preimage: string, bolt11: string) => {
		const invoice = invoices.find((inv) => inv.id === invoiceId)
		if (!invoice) return

		let ndk = ndkActions.getNDK()
		if (!ndk) {
			console.warn('NDK not initialized for payment receipt, initializing now...')
			ndk = ndkActions.initialize()
			await ndkActions.connect()
		}

		if (!ndk || !ndk.activeUser) {
			console.warn('No active user found for payment receipt creation')
			return
		}

		try {
			// Create gamma spec compliant Kind 17 payment receipt
			const orderId = invoice.orderId !== 'temp-order' ? invoice.orderId : specOrderIds[0] || 'unknown-order'
			const tags: NDKTag[] = [
				['p', invoice.recipientPubkey], // Merchant's public key
				['subject', 'order-receipt'], // Required by gamma spec
				['order', orderId], // Original order identifier
				['payment-request', invoiceId], // Payment request ID this receipt is for
				['payment', 'lightning', bolt11 || 'nwc-payment', preimage], // Payment proof with preimage
				['amount', invoice.amount.toString()], // Payment amount
			]

			const receiptEvent = new NDKEvent(ndk, {
				kind: 17, // Payment receipt as per gamma spec
				content: `Payment completed for ${invoice.description}. Amount: ${invoice.amount} sats.`,
				tags,
			})

			// Sign and publish the payment receipt
			await receiptEvent.sign()
			await receiptEvent.publish()

			console.log('✅ Payment receipt (Kind 17) created and published:', receiptEvent.id)
			return receiptEvent
		} catch (error) {
			console.error('Failed to create payment receipt:', error)
		}
	}

	const handlePaymentComplete = async (invoiceId: string, preimage: string, skipAutoAdvance = false) => {
		console.log(`Payment completed for invoice ${invoiceId} with preimage: ${preimage.substring(0, 16)}...`)

		// Find the invoice to get bolt11 for receipt creation
		const invoice = invoices.find((inv) => inv.id === invoiceId)

		// Create payment receipt
		if (invoice) {
			await createPaymentReceipt(invoiceId, preimage, invoice.bolt11 || '')
		}

		setInvoices((prev) =>
			prev.map((invoice) => {
				if (invoice.id === invoiceId) {
					return {
						...invoice,
						status: 'paid' as const,
					}
				}
				return invoice
			}),
		)

		// Auto-advance on successful payment (unless disabled for bulk operations)
		if (!skipAutoAdvance) {
			setTimeout(() => {
				// Use the setter function to get fresh state
				setInvoices((currentInvoices) => {
					const allPaid = currentInvoices.every((inv) => inv.status === 'paid')

					if (allPaid) {
						setCurrentStep('complete')
						// Clear the cart after all payments are complete
						cartActions.clear()
					} else if (currentInvoiceIndex < currentInvoices.length - 1) {
						setCurrentInvoiceIndex((prev) => prev + 1)
					} else {
						// If we're at the last invoice but not all are paid, stay here
						// This can happen with failed payments
					}

					return currentInvoices // Return unchanged state
				})
			}, 1500)
		}
	}

	const handlePaymentFailed = (invoiceId: string, error: string) => {
		console.error(`Payment failed for invoice ${invoiceId}:`, error)

		setInvoices((prev) =>
			prev.map((invoice) => {
				if (invoice.id === invoiceId) {
					return {
						...invoice,
						status: 'expired' as const,
					}
				}
				return invoice
			}),
		)

		toast.error(`Payment failed: ${error}`)
	}

	// Individual NWC payment function (similar to PaymentContent logic)
	const handleNwcPaymentForInvoice = async (invoice: PaymentInvoiceData): Promise<string> => {
		let ndk = ndkActions.getNDK()
		if (!ndk) {
			console.warn('NDK not initialized for NWC payment, initializing now...')
			ndk = ndkActions.initialize()
			await ndkActions.connect()
		}

		if (!ndk) {
			throw new Error('Failed to initialize NDK for NWC payment')
		}

		const activeNwcUri = ndkState.activeNwcWalletUri
		if (!activeNwcUri) {
			throw new Error('No active NWC wallet selected. Please configure one in settings.')
		}

		let originalNdkWallet = ndk.wallet
		let nwcWalletForPayment: NDKNWCWallet | undefined

		try {
			nwcWalletForPayment = new NDKNWCWallet(ndk, { pairingCode: activeNwcUri })
			ndk.wallet = nwcWalletForPayment

			// Wait for wallet to be ready
			if (nwcWalletForPayment.status !== NDKWalletStatus.READY) {
				await new Promise<void>((resolve, reject) => {
					const readyTimeout = setTimeout(() => reject(new Error('NWC wallet connection timed out')), 20000)
					nwcWalletForPayment!.once('ready', () => {
						clearTimeout(readyTimeout)
						resolve()
					})
				})
			}

			// Create a "user" object for zapping (the payment recipient)
			const recipientUser = ndk.getUser({ pubkey: invoice.recipientPubkey })
			const zapAmountMsats = invoice.amount * 1000

			// Use NDKZapper for the payment (treating marketplace payment as a zap)
			const zapper = new NDKZapper(recipientUser, zapAmountMsats, 'msats', {
				comment: invoice.description,
			})

			console.log(`💸 Initiating NWC zap payment: ${invoice.amount} sats to ${invoice.recipientName}`)

			// Execute the zap payment
			const zapDetails = await zapper.zap()

			if (zapDetails instanceof Map && zapDetails.size > 0) {
				// Check if any payment confirmations contain a preimage
				const values = Array.from(zapDetails.values())
				for (const value of values) {
					if (value && typeof value === 'object' && 'preimage' in value && value.preimage) {
						return String(value.preimage)
					}
				}
			}

			// If we get here, the zap succeeded but we didn't get a preimage
			// Still mark as complete but with a mock preimage
			return `nwc-payment-${Date.now()}`
		} finally {
			if (ndk) ndk.wallet = originalNdkWallet
		}
	}

	const handlePayAllInvoices = async () => {
		if (!nwcEnabled) {
			toast.error('NWC not available for bulk payments')
			return
		}

		const pendingInvoices = invoices.filter((inv) => inv.status === 'pending')
		if (pendingInvoices.length === 0) {
			toast.info('No pending invoices to pay')
			return
		}

		toast.info(`Starting bulk payment for ${pendingInvoices.length} invoices...`)

		// Pay each invoice using real NWC payments
		for (let i = 0; i < pendingInvoices.length; i++) {
			const invoice = pendingInvoices[i]
			try {
				// Use real NWC payment
				const preimage = await handleNwcPaymentForInvoice(invoice)

				// Mark as paid using the existing handler but skip auto-advance
				await handlePaymentComplete(invoice.id, preimage, true)

				// Small delay between payments to avoid overwhelming the wallet
				await new Promise((resolve) => setTimeout(resolve, 1000))

				toast.success(`Payment ${i + 1}/${pendingInvoices.length} completed: ${invoice.recipientName}`)
			} catch (error) {
				console.error(`Bulk payment failed for invoice ${invoice.id}:`, error)
				handlePaymentFailed(invoice.id, error instanceof Error ? error.message : 'Bulk payment failed')
				toast.error(`Payment failed for ${invoice.recipientName}`)
				break // Stop on first failure
			}
		}

		// Check if all payments succeeded and manually transition to complete
		setTimeout(() => {
			setInvoices((currentInvoices) => {
				const allPaid = currentInvoices.every((inv) => inv.status === 'paid')
				if (allPaid) {
					toast.success('All payments completed successfully!')
					setCurrentStep('complete')
					// Clear the cart after all payments are complete
					cartActions.clear()
				}
				return currentInvoices // Return unchanged state
			})
		}, 1500)
	}

	const goBackToShopping = () => {
		navigate({ to: '/' })
	}

	const goToOrders = () => {
		navigate({ to: '/dashboard/account/your-purchases' })
	}

	const goBackToPreviousStep = () => {
		if (currentStep === 'summary') {
			setCurrentStep('shipping')
		} else if (currentStep === 'payment') {
			if (currentInvoiceIndex > 0) {
				setCurrentInvoiceIndex((prev) => prev - 1)
			} else {
				setCurrentStep('summary')
			}
		} else if (currentStep === 'complete') {
			setCurrentStep('payment')
			setCurrentInvoiceIndex(invoices.length - 1)
		}
	}

	const handleBackClick = () => {
		if (currentStep === 'shipping') {
			goBackToShopping()
		} else {
			goBackToPreviousStep()
		}
	}

	const handleContinueToPayment = async () => {
		setCurrentStep('payment')

		// Create spec-compliant orders - one per seller
		if (shippingData && sellers.length > 0 && specOrderIds.length === 0) {
			try {
				const ndk = ndkActions.getNDK()
				const currentUser = ndk?.activeUser
				const buyerPubkey = currentUser?.pubkey

				if (!buyerPubkey) {
					console.error('No active user found for order creation')
					// Continue with regular checkout flow
					return
				}

				const newOrderIds: string[] = []
				const newInvoiceSets: Record<string, OrderInvoiceSet> = {}

				// Create one order per seller
				for (const sellerPubkey of sellers) {
					const sellerProducts = productsBySeller[sellerPubkey] || []
					const data = sellerData[sellerPubkey]

					if (sellerProducts.length === 0) continue

					const sellerTotalSats = data?.satsTotal || 0
					const sellerShippingSats = data?.shippingSats || 0

					const orderData: OrderCreationData = {
						merchantPubkey: sellerPubkey,
						buyerPubkey: buyerPubkey,
						orderItems: sellerProducts.map((product) => ({
							productRef: `30402:${sellerPubkey}:${product.id}`,
							quantity: product.amount,
						})),
						totalAmountSats: sellerTotalSats,
						shippingAddress: shippingData,
						email: shippingData?.email || 'customer@example.com',
						notes: `Order for ${sellerProducts.length} item${sellerProducts.length !== 1 ? 's' : ''} from seller`,
					}

					const { orderId, success } = await createAndPublishOrder(orderData)

					if (success && orderId) {
						newOrderIds.push(orderId)

						// Create comprehensive invoice set for this seller
						const merchantAmount = data?.shares?.sellerAmount || sellerTotalSats
						const v4vRecipients = v4vShares[sellerPubkey] || []

						const invoiceSet = createOrderInvoiceSet(
							orderId,
							sellerPubkey,
							merchantAmount,
							v4vRecipients.map((recipient) => ({
								pubkey: recipient.pubkey,
								amount: Math.floor(sellerTotalSats * (recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage)),
							})),
						)

						newInvoiceSets[sellerPubkey] = invoiceSet
						console.log(`Spec-compliant order created for seller ${sellerPubkey.substring(0, 8)}...:`, orderId)

						// *** Create payment request events for each share ***
						// This creates individual payment request events (Kind 16, type 2) for the merchant and each V4V recipient
						const productSubtotal = sellerTotalSats - sellerShippingSats
						console.log(`\n📋 Creating payment requests for order ${orderId}:`)
						console.log(`   Total order: ${sellerTotalSats} sats (${productSubtotal} products + ${sellerShippingSats} shipping)`)
						console.log(`   Merchant share: ${merchantAmount} sats (${((merchantAmount / sellerTotalSats) * 100).toFixed(1)}%)`)
						if (v4vRecipients.length > 0) {
							console.log(`   V4V recipients: ${v4vRecipients.length}`)
							v4vRecipients.forEach((recipient, index) => {
								const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
								const recipientAmount = Math.max(1, Math.floor(productSubtotal * recipientPercentage))
								console.log(
									`     ${index + 1}. ${recipient.name}: ${recipientAmount} sats (${(recipientPercentage * 100).toFixed(1)}% of products)`,
								)
							})
						}
						console.log(`   Total payment requests to create: ${1 + v4vRecipients.length}\n`)

						const paymentRequests: PaymentRequestData[] = []

						// Fetch seller profile to get lightning address
						const sellerProfile = await fetchProfileByIdentifier(sellerPubkey)
						const sellerLightningAddress = sellerProfile?.lud16 || sellerProfile?.lud06 || 'plebeianuser@coinos.io' // fallback

						// 1. Create payment request for merchant share
						const merchantShare = data?.shares?.sellerAmount || sellerTotalSats
						const merchantPaymentData: PaymentRequestData = {
							buyerPubkey: buyerPubkey,
							merchantPubkey: sellerPubkey,
							orderId: orderId,
							amountSats: merchantShare,
							paymentMethods: [
								{
									type: 'lightning',
									details: sellerLightningAddress, // Use real lightning address
								},
							],
							notes: `Payment request for merchant share (${merchantShare} sats)`,
						}
						paymentRequests.push(merchantPaymentData)

						// 2. Create payment requests for each V4V recipient share
						for (const recipient of v4vRecipients) {
							// Calculate the recipient's amount based on their percentage of the PRODUCT total (excluding shipping)
							const productSubtotal = sellerTotalSats - sellerShippingSats
							const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
							const recipientAmount = Math.max(1, Math.floor(productSubtotal * recipientPercentage))

							if (recipientAmount > 0) {
								// Fetch V4V recipient profile to get their lightning address
								const recipientProfile = await fetchProfileByIdentifier(recipient.pubkey)
								const recipientLightningAddress = recipientProfile?.lud16 || recipientProfile?.lud06 || 'plebeianuser@coinos.io' // fallback

								const v4vPaymentData: PaymentRequestData = {
									buyerPubkey: buyerPubkey,
									merchantPubkey: recipient.pubkey, // V4V recipient receives the payment
									orderId: orderId,
									amountSats: recipientAmount,
									paymentMethods: [
										{
											type: 'lightning',
											details: recipientLightningAddress, // Use real lightning address
										},
									],
									notes: `Payment request for V4V recipient ${recipient.name} (${recipientAmount} sats, ${(recipientPercentage * 100).toFixed(1)}%)`,
								}
								paymentRequests.push(v4vPaymentData)
							}
						}

						// Create and publish all payment request events
						let successfulRequests = 0
						for (const paymentData of paymentRequests) {
							try {
								const paymentRequestEvent = await createPaymentRequestEvent(paymentData)
								await paymentRequestEvent.publish()
								successfulRequests++

								const isV4V = paymentData.merchantPubkey !== sellerPubkey
								console.log(
									`✅ Created payment request ${successfulRequests}/${paymentRequests.length}: ${isV4V ? 'V4V' : 'Merchant'} (${paymentData.amountSats} sats)`,
								)
							} catch (error) {
								console.error(`Failed to create payment request for ${paymentData.notes}:`, error)
							}
						}

						console.log(`Created ${successfulRequests}/${paymentRequests.length} payment request events for order ${orderId}`)
						if (successfulRequests !== paymentRequests.length) {
							console.warn(`Only ${successfulRequests} out of ${paymentRequests.length} payment requests were created successfully`)
						}
					}
				}

				setSpecOrderIds(newOrderIds)
				setOrderInvoiceSets(newInvoiceSets)

				// Calculate total payment requests created
				const totalPaymentRequests = sellers.reduce((total, sellerPubkey) => {
					const v4vRecipients = v4vShares[sellerPubkey] || []
					return total + 1 + v4vRecipients.length // 1 merchant + N v4v recipients
				}, 0)

				console.log(`\n🎉 Summary: Created ${newOrderIds.length} spec-compliant orders with ${totalPaymentRequests} total payment requests`)
				console.log(`   ${newOrderIds.length} merchant payment requests`)
				console.log(`   ${totalPaymentRequests - newOrderIds.length} V4V payment requests`)
				console.log('   Each payment request follows gamma spec (Kind 16, type 2)\n')
			} catch (error) {
				console.error('Failed to create spec-compliant orders:', error)
				// Continue with regular checkout flow
			}
		}
	}

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	// Redirect to home if cart is empty
	if (isCartEmpty) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="max-w-md mx-auto text-center">
					<h1 className="text-2xl font-bold text-gray-900 mb-4">Your cart is empty</h1>
					<p className="text-gray-600 mb-6">Add some products to your cart before checking out.</p>
					<Button onClick={goBackToShopping} className="bg-black text-white hover:bg-gray-800">
						Continue Shopping
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex-grow flex flex-col">
			{/* Progress Bar */}
			<CheckoutProgress
				currentStepNumber={currentStepNumber}
				totalSteps={totalSteps}
				progress={progress}
				stepDescription={stepDescription}
				onBackClick={handleBackClick}
			/>

			{/* Main Content */}
			<div className="px-4 py-8 flex flex-row gap-4 w-full flex-grow">
				{/* Main Content Area */}
				<Card className="flex-1 w-1/2 flex-grow">
					<CardContent className="p-6 h-full">
						<div ref={animationParent}>
							{currentStep === 'shipping' && <ShippingAddressForm form={form} hasAllShippingMethods={hasAllShippingMethods} />}

							{currentStep === 'summary' && (
								<OrderFinalizeComponent
									shippingData={shippingData}
									invoices={[]} // No invoices yet in summary step
									totalInSats={totalInSats}
									onNewOrder={goBackToShopping}
									onContinueToPayment={handleContinueToPayment}
								/>
							)}

							{/* Loading State for Invoice Generation */}
							{currentStep === 'payment' && isGeneratingInvoices && (
								<div className="text-center py-12">
									<div className="inline-flex items-center gap-2 text-gray-600 mb-4">
										<div className="animate-spin w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full" />
										<span className="text-lg font-medium">Generating Lightning invoices...</span>
									</div>
									<p className="text-sm text-gray-500 mb-2">Fetching seller Lightning addresses and creating payment requests</p>
									<p className="text-xs text-gray-400">This may take a few seconds</p>
								</div>
							)}

							{/* Error State - No Invoices Generated */}
							{currentStep === 'payment' && !isGeneratingInvoices && invoices.length === 0 && (
								<div className="text-center py-12">
									<div className="text-gray-600 mb-6">
										<Zap className="w-16 h-16 mx-auto mb-4 text-gray-400" />
										<h3 className="text-lg font-medium mb-2">Unable to generate payment invoices</h3>
										<p className="text-sm text-gray-500 max-w-md mx-auto">
											There may be an issue with the seller's Lightning configuration, or the Lightning service may be temporarily
											unavailable.
										</p>
									</div>
									<div className="space-y-2">
										<Button
											onClick={() => {
												setInvoices([])
												// This will trigger the useEffect to regenerate invoices
											}}
											variant="outline"
											className="mr-2"
										>
											Try Again
										</Button>
										<Button onClick={goBackToPreviousStep} variant="ghost">
											Go Back
										</Button>
									</div>
								</div>
							)}

							{/* Payment Interface - Only show when invoices are ready */}
							{currentStep === 'payment' && !isGeneratingInvoices && invoices.length > 0 && (
								<div className="space-y-6">
									<div className="flex items-center justify-between">
										<h2 className="text-2xl font-bold">
											Payment {currentInvoiceIndex + 1} of {invoices.length}
										</h2>
										{invoices.length > 1 && (
											<div className="flex items-center gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => setCurrentInvoiceIndex(Math.max(0, currentInvoiceIndex - 1))}
													disabled={currentInvoiceIndex === 0}
												>
													<ChevronLeft className="w-4 h-4" />
													Previous
												</Button>
												<span className="text-sm text-gray-500">
													{currentInvoiceIndex + 1} of {invoices.length}
												</span>
												<Button
													variant="outline"
													size="sm"
													onClick={() => setCurrentInvoiceIndex(Math.min(invoices.length - 1, currentInvoiceIndex + 1))}
													disabled={currentInvoiceIndex === invoices.length - 1}
												>
													Next
													<ChevronRight className="w-4 h-4" />
												</Button>
											</div>
										)}
									</div>

									{/* Pay All Button - Only show if NWC is enabled and there are unpaid invoices */}
									{nwcEnabled && invoices.filter((inv) => inv.status === 'pending').length > 1 && (
										<div className="flex justify-center mb-4">
											<Button
												onClick={handlePayAllInvoices}
												className="bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-2"
												size="lg"
											>
												<Zap className="w-4 h-4 mr-2" />
												Pay All with NWC ({invoices.filter((inv) => inv.status === 'pending').length} invoices)
											</Button>
										</div>
									)}

									{/* Payment Content - Inline instead of modal */}
									<PaymentContent
										invoices={invoices}
										currentIndex={currentInvoiceIndex}
										onPaymentComplete={handlePaymentComplete}
										onPaymentFailed={handlePaymentFailed}
										showNavigation={false} // We have our own navigation above
										nwcEnabled={nwcEnabled}
										onNavigate={setCurrentInvoiceIndex}
									/>
								</div>
							)}

							{currentStep === 'complete' && (
								<OrderFinalizeComponent
									shippingData={shippingData}
									invoices={invoices}
									totalInSats={totalInSats}
									onNewOrder={goBackToShopping}
									onViewOrders={goToOrders}
								/>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Right Sidebar */}
				<Card className="flex-1 w-1/2">
					<CardHeader>
						<CardTitle>{currentStep === 'payment' ? 'Payment Details' : 'Order Summary'}</CardTitle>
					</CardHeader>
					<CardContent className="h-full">
						{currentStep === 'payment' && isGeneratingInvoices ? (
							<div className="flex items-center justify-center h-full">
								<div className="text-center">
									<div className="animate-spin w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full mx-auto mb-4" />
									<p className="text-gray-600">Loading payment details...</p>
								</div>
							</div>
						) : currentStep === 'payment' && invoices.length > 0 ? (
							<>
								{/* NWC Status Indicator */}
								<div className="mb-4 p-3 bg-gray-50 rounded-lg border">
									<div className="flex items-center justify-between text-sm">
										<span className="font-medium text-gray-700">Wallet Status:</span>
										<div className="flex items-center gap-2">
											{nwcEnabled ? (
												<>
													<div className="w-2 h-2 bg-green-500 rounded-full" />
													<span className="text-green-700 font-medium">
														{wallets.filter((w) => w.nwcUri && parseNwcUri(w.nwcUri)).length} NWC wallet
														{wallets.filter((w) => w.nwcUri && parseNwcUri(w.nwcUri)).length !== 1 ? 's' : ''} connected
													</span>
												</>
											) : (
												<>
													<div className="w-2 h-2 bg-gray-400 rounded-full" />
													<span className="text-gray-600">No NWC wallets</span>
												</>
											)}
										</div>
									</div>
									{nwcEnabled && <p className="text-xs text-gray-500 mt-1">Fast payments available • Configure more wallets in settings</p>}
								</div>

								<PaymentSummary invoices={invoices} currentIndex={currentInvoiceIndex} onSelectInvoice={setCurrentInvoiceIndex} />
							</>
						) : (
							<ScrollArea className="h-full">
								<CartSummary
									allowQuantityChanges={currentStep === 'shipping'}
									allowShippingChanges={currentStep === 'shipping'}
									showExpandedDetails={false}
								/>
							</ScrollArea>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
