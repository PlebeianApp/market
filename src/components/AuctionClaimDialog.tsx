import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CountryCombobox, isValidCountry } from '@/components/checkout/CountryCombobox'
import { CityCombobox } from '@/components/checkout/CityCombobox'
import { usePublishAuctionClaimOrderMutation, type AuctionClaimFormData } from '@/publish/auctions'
import { useState } from 'react'

interface AuctionClaimDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	auctionEventId: string
	auctionCoordinates: string
	settlementEventId: string
	sellerPubkey: string
	finalAmount: number
}

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

	const [name, setName] = useState('')
	const [firstLineOfAddress, setFirstLineOfAddress] = useState('')
	const [city, setCity] = useState('')
	const [zipPostcode, setZipPostcode] = useState('')
	const [country, setCountry] = useState('')
	const [additionalInformation, setAdditionalInformation] = useState('')
	const [email, setEmail] = useState('')
	const [notes, setNotes] = useState('')

	const isValid =
		name.trim().length >= 2 && firstLineOfAddress.trim().length >= 5 && city.trim() && zipPostcode.trim() && isValidCountry(country)

	const handleSubmit = async () => {
		if (!isValid) return

		const data: AuctionClaimFormData = {
			auctionEventId,
			auctionCoordinates,
			settlementEventId,
			sellerPubkey,
			finalAmount,
			shippingAddress: {
				name: name.trim(),
				firstLineOfAddress: firstLineOfAddress.trim(),
				city: city.trim(),
				zipPostcode: zipPostcode.trim(),
				country,
				additionalInformation: additionalInformation.trim() || undefined,
			},
			email: email.trim() || undefined,
			notes: notes.trim() || undefined,
		}

		try {
			await claimMutation.mutateAsync(data)
			onOpenChange(false)
		} catch {
			// Error toast handled by mutation
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Claim Your Auction Win</DialogTitle>
					<DialogDescription>
						Submit your shipping address so the seller can send you the item. Amount settled:{' '}
						<span className="font-semibold">{finalAmount.toLocaleString()} sats</span>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div>
						<Label htmlFor="claim-name">
							Full Name <span className="text-red-500">*</span>
						</Label>
						<Input id="claim-name" placeholder="e.g. Satoshi Nakamoto" value={name} onChange={(e) => setName(e.target.value)} />
					</div>

					<div>
						<Label htmlFor="claim-email">Email (optional)</Label>
						<Input
							id="claim-email"
							type="email"
							placeholder="e.g. satoshi@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>

					<div>
						<Label htmlFor="claim-address">
							Street Address <span className="text-red-500">*</span>
						</Label>
						<Input
							id="claim-address"
							placeholder="e.g. 123 Main Street, Apt 4B"
							value={firstLineOfAddress}
							onChange={(e) => setFirstLineOfAddress(e.target.value)}
						/>
					</div>

					<div>
						<Label htmlFor="claim-city">
							City <span className="text-red-500">*</span>
						</Label>
						<CityCombobox
							id="claim-city"
							value={city}
							onChange={setCity}
							placeholder="e.g. San Francisco"
							required
							selectedCountry={country}
						/>
					</div>

					<div>
						<Label htmlFor="claim-zip">
							ZIP/Postal Code <span className="text-red-500">*</span>
						</Label>
						<Input id="claim-zip" placeholder="e.g. 90210" value={zipPostcode} onChange={(e) => setZipPostcode(e.target.value)} />
					</div>

					<div>
						<Label htmlFor="claim-country">
							Country <span className="text-red-500">*</span>
						</Label>
						<CountryCombobox id="claim-country" value={country} onChange={setCountry} placeholder="e.g. United States" required />
					</div>

					<div>
						<Label htmlFor="claim-notes">Delivery Notes (optional)</Label>
						<Textarea
							id="claim-notes"
							placeholder="Any special delivery instructions"
							value={additionalInformation}
							onChange={(e) => setAdditionalInformation(e.target.value)}
							rows={2}
						/>
					</div>

					<div>
						<Label htmlFor="claim-message">Message to Seller (optional)</Label>
						<Textarea
							id="claim-message"
							placeholder="e.g. Looking forward to the item!"
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void handleSubmit()} disabled={!isValid || claimMutation.isPending}>
						{claimMutation.isPending ? 'Submitting...' : 'Submit Shipping Details'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
