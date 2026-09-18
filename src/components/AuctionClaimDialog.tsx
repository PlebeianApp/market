import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CountryCombobox, isValidCountry } from '@/components/checkout/CountryCombobox'
import { CityCombobox } from '@/components/checkout/CityCombobox'
import { isValidDigitalDeliveryContact } from '@/lib/checkout/deliveryRequirements'
import { usePublishAuctionClaimOrderMutation, type AuctionClaimFormData } from '@/publish/auctions'
import { useForm } from '@tanstack/react-form'

interface AuctionClaimDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	auctionEventId: string
	auctionCoordinates: string
	settlementEventId: string
	sellerPubkey: string
	finalAmount: number
}

type ValidationField = 'name' | 'email' | 'firstLineOfAddress' | 'city' | 'zipPostcode' | 'country'

export function AuctionClaimDialog({
	open,
	onOpenChange,
	auctionEventId,
	auctionCoordinates,
	settlementEventId,
	sellerPubkey,
	finalAmount,
}: AuctionClaimDialogProps) {
	const claimMutation = usePublishAuctionClaimOrderMutation()
	const form = useForm({
		defaultValues: {
			name: '',
			email: '',
			firstLineOfAddress: '',
			city: '',
			zipPostcode: '',
			country: '',
			additionalInformation: '',
			notes: '',
		},
		onSubmit: async ({ value }) => {
			const data: AuctionClaimFormData = {
				auctionEventId,
				auctionCoordinates,
				settlementEventId,
				sellerPubkey,
				finalAmount,
				shippingAddress: {
					name: value.name.trim(),
					firstLineOfAddress: value.firstLineOfAddress.trim(),
					city: value.city.trim(),
					zipPostcode: value.zipPostcode.trim(),
					country: value.country,
					additionalInformation: value.additionalInformation.trim() || undefined,
				},
				email: value.email.trim() || undefined,
				notes: value.notes.trim() || undefined,
			}

			try {
				await claimMutation.mutateAsync(data)
				handleOpenChange(false)
			} catch {
				// Error toast handled by mutation
			}
		},
	})

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			form.reset()
		}

		onOpenChange(nextOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Claim Your Auction Win</DialogTitle>
					<DialogDescription>
						Submit your shipping address so the seller can send you the item. Amount settled:{' '}
						<span className="font-semibold">{finalAmount.toLocaleString()} sats</span>
					</DialogDescription>
				</DialogHeader>

				<form
					noValidate
					onSubmit={(e) => {
						e.preventDefault()
						e.stopPropagation()
						form.handleSubmit()
					}}
					className="space-y-4 py-2"
				>
					<form.Subscribe selector={(state) => state.submissionAttempts > 0}>
						{(hasAttemptedSubmit) => (
							<>
								<form.Field
									name={'name' satisfies ValidationField}
									validators={{
										onChange: ({ value }: { value: string }) => {
											if (/\d/.test(value)) return 'Name cannot contain numbers'
											if (value.trim().length < 2) return 'Name must be at least 2 characters'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label htmlFor="claim-name">
												Full Name <span className="text-red-500">*</span>
											</Label>
											<Input
												id="claim-name"
												placeholder="e.g. Satoshi Nakamoto"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
												<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field
									name={'email' satisfies ValidationField}
									validators={{
										onChange: ({ value }: { value: string }) => {
											if (value.trim() && !isValidDigitalDeliveryContact(value)) return 'Please enter a valid email address'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label htmlFor="claim-email">Email (optional)</Label>
											<Input
												id="claim-email"
												type="email"
												placeholder="e.g. satoshi@example.com"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
												<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field
									name={'firstLineOfAddress' satisfies ValidationField}
									validators={{
										onChange: ({ value }: { value: string }) => {
											if (value.trim().length < 5) return 'Address must be at least 5 characters'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label htmlFor="claim-address">
												Street Address <span className="text-red-500">*</span>
											</Label>
											<Input
												id="claim-address"
												placeholder="e.g. 123 Main Street, Apt 4B"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
												<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Subscribe selector={(state) => state.values.country}>
									{(selectedCountry) => (
										<form.Field
											name={'city' satisfies ValidationField}
											validators={{
												onChange: ({ value }: { value: string }) => {
													if (!value.trim()) return 'City is required'
													return undefined
												},
											}}
										>
											{(field) => (
												<div>
													<Label htmlFor="claim-city">
														City <span className="text-red-500">*</span>
													</Label>
													<CityCombobox
														id="claim-city"
														value={field.state.value}
														onChange={(value) => field.handleChange(value)}
														onBlur={field.handleBlur}
														placeholder="e.g. San Francisco"
														selectedCountry={selectedCountry}
													/>
													{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
														<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
													)}
												</div>
											)}
										</form.Field>
									)}
								</form.Subscribe>

								<form.Field
									name={'zipPostcode' satisfies ValidationField}
									validators={{
										onChange: ({ value }: { value: string }) => {
											if (!value.trim()) return 'ZIP/Postal code is required'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label htmlFor="claim-zip">
												ZIP/Postal Code <span className="text-red-500">*</span>
											</Label>
											<Input
												id="claim-zip"
												placeholder="e.g. 90210"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
												<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field
									name={'country' satisfies ValidationField}
									validators={{
										onChange: ({ value }: { value: string }) => {
											if (!isValidCountry(value)) return 'Please select a valid country'
											return undefined
										},
									}}
								>
									{(field) => (
										<div>
											<Label htmlFor="claim-country">
												Country <span className="text-red-500">*</span>
											</Label>
											<CountryCombobox
												id="claim-country"
												value={field.state.value}
												onChange={(value) => field.handleChange(value)}
												onBlur={field.handleBlur}
												placeholder="e.g. United States"
											/>
											{(field.state.meta.isTouched || hasAttemptedSubmit) && field.state.meta.errors.length > 0 && (
												<p className="mt-1 text-xs text-red-500">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field name="additionalInformation">
									{(field) => (
										<div>
											<Label htmlFor="claim-notes">Delivery Notes (optional)</Label>
											<Textarea
												id="claim-notes"
												placeholder="Any special delivery instructions"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												rows={2}
											/>
										</div>
									)}
								</form.Field>

								<form.Field name="notes">
									{(field) => (
										<div>
											<Label htmlFor="claim-message">Message to Seller (optional)</Label>
											<Textarea
												id="claim-message"
												placeholder="e.g. Looking forward to the item!"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												rows={2}
											/>
										</div>
									)}
								</form.Field>
							</>
						)}
					</form.Subscribe>

					<DialogFooter>
						<Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={claimMutation.isPending}>
							{claimMutation.isPending ? 'Submitting...' : 'Submit Shipping Details'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
