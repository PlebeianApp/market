import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { getShippingEvent, getShippingService, getShippingPickupAddressString, getShippingTitle } from '@/queries/shipping'
import { useEffect, useState } from 'react'

export interface CheckoutFormData {
	name: string
	email: string
	phone: string
	firstLineOfAddress: string
	zipPostcode: string
	city: string
	country: string
	additionalInformation: string
}

interface ShippingAddressFormProps {
	form: any
	hasAllShippingMethods: boolean
}

export function ShippingAddressForm({ form, hasAllShippingMethods }: ShippingAddressFormProps) {
	const { cart } = useStore(cartStore)
	const [isAllPickup, setIsAllPickup] = useState(false)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ title: string; address: string }>>([])

	// Check if all shipping methods are pickup type and fetch pickup addresses
	useEffect(() => {
		const checkPickupStatus = async () => {
			const products = Object.values(cart.products)
			if (products.length === 0) {
				setIsAllPickup(false)
				setPickupAddresses([])
				return
			}

			const pickupData = await Promise.all(
				products.map(async (product) => {
					if (!product.shippingMethodId) return { isPickup: false, title: '', address: '' }

					try {
						const shippingEvent = await getShippingEvent(product.shippingMethodId)
						if (!shippingEvent) return { isPickup: false, title: '', address: '' }

						const serviceTag = getShippingService(shippingEvent)
						const isPickup = serviceTag?.[1] === 'pickup'

						if (isPickup) {
							const title = getShippingTitle(shippingEvent)
							const address = getShippingPickupAddressString(shippingEvent)
							return { isPickup: true, title, address: address || 'Address not specified' }
						}

						return { isPickup: false, title: '', address: '' }
					} catch (error) {
						console.error('Error checking shipping service:', error)
						return { isPickup: false, title: '', address: '' }
					}
				}),
			)

			const allPickup = pickupData.every((data) => data.isPickup)
			setIsAllPickup(allPickup)

			if (allPickup) {
				// Get unique pickup addresses
				const uniqueAddresses = pickupData
					.filter((data) => data.isPickup)
					.reduce(
						(acc, data) => {
							const key = `${data.title}-${data.address}`
							if (!acc.some((item) => `${item.title}-${item.address}` === key)) {
								acc.push({ title: data.title, address: data.address })
							}
							return acc
						},
						[] as Array<{ title: string; address: string }>,
					)

				setPickupAddresses(uniqueAddresses)
			} else {
				setPickupAddresses([])
			}
		}

		checkPickupStatus()
	}, [cart.products])
	return (
		<form
			id="shipping-form"
			onSubmit={(e) => {
				e.preventDefault()
				e.stopPropagation()
				form.handleSubmit()
			}}
			className="space-y-4"
		>
			{/* Customer Information */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<form.Field
					name="name"
					validators={{
						onChange: ({ value }: { value: string }) => {
							// Name is only required for non-pickup orders
							if (!isAllPickup && !value.trim()) return 'Name is required'
							if (value.trim() && value.trim().length < 2) return 'Name must be at least 2 characters'
							return undefined
						},
					}}
					children={(field: any) => (
						<div>
							<Label htmlFor={field.name} className="text-sm font-medium">
								Full Name {!isAllPickup && <span className="text-red-500">*</span>}
							</Label>
							<Input
								id={field.name}
								type="text"
								placeholder="e.g. Satoshi Nakamoto"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								required={!isAllPickup}
							/>
							{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
								<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
							)}
						</div>
					)}
				/>

				<form.Field
					name="email"
					validators={{
						onChange: ({ value }: { value: string }) => {
							// Email is always optional
							if (value.trim()) {
								const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
								return !emailRegex.test(value) ? 'Please enter a valid email address' : undefined
							}
							return undefined
						},
					}}
					children={(field: any) => (
						<div>
							<Label htmlFor={field.name} className="text-sm font-medium">
								Email Address
							</Label>
							<Input
								id={field.name}
								type="email"
								placeholder="e.g. satoshi@example.com"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
							/>
							{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
								<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
							)}
						</div>
					)}
				/>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<form.Field
					name="phone"
					children={(field: any) => (
						<div>
							<Label htmlFor={field.name} className="text-sm font-medium">
								Phone Number
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

			{/* Pickup notification */}
			{isAllPickup && (
				<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
					<h3 className="text-sm font-medium text-blue-800 mb-2">Pickup Order</h3>
					<p className="text-sm text-blue-700 mb-3">All items in your order are for pickup. No shipping address is required.</p>

					{pickupAddresses.length > 0 && (
						<div className="space-y-2">
							<h4 className="text-xs font-medium text-blue-800 uppercase tracking-wide">
								Pickup Location{pickupAddresses.length > 1 ? 's' : ''}:
							</h4>
							{pickupAddresses.map((pickup, index) => (
								<div key={index} className="bg-white rounded-md p-3 border border-blue-100">
									<div className="text-sm font-medium text-gray-900">{pickup.title}</div>
									<div className="text-sm text-gray-600 mt-1">{pickup.address}</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Address - Only show if not all pickup */}
			{!isAllPickup && (
				<>
					<form.Field
						name="firstLineOfAddress"
						validators={{
							onChange: ({ value }: { value: string }) =>
								!isAllPickup && !value.trim()
									? 'Address is required'
									: !isAllPickup && value.trim().length < 5
										? 'Please enter a complete address'
										: undefined,
						}}
						children={(field: any) => (
							<div>
								<Label htmlFor={field.name} className="text-sm font-medium">
									Street Address <span className="text-red-500">*</span>
								</Label>
								<Input
									id={field.name}
									type="text"
									placeholder="e.g. 123 Main Street, Apt 4B"
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									required={!isAllPickup}
								/>
								{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
									<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					/>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<form.Field
							name="city"
							validators={{
								onChange: ({ value }: { value: string }) =>
									!isAllPickup && !value.trim()
										? 'City is required'
										: !isAllPickup && value.trim().length < 2
											? 'Please enter a valid city name'
											: undefined,
							}}
							children={(field: any) => (
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
										required={!isAllPickup}
									/>
									{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
										<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						/>

						<form.Field
							name="zipPostcode"
							validators={{
								onChange: ({ value }: { value: string }) =>
									!isAllPickup && !value.trim()
										? 'ZIP/Postcode is required'
										: !isAllPickup && value.trim().length < 3
											? 'Please enter a valid ZIP/Postcode'
											: undefined,
							}}
							children={(field: any) => (
								<div>
									<Label htmlFor={field.name} className="text-sm font-medium">
										ZIP/Postal Code <span className="text-red-500">*</span>
									</Label>
									<Input
										id={field.name}
										type="text"
										placeholder="e.g. 90210"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										required={!isAllPickup}
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
							onChange: ({ value }: { value: string }) =>
								!isAllPickup && !value.trim()
									? 'Country is required'
									: !isAllPickup && value.trim().length < 2
										? 'Please enter a valid country name'
										: undefined,
						}}
						children={(field: any) => (
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
									required={!isAllPickup}
								/>
								{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
									<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
								)}
							</div>
						)}
					/>
				</>
			)}

			{/* Additional Information */}
			<form.Field
				name="additionalInformation"
				children={(field: any) => (
					<div>
						<Label htmlFor={field.name} className="text-sm font-medium">
							Delivery Notes (Optional)
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

			{/* Submit button moved to parent fixed footer */}
		</form>
	)
}
