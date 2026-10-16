import type { ReactNode } from 'react'
import { summarizeCheckoutDelivery, type CheckoutDeliveryRequirements, type CheckoutFormField } from '@sdk/commerce/checkout'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Textarea } from '../../primitives/textarea'
import { CityCombobox } from '../CityCombobox'
import { CountryCombobox } from '../CountryCombobox'
import { PhoneInput } from '../PhoneInput'

export interface CheckoutFieldBinding {
	value: string
	/** Shown once the field has been touched. */
	error?: string
	onChange: (value: string) => void
	onBlur: () => void
}

export interface ShippingAddressFormViewProps {
	fields: Record<CheckoutFormField, CheckoutFieldBinding>
	hasAllShippingMethods: boolean
	deliveryRequirements: CheckoutDeliveryRequirements
	isDeliveryRequirementsLoading: boolean
	deliveryRequirementsError: string | null
	pickupAddresses: readonly { title: string; address: string }[]
	isSubmitting: boolean
	onSubmit: () => void
}

function FieldError({ error }: { error?: string }) {
	return error ? <p className="text-xs text-red-500 mt-1">{error}</p> : null
}

function RequiredMark({ show = true }: { show?: boolean }) {
	return show ? <span className="text-red-500">*</span> : null
}

function Notice({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
	const className = tone === 'warning' ? 'bg-yellow-50 border-l-4 border-yellow-400 p-4' : 'bg-red-50 border-l-4 border-red-400 p-4'
	const textClass = tone === 'warning' ? 'text-sm text-yellow-700' : 'text-sm text-red-700'
	return (
		<div className={className}>
			<p className={textClass}>{children}</p>
		</div>
	)
}

export function ShippingAddressFormView({
	fields,
	hasAllShippingMethods,
	deliveryRequirements,
	isDeliveryRequirementsLoading,
	deliveryRequirementsError,
	pickupAddresses,
	isSubmitting,
	onSubmit,
}: ShippingAddressFormViewProps) {
	const { isAllPickup, isAllDigital, noAddressRequired, needsPhysicalAddress, needsDigitalDeliveryContact } =
		summarizeCheckoutDelivery(deliveryRequirements)
	const hasDigitalDelivery = deliveryRequirements.hasDigitalDelivery
	const deliveryRequirementsBlocked =
		isDeliveryRequirementsLoading || !!deliveryRequirementsError || (hasAllShippingMethods && !deliveryRequirements.isResolved)
	const country = fields.country.value

	const textField = (name: CheckoutFormField, label: ReactNode, type: string, placeholder: string, required: boolean) => (
		<div>
			<Label htmlFor={name} className="text-sm font-medium">
				{label}
			</Label>
			<Input
				id={name}
				type={type}
				placeholder={placeholder}
				value={fields[name].value}
				onChange={(e) => fields[name].onChange(e.target.value)}
				onBlur={fields[name].onBlur}
				required={required}
			/>
			<FieldError error={fields[name].error} />
		</div>
	)

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto space-y-4">
				<form
					id="shipping-form"
					onSubmit={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onSubmit()
					}}
					className="space-y-4"
				>
					<div className="space-y-4">
						{textField(
							'name',
							<>
								Full Name <RequiredMark show={needsPhysicalAddress} />
							</>,
							'text',
							'e.g. Satoshi Nakamoto',
							needsPhysicalAddress,
						)}

						<div>
							<Label htmlFor="email" className="text-sm font-medium">
								{hasDigitalDelivery ? 'Digital Delivery Contact (Email)' : 'Email Address'}{' '}
								<RequiredMark show={needsDigitalDeliveryContact} />
							</Label>
							<Input
								id="email"
								type="email"
								placeholder="e.g. satoshi@example.com"
								value={fields.email.value}
								onChange={(e) => fields.email.onChange(e.target.value)}
								onBlur={fields.email.onBlur}
								required={needsDigitalDeliveryContact}
							/>
							{hasDigitalDelivery && (
								<div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
									<p className="font-medium">Digital delivery contact</p>
									<p className="mt-1">The seller will use this contact to deliver your digital item after payment settles.</p>
									<p className="mt-1">
										Privacy note: this contact will be shared with the seller and may be visible according to the app's current public order
										metadata model.
									</p>
								</div>
							)}
							<FieldError error={fields.email.error} />
						</div>
					</div>

					<div>
						<Label htmlFor="phone" className="text-sm font-medium">
							Phone Number
						</Label>
						<PhoneInput
							id="phone"
							value={fields.phone.value}
							onChange={fields.phone.onChange}
							onBlur={fields.phone.onBlur}
							selectedCountry={country}
						/>
					</div>

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

					{isAllDigital && (
						<div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
							<h3 className="text-sm font-medium text-purple-800 mb-2">Digital Delivery</h3>
							<p className="text-sm text-purple-700">
								All items in your order will be delivered digitally. No shipping address is required. The seller will use your delivery
								contact after payment settles.
							</p>
						</div>
					)}

					{noAddressRequired && !isAllPickup && !isAllDigital && (
						<div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
							<h3 className="text-sm font-medium text-indigo-800 mb-2">No Shipping Required</h3>
							<p className="text-sm text-indigo-700">
								All items in your order are either for pickup or digital delivery. No shipping address is required. Sellers will use any
								digital delivery contact after payment settles.
							</p>
						</div>
					)}

					{needsPhysicalAddress && (
						<>
							{textField(
								'firstLineOfAddress',
								<>
									Street Address <RequiredMark />
								</>,
								'text',
								'e.g. 123 Main Street, Apt 4B',
								true,
							)}

							<div>
								<Label htmlFor="city" className="text-sm font-medium">
									City <RequiredMark />
								</Label>
								<CityCombobox
									id="city"
									value={fields.city.value}
									onChange={fields.city.onChange}
									onBlur={fields.city.onBlur}
									placeholder="e.g. San Francisco"
									required
									selectedCountry={country || ''}
								/>
								<FieldError error={fields.city.error} />
							</div>

							{textField(
								'zipPostcode',
								<>
									ZIP/Postal Code <RequiredMark />
								</>,
								'text',
								'e.g. 90210',
								true,
							)}

							<div>
								<Label htmlFor="country" className="text-sm font-medium">
									Country <RequiredMark />
								</Label>
								<CountryCombobox
									id="country"
									value={country}
									onChange={fields.country.onChange}
									onBlur={fields.country.onBlur}
									placeholder="e.g. United Kingdom"
									required
								/>
								<FieldError error={fields.country.error} />
							</div>
						</>
					)}

					<div>
						<Label htmlFor="additionalInformation" className="text-sm font-medium">
							Delivery Notes (Optional)
						</Label>
						<Textarea
							id="additionalInformation"
							placeholder="e.g. Leave package at front door, Ring doorbell twice"
							value={fields.additionalInformation.value}
							onChange={(e) => fields.additionalInformation.onChange(e.target.value)}
							onBlur={fields.additionalInformation.onBlur}
							rows={3}
						/>
						<p className="text-xs text-gray-500 mt-1">Any special delivery instructions or notes for the seller</p>
					</div>

					{!hasAllShippingMethods && <Notice tone="warning">Please select shipping options for all items in your cart.</Notice>}
					{hasAllShippingMethods && isDeliveryRequirementsLoading && (
						<Notice tone="warning">Checking delivery requirements before checkout can continue...</Notice>
					)}
					{hasAllShippingMethods && deliveryRequirementsError && <Notice tone="error">{deliveryRequirementsError}</Notice>}
					{hasAllShippingMethods && !isDeliveryRequirementsLoading && !deliveryRequirementsError && !deliveryRequirements.isResolved && (
						<Notice tone="error">
							Delivery requirements could not be verified for the selected shipping options. Please reselect shipping before continuing.
						</Notice>
					)}
				</form>
			</div>
			<div className="flex-shrink-0 bg-white border-t pt-4">
				<Button
					form="shipping-form"
					type="submit"
					className="w-full btn-black"
					disabled={!hasAllShippingMethods || deliveryRequirementsBlocked || isSubmitting}
				>
					{isSubmitting ? 'Processing...' : 'Continue to Review'}
				</Button>
			</div>
		</div>
	)
}
