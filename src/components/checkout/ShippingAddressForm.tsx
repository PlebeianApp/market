import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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
		<div className="flex flex-col h-full max-h-full">
			{/* Fixed Header */}
			<div className="flex-shrink-0 mb-6">
				<h2 className="font-semibold">Shipping Address</h2>
			</div>

			<div className="flex-1 overflow-y-auto space-y-6 pr-2 pb-4">

			<form
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

				<div className="space-y-4">
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

				</form>
			</div>

			{/* Fixed Submit Button */}
			<div className="flex-shrink-0 bg-white border-t pt-4">
				<form.Subscribe
					selector={(state: any) => [state.canSubmit, state.isSubmitting]}
					children={([canSubmit, isSubmitting]: [boolean, boolean]) => (
						<Button
							type="submit"
							className="w-full btn-black"
							disabled={!canSubmit || !hasAllShippingMethods || isSubmitting}
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								form.handleSubmit()
							}}
						>
							{isSubmitting ? 'Processing...' : 'Continue to Payment'}
						</Button>
					)}
				/>
			</div>
		</div>
	)
}
