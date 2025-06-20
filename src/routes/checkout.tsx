// @ts-nocheck
import { CartSummary } from '@/components/CartSummary'
import { CheckoutProgress } from '@/components/checkout/CheckoutProgress'
import { InvoicePaymentComponent, type LightningInvoiceData } from '@/components/checkout/InvoicePaymentComponent'
import { OrderFinalizeComponent } from '@/components/checkout/OrderFinalizeComponent'
import { ShippingAddressForm, type CheckoutFormData } from '@/components/checkout/ShippingAddressForm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { ChevronLeft, ChevronRight, Zap, User, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

type CheckoutStep = 'shipping' | 'summary' | 'payment' | 'complete'

// Mock function to generate BOLT11 invoice
const generateMockBolt11 = (amountSats: number, description: string): string => {
	// This is a mock BOLT11 invoice - in production, this would come from a Lightning service
	const mockInvoice = `lnbc${amountSats}u1pjkxyzt0zd9xksxzh9grrfvxsxgrsq27hv2xz6x9zpqfnwv4j8gctjq4s7w58rq3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v`
	return mockInvoice + Math.random().toString(36).substring(2, 15)
}

function RouteComponent() {
	const navigate = useNavigate()
	const { cart, totalInSats, totalShippingInSats, productsBySeller, sellerData, v4vShares } = useStore(cartStore)
	const [currentStep, setCurrentStep] = useState<CheckoutStep>('shipping')
	const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0)
	const [invoices, setInvoices] = useState<LightningInvoiceData[]>([])
	const [shippingData, setShippingData] = useState<CheckoutFormData | null>(null)
	const [animationParent] = useAutoAnimate()

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
		return sellers.reduce((total, sellerPubkey) => {
			// 1 invoice for the seller + 1 invoice for each V4V recipient
			const v4vRecipients = v4vShares[sellerPubkey] || []
			return total + 1 + v4vRecipients.length
		}, 0)
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
		if (currentStep === 'payment' && invoices.length === 0 && sellers.length > 0) {
			const newInvoices: LightningInvoiceData[] = []
			let invoiceIndex = 0

			sellers.forEach((sellerPubkey) => {
				const sellerProducts = productsBySeller[sellerPubkey] || []
				const data = sellerData[sellerPubkey]
				const totalAmount = data?.satsTotal || 0
				const shares = data?.shares
				const v4vRecipients = v4vShares[sellerPubkey] || []

				// Create invoice for seller's share
				const sellerAmount = shares?.sellerAmount || totalAmount
				const sellerInvoice: LightningInvoiceData = {
					id: `invoice-${invoiceIndex++}`,
					sellerPubkey,
					sellerName: `Seller ${sellerPubkey.substring(0, 8)}...`,
					amount: sellerAmount,
					bolt11: generateMockBolt11(sellerAmount, `Seller payment for ${sellerProducts.length} items`),
					expiresAt: Math.floor(Date.now() / 1000) + 3600,
					items: sellerProducts.map((product) => ({
						productId: product.id,
						name: `Product ${product.id.substring(0, 8)}...`,
						amount: product.amount,
						price: Math.floor(sellerAmount / sellerProducts.length),
					})),
					status: 'pending',
					invoiceType: 'seller',
				}
				newInvoices.push(sellerInvoice)

				// Create invoices for each V4V recipient
				v4vRecipients.forEach((recipient) => {
					// Calculate the recipient's amount based on their percentage
					const recipientPercentage = recipient.percentage > 1 ? recipient.percentage / 100 : recipient.percentage
					const recipientAmount = Math.floor(totalAmount * recipientPercentage)

					if (recipientAmount > 0) {
						const recipientInvoice: LightningInvoiceData = {
							id: `invoice-${invoiceIndex++}`,
							sellerPubkey: recipient.pubkey,
							sellerName: recipient.name || `V4V ${recipient.pubkey.substring(0, 8)}...`,
							amount: recipientAmount,
							bolt11: generateMockBolt11(recipientAmount, `V4V payment to ${recipient.name}`),
							expiresAt: Math.floor(Date.now() / 1000) + 3600,
							items: [
								{
									productId: `v4v-${recipient.id}`,
									name: `V4V Share (${(recipientPercentage * 100).toFixed(1)}%)`,
									amount: 1,
									price: recipientAmount,
								},
							],
							status: 'pending',
							invoiceType: 'v4v',
							originalSellerPubkey: sellerPubkey,
						}
						newInvoices.push(recipientInvoice)
					}
				})
			})

			setInvoices(newInvoices)
		}
	}, [currentStep, sellers, productsBySeller, sellerData, v4vShares, invoices.length])

	const form = useForm({
		defaultValues: {
			name: '',
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
			}
		}, 3000) // Slightly longer delay to simulate Lightning verification
	}

	const goBackToShopping = () => {
		navigate({ to: '/' })
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

	const handleContinueToPayment = () => {
		setCurrentStep('payment')
	}

	const navigateToInvoice = (index: number) => {
		if (index >= 0 && index < invoices.length) {
			setCurrentInvoiceIndex(index)
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

							{currentStep === 'payment' && invoices[currentInvoiceIndex] && (
								<div className="space-y-4">
									{/* Invoice Carousel Navigation */}
									{invoices.length > 1 && (
										<div className="flex items-center justify-between mb-4 p-4 bg-gray-50 rounded-lg">
											<Button
												variant="outline"
												size="sm"
												onClick={() => navigateToInvoice(currentInvoiceIndex - 1)}
												disabled={currentInvoiceIndex === 0}
											>
												<ChevronLeft className="w-4 h-4 mr-1" />
												Previous
											</Button>

											<div className="flex items-center space-x-2">
												{invoices.map((_, index) => (
													<button
														key={index}
														onClick={() => navigateToInvoice(index)}
														className={`w-3 h-3 rounded-full transition-colors ${
															index === currentInvoiceIndex ? 'bg-pink-500' : 'bg-gray-300 hover:bg-gray-400'
														}`}
													/>
												))}
											</div>

											<Button
												variant="outline"
												size="sm"
												onClick={() => navigateToInvoice(currentInvoiceIndex + 1)}
												disabled={currentInvoiceIndex === invoices.length - 1}
											>
												Next
												<ChevronRight className="w-4 h-4 ml-1" />
											</Button>
										</div>
									)}

									{/* Invoice Payment Component */}
									<InvoicePaymentComponent
										invoice={invoices[currentInvoiceIndex]}
										onPayInvoice={handlePayInvoice}
										invoiceNumber={currentInvoiceIndex + 1}
										totalInvoices={totalInvoicesNeeded}
									/>
								</div>
							)}

							{currentStep === 'complete' && (
								<OrderFinalizeComponent
									shippingData={shippingData}
									invoices={invoices}
									totalInSats={totalInSats}
									onNewOrder={goBackToShopping}
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
						{currentStep === 'payment' && invoices.length > 0 ? (
							<div className="space-y-4 h-full">
								{/* Current Invoice Summary */}
								<div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg p-4 border-2 border-pink-200">
									<div className="flex items-center gap-2 mb-2">
										{invoices[currentInvoiceIndex].invoiceType === 'v4v' ? (
											<Users className="w-5 h-5 text-purple-600" />
										) : (
											<User className="w-5 h-5 text-blue-600" />
										)}
										<span className="font-medium text-gray-900">Currently Paying: {invoices[currentInvoiceIndex].sellerName}</span>
									</div>
									<div className="flex items-center gap-2">
										<Zap className="w-4 h-4 text-yellow-500" />
										<span className="text-lg font-bold">{formatSats(invoices[currentInvoiceIndex].amount)} sats</span>
										<span
											className={`px-2 py-1 rounded-full text-xs font-medium ${
												invoices[currentInvoiceIndex].invoiceType === 'v4v' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
											}`}
										>
											{invoices[currentInvoiceIndex].invoiceType === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}
										</span>
									</div>
								</div>

								{/* Invoice List */}
								<h4 className="font-medium text-gray-900 mb-3 flex items-center justify-between">
									<span>All Payments ({invoices.length})</span>
									<span className="text-sm text-gray-500">Click to select</span>
								</h4>
								<ScrollArea>
									<div className="space-y-2">
										{invoices.map((invoice, index) => (
											<div
												key={invoice.id}
												onClick={() => navigateToInvoice(index)}
												className={`p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:shadow-md ${
													index === currentInvoiceIndex
														? 'bg-pink-50 border-pink-300 shadow-md ring-2 ring-pink-200'
														: 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-300'
												}`}
											>
												<div className="flex items-center justify-between">
													{/* Left Side - Invoice Info */}
													<div className="flex items-center gap-3 flex-1">
														<div className="flex-shrink-0">
															{invoice.invoiceType === 'v4v' ? (
																<div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
																	<Users className="w-5 h-5 text-purple-600" />
																</div>
															) : (
																<div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
																	<User className="w-5 h-5 text-blue-600" />
																</div>
															)}
														</div>
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1">
																<p className="font-medium text-gray-900 truncate">{invoice.sellerName}</p>
																{index === currentInvoiceIndex && (
																	<span className="bg-pink-500 text-white text-xs px-2 py-0.5 rounded-full">Current</span>
																)}
															</div>
															<p className="text-sm text-gray-600 mb-1">{invoice.invoiceType === 'v4v' ? 'V4V Recipient' : 'Merchant'}</p>
															<p className="text-xs text-gray-500 font-mono truncate">{invoice.sellerPubkey.substring(0, 20)}...</p>
														</div>
													</div>

													{/* Right Side - Amount & Status */}
													<div className="text-right flex-shrink-0 ml-4">
														<div className="flex items-center gap-1 justify-end mb-1">
															<Zap className="w-4 h-4 text-yellow-500" />
															<span className="font-bold text-gray-900">{formatSats(invoice.amount)}</span>
															<span className="text-sm text-gray-600">sats</span>
														</div>
														<div
															className={`inline-block text-xs px-2 py-1 rounded-full font-medium ${
																invoice.status === 'paid'
																	? 'bg-green-100 text-green-800'
																	: invoice.status === 'processing'
																		? 'bg-yellow-100 text-yellow-800'
																		: 'bg-gray-100 text-gray-800'
															}`}
														>
															{invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
														</div>
														{invoice.items.slice(0, 2).map((item, itemIndex) => (
															<div key={itemIndex} className="flex justify-between text-xs">
																<span className="text-gray-700 truncate mr-2">{item.name}</span>
															</div>
														))}
													</div>
												</div>
											</div>
										))}
									</div>
								</ScrollArea>
							</div>
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
