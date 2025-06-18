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
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

type CheckoutStep = 'shipping' | 'summary' | 'payment' | 'complete'

// Mock function to generate BOLT11 invoice
const generateMockBolt11 = (amountSats: number, description: string): string => {
	// This is a mock BOLT11 invoice - in production, this would come from a Lightning service
	const mockInvoice = `lnbc${amountSats}u1pjkxyzt0zd9xksxzh9grrfvxsxgrsq27hv2xz6x9zpqfnwv4j8gctjq4s7w58rq3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v3h7w2e8l9g8v`
	return mockInvoice + Math.random().toString(36).substring(2, 15)
}

function RouteComponent() {
	const navigate = useNavigate()
	const { cart, totalInSats, totalShippingInSats, productsBySeller, sellerData } = useStore(cartStore)
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

	const totalSteps = useMemo(() => {
		// shipping + summary + (number of invoices) + complete
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
					return `Lightning Payment ${currentInvoiceIndex + 1} of ${invoices.length}: ${currentInvoice.sellerName}`
				}
				return 'Processing Lightning payments'
			case 'complete':
				return 'Order complete'
			default:
				return 'Checkout'
		}
	}, [currentStep, currentInvoiceIndex, invoices])

	// Generate Lightning invoices when moving to payment step
	useEffect(() => {
		if (currentStep === 'payment' && invoices.length === 0 && sellers.length > 0) {
			const newInvoices: LightningInvoiceData[] = sellers.map((sellerPubkey, index) => {
				const sellerProducts = productsBySeller[sellerPubkey] || []
				const data = sellerData[sellerPubkey]
				const amount = data?.satsTotal || 0
				const description = `Payment to ${sellerPubkey.substring(0, 8)}... for ${sellerProducts.length} items`

				return {
					id: `invoice-${index}`,
					sellerPubkey,
					sellerName: `Seller ${sellerPubkey.substring(0, 8)}...`,
					amount,
					bolt11: generateMockBolt11(amount, description),
					expiresAt: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
					items: sellerProducts.map((product) => ({
						productId: product.id,
						name: `Product ${product.id.substring(0, 8)}...`,
						amount: product.amount,
						price: Math.floor((data?.satsTotal || 0) / sellerProducts.length), // Rough estimate
					})),
					status: 'pending',
				}
			})
			setInvoices(newInvoices)
		}
	}, [currentStep, sellers, productsBySeller, sellerData, invoices.length])

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
			if (currentInvoiceIndex < invoices.length - 1) {
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

	const handleContinueToPayment = () => {
		setCurrentStep('payment')
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
		<div>
			{/* Progress Bar */}
			<CheckoutProgress
				currentStepNumber={currentStepNumber}
				totalSteps={totalSteps}
				progress={progress}
				stepDescription={stepDescription}
				onBackClick={handleBackClick}
			/>

			{/* Main Content */}
			<div className="px-4 py-8 flex flex-row gap-4 w-full h-full">
				{/* Main Content Area */}
				<Card className="flex-1 w-1/2">
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
								<InvoicePaymentComponent
									invoice={invoices[currentInvoiceIndex]}
									onPayInvoice={handlePayInvoice}
									invoiceNumber={currentInvoiceIndex + 1}
									totalInvoices={invoices.length}
								/>
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

				{/* Order Summary Sidebar */}
				<Card className="flex-1 w-1/2">
					<CardHeader>
						<CardTitle>Order Summary</CardTitle>
					</CardHeader>
					<CardContent>
						<ScrollArea className="h-96">
							<CartSummary
								allowQuantityChanges={currentStep === 'shipping'}
								allowShippingChanges={currentStep === 'shipping'}
								showExpandedDetails={false}
							/>
						</ScrollArea>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
