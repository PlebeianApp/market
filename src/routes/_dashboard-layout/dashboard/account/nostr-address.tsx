import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { ndkActions } from '@/lib/stores/ndk'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useConfigQuery } from '@/queries/config'
import { useNip05Settings, getNip05ForPubkey, getExpiredNip05ForPubkey } from '@/queries/nip05'
import { nip05Actions } from '@/lib/stores/nip05'
import { NIP05_PRICING } from '@/server/Nip05Manager'
import { AlertCircle, CheckCircle2, Clock, Copy, Zap, RefreshCw, AtSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LightningPaymentProcessor } from '@/components/lightning/LightningPaymentProcessor'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { purchaseNip05ForPubkey } from '@/lib/zapPurchase'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/nostr-address')({
	component: NostrAddressComponent,
})

function NostrAddressComponent() {
	useDashboardTitle('Nostr Address (NIP-05)')
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey

	const { data: config } = useConfigQuery()
	const { data: nip05Settings, isLoading } = useNip05Settings(config?.appPublicKey)

	const [username, setUsername] = useState('')
	const [isChecking, setIsChecking] = useState(false)

	// Get current user's NIP-05 address
	const currentNip05 = useMemo(() => {
		if (!pubkey || !nip05Settings) return null
		return getNip05ForPubkey(nip05Settings, pubkey)
	}, [pubkey, nip05Settings])

	// Get expired entries for renewal
	const expiredNip05s = useMemo(() => {
		if (!pubkey || !nip05Settings) return []
		return getExpiredNip05ForPubkey(nip05Settings, pubkey)
	}, [pubkey, nip05Settings])

	const domain = typeof window !== 'undefined' ? window.location.hostname : ''

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

	useEffect(() => {
		if (!username) {
			setIsChecking(false)
			setValidationState({ isValid: false, isAvailable: null, message: '' })
			return
		}

		const normalized = username.toLowerCase()

		if (!nip05Actions.isValidUsername(normalized)) {
			setIsChecking(false)
			setValidationState({
				isValid: false,
				isAvailable: null,
				message: 'Must be 1-30 characters, alphanumeric with hyphens, underscores, or dots',
			})
			return
		}

		// Check reserved
		if (nip05Actions.isReservedName(normalized)) {
			setIsChecking(false)
			setValidationState({
				isValid: false,
				isAvailable: false,
				message: 'This username is reserved and cannot be used',
			})
			return
		}

		// Check availability
		setIsChecking(true)
		const timer = setTimeout(() => {
			const available = nip05Actions.isUsernameAvailable(normalized)
			setValidationState({
				isValid: true,
				isAvailable: available,
				message: available ? 'This username is available!' : 'This username is already taken',
			})
			setIsChecking(false)
		}, 300)

		return () => {
			clearTimeout(timer)
			setIsChecking(false)
		}
	}, [username])

	// Format expiration date
	const formatExpiration = (timestamp: number) => {
		const date = new Date(timestamp * 1000)
		const now = new Date()
		const msLeft = date.getTime() - now.getTime()

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

	const copyNip05Address = () => {
		if (!currentNip05) return
		const address = `${currentNip05.username}@${domain}`
		navigator.clipboard.writeText(address)
		toast.success('Nostr address copied to clipboard!')
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

	const handleZap = async (tier: (typeof NIP05_PRICING)[string]) => {
		if (!pubkey || !config?.appPublicKey) {
			toast.error('App configuration missing')
			return
		}

		if (!validationState.isValid || validationState.isAvailable === false) {
			toast.error('Please choose a valid and available username')
			return
		}

		try {
			const { pr, invoiceId } = await purchaseNip05ForPubkey(
				{ ndk, appPubkey: config.appPublicKey, appRelay: config.appRelay },
				{ username, amountSats: tier.sats },
			)

			setPaymentState({
				isOpen: true,
				invoice: pr,
				amount: tier.sats,
				invoiceId: invoiceId,
			})
		} catch (error) {
			console.error('Payment error:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to create payment')
		}
	}

	if (!pubkey) {
		return (
			<div className="space-y-6 p-4 lg:p-8">
				<h1 className="text-2xl font-bold">Nostr Address (NIP-05)</h1>
				<p className="text-muted-foreground">Please connect your Nostr account to manage your Nostr address.</p>
			</div>
		)
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Nostr Address (NIP-05)</h1>
			</div>

			<div className="space-y-6 p-4 lg:p-8">
				{isLoading ? (
					<div className="flex items-center justify-center p-8">
						<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
					</div>
				) : (
					<>
						{/* Current NIP-05 Address Status */}
						{currentNip05 ? (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<CheckCircle2 className="h-5 w-5 text-green-500" />
										Your Nostr Address
									</CardTitle>
									<CardDescription>Your NIP-05 address is active and ready to use</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
										<AtSign className="h-5 w-5 text-muted-foreground" />
										<code className="text-lg font-mono flex-1">
											{currentNip05.username}@{domain}
										</code>
										<Button variant="ghost" size="icon" onClick={copyNip05Address}>
											<Copy className="h-4 w-4" />
										</Button>
									</div>

									<div className="flex items-center gap-2">
										<Clock className="h-4 w-4 text-muted-foreground" />
										<span className="text-sm text-muted-foreground">Expires: {formatExpiration(currentNip05.validUntil).date}</span>
										{formatExpiration(currentNip05.validUntil).isExpiringSoon && (
											<Badge variant="destructive" className="text-xs">
												{formatExpiration(currentNip05.validUntil).timeLeft} left
											</Badge>
										)}
									</div>

									<p className="text-sm text-muted-foreground">
										Set this as your NIP-05 address in your Nostr profile to verify your identity.
									</p>
								</CardContent>
							</Card>
						) : (
							<Card>
								<CardHeader>
									<CardTitle>No Nostr Address</CardTitle>
									<CardDescription>Register a NIP-05 address to verify your identity on Nostr</CardDescription>
								</CardHeader>
							</Card>
						)}

						{/* Expired NIP-05 Addresses */}
						{expiredNip05s.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2">
										<Clock className="h-5 w-5 text-orange-500" />
										Expired Nostr Addresses
									</CardTitle>
									<CardDescription>These addresses have expired. Renew them to keep your identity verified.</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									{expiredNip05s.map((expired) => (
										<div
											key={expired.username}
											className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-orange-200"
										>
											<div className="flex items-center gap-3">
												<code className="font-mono text-sm">
													{expired.username}@{domain}
												</code>
												<Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
													Expired {new Date(expired.validUntil * 1000).toLocaleDateString()}
												</Badge>
											</div>
											<Button
												variant="outline"
												size="sm"
												className="flex items-center gap-2"
												onClick={() => {
													setUsername(expired.username)
													document.getElementById('nip05-register-section')?.scrollIntoView({ behavior: 'smooth' })
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

						{/* Register New NIP-05 Address */}
						<Card id="nip05-register-section">
							<CardHeader>
								<CardTitle>{currentNip05 ? 'Change or Extend' : 'Register'} Nostr Address</CardTitle>
								<CardDescription>
									Choose a username for your NIP-05 address. This will be your verifiable identity on Nostr.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6">
								<div className="space-y-2">
									<Label htmlFor="nip05Username">Username</Label>
									<div className="flex items-center gap-2">
										<Input
											id="nip05Username"
											value={username}
											onChange={(e) => setUsername(e.target.value.toLowerCase())}
											placeholder="your-name"
											className="flex-1"
										/>
										<span className="text-muted-foreground">@{domain}</span>
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
										{Object.entries(NIP05_PRICING).map(([key, tier]) => (
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
										invoiceId: paymentState.invoiceId || 'nip05-reg',
										description: `NIP-05 Address Registration: ${username}@${domain}`,
										bolt11: paymentState.invoice,
										isZap: true,
										monitorZapReceipt: true,
										requireZapReceipt: false,
									}}
									onPaymentComplete={() => {
										console.log('Zap payment confirmed for invoice:', paymentState.invoiceId)
										setPaymentState((prev) => ({ ...prev, isOpen: false }))
										setUsername('')
										toast.success('Zap confirmed! Your Nostr address is being registered.')
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
