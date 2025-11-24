import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Bitcoin, Clock, Shield, Zap, CircleDollarSign } from 'lucide-react'

export interface PaymentMethodOption {
	id: string
	type: 'lightning' | 'bitcoin' | 'on-chain'
	name: string
	description: string
	icon: React.ReactNode
	fees: string
	time: string
	available: boolean
	recommended?: boolean
}

interface PaymentMethodSelectorProps {
	methods: PaymentMethodOption[]
	selectedMethod: string
	onSelect: (methodId: string) => void
	className?: string
}

const defaultMethods: PaymentMethodOption[] = [
	{
		id: 'lightning',
		type: 'lightning',
		name: 'Lightning Network',
		description: 'Instant, low-fee payments via the Lightning Network',
		icon: <Zap className="w-6 h-6 text-yellow-500" />,
		fees: '< 1 sat',
		time: 'Instant',
		available: true,
		recommended: true,
	},
	{
		id: 'on-chain',
		type: 'on-chain',
		name: 'Bitcoin On-chain',
		description: 'Secure payments directly on the Bitcoin blockchain',
		icon: <Bitcoin className="w-6 h-6 text-orange-500" />,
		fees: '~2000 sats',
		time: '10-60 min',
		available: true,
	},
]

export function PaymentMethodSelector({ methods = defaultMethods, selectedMethod, onSelect, className = '' }: PaymentMethodSelectorProps) {
	return (
		<div className={`space-y-3 ${className}`}>
			<h3 className="font-medium text-gray-900 mb-4">Select Payment Method</h3>

			{methods.map((method) => (
				<Card
					key={method.id}
					className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
						selectedMethod === method.id ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 hover:border-gray-300'
					} ${!method.available ? 'opacity-50 cursor-not-allowed' : ''}`}
					onClick={() => method.available && onSelect(method.id)}
				>
					<CardContent className="p-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3 flex-1">
								{/* Icon */}
								<div className="flex-shrink-0">{method.icon}</div>

								{/* Method Info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<h4 className="font-medium text-gray-900">{method.name}</h4>
										{method.recommended && (
											<Badge variant="secondary" className="text-xs">
												Recommended
											</Badge>
										)}
										{!method.available && (
											<Badge variant="outline" className="text-xs">
												Coming Soon
											</Badge>
										)}
									</div>
									<p className="text-sm text-gray-600 mb-2">{method.description}</p>

									{/* Method Details */}
									<div className="flex items-center gap-4 text-xs text-gray-500">
										<div className="flex items-center gap-1">
											<CircleDollarSign className="w-3 h-3" />
											<span>Fee: {method.fees}</span>
										</div>
										<div className="flex items-center gap-1">
											<Clock className="w-3 h-3" />
											<span>Time: {method.time}</span>
										</div>
									</div>
								</div>
							</div>

							{/* Selection indicator */}
							<div className="flex-shrink-0">
								{selectedMethod === method.id && method.available && (
									<div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
										<div className="w-2 h-2 bg-white rounded-full" />
									</div>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			))}

			{/* Payment Security Note */}
			<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
				<div className="flex items-start gap-2">
					<Shield className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
					<div className="text-xs text-blue-800">
						<p className="font-medium mb-1">Secure Payments</p>
						<p>All payments are processed securely. Your private keys never leave your device.</p>
					</div>
				</div>
			</div>
		</div>
	)
}

// Helper function to get payment method by type
export function getPaymentMethodByType(type: 'lightning' | 'bitcoin' | 'on-chain'): PaymentMethodOption {
	return defaultMethods.find((method) => method.type === type) || defaultMethods[0]
}

// Helper function to format payment method for display
export function formatPaymentMethodLabel(type: string): string {
	switch (type) {
		case 'ln':
		case 'lightning':
			return 'Lightning Network'
		case 'on-chain':
		case 'bitcoin':
			return 'Bitcoin On-chain'
		default:
			return type.charAt(0).toUpperCase() + type.slice(1)
	}
}
