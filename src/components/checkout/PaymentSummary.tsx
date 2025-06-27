import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, Clock, Zap, Users, CreditCard } from 'lucide-react'
import type { PaymentInvoice } from './PaymentInterface'

interface PaymentSummaryProps {
	invoices: PaymentInvoice[]
	currentIndex: number
	onSelectInvoice: (index: number) => void
}

export function PaymentSummary({ invoices, currentIndex, onSelectInvoice }: PaymentSummaryProps) {
	const formatSats = (sats: number) => Math.round(sats).toLocaleString()

	const paidCount = invoices.filter((inv) => inv.status === 'paid').length
	const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0)
	const paidAmount = invoices.filter((inv) => inv.status === 'paid').reduce((sum, inv) => sum + inv.amount, 0)
	const remainingAmount = totalAmount - paidAmount

	const currentInvoice = invoices[currentIndex]

	return (
		<div className="space-y-4">
			{/* Current Payment */}
			<Card className="border-pink-200 bg-pink-50">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Currently Paying</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2 mb-2">
						{currentInvoice.type === 'v4v' ? (
							<Users className="w-4 h-4 text-purple-600" />
						) : (
							<CreditCard className="w-4 h-4 text-blue-600" />
						)}
						<span className="font-medium">{currentInvoice.sellerName}</span>
					</div>
					<div className="flex items-center gap-2">
						<Zap className="w-4 h-4 text-yellow-500" />
						<span className="text-lg font-bold">{formatSats(currentInvoice.amount)} sats</span>
						<Badge variant={currentInvoice.type === 'v4v' ? 'secondary' : 'outline'}>
							{currentInvoice.type === 'v4v' ? 'V4V' : 'Merchant'}
						</Badge>
					</div>
				</CardContent>
			</Card>

			{/* Summary Stats */}
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Payment Summary</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					<div className="flex justify-between text-sm">
						<span>Paid</span>
						<span className="font-medium">
							{paidCount}/{invoices.length}
						</span>
					</div>
					<div className="flex justify-between text-sm">
						<span>Completed</span>
						<span className="font-medium text-green-600">{formatSats(paidAmount)} sats</span>
					</div>
					<div className="flex justify-between text-sm">
						<span>Remaining</span>
						<span className="font-medium">{formatSats(remainingAmount)} sats</span>
					</div>
					<div className="border-t pt-2 flex justify-between font-medium">
						<span>Total</span>
						<span>{formatSats(totalAmount)} sats</span>
					</div>
				</CardContent>
			</Card>

			{/* Invoice List */}
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">All Payments ({invoices.length})</CardTitle>
				</CardHeader>
				<CardContent className="p-0">
					<ScrollArea className="h-64">
						<div className="space-y-1 p-3">
							{invoices.map((invoice, index) => (
								<button
									key={invoice.id}
									onClick={() => onSelectInvoice(index)}
									className={`w-full p-3 rounded-lg border text-left transition-all ${
										index === currentIndex
											? 'border-pink-300 bg-pink-50 shadow-sm'
											: invoice.status === 'paid'
												? 'border-green-200 bg-green-50'
												: 'border-gray-200 bg-white hover:bg-gray-50'
									}`}
								>
									<div className="flex items-center justify-between mb-1">
										<div className="flex items-center gap-2">
											{invoice.type === 'v4v' ? (
												<Users className="w-4 h-4 text-purple-600" />
											) : (
												<CreditCard className="w-4 h-4 text-blue-600" />
											)}
											<span className="font-medium text-sm truncate">{invoice.sellerName}</span>
											{invoice.status === 'paid' && <Check className="w-4 h-4 text-green-600" />}
										</div>
										{index === currentIndex && (
											<Badge variant="outline" className="text-xs">
												Current
											</Badge>
										)}
									</div>

									<div className="flex items-center justify-between">
										<span className="text-xs text-gray-500">{invoice.type === 'v4v' ? 'V4V Payment' : 'Merchant Payment'}</span>
										<div className="text-right">
											<div className="font-medium text-sm">{formatSats(invoice.amount)} sats</div>
											{invoice.status === 'paid' && <div className="text-xs text-green-600">Paid</div>}
											{invoice.status === 'pending' && invoice.expiresAt && (
												<div className="text-xs text-gray-500 flex items-center gap-1">
													<Clock className="w-3 h-3" />
													<span>{Math.max(0, Math.floor((invoice.expiresAt - Date.now()) / 60000))}m</span>
												</div>
											)}
										</div>
									</div>
								</button>
							))}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	)
}
