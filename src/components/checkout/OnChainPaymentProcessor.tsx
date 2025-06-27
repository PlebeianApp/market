import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { QRCode } from '@/components/ui/qr-code'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Check, Copy, ExternalLink, RefreshCw, AlertTriangle, Timer, Clock } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { MempoolService, type MempoolTransaction } from '@/lib/utils/mempool'
import { copyToClipboard } from '@/lib/utils'
import { toast } from 'sonner'

export interface OnChainPaymentProcessorProps {
	address: string
	amountSats: number
	label?: string
	onPaymentComplete?: (txId: string) => void
	onPaymentExpired?: () => void
	onPaymentCancelled?: () => void
	disabled?: boolean
	expiryMinutes?: number
}

export function OnChainPaymentProcessor({
	address,
	amountSats,
	label,
	onPaymentComplete,
	onPaymentExpired,
	onPaymentCancelled,
	disabled = false,
	expiryMinutes = 30,
}: OnChainPaymentProcessorProps) {
	const [paymentStatus, setPaymentStatus] = useState<'idle' | 'checking' | 'completed' | 'expired' | 'error'>('idle')
	const [timeLeft, setTimeLeft] = useState<number | null>(null)
	const [expiryTime, setExpiryTime] = useState<Date | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [lastTransaction, setLastTransaction] = useState<MempoolTransaction | null>(null)
	const [isManualChecking, setIsManualChecking] = useState(false)
	const [checkAttempts, setCheckAttempts] = useState(0)

	const amountBtc = MempoolService.satoshisToBtc(amountSats)
	const bitcoinUri = MempoolService.generateBitcoinUri(address, amountBtc, label)

	const formatSats = (sats: number): string => {
		return Math.round(sats).toLocaleString()
	}

	const formatTime = (seconds: number): string => {
		const minutes = Math.floor(seconds / 60)
		const remainingSeconds = seconds % 60
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
	}

	// Setup expiry timer
	useEffect(() => {
		if (disabled) return

		const expiry = new Date()
		expiry.setMinutes(expiry.getMinutes() + expiryMinutes)
		setExpiryTime(expiry)
		setTimeLeft(expiryMinutes * 60)

		const interval = setInterval(() => {
			const now = new Date()
			const remaining = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 1000))
			setTimeLeft(remaining)

			if (remaining === 0) {
				setPaymentStatus('expired')
				onPaymentExpired?.()
				clearInterval(interval)
			}
		}, 1000)

		return () => clearInterval(interval)
	}, [disabled, expiryMinutes, onPaymentExpired])

	// Auto-check for payments periodically
	useEffect(() => {
		if (disabled || paymentStatus !== 'idle') return

		const interval = setInterval(async () => {
			await checkPayment(false)
		}, 10000) // Check every 10 seconds

		return () => clearInterval(interval)
	}, [disabled, paymentStatus])

	const checkPayment = useCallback(
		async (isManual = false) => {
			if (disabled || paymentStatus === 'completed' || paymentStatus === 'expired') return

			if (isManual) {
				setIsManualChecking(true)
			} else {
				setPaymentStatus('checking')
			}

			setError(null)
			setCheckAttempts((prev) => prev + 1)

			try {
				const transaction = await MempoolService.checkPaymentReceived(address, amountSats)

				if (transaction) {
					setLastTransaction(transaction)
					setPaymentStatus('completed')
					onPaymentComplete?.(transaction.txid)
					toast.success('Payment received!')
				} else if (isManual) {
					toast.error('Payment not detected yet. Please wait for confirmation.')
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Failed to check payment'
				setError(errorMessage)
				if (isManual) {
					toast.error('Error checking payment status. Please try again.')
				}
			} finally {
				setIsManualChecking(false)
				if (paymentStatus === 'checking') {
					setPaymentStatus('idle')
				}
			}
		},
		[address, amountSats, disabled, paymentStatus, onPaymentComplete],
	)

	const handleManualCheck = () => {
		checkPayment(true)
	}

	const handleOpenInWallet = () => {
		window.open(bitcoinUri, '_blank')
	}

	const handleCopyAddress = async () => {
		await copyToClipboard(address)
		toast.success('Address copied to clipboard')
	}

	const handleCopyUri = async () => {
		await copyToClipboard(bitcoinUri)
		toast.success('Bitcoin URI copied to clipboard')
	}

	const handleCancel = () => {
		setPaymentStatus('idle')
		onPaymentCancelled?.()
	}

	const getStatusColor = () => {
		switch (paymentStatus) {
			case 'completed':
				return 'text-green-600'
			case 'checking':
				return 'text-blue-600'
			case 'expired':
			case 'error':
				return 'text-red-600'
			default:
				return 'text-gray-600'
		}
	}

	const getStatusBadgeVariant = () => {
		switch (paymentStatus) {
			case 'completed':
				return 'secondary'
			case 'checking':
				return 'outline'
			case 'expired':
			case 'error':
				return 'destructive'
			default:
				return 'outline'
		}
	}

	if (disabled) {
		return (
			<Card className="opacity-50">
				<CardContent className="p-4">
					<div className="text-center text-gray-500">On-chain payment processor disabled</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="w-5 h-5 bg-orange-500 rounded-full" />
						<span className="text-lg">Bitcoin On-chain</span>
						<Badge variant={getStatusBadgeVariant()}>{paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1)}</Badge>
					</div>
					<div className="text-right">
						<div className="text-sm text-gray-500">Amount</div>
						<div className="font-bold">{formatSats(amountSats)} sats</div>
						<div className="text-sm text-gray-500">{amountBtc.toFixed(8)} BTC</div>
					</div>
				</CardTitle>
				{checkAttempts > 0 && <div className="text-sm text-gray-500">Check attempts: {checkAttempts}</div>}
			</CardHeader>

			<CardContent className="space-y-4">
				{/* Timer */}
				{timeLeft !== null && timeLeft > 0 && paymentStatus !== 'completed' && (
					<div className="flex items-center gap-2">
						<Clock className="w-4 h-4 text-blue-600" />
						<span className="text-sm">Expires in: {formatTime(timeLeft)}</span>
						<Progress value={Math.max(0, (timeLeft / (expiryMinutes * 60)) * 100)} className="flex-1 h-2" />
					</div>
				)}

				{/* Status indicator */}
				{paymentStatus === 'checking' && (
					<div className="flex items-center gap-2 text-blue-600">
						<RefreshCw className="w-4 h-4 animate-spin" />
						<span>Checking payment...</span>
					</div>
				)}

				{/* Payment request display */}
				{paymentStatus !== 'completed' && (
					<div className="space-y-3">
						{/* QR Code */}
						<div className="flex justify-center">
							<QRCode
								value={bitcoinUri}
								size={200}
								title="Bitcoin Payment"
								description={`Send ${formatSats(amountSats)} sats to this address`}
								showBorder={false}
							/>
						</div>

						{/* Address display */}
						<div className="space-y-2">
							<div className="text-sm font-medium">Bitcoin Address:</div>
							<div className="bg-gray-50 p-3 rounded">
								<div className="flex items-center gap-2">
									<code className="text-xs font-mono flex-1 break-all">{address}</code>
									<Button variant="outline" size="sm" onClick={handleCopyAddress}>
										<Copy className="w-4 h-4" />
									</Button>
								</div>
							</div>
						</div>

						{/* Amount display */}
						<div className="bg-blue-50 p-3 rounded">
							<div className="text-center">
								<div className="font-bold text-lg">{formatSats(amountSats)} sats</div>
								<div className="text-sm text-gray-600">{amountBtc.toFixed(8)} BTC</div>
								{label && <div className="text-sm text-gray-600 mt-1">{label}</div>}
							</div>
						</div>
					</div>
				)}

				{/* Error display */}
				{error && (
					<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
						<AlertTriangle className="w-4 h-4" />
						<span className="text-sm">{error}</span>
					</div>
				)}

				{/* Success display */}
				{paymentStatus === 'completed' && lastTransaction && (
					<div className="space-y-3">
						<div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded">
							<Check className="w-5 h-5" />
							<span>Payment received successfully!</span>
						</div>
						<div className="bg-gray-50 p-3 rounded">
							<div className="text-sm">
								<div className="font-medium">Transaction ID:</div>
								<code className="text-xs break-all">{lastTransaction.txid}</code>
							</div>
							{lastTransaction.status.confirmed && <div className="text-xs text-green-600 mt-1">✓ Confirmed</div>}
						</div>
					</div>
				)}

				{/* Expiry display */}
				{paymentStatus === 'expired' && (
					<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
						<Timer className="w-4 h-4" />
						<span>Payment request expired</span>
					</div>
				)}

				{/* Action buttons */}
				<div className="space-y-2">
					{paymentStatus !== 'completed' && paymentStatus !== 'expired' && (
						<>
							<Button onClick={handleOpenInWallet} className="w-full" variant="outline">
								<ExternalLink className="w-4 h-4 mr-2" />
								Open in Wallet
							</Button>
							<Button onClick={handleCopyUri} variant="outline" className="w-full">
								<Copy className="w-4 h-4 mr-2" />
								Copy Bitcoin URI
							</Button>
							<Button onClick={handleManualCheck} className="w-full" disabled={isManualChecking}>
								{isManualChecking ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
								{isManualChecking ? 'Checking...' : "I've Paid - Check Status"}
							</Button>
							<Button onClick={handleCancel} variant="ghost" className="w-full">
								Cancel Payment
							</Button>
						</>
					)}

					{paymentStatus === 'completed' && (
						<Button disabled className="w-full" variant="secondary">
							<Check className="w-4 h-4 mr-2" />
							Payment Complete
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
