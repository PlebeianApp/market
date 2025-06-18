import { CartSummary } from '@/components/CartSummary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/checkout')({
	component: RouteComponent,
})

interface CheckoutFormData {
	name: string
	phone: string
	firstLineOfAddress: string
	zipPostcode: string
	city: string
	country: string
	additionalInformation: string
}

function RouteComponent() {
	const navigate = useNavigate()
	const { cart, totalInSats, totalShippingInSats } = useStore(cartStore)
	const [isProcessing, setIsProcessing] = useState(false)

	const isCartEmpty = useMemo(() => {
		return Object.keys(cart.products).length === 0
	}, [cart.products])

	const hasAllShippingMethods = useMemo(() => {
		return Object.values(cart.products).every((product) => product.shippingMethodId !== null)
	}, [cart.products])

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

			setIsProcessing(true)
			// TODO: Implement order creation and payment processing according to gamma spec
			console.log('Proceeding to payment with:', {
				formData: value,
				cartData: cart,
				totalInSats,
			})

			// For now, just simulate processing
			setTimeout(() => {
				setIsProcessing(false)
				// TODO: Navigate to payment or success page
			}, 2000)
		},
	})

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
					<Button onClick={() => navigate({ to: '/' })} className="bg-black text-white hover:bg-gray-800">
						Continue Shopping
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="flex-1 px-4 sm:px-6 lg:px-8 py-8 overflow-hidden">
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				{/* Left Column - Checkout Form */}
				<Card className="flex-1 lg:order-1 flex flex-col">
					<CardHeader className="flex-shrink-0">
						<CardTitle>Order Details</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 overflow-hidden">
						<ScrollArea className="pr-4">
							<div className="space-y-6">
								<form
									onSubmit={(e) => {
										e.preventDefault()
										e.stopPropagation()
										form.handleSubmit()
									}}
									className="space-y-6"
								>
									{/* Customer Information */}
									<div className="space-y-4">
										<form.Field
											name="name"
											validators={{
												onChange: ({ value }) =>
													!value.trim() ? 'Name is required' : value.trim().length < 2 ? 'Name must be at least 2 characters' : undefined,
											}}
											children={(field) => (
												<div>
													<Label htmlFor={field.name} className="text-sm font-medium">
														Name <span className="text-red-500">*</span>
													</Label>
													<Input
														id={field.name}
														type="text"
														placeholder="e.g. Satoshi Nakamoto"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														required
													/>
													{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
														<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
													)}
												</div>
											)}
										/>

										<form.Field
											name="phone"
											children={(field) => (
												<div>
													<Label htmlFor={field.name} className="text-sm font-medium">
														Phone (Optional)
													</Label>
													<Input
														id={field.name}
														type="tel"
														placeholder="e.g. +447751892718"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
												</div>
											)}
										/>
									</div>

									{/* Shipping Address */}
									<div className="space-y-4">
										<h3 className="text-lg font-medium">Shipping Address</h3>

										<form.Field
											name="firstLineOfAddress"
											validators={{
												onChange: ({ value }) =>
													!value.trim() ? 'Address is required' : value.trim().length < 5 ? 'Please enter a complete address' : undefined,
											}}
											children={(field) => (
												<div>
													<Label htmlFor={field.name} className="text-sm font-medium">
														First Line Of Address <span className="text-red-500">*</span>
													</Label>
													<Input
														id={field.name}
														type="text"
														placeholder="e.g. 123 Main Street"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														required
													/>
													{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
														<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
													)}
												</div>
											)}
										/>

										<div className="grid grid-cols-2 gap-4">
											<form.Field
												name="zipPostcode"
												validators={{
													onChange: ({ value }) =>
														!value.trim()
															? 'ZIP/Postcode is required'
															: value.trim().length < 3
																? 'Please enter a valid ZIP/Postcode'
																: undefined,
												}}
												children={(field) => (
													<div>
														<Label htmlFor={field.name} className="text-sm font-medium">
															ZIP/Postcode <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															type="text"
															placeholder="e.g. 90210"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															required
														/>
														{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
															<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
														)}
													</div>
												)}
											/>

											<form.Field
												name="city"
												validators={{
													onChange: ({ value }) =>
														!value.trim() ? 'City is required' : value.trim().length < 2 ? 'Please enter a valid city name' : undefined,
												}}
												children={(field) => (
													<div>
														<Label htmlFor={field.name} className="text-sm font-medium">
															City <span className="text-red-500">*</span>
														</Label>
														<Input
															id={field.name}
															type="text"
															placeholder="e.g. San Francisco"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															onBlur={field.handleBlur}
															required
														/>
														{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
															<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
														)}
													</div>
												)}
											/>
										</div>

										<form.Field
											name="country"
											validators={{
												onChange: ({ value }) =>
													!value.trim() ? 'Country is required' : value.trim().length < 2 ? 'Please enter a valid country name' : undefined,
											}}
											children={(field) => (
												<div>
													<Label htmlFor={field.name} className="text-sm font-medium">
														Country <span className="text-red-500">*</span>
													</Label>
													<Input
														id={field.name}
														type="text"
														placeholder="e.g. United Kingdom"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
														required
													/>
													{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
														<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
													)}
												</div>
											)}
										/>
									</div>

									{/* Additional Information */}
									<form.Field
										name="additionalInformation"
										children={(field) => (
											<div>
												<Label htmlFor={field.name} className="text-sm font-medium">
													Additional Information
												</Label>
												<Textarea
													id={field.name}
													placeholder="e.g. Leave package at front door, Ring doorbell twice"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													rows={3}
												/>
												<p className="text-xs text-gray-500 mt-1">Any special delivery instructions or notes for the seller</p>
											</div>
										)}
									/>

									{/* Validation Messages */}
									{!hasAllShippingMethods && (
										<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
											<p className="text-sm text-yellow-700">Please select shipping options for all items in your cart.</p>
										</div>
									)}

									{/* Order Total Summary */}
									<div className="border-t pt-6">
										<div className="space-y-2">
											<div className="flex justify-between text-sm">
												<span>Subtotal:</span>
												<span>{formatSats(totalInSats - totalShippingInSats)} sat</span>
											</div>
											<div className="flex justify-between text-sm">
												<span>Shipping:</span>
												<span>{formatSats(totalShippingInSats)} sat</span>
											</div>
											<div className="flex justify-between text-lg font-bold border-t pt-2">
												<span>Total:</span>
												<span>{formatSats(totalInSats)} sat</span>
											</div>
										</div>
									</div>

									{/* Proceed to Payment Button */}
									<form.Subscribe
										selector={(state) => [state.canSubmit, state.isSubmitting]}
										children={([canSubmit, isSubmitting]) => (
											<Button
												type="submit"
												className="w-full bg-black text-white hover:bg-gray-800"
												disabled={!canSubmit || !hasAllShippingMethods || isSubmitting || isProcessing}
											>
												{isSubmitting || isProcessing ? 'Processing...' : 'Proceed to Payment'}
											</Button>
										)}
									/>

									<p className="text-xs text-gray-500 text-center">You'll be able to review your order before payment</p>
								</form>
							</div>
						</ScrollArea>
					</CardContent>
				</Card>

				{/* Right Column - Order Summary */}
				<Card className="flex-1 lg:order-2 flex flex-col">
					<CardHeader className="flex-shrink-0">
						<CardTitle>Order Summary</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 overflow-hidden">
						<ScrollArea className="h-full pr-4">
							<CartSummary allowQuantityChanges={true} allowShippingChanges={true} showExpandedDetails={false} />
						</ScrollArea>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
