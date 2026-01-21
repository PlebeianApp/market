import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { QRCode } from '@/components/ui/qr-code'
import { Spinner } from '@/components/ui/spinner'
import { LightningService, createLightningUri } from '@/lib/utils/lightning'
import { useVanityConfirmationPolling } from '@/queries/vanity'
import { copyToClipboard } from '@/lib/utils'
import { ndkActions, ndkStore } from '@/lib/stores/ndk'
import { handleNWCPayment, handleWebLNPayment, hasWebLN } from '@/lib/utils/payment.utils'
import { useStore } from '@tanstack/react-store'
import { Copy, CheckCircle, Zap, Wallet, ExternalLink, AlertCircle } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface VanityPaymentFlowProps {
	name: string
	domain: string
	dTag: string
	requestEventId: string
	lud16: string
	amountSats: number
	memo: string
	onSuccess: () => void
	onCancel: () => void
}

type PaymentState = 'generating' | 'ready' | 'paying' | 'confirming' | 'success' | 'error'

export function VanityPaymentFlow({
	name,
	domain,
	dTag,
	requestEventId,
	lud16,
	amountSats,
	memo,
	onSuccess,
	onCancel,
}: VanityPaymentFlowProps) {
	const [state, setState] = useState<PaymentState>('generating')
	const [invoice, setInvoice] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	const ndkState = useStore(ndkStore)
	const hasNwc = !!ndkState.activeNwcWalletUri
	const hasWebLn = hasWebLN()

	// Poll for confirmation
	const confirmationPolling = useVanityConfirmationPolling(dTag, state === 'confirming' || state === 'paying')

	// Generate invoice on mount
	useEffect(() => {
		const generateInvoice = async () => {
			try {
				setState('generating')
				setError(null)

				const result = await LightningService.generateInvoiceFromLightningAddress(lud16, amountSats, memo)

				setInvoice(result.bolt11)
				setState('ready')
			} catch (err) {
				console.error('Failed to generate invoice:', err)
				setError(err instanceof Error ? err.message : 'Failed to generate invoice')
				setState('error')
			}
		}

		generateInvoice()
	}, [lud16, amountSats, memo])

	// Watch for confirmation
	useEffect(() => {
		if (confirmationPolling.data && !confirmationPolling.data.revoked) {
			setState('success')
			toast.success('Vanity address registered!')
			onSuccess()
		}
	}, [confirmationPolling.data, onSuccess])

	const handleCopy = useCallback(async () => {
		if (invoice) {
			await copyToClipboard(invoice)
			setCopied(true)
			toast.success('Invoice copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		}
	}, [invoice])

	const handleNwcPay = useCallback(async () => {
		if (!invoice || !ndkState.activeNwcWalletUri) return

		const signer = ndkActions.getSigner()
		if (!signer) {
			toast.error('Please sign in to pay with wallet')
			return
		}

		setState('paying')
		try {
			const result = await handleNWCPayment(invoice, ndkState.activeNwcWalletUri, signer)
			if (result.ok) {
				setState('confirming')
				toast.success('Payment sent! Waiting for confirmation...')
			} else {
				throw new Error(result.error || 'Payment failed')
			}
		} catch (err) {
			console.error('NWC payment error:', err)
			toast.error(err instanceof Error ? err.message : 'Payment failed')
			setState('ready')
		}
	}, [invoice, ndkState.activeNwcWalletUri])

	const handleWebLnPay = useCallback(async () => {
		if (!invoice) return

		setState('paying')
		try {
			const result = await handleWebLNPayment(invoice)
			if (result.ok) {
				setState('confirming')
				toast.success('Payment sent! Waiting for confirmation...')
			} else {
				throw new Error(result.error || 'Payment failed')
			}
		} catch (err) {
			console.error('WebLN payment error:', err)
			toast.error(err instanceof Error ? err.message : 'Payment failed')
			setState('ready')
		}
	}, [invoice])

	const handleMarkAsPaid = useCallback(() => {
		setState('confirming')
		toast.info('Checking for confirmation...')
	}, [])

	// Generating invoice
	if (state === 'generating') {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<Spinner className="w-8 h-8 mx-auto mb-4" />
					<p className="text-muted-foreground">Generating invoice...</p>
				</CardContent>
			</Card>
		)
	}

	// Error state
	if (state === 'error') {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
					<p className="font-medium text-red-600 mb-2">Failed to generate invoice</p>
					<p className="text-sm text-muted-foreground mb-4">{error}</p>
					<div className="flex justify-center gap-2">
						<Button variant="outline" onClick={onCancel}>
							Cancel
						</Button>
						<Button onClick={() => window.location.reload()}>Try Again</Button>
					</div>
				</CardContent>
			</Card>
		)
	}

	// Success state
	if (state === 'success') {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
					<p className="font-medium text-green-600 mb-2">Registration Complete!</p>
					<p className="text-sm text-muted-foreground">
						Your vanity URL is now active at {domain}/{name}
					</p>
				</CardContent>
			</Card>
		)
	}

	// Confirming state
	if (state === 'confirming') {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<Spinner className="w-8 h-8 mx-auto mb-4" />
					<p className="font-medium mb-2">Waiting for confirmation...</p>
					<p className="text-sm text-muted-foreground">This may take a few minutes. Please don't close this page.</p>
				</CardContent>
			</Card>
		)
	}

	// Ready / Paying state - show invoice
	return (
		<Card>
			<CardHeader>
				<CardTitle>Pay for {name}</CardTitle>
				<CardDescription>
					Pay {amountSats} sats to register {domain}/{name}
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-6">
				{/* QR Code */}
				{invoice && (
					<div className="flex justify-center">
						<div className="bg-white p-4 rounded-lg">
							<QRCode value={createLightningUri(invoice)} size={200} />
						</div>
					</div>
				)}

				{/* Payment Methods */}
				<div className="space-y-3">
					{/* NWC Button */}
					{hasNwc && (
						<Button className="w-full" onClick={handleNwcPay} disabled={state === 'paying'}>
							<Wallet className="w-4 h-4 mr-2" />
							{state === 'paying' ? 'Processing...' : 'Pay with Wallet'}
						</Button>
					)}

					{/* WebLN Button */}
					{hasWebLn && (
						<Button variant="outline" className="w-full" onClick={handleWebLnPay} disabled={state === 'paying'}>
							<Zap className="w-4 h-4 mr-2" />
							Pay with Browser Extension
						</Button>
					)}

					{/* Copy Invoice */}
					<Button variant="outline" className="w-full" onClick={handleCopy}>
						{copied ? <CheckCircle className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
						{copied ? 'Copied!' : 'Copy Invoice'}
					</Button>

					{/* Open in Wallet */}
					{invoice && (
						<Button variant="ghost" className="w-full" onClick={() => window.open(createLightningUri(invoice), '_blank')}>
							<ExternalLink className="w-4 h-4 mr-2" />
							Open in Wallet App
						</Button>
					)}
				</div>

				{/* Manual confirmation for external payments */}
				<div className="pt-4 border-t">
					<p className="text-sm text-muted-foreground text-center mb-3">Already paid? Click below to check for confirmation.</p>
					<Button variant="outline" className="w-full" onClick={handleMarkAsPaid}>
						I've Already Paid
					</Button>
				</div>
			</CardContent>

			<CardFooter>
				<Button variant="ghost" className="w-full" onClick={onCancel}>
					Cancel
				</Button>
			</CardFooter>
		</Card>
	)
}
