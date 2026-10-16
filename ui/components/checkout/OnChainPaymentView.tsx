import { AlertTriangle, Check, Clock, Copy, ExternalLink, RefreshCw, Timer } from 'lucide-react'
import { Badge } from '../../primitives/badge'
import { Button } from '../../primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../primitives/card'
import { Progress } from '../../primitives/progress'
import { QRCode } from '../../primitives/qr-code'

export type OnChainPaymentStatus = 'idle' | 'checking' | 'completed' | 'expired' | 'error'

export interface OnChainPaymentViewProps {
	status: OnChainPaymentStatus
	disabled: boolean
	address: string
	amountSats: number
	amountBtc: number
	bitcoinUri: string
	label?: string
	/** Seconds until the request expires; null before the timer starts. */
	timeLeft: number | null
	expirySeconds: number
	checkAttempts: number
	error: string | null
	transaction: { txid: string; confirmed: boolean } | null
	isManualChecking: boolean
	onOpenInWallet: () => void
	onCopyAddress: () => void
	onCopyUri: () => void
	onManualCheck: () => void
	onCancel: () => void
}

const formatSats = (sats: number): string => Math.round(sats).toLocaleString()

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60)
	return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
}

function statusBadgeVariant(status: OnChainPaymentStatus) {
	if (status === 'completed') return 'secondary' as const
	if (status === 'expired' || status === 'error') return 'destructive' as const
	return 'outline' as const
}

export function OnChainPaymentView(props: OnChainPaymentViewProps) {
	const { status, amountSats, amountBtc, timeLeft } = props

	if (props.disabled) {
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
						<Badge variant={statusBadgeVariant(status)}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>
					</div>
					<div className="text-right">
						<div className="text-sm text-gray-500">Amount</div>
						<div className="font-bold">{formatSats(amountSats)} sats</div>
						<div className="text-sm text-gray-500">{amountBtc.toFixed(8)} BTC</div>
					</div>
				</CardTitle>
				{props.checkAttempts > 0 && <div className="text-sm text-gray-500">Check attempts: {props.checkAttempts}</div>}
			</CardHeader>

			<CardContent className="space-y-4">
				{timeLeft !== null && timeLeft > 0 && status !== 'completed' && (
					<div className="flex items-center gap-2">
						<Clock className="w-4 h-4 text-blue-600" />
						<span className="text-sm">Expires in: {formatTime(timeLeft)}</span>
						<Progress value={Math.max(0, (timeLeft / props.expirySeconds) * 100)} className="flex-1 h-2" />
					</div>
				)}

				{status === 'checking' && (
					<div className="flex items-center gap-2 text-blue-600">
						<RefreshCw className="w-4 h-4 animate-spin" />
						<span>Checking payment...</span>
					</div>
				)}

				{status !== 'completed' && (
					<div className="space-y-3">
						<div className="flex justify-center">
							<QRCode
								value={props.bitcoinUri}
								size={200}
								title="Bitcoin Payment"
								description={`Send ${formatSats(amountSats)} sats to this address`}
								showBorder={false}
							/>
						</div>

						<div className="space-y-2">
							<div className="text-sm font-medium">Bitcoin Address:</div>
							<div className="bg-gray-50 p-3 rounded">
								<div className="flex items-center gap-2">
									<code className="text-xs font-mono flex-1 break-all">{props.address}</code>
									<Button variant="outline" size="sm" onClick={props.onCopyAddress}>
										<Copy className="w-4 h-4" />
									</Button>
								</div>
							</div>
						</div>

						<div className="bg-blue-50 p-3 rounded">
							<div className="text-center">
								<div className="font-bold text-lg">{formatSats(amountSats)} sats</div>
								<div className="text-sm text-gray-600">{amountBtc.toFixed(8)} BTC</div>
								{props.label && <div className="text-sm text-gray-600 mt-1">{props.label}</div>}
							</div>
						</div>
					</div>
				)}

				{props.error && (
					<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
						<AlertTriangle className="w-4 h-4" />
						<span className="text-sm">{props.error}</span>
					</div>
				)}

				{status === 'completed' && props.transaction && (
					<div className="space-y-3">
						<div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded">
							<Check className="w-5 h-5" />
							<span>Payment received successfully!</span>
						</div>
						<div className="bg-gray-50 p-3 rounded">
							<div className="text-sm">
								<div className="font-medium">Transaction ID:</div>
								<code className="text-xs break-all">{props.transaction.txid}</code>
							</div>
							{props.transaction.confirmed && <div className="text-xs text-green-600 mt-1">✓ Confirmed</div>}
						</div>
					</div>
				)}

				{status === 'expired' && (
					<div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded">
						<Timer className="w-4 h-4" />
						<span>Payment request expired</span>
					</div>
				)}

				<div className="space-y-2">
					{status !== 'completed' && status !== 'expired' && (
						<>
							<Button onClick={props.onOpenInWallet} className="w-full" variant="outline">
								<ExternalLink className="w-4 h-4 mr-2" />
								Open in Wallet
							</Button>
							<Button onClick={props.onCopyUri} variant="outline" className="w-full">
								<Copy className="w-4 h-4 mr-2" />
								Copy Bitcoin URI
							</Button>
							<Button onClick={props.onManualCheck} className="w-full" disabled={props.isManualChecking}>
								{props.isManualChecking ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
								{props.isManualChecking ? 'Checking...' : "I've Paid - Check Status"}
							</Button>
							<Button onClick={props.onCancel} variant="ghost" className="w-full">
								Cancel Payment
							</Button>
						</>
					)}

					{status === 'completed' && (
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
