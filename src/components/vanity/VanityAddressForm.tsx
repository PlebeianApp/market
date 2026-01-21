import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useVanityConfig, useCheckNameAvailability, getVanityDomain } from '@/queries/vanity'
import { usePublishVanityRequestMutation, validateVanityName, generateVanityPaymentMemo } from '@/publish/vanity'
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { VanityPaymentFlow } from './VanityPaymentFlow'
import { generateVanityDTag } from '@/lib/schemas/vanity'
import { useDebounce } from '@/lib/hooks/useDebounce'

interface VanityAddressFormProps {
	onSuccess: () => void
	onCancel: () => void
}

type FormStep = 'input' | 'payment' | 'confirming'

export function VanityAddressForm({ onSuccess, onCancel }: VanityAddressFormProps) {
	const [name, setName] = useState('')
	const [step, setStep] = useState<FormStep>('input')
	const [requestEventId, setRequestEventId] = useState<string | null>(null)
	const [validationError, setValidationError] = useState<string | null>(null)

	const domain = getVanityDomain()
	const debouncedName = useDebounce(name.toLowerCase(), 300)

	const configQuery = useVanityConfig()
	const availabilityQuery = useCheckNameAvailability(debouncedName, domain)
	const publishMutation = usePublishVanityRequestMutation()

	// Validate name on change
	useEffect(() => {
		if (!name) {
			setValidationError(null)
			return
		}
		const validation = validateVanityName(name)
		setValidationError(validation.valid ? null : validation.error || null)
	}, [name])

	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		// Only allow valid characters
		const value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
		setName(value)
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (validationError || !availabilityQuery.isAvailable) {
			return
		}

		try {
			const eventId = await publishMutation.mutateAsync({ name, domain })
			setRequestEventId(eventId)
			setStep('payment')
		} catch (error) {
			// Error handled by mutation
		}
	}

	const handlePaymentSuccess = () => {
		setStep('confirming')
	}

	const handleConfirmationSuccess = () => {
		onSuccess()
	}

	const isCheckingAvailability = availabilityQuery.isLoading && debouncedName.length >= 2
	const showAvailability = debouncedName.length >= 2 && !validationError && !availabilityQuery.isLoading

	// Step: Input name
	if (step === 'input') {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Register Vanity Address</CardTitle>
					<CardDescription>Choose a custom URL like {domain}/yourname</CardDescription>
				</CardHeader>
				<form onSubmit={handleSubmit}>
					<CardContent className="space-y-4">
						{/* Name Input */}
						<div className="space-y-2">
							<Label htmlFor="vanity-name">Name</Label>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground">{domain}/</span>
								<Input id="vanity-name" value={name} onChange={handleNameChange} placeholder="yourname" className="flex-1" autoFocus />
							</div>

							{/* Validation feedback */}
							{validationError && (
								<p className="text-sm text-red-500 flex items-center gap-1">
									<XCircle className="w-4 h-4" />
									{validationError}
								</p>
							)}

							{/* Availability feedback */}
							{isCheckingAvailability && (
								<p className="text-sm text-muted-foreground flex items-center gap-1">
									<Loader2 className="w-4 h-4 animate-spin" />
									Checking availability...
								</p>
							)}

							{showAvailability && availabilityQuery.isAvailable && (
								<p className="text-sm text-green-600 flex items-center gap-1">
									<CheckCircle className="w-4 h-4" />
									This name is available!
								</p>
							)}

							{showAvailability && availabilityQuery.isTaken && (
								<p className="text-sm text-red-500 flex items-center gap-1">
									<XCircle className="w-4 h-4" />
									This name is already taken
								</p>
							)}
						</div>

						{/* Pricing Info */}
						{configQuery.data && (
							<div className="bg-muted rounded-lg p-3 text-sm">
								<div className="flex justify-between">
									<span>Price:</span>
									<span className="font-medium">{configQuery.data.price} sats</span>
								</div>
								<div className="flex justify-between text-muted-foreground">
									<span>Duration:</span>
									<span>{Math.round(configQuery.data.duration / 86400 / 365)} year(s)</span>
								</div>
							</div>
						)}
					</CardContent>

					<CardFooter className="flex justify-end gap-2">
						<Button type="button" variant="outline" onClick={onCancel}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								!name || !!validationError || !availabilityQuery.isAvailable || availabilityQuery.isLoading || publishMutation.isPending
							}
						>
							{publishMutation.isPending ? (
								<>
									<Spinner className="w-4 h-4 mr-2" />
									Submitting...
								</>
							) : (
								'Continue to Payment'
							)}
						</Button>
					</CardFooter>
				</form>
			</Card>
		)
	}

	// Step: Payment
	if (step === 'payment' && configQuery.data && requestEventId) {
		const paymentMemo = generateVanityPaymentMemo(name, domain, requestEventId)
		const dTag = generateVanityDTag(name, domain)

		return (
			<VanityPaymentFlow
				name={name}
				domain={domain}
				dTag={dTag}
				requestEventId={requestEventId}
				lud16={configQuery.data.lud16}
				amountSats={configQuery.data.price}
				memo={paymentMemo}
				onSuccess={handleConfirmationSuccess}
				onCancel={onCancel}
			/>
		)
	}

	// Step: Confirming (waiting for Kind 30410)
	if (step === 'confirming') {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<Spinner className="w-8 h-8 mx-auto mb-4" />
					<p className="font-medium">Confirming your registration...</p>
					<p className="text-sm text-muted-foreground mt-2">This may take a few minutes. Please don't close this page.</p>
				</CardContent>
			</Card>
		)
	}

	return null
}
