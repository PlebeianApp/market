import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useConfigQuery } from '@/queries/config'
import { useVanitySettings, getVanityForPubkey } from '@/queries/vanity'
import { vanityActions } from '@/lib/stores/vanity'
import { VANITY_PRICING } from '@/server/VanityManager'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Copy, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { LightningPaymentProcessor } from '@/components/lightning/LightningPaymentProcessor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ZAP_RELAYS } from '@/lib/constants'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/vanity-url')({
	component: VanityUrlComponent,
})

function VanityUrlComponent() {
	useDashboardTitle('Vanity URL')
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey

	const { data: config } = useConfigQuery()
	const { data: vanitySettings, isLoading } = useVanitySettings(config?.appPublicKey)

	const [vanityName, setVanityName] = useState('')
	const [isChecking, setIsChecking] = useState(false)

	// Get current user's vanity URL
	const currentVanity = useMemo(() => {
		if (!pubkey || !vanitySettings) return null
		return getVanityForPubkey(vanitySettings, pubkey)
	}, [pubkey, vanitySettings])

	// Validation state
	const [validationState, setValidationState] = useState<{
		isValid: boolean
		isAvailable: boolean | null
		message: string
	}>({
		isValid: false,
		isAvailable: null,
		message: '',
	})

	// Validate vanity name as user types
	useEffect(() => {
		if (!vanityName) {
			setIsChecking(false)
			setValidationState({ isValid: false, isAvailable: null, message: '' })
			return
		}

		const normalized = vanityName.toLowerCase()

		// Check format
		if (!vanityActions.isValidVanityName(normalized)) {
			setIsChecking(false)
			setValidationState({
				isValid: false,
				isAvailable: null,
				message: 'Must be 3-30 characters, alphanumeric with hyphens/underscores',
			})
			return
		}

		// Check reserved
		if (vanityActions.isReservedName(normalized)) {
			setIsChecking(false)
			setValidationState({
				isValid: false,
				isAvailable: false,
				message: 'This name is reserved and cannot be used',
			})
			return
		}

		// Check availability
		setIsChecking(true)
		const timer = setTimeout(() => {
			const available = vanityActions.isVanityAvailable(normalized)
			setValidationState({
				isValid: true,
				isAvailable: available,
				message: available ? 'This name is available!' : 'This name is already taken',
			})
			setIsChecking(false)
		}, 300)

		return () => {
			clearTimeout(timer)
			setIsChecking(false)
		}
	}, [vanityName])

	// Format expiration date
	const formatExpiration = (timestamp: number) => {
		const date = new Date(timestamp * 1000)
		const now = new Date()
		const daysLeft = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

		return {
			date: date.toLocaleDateString(),
			daysLeft,
			isExpiringSoon: daysLeft <= 30,
		}
	}

	// Copy vanity URL to clipboard
	const copyVanityUrl = () => {
		if (!currentVanity) return
		const url = `${window.location.origin}/${currentVanity.vanityName}`
		navigator.clipboard.writeText(url)
		toast.success('Vanity URL copied to clipboard!')
	}

	// Payment state
	const [paymentState, setPaymentState] = useState<{
		isOpen: boolean
		invoice: string
		amount: number
		invoiceId: string
	}>({
		isOpen: false,
		invoice: '',
		amount: 0,
		invoiceId: '',
	})

	const handleZap = async (tier: (typeof VANITY_PRICING)[string]) => {
		if (!pubkey || !config?.appPublicKey) {
			toast.error('App configuration missing')
			return
		}

		if (!validationState.isValid || validationState.isAvailable === false) {
			toast.error('Please choose a valid and available vanity name')
			return
		}

		const satsAmount = tier.sats
		const normalizedVanityName = vanityName.toLowerCase()

		try {
			// 1. Create zap request event
			const zapRequest = new NDKEvent(ndk)
			zapRequest.kind = 9734
			zapRequest.content = ''
			zapRequest.tags = [
				['p', config.appPublicKey],
				['amount', (satsAmount * 1000).toString()],
				['L', 'vanity-register'],
				['vanity', normalizedVanityName],
				['relays', ...Array.from(new Set([config.appRelay, ...ZAP_RELAYS].filter(Boolean)))],
			]

			await zapRequest.sign()
			const invoiceId = `vanity-${normalizedVanityName}-${satsAmount}-${Date.now()}`

			// 2. Request a zap-compatible invoice from the server (avoids LNURL CORS issues in-browser)
			const invoiceRes = await fetch('/api/vanity/invoice', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					amountSats: satsAmount,
					vanityName: normalizedVanityName,
					zapRequest: zapRequest.rawEvent(),
				}),
			})

			if (!invoiceRes.ok) {
				const bodyText = await invoiceRes.text().catch(() => '')
				throw new Error(bodyText || `Failed to create invoice (${invoiceRes.status})`)
			}

			const invoiceData = (await invoiceRes.json()) as { pr?: string; error?: string }
			if (!invoiceData.pr) {
				throw new Error(invoiceData.error || 'Failed to create invoice')
			}

			setPaymentState({
				isOpen: true,
				invoice: invoiceData.pr,
				amount: satsAmount,
				invoiceId,
			})
		} catch (error) {
			console.error('Payment error:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to create payment')
		}
	}

	if (!pubkey) {
		return (
			<div className="space-y-6 p-4 lg:p-8">
				<h1 className="text-2xl font-bold">Vanity URL</h1>
				<p className="text-muted-foreground">Please connect your Nostr account to manage your vanity URL.</p>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Vanity URL</h1>
			</div>

			<div className="space-y-6 p-4 lg:p-8">
				{isLoading ? (
					<div className="flex items-center justify-center p-8">
						<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					</div>
				) : (
					<>
						{/* Current Vanity URL Status */}
						{currentVanity ? (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<CheckCircle2 className="h-5 w-5 text-green-500" />
										Your Vanity URL
									</CardTitle>
									<CardDescription>Your custom vanity URL is active and ready to share</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
										<code className="text-lg font-mono flex-1">
											{window.location.origin}/{currentVanity.vanityName}
										</code>
										<Button variant="ghost" size="icon" onClick={copyVanityUrl}>
											<Copy className="h-4 w-4" />
										</Button>
										<Button variant="ghost" size="icon" asChild>
											<a href={`/${currentVanity.vanityName}`} target="_blank" rel="noopener noreferrer">
												<ExternalLink className="h-4 w-4" />
											</a>
										</Button>
									</div>

									<div className="flex items-center gap-2">
										<Clock className="h-4 w-4 text-muted-foreground" />
										<span className="text-sm text-muted-foreground">Expires: {formatExpiration(currentVanity.validUntil).date}</span>
										{formatExpiration(currentVanity.validUntil).isExpiringSoon && (
											<Badge variant="destructive" className="text-xs">
												{formatExpiration(currentVanity.validUntil).daysLeft} days left
											</Badge>
										)}
									</div>
								</CardContent>
							</Card>
						) : (
							<Card>
								<CardHeader>
									<CardTitle>No Vanity URL</CardTitle>
									<CardDescription>Register a custom vanity URL for your profile</CardDescription>
								</CardHeader>
							</Card>
						)}

						{/* Register New Vanity URL */}
						<Card>
							<CardHeader>
								<CardTitle>{currentVanity ? 'Change or Extend' : 'Register'} Vanity URL</CardTitle>
								<CardDescription>Choose a custom URL for your profile. This will be your shareable link.</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6">
								<div className="space-y-2">
									<Label htmlFor="vanityName">Vanity Name</Label>
									<div className="flex items-center gap-2">
										<span className="text-muted-foreground">{window.location.host}/</span>
										<Input
											id="vanityName"
											value={vanityName}
											onChange={(e) => setVanityName(e.target.value.toLowerCase())}
											placeholder="your-name"
											className="flex-1"
										/>
									</div>
									{(validationState.message || isChecking) && (
										<p
											className={`text-sm flex items-center gap-1 ${
												validationState.isAvailable === true
													? 'text-green-600'
													: validationState.isAvailable === false
														? 'text-red-600'
														: 'text-muted-foreground'
											}`}
										>
											{validationState.isAvailable === true && <CheckCircle2 className="h-4 w-4" />}
											{validationState.isAvailable === false && <AlertCircle className="h-4 w-4" />}
											{isChecking ? 'Checking availability…' : validationState.message}
										</p>
									)}
								</div>

								{/* Pricing Tiers */}
								<div className="space-y-3">
									<Label>Pricing</Label>
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										{Object.entries(VANITY_PRICING).map(([key, tier]) => (
											<div
												key={key}
												className={`flex items-center justify-between p-4 border rounded-lg transition-colors cursor-pointer hover:border-primary ${
													!validationState.isValid || validationState.isAvailable === false ? 'opacity-50 hover:opacity-100' : ''
												}`}
												onClick={() => handleZap(tier)}
											>
												<div>
													<p className="font-semibold">{tier.label}</p>
													<p className="text-sm text-muted-foreground">{tier.days} days</p>
												</div>
												<div className="text-right">
													<p className="font-bold text-lg">{tier.sats.toLocaleString()} sats</p>
												</div>
											</div>
										))}
									</div>
								</div>

								{/* How to Register */}
								<div className="bg-muted/50 p-4 rounded-lg space-y-2">
									<h4 className="font-semibold flex items-center gap-2">
										<Zap className="h-4 w-4 text-yellow-500" />
										How to Register
									</h4>
									<ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
										<li>Choose your desired vanity name above</li>
										<li>
											Create a zap to this app with:
											<ul className="ml-4 mt-1 list-disc list-inside">
												<li>
													Label: <code className="text-xs bg-muted px-1 rounded">["L", "vanity-register"]</code>
												</li>
												<li>
													Vanity tag: <code className="text-xs bg-muted px-1 rounded">["vanity", "your-name"]</code>
												</li>
											</ul>
										</li>
										<li>Zap at least 10,000 sats for 6 months or 18,000 sats for 1 year</li>
										<li>Your vanity URL will be activated within seconds</li>
									</ol>
								</div>
							</CardContent>
						</Card>
						<Dialog open={paymentState.isOpen} onOpenChange={(open) => setPaymentState((prev) => ({ ...prev, isOpen: open }))}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader>
									<DialogTitle>Complete Payment</DialogTitle>
								</DialogHeader>
								<LightningPaymentProcessor
									data={{
										amount: paymentState.amount,
										invoiceId: paymentState.invoiceId || 'vanity-reg',
										description: `Vanity URL Registration: ${vanityName}`,
										bolt11: paymentState.invoice,
										isZap: true,
										monitorZapReceipt: true,
										requireZapReceipt: true,
									}}
									onPaymentComplete={() => {
										setPaymentState((prev) => ({ ...prev, isOpen: false }))
										toast.success('Zap confirmed! Your vanity URL is being registered.')
									}}
									onCancel={() => setPaymentState((prev) => ({ ...prev, isOpen: false }))}
								/>
							</DialogContent>
						</Dialog>
					</>
				)}
			</div>
		</div>
	)
}
