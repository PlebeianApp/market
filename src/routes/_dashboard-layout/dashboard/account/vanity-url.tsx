import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useConfigQuery } from '@/queries/config'
import { useVanitySettings, getVanityForPubkey, getExpiredVanityForPubkey } from '@/queries/vanity'
import { vanityActions } from '@/lib/stores/vanity'
import { VANITY_PRICING } from '@/server/VanityManager'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Copy, Zap, RefreshCw } from 'lucide-react'
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
	const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

	// Keep time-based UI (expiry / active status) fresh without needing a refetch.
	useEffect(() => {
		const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 15_000)
		return () => clearInterval(id)
	}, [])

	// Get current user's vanity URL
	const currentVanity = useMemo(() => {
		if (!pubkey || !vanitySettings) return null
		return getVanityForPubkey(vanitySettings, pubkey)
	}, [pubkey, vanitySettings, nowSec])

	// Get expired vanity URLs for renewal
	const expiredVanities = useMemo(() => {
		if (!pubkey || !vanitySettings) return []
		return getExpiredVanityForPubkey(vanitySettings, pubkey)
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
		const msLeft = date.getTime() - now.getTime()

		// Check if expired
		if (msLeft <= 0) {
			return {
				date: date.toLocaleDateString(),
				timeLeft: 'Expired',
				daysLeft: 0,
				isExpired: true,
				isExpiringSoon: true,
			}
		}

		const secondsLeft = Math.floor(msLeft / 1000)
		const minutesLeft = Math.floor(msLeft / (1000 * 60))
		const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60))
		const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))

		let timeLeft: string
		if (secondsLeft < 60) {
			timeLeft = `${secondsLeft} seconds`
		} else if (minutesLeft < 60) {
			timeLeft = `${minutesLeft} minutes`
		} else if (hoursLeft < 24) {
			timeLeft = `${hoursLeft} hours`
		} else {
			timeLeft = `${daysLeft} days`
		}

		return {
			date: date.toLocaleDateString(),
			timeLeft,
			daysLeft,
			isExpired: false,
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
		expectedVanityName: string
		previousValidUntil: number
	}>({
		isOpen: false,
		invoice: '',
		amount: 0,
		invoiceId: '',
		expectedVanityName: '',
		previousValidUntil: 0,
	})

	const closePaymentDialog = () => {
		setPaymentState((prev) => ({
			...prev,
			isOpen: false,
			invoice: '',
			amount: 0,
			invoiceId: '',
			expectedVanityName: '',
			previousValidUntil: 0,
		}))
	}

	// If the backend updates the vanity registry but the client doesn't detect payment completion
	// (e.g. zap monitoring relay issues), auto-close the dialog once the expected vanity becomes active.
	useEffect(() => {
		if (!paymentState.isOpen) return
		if (!paymentState.expectedVanityName) return
		if (!currentVanity) return

		const normalizedExpected = paymentState.expectedVanityName.toLowerCase()
		if (currentVanity.vanityName.toLowerCase() !== normalizedExpected) return
		if (currentVanity.validUntil <= nowSec) return
		if (currentVanity.validUntil <= paymentState.previousValidUntil) return

		closePaymentDialog()
		toast.success('Vanity URL is active!')
	}, [currentVanity, nowSec, paymentState.expectedVanityName, paymentState.isOpen, paymentState.previousValidUntil])

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
				expectedVanityName: normalizedVanityName,
				previousValidUntil: currentVanity?.validUntil ?? 0,
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
												{formatExpiration(currentVanity.validUntil).timeLeft} left
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

						{/* Expired Vanity URLs */}
						{expiredVanities.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Clock className="h-5 w-5 text-orange-500" />
										Expired Vanity URLs
									</CardTitle>
									<CardDescription>These vanity URLs have expired. Renew them to keep your custom links.</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									{expiredVanities.map((expired) => (
										<div
											key={expired.vanityName}
											className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-orange-200"
										>
											<div className="flex items-center gap-3">
												<code className="font-mono text-sm">/{expired.vanityName}</code>
												<Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
													Expired {new Date(expired.validUntil * 1000).toLocaleDateString()}
												</Badge>
											</div>
											<Button
												variant="outline"
												size="sm"
												className="flex items-center gap-2"
												onClick={() => {
													setVanityName(expired.vanityName)
													// Scroll to registration section
													document.getElementById('vanity-register-section')?.scrollIntoView({ behavior: 'smooth' })
												}}
											>
												<RefreshCw className="h-4 w-4" />
												Renew
											</Button>
										</div>
									))}
								</CardContent>
							</Card>
						)}

						{/* Register New Vanity URL */}
						<Card id="vanity-register-section">
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
									<Label>Select Duration</Label>
									<div className="space-y-2">
										{Object.entries(VANITY_PRICING).map(([key, tier]) => (
											<button
												key={key}
												type="button"
												disabled={!validationState.isValid || validationState.isAvailable === false}
												className={`w-full flex items-center gap-4 p-4 border rounded-lg transition-all hover:border-yellow-500 hover:bg-yellow-500/5 disabled:opacity-50 disabled:cursor-not-allowed`}
												onClick={() => handleZap(tier)}
											>
												<div className="flex items-center justify-center w-10 h-10 rounded-full bg-yellow-500/10">
													<Zap className="h-5 w-5 text-yellow-500" />
												</div>
												<div className="flex-1 text-left">
													<p className="font-semibold">{tier.label}</p>
													<p className="text-sm text-muted-foreground">
														{tier.seconds ? `${tier.seconds} seconds` : `${tier.days} days`} validity
													</p>
												</div>
												<div className="text-right">
													<p className="font-bold text-lg text-yellow-500">{tier.sats.toLocaleString()}</p>
													<p className="text-xs text-muted-foreground">sats</p>
												</div>
											</button>
										))}
									</div>
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
                                    }}
                                    onPaymentComplete={async (result) => {
                                        if (result.proofType === 'preimage' && result.preimage) {
                                            try {
                                                const res = await fetch('/api/vanity/confirm', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ bolt11: paymentState.invoice, preimage: result.preimage }),
                                                })
	                                                if (!res.ok) {
	                                                    const bodyText = await res.text().catch(() => '')
	                                                    throw new Error(bodyText || `Failed to confirm payment (${res.status})`)
	                                                }

	                                                closePaymentDialog()
	                                                toast.success('Payment confirmed! Your vanity URL is registered.')
	                                                return
	                                            } catch (error) {
	                                                console.error('Vanity confirmation error:', error)
	                                                toast.error(error instanceof Error ? error.message : 'Failed to confirm payment')
                                                return
                                            }
	                                        }

	                                        // If we don't have a valid preimage, fallback to zap receipt processing on the server.
	                                        closePaymentDialog()
	                                        toast.success('Payment sent. Your vanity URL will activate once confirmed.')
	                                    }}
	                                    onCancel={closePaymentDialog}
	                                />
								</DialogContent>
							</Dialog>
						</>
					)}
			</div>
		</div>
	)
}
