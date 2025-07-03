// @ts-nocheck
import { CartSummary } from '@/components/CartSummary'
import { CheckoutProgress } from '@/components/checkout/CheckoutProgress'
import { PaymentInterface, type PaymentInvoice } from '@/components/checkout/PaymentInterface'
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
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useInvoiceGeneration } from '@/hooks/useInvoiceGeneration'
import { createAndPublishOrder, createPaymentRequestEvent } from '@/publish/orders'
import type { OrderCreationData, PaymentRequestData } from '@/publish/orders'
import { createOrderInvoiceSet, updateInvoiceStatus } from '@/lib/utils/orderUtils'
import type { OrderInvoiceSet } from '@/lib/utils/orderUtils'
import { ndkActions } from '@/lib/stores/ndk'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

type CheckoutStep = 'shipping' | 'summary' | 'payment' | 'complete'

function RouteComponent() {
	const navigate = useNavigate()
	const { cart, totalInSats, totalShippingInSats, productsBySeller, sellerData, v4vShares } = useStore(cartStore)
	const { wallets, isInitialized: walletsInitialized, initialize: initializeWallets } = useWallets()
	const [currentStep, setCurrentStep] = useState<CheckoutStep>('shipping')
	const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0)
	const [invoices, setInvoices] = useState<PaymentInvoice[]>([])
	const [shippingData, setShippingData] = useState<CheckoutFormData | null>(null)

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
		// shipping + summary + (total invoices needed) + complete
		return 2 + totalInvoicesNeeded + 1
	}, [totalInvoicesNeeded])

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
					const invoiceTypeLabel = currentInvoice.invoiceType === 'v4v' ? 'V4V Payment' : 'Payment'
					return `${invoiceTypeLabel} ${currentInvoiceIndex + 1} of ${totalInvoicesNeeded}: ${currentInvoice.sellerName}`
				}
				return `Processing Lightning payments (${currentInvoiceIndex + 1} of ${totalInvoicesNeeded})`
			case 'complete':
				return 'Order complete'
			default:
				return 'Checkout'
		}
	}, [currentStep, currentInvoiceIndex, invoices, totalInvoicesNeeded])

	// Generate Lightning invoices when moving to payment step
	useEffect(() => {
		if (currentStep === 'payment' && invoices.length === 0 && sellers.length > 0 && !isGeneratingInvoices) {
			const generateInvoices = async () => {
				const newInvoices: PaymentInvoice[] = []
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

						// Convert to simplified PaymentInvoice format
						const paymentInvoice: PaymentInvoice = {
							id: sellerInvoice.id,
							sellerPubkey: sellerInvoice.sellerPubkey,
							sellerName: sellerInvoice.sellerName,
							amount: sellerInvoice.amount,
							bolt11: sellerInvoice.bolt11 || '',
							expiresAt: sellerInvoice.expiresAt,
							status: sellerInvoice.status,
							type: 'merchant',
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

									// Convert to simplified PaymentInvoice format
									const v4vPaymentInvoice: PaymentInvoice = {
										id: recipientInvoice.id,
										sellerPubkey: recipient.pubkey,
										sellerName: recipient.name,
										amount: recipientAmount,
										bolt11: recipientInvoice.bolt11 || '',
										expiresAt: recipientInvoice.expiresAt,
										status: recipientInvoice.status,
										type: 'v4v',
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
			if (currentInvoiceIndex < totalInvoicesNeeded - 1) {
				setCurrentInvoiceIndex((prev) => prev + 1)
			} else {
				setCurrentStep('complete')
				// Clear the cart after all payments are complete
				cartActions.clear()
			}
		}, 3000) // Slightly longer delay to simulate Lightning verification
	}

	const handlePaymentComplete = (invoiceId: string, method: 'lightning' | 'nwc') => {
		console.log(`Payment completed for invoice ${invoiceId} via ${method}`)

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

		// Auto-advance on successful payment
		setTimeout(() => {
			if (currentInvoiceIndex < totalInvoicesNeeded - 1) {
				setCurrentInvoiceIndex((prev) => prev + 1)
			} else {
				setCurrentStep('complete')
				// Clear the cart after all payments are complete
				cartActions.clear()
			}
		}, 1500)
	}

	const handlePayAllInvoices = () => {
		// Mark all remaining invoices as paid (simulating NWC batch payment)
		setInvoices((prev) =>
			prev.map((invoice) => ({
				...invoice,
				status: invoice.status === 'pending' ? ('paid' as const) : invoice.status,
			})),
		)

		// Go to completion
		setTimeout(() => {
			setCurrentStep('complete')
			cartActions.clear()
		}, 2000)
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
			setCurrentInvoiceIndex(totalInvoicesNeeded - 1)
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

						// *** NEW: Create payment request events for each invoice ***
						// This creates individual payment request events (Kind 16, type 2) for the merchant and each V4V recipient
						console.log(`Creating payment request events for order ${orderId}...`)

						// Create payment request for merchant
						const merchantInvoice = invoices.find((inv) => inv.sellerPubkey === sellerPubkey && inv.invoiceType === 'seller')
						if (merchantInvoice) {
							const merchantPaymentData: PaymentRequestData = {
								buyerPubkey: buyerPubkey,
								merchantPubkey: sellerPubkey,
								orderId: orderId,
								amountSats: merchantInvoice.amount,
								paymentMethods: [
									{
										type: 'lightning',
										details: merchantInvoice.bolt11 || 'lnbc130n1p5947vzsp...',
									},
								],
								expirationTime: merchantInvoice.expiresAt,
								notes: `Payment request for merchant payment (${merchantInvoice.amount} sats)`,
							}

							try {
								const paymentRequestEvent = await createPaymentRequestEvent(merchantPaymentData)
								await paymentRequestEvent.publish()
								console.log(`✅ Created payment request for merchant: ${merchantInvoice.amount} sats`)
							} catch (error) {
								console.error('Failed to create merchant payment request:', error)
							}
						}

						// Create payment requests for V4V recipients
						const v4vInvoicesForSeller = invoices.filter((inv) => inv.sellerPubkey === sellerPubkey && inv.invoiceType === 'v4v')
						for (const v4vInvoice of v4vInvoicesForSeller) {
							const v4vPaymentData: PaymentRequestData = {
								buyerPubkey: buyerPubkey,
								merchantPubkey: v4vInvoice.recipientPubkey, // V4V recipient is the "merchant" for this payment request
								orderId: orderId,
								amountSats: v4vInvoice.amount,
								paymentMethods: [
									{
										type: 'lightning',
										details: v4vInvoice.bolt11 || 'mock_v4v_invoice',
									},
								],
								expirationTime: v4vInvoice.expiresAt,
								notes: `Payment request for V4V recipient ${v4vInvoice.sellerName} (${v4vInvoice.amount} sats)`,
							}

							try {
								const paymentRequestEvent = await createPaymentRequestEvent(v4vPaymentData)
								await paymentRequestEvent.publish()
								console.log(`✅ Created payment request for V4V recipient ${v4vInvoice.sellerName}: ${v4vInvoice.amount} sats`)
							} catch (error) {
								console.error(`Failed to create V4V payment request for ${v4vInvoice.sellerName}:`, error)
							}
						}

						console.log(`Created ${1 + v4vInvoicesForSeller.length} payment request events for order ${orderId}`)
					}
				}

				setSpecOrderIds(newOrderIds)
				setOrderInvoiceSets(newInvoiceSets)
				console.log(`Created ${newOrderIds.length} spec-compliant orders with payment requests`)
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
								<PaymentInterface
									invoices={invoices}
									currentIndex={currentInvoiceIndex}
									onPaymentComplete={handlePaymentComplete}
									onNavigate={setCurrentInvoiceIndex}
									onPayAll={handlePayAllInvoices}
									nwcEnabled={nwcEnabled}
								/>
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
