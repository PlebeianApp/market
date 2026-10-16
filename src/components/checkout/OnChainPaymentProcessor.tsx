import { useState, useEffect, useCallback } from 'react'
import { MempoolService, type MempoolTransaction } from '@/lib/utils/mempool'
import { copyToClipboard } from '@/lib/utils'
import { toast } from 'sonner'
import { OnChainPaymentView, type OnChainPaymentStatus } from '@ui/components/checkout/OnChainPaymentView'

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
	const [paymentStatus, setPaymentStatus] = useState<OnChainPaymentStatus>('idle')
	const [timeLeft, setTimeLeft] = useState<number | null>(null)
	const [expiryTime, setExpiryTime] = useState<Date | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [lastTransaction, setLastTransaction] = useState<MempoolTransaction | null>(null)
	const [isManualChecking, setIsManualChecking] = useState(false)
	const [checkAttempts, setCheckAttempts] = useState(0)

	const amountBtc = MempoolService.satoshisToBtc(amountSats)
	const bitcoinUri = MempoolService.generateBitcoinUri(address, amountBtc, label)

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

	return (
		<OnChainPaymentView
			status={paymentStatus}
			disabled={disabled}
			address={address}
			amountSats={amountSats}
			amountBtc={amountBtc}
			bitcoinUri={bitcoinUri}
			label={label}
			timeLeft={timeLeft}
			expirySeconds={expiryMinutes * 60}
			checkAttempts={checkAttempts}
			error={error}
			transaction={lastTransaction ? { txid: lastTransaction.txid, confirmed: lastTransaction.status.confirmed } : null}
			isManualChecking={isManualChecking}
			onOpenInWallet={handleOpenInWallet}
			onCopyAddress={handleCopyAddress}
			onCopyUri={handleCopyUri}
			onManualCheck={handleManualCheck}
			onCancel={handleCancel}
		/>
	)
}
