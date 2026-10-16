import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../../primitives/select'

export interface WalletSelectorOption {
	id: string
	/** Host-formatted label, e.g. method, truncated address and scope. */
	label: string
}

export interface WalletSelectorViewProps {
	wallets: readonly WalletSelectorOption[]
	selectedWalletId: string | null
	onSelect: (walletId: string) => void
	className?: string
	sellerName?: string
}

export function WalletSelectorView({ wallets, selectedWalletId, onSelect, className = '', sellerName }: WalletSelectorViewProps) {
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
								{wallet.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</div>
	)
}

export interface PaymentDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	description: string
	children: ReactNode
}

export function PaymentDialogView({ open, onOpenChange, title, description, children }: PaymentDialogViewProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center justify-between">{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	)
}
