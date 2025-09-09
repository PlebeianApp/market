import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MapPin } from 'lucide-react'

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
	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 bg-blue-100 rounded-lg">
					<MapPin className="h-5 w-5 text-blue-600" />
				</div>
				<div>
					<h2 className="text-xl font-semibold">Shipping Address</h2>
					<p className="text-gray-600">Where should we deliver your order?</p>
				</div>
			</div>

			<form
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
							onChange: ({ value }: { value: string }) =>
								!value.trim() ? 'Name is required' : value.trim().length < 2 ? 'Name must be at least 2 characters' : undefined,
						}}
						children={(field: any) => (
							<div>
								<Label htmlFor={field.name} className="text-sm font-medium">
									Full Name <span className="text-red-500">*</span>
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
						name="email"
						validators={{
							onChange: ({ value }: { value: string }) => {
								if (!value.trim()) return 'Email is required'
								const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
								return !emailRegex.test(value) ? 'Please enter a valid email address' : undefined
							},
						}}
						children={(field: any) => (
							<div>
								<Label htmlFor={field.name} className="text-sm font-medium">
									Email Address <span className="text-red-500">*</span>
								</Label>
								<Input
									id={field.name}
									type="email"
									placeholder="e.g. satoshi@example.com"
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

				{/* Address Fields */}
				<form.Field
					name="firstLineOfAddress"
					validators={{
						onChange: ({ value }: { value: string }) =>
							!value.trim() ? 'Address is required' : value.trim().length < 5 ? 'Please enter a complete address' : undefined,
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
								required
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
								!value.trim() ? 'City is required' : value.trim().length < 2 ? 'Please enter a valid city name' : undefined,
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
									required
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
								!value.trim() ? 'ZIP/Postcode is required' : value.trim().length < 3 ? 'Please enter a valid ZIP/Postcode' : undefined,
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
						onChange: ({ value }: { value: string }) =>
							!value.trim() ? 'Country is required' : value.trim().length < 2 ? 'Please enter a valid country name' : undefined,
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
								required
							/>
							{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
								<p className="text-xs text-red-500 mt-1">{field.state.meta.errors[0]}</p>
							)}
						</div>
					)}
				/>

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

				{/* Submit Button */}
				<form.Subscribe
					selector={(state: any) => [state.canSubmit, state.isSubmitting]}
					children={([canSubmit, isSubmitting]: [boolean, boolean]) => (
						<Button
							type="submit"
							className="w-full btn-black"
							disabled={!canSubmit || !hasAllShippingMethods || isSubmitting}
						>
							{isSubmitting ? 'Processing...' : 'Continue to Payment'}
						</Button>
					)}
				/>
			</form>
		</div>
	)
}
