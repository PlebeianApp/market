import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CountryCombobox, isValidCountry } from '@/components/checkout/CountryCombobox'
import { CityCombobox } from '@/components/checkout/CityCombobox'
import { PhoneInput } from '@/components/checkout/PhoneInput'
import type { CheckoutDeliveryRequirements } from '@/lib/checkout/deliveryRequirements'
import { isValidDigitalDeliveryContact } from '@/lib/checkout/deliveryRequirements'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { getShippingEvent, getShippingPickupAddressString, getShippingService, getShippingTitle } from '@/queries/shipping'
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
	deliveryRequirements: CheckoutDeliveryRequirements
	isDeliveryRequirementsLoading: boolean
	deliveryRequirementsError: string | null
}

export function ShippingAddressForm({
	form,
	hasAllShippingMethods,
	deliveryRequirements,
	isDeliveryRequirementsLoading,
	deliveryRequirementsError,
}: ShippingAddressFormProps) {
	const { cart } = useStore(cartStore)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ title: string; address: string }>>([])

	const isAllPickup =
		deliveryRequirements.isResolved &&
		deliveryRequirements.hasPickupDelivery &&
		!deliveryRequirements.hasDigitalDelivery &&
		!deliveryRequirements.hasPhysicalDelivery
	const isAllDigital =
		deliveryRequirements.isResolved &&
		deliveryRequirements.hasDigitalDelivery &&
		!deliveryRequirements.hasPickupDelivery &&
		!deliveryRequirements.hasPhysicalDelivery
	const noAddressRequired = deliveryRequirements.isResolved && !deliveryRequirements.needsPhysicalAddress
	const needsPhysicalAddress = deliveryRequirements.isResolved ? deliveryRequirements.needsPhysicalAddress : true
	const needsDigitalDeliveryContact = deliveryRequirements.isResolved && deliveryRequirements.needsDigitalDeliveryContact
	const hasDigitalDelivery = deliveryRequirements.hasDigitalDelivery
	const deliveryRequirementsBlocked =
		isDeliveryRequirementsLoading || !!deliveryRequirementsError || (hasAllShippingMethods && !deliveryRequirements.isResolved)

	useEffect(() => {
		const fetchPickupAddresses = async () => {
			const products = Object.values(cart.products)
			if (products.length === 0 || !deliveryRequirements.isResolved || !deliveryRequirements.hasPickupDelivery) {
				setPickupAddresses([])
				return
			}

			const serviceData = await Promise.all(
				products.map(async (product) => {
					if (!product.shippingMethodId) return null

					try {
						const shippingEvent = await getShippingEvent(product.shippingMethodId)
						if (!shippingEvent) return null

						const serviceTag = getShippingService(shippingEvent)
						const serviceType = serviceTag?.[1]

						if (serviceType === 'pickup') {
							const title = getShippingTitle(shippingEvent)
							const address = getShippingPickupAddressString(shippingEvent)
							return { title, address: address || 'Address not specified' }
						}

						return null
					} catch (error) {
						console.error('Error checking shipping service:', error)
						return null
					}
				}),
			)

			const uniqueAddresses = serviceData.filter(Boolean).reduce(
				(acc, data) => {
					const key = `${data!.title}-${data!.address}`
					if (!acc.some((item) => `${item.title}-${item.address}` === key)) {
						acc.push({ title: data!.title, address: data!.address })
					}
					return acc
				},
				[] as Array<{ title: string; address: string }>,
			)

			setPickupAddresses(uniqueAddresses)
		}

		fetchPickupAddresses()
	}, [cart.products, deliveryRequirements.hasPickupDelivery, deliveryRequirements.isResolved])
	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto space-y-4">
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
					<div className="space-y-4">
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }: { value: string }) => {
									// Name is only required when a physical address is needed
									if (needsPhysicalAddress && !value.trim()) return 'Name is required'
									if (value.trim() && value.trim().length < 2) return 'Name must be at least 2 characters'
									return undefined
								},
							}}
							children={(field: any) => (
								<div>
									<Label htmlFor={field.name} className="text-sm font-medium">
										Full Name {needsPhysicalAddress && <span className="text-red-500">*</span>}
									</Label>
									<Input
										id={field.name}
										type="text"
										placeholder="e.g. Satoshi Nakamoto"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										required={needsPhysicalAddress}
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
									if (needsDigitalDeliveryContact && !value.trim()) {
										return 'Digital delivery contact is required'
									}
									if (value.trim() && !isValidDigitalDeliveryContact(value)) return 'Please enter a valid email address'
									return undefined
								},
							}}
							children={(field: any) => (
								<div>
									<Label htmlFor={field.name} className="text-sm font-medium">
										{hasDigitalDelivery ? 'Digital Delivery Contact (Email)' : 'Email Address'}{' '}
										{needsDigitalDeliveryContact && <span className="text-red-500">*</span>}
									</Label>
									<Input
										id={field.name}
										type="email"
										placeholder="e.g. satoshi@example.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										required={needsDigitalDeliveryContact}
									/>
									{hasDigitalDelivery && (
										<div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
											<p className="font-medium">Digital delivery contact</p>
											<p className="mt-1">The seller will use this contact to deliver your digital item after payment settles.</p>
											<p className="mt-1">
												Privacy note: this contact will be shared with the seller and may be visible according to the app's current public
												order metadata model.
											</p>
										</div>
									)}
									{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
										<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						/>
					</div>

					<form.Subscribe
						selector={(state: any) => state.values.country}
						children={(selectedCountry: string) => (
							<form.Field
								name="phone"
								children={(field: any) => (
									<div>
										<Label htmlFor={field.name} className="text-sm font-medium">
											Phone Number
										</Label>
										<PhoneInput
											id={field.name}
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											onBlur={field.handleBlur}
											selectedCountry={selectedCountry}
										/>
									</div>
								)}
							/>
						)}
					/>

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

					{/* Digital delivery notification */}
					{isAllDigital && (
						<div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
							<h3 className="text-sm font-medium text-purple-800 mb-2">Digital Delivery</h3>
							<p className="text-sm text-purple-700">
								All items in your order will be delivered digitally. No shipping address is required. The seller will use your delivery
								contact after payment settles.
							</p>
						</div>
					)}

					{/* Mixed pickup + digital notification */}
					{noAddressRequired && !isAllPickup && !isAllDigital && (
						<div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
							<h3 className="text-sm font-medium text-indigo-800 mb-2">No Shipping Required</h3>
							<p className="text-sm text-indigo-700">
								All items in your order are either for pickup or digital delivery. No shipping address is required. Sellers will use any
								digital delivery contact after payment settles.
							</p>
						</div>
					)}

					{/* Address - Only show when physical shipping is needed */}
					{needsPhysicalAddress && (
						<>
							<form.Field
								name="firstLineOfAddress"
								validators={{
									onChange: ({ value }: { value: string }) =>
										needsPhysicalAddress && !value.trim()
											? 'Address is required'
											: needsPhysicalAddress && value.trim().length < 5
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
											required={needsPhysicalAddress}
										/>
										{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
											<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							/>

							<form.Subscribe
								selector={(state: any) => state.values.country || ''}
								children={(selectedCountry: string) => (
									<form.Field
										name="city"
										validators={{
											onChange: ({ value }: { value: string }) =>
												needsPhysicalAddress && !value.trim()
													? 'City is required'
													: needsPhysicalAddress && value.trim().length < 2
														? 'Please enter a valid city name'
														: undefined,
										}}
										children={(field: any) => (
											<div>
												<Label htmlFor={field.name} className="text-sm font-medium">
													City <span className="text-red-500">*</span>
												</Label>
												<CityCombobox
													id={field.name}
													value={field.state.value}
													onChange={(value) => field.handleChange(value)}
													onBlur={field.handleBlur}
													placeholder="e.g. San Francisco"
													required={needsPhysicalAddress}
													selectedCountry={selectedCountry}
												/>
												{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
													<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
												)}
											</div>
										)}
									/>
								)}
							/>

							<form.Field
								name="zipPostcode"
								validators={{
									onChange: ({ value }: { value: string }) =>
										needsPhysicalAddress && !value.trim()
											? 'ZIP/Postcode is required'
											: needsPhysicalAddress && value.trim().length < 3
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
											required={needsPhysicalAddress}
										/>
										{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
											<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							/>

							<form.Field
								name="country"
								validators={{
									onChange: ({ value }: { value: string }) =>
										needsPhysicalAddress && !value.trim()
											? 'Country is required'
											: needsPhysicalAddress && !isValidCountry(value)
												? 'Please select a valid country from the list'
												: undefined,
								}}
								children={(field: any) => (
									<div>
										<Label htmlFor={field.name} className="text-sm font-medium">
											Country <span className="text-red-500">*</span>
										</Label>
										<CountryCombobox
											id={field.name}
											value={field.state.value}
											onChange={(value) => field.handleChange(value)}
											onBlur={field.handleBlur}
											placeholder="e.g. United Kingdom"
											required={needsPhysicalAddress}
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
					{hasAllShippingMethods && isDeliveryRequirementsLoading && (
						<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
							<p className="text-sm text-yellow-700">Checking delivery requirements before checkout can continue...</p>
						</div>
					)}
					{hasAllShippingMethods && deliveryRequirementsError && (
						<div className="bg-red-50 border-l-4 border-red-400 p-4">
							<p className="text-sm text-red-700">{deliveryRequirementsError}</p>
						</div>
					)}
					{hasAllShippingMethods && !isDeliveryRequirementsLoading && !deliveryRequirementsError && !deliveryRequirements.isResolved && (
						<div className="bg-red-50 border-l-4 border-red-400 p-4">
							<p className="text-sm text-red-700">
								Delivery requirements could not be verified for the selected shipping options. Please reselect shipping before continuing.
							</p>
						</div>
					)}
				</form>
			</div>
			<div className="flex-shrink-0 bg-white border-t pt-4">
				<form.Subscribe
					selector={(state: any) => state.isSubmitting}
					children={(isSubmitting: boolean) => (
						<Button
							form="shipping-form"
							type="submit"
							className="w-full btn-black"
							disabled={!hasAllShippingMethods || deliveryRequirementsBlocked || isSubmitting}
						>
							{isSubmitting ? 'Processing...' : 'Continue to Review'}
						</Button>
					)}
				/>
			</div>
		</div>
	)
}
