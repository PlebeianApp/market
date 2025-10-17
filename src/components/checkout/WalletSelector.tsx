import { PAYMENT_DETAILS_METHOD } from '@/lib/constants'
import type { PaymentDetail } from '@/queries/payment'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface WalletOption extends PaymentDetail {
	displayName: string
	isDefault?: boolean
}

interface WalletSelectorProps {
	wallets: WalletOption[]
	selectedWalletId: string | null
	onSelect: (walletId: string) => void
	className?: string
	sellerName?: string
}

const getPaymentMethodLabel = (method: string) => {
	switch (method) {
		case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK:
			return '⚡ Lightning'
		case PAYMENT_DETAILS_METHOD.ON_CHAIN:
			return '₿ On-chain'
		default:
			return 'Other'
	}
}

const getWalletDisplayName = (wallet: WalletOption) => {
	const method = getPaymentMethodLabel(wallet.paymentMethod)
	const address = wallet.paymentDetail.substring(0, 30) + (wallet.paymentDetail.length > 30 ? '...' : '')
	const scope = wallet.coordinates
		? wallet.coordinates.includes('30402:')
			? ' (Product)'
			: wallet.coordinates.includes('30405:')
				? ' (Collection)'
				: ' (Scoped)'
		: ''
	const defaultBadge = wallet.isDefault ? ' • Default' : ''
	return `${method}: ${address}${scope}${defaultBadge}`
}

export function WalletSelector({ wallets, selectedWalletId, onSelect, className = '', sellerName }: WalletSelectorProps) {
	if (wallets.length === 0) {
		return null
	}

	// If only one wallet, auto-select it and don't show the selector
	if (wallets.length === 1) {
		if (!selectedWalletId) {
			onSelect(wallets[0].id)
		}
		return null
	}

	return (
		<div className={`space-y-2 ${className}`}>
			<label className="text-sm font-medium text-gray-700">{sellerName ? `${sellerName}'s Wallet` : 'Payment Wallet'}</label>
			<Select onValueChange={onSelect} value={selectedWalletId || undefined}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder="Select payment wallet" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectLabel>Available Wallets</SelectLabel>
						{wallets.map((wallet) => (
							<SelectItem key={wallet.id} value={wallet.id}>
								{getWalletDisplayName(wallet)}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	)
}
