import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PAYMENT_DETAILS_METHOD } from '@/lib/constants'
import type { PaymentDetail } from '@/queries/payment'
import { Wallet, Zap, Bitcoin } from 'lucide-react'

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

const getPaymentMethodIcon = (method: string) => {
	switch (method) {
		case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK:
			return <Zap className="w-5 h-5 text-yellow-500" />
		case PAYMENT_DETAILS_METHOD.ON_CHAIN:
			return <Bitcoin className="w-5 h-5 text-orange-500" />
		default:
			return <Wallet className="w-5 h-5 text-gray-500" />
	}
}

const getPaymentMethodLabel = (method: string) => {
	switch (method) {
		case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK:
			return 'Lightning Network'
		case PAYMENT_DETAILS_METHOD.ON_CHAIN:
			return 'Bitcoin On-chain'
		default:
			return 'Other'
	}
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
		<div className={`space-y-3 ${className}`}>
			<h3 className="font-medium text-gray-900 mb-2">{sellerName ? `Select ${sellerName}'s Wallet` : 'Select Seller Wallet'}</h3>
			<p className="text-sm text-gray-600 mb-4">This seller has multiple payment wallets configured. Choose which one to pay to:</p>

			{wallets.map((wallet) => (
				<Card
					key={wallet.id}
					className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
						selectedWalletId === wallet.id ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 hover:border-gray-300'
					}`}
					onClick={() => onSelect(wallet.id)}
				>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3 flex-1">
								{/* Icon */}
								<div className="flex-shrink-0">{getPaymentMethodIcon(wallet.paymentMethod)}</div>

								{/* Wallet Info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<h4 className="font-medium text-gray-900">{getPaymentMethodLabel(wallet.paymentMethod)}</h4>
										{wallet.isDefault && (
											<Badge variant="secondary" className="text-xs">
												Default
											</Badge>
										)}
									</div>
									<p className="text-sm text-gray-600 truncate">{wallet.paymentDetail}</p>

									{/* Scope info */}
									{wallet.coordinates && (
										<div className="mt-1">
											<Badge variant="outline" className="text-xs">
												{wallet.coordinates.includes('30402:')
													? 'Product-specific'
													: wallet.coordinates.includes('30405:')
														? 'Collection-specific'
														: 'Scoped'}
											</Badge>
										</div>
									)}
								</div>
							</div>

							{/* Selection indicator */}
							<div className="flex-shrink-0">
								{selectedWalletId === wallet.id && (
									<div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
										<div className="w-2 h-2 bg-white rounded-full" />
									</div>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			))}

			<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
				<div className="text-xs text-blue-800">
					<p className="font-medium mb-1">About Multiple Wallets</p>
					<p>
						Sellers can configure different wallets for different products or collections. Your payment will go directly to the selected
						wallet.
					</p>
				</div>
			</div>
		</div>
	)
}
