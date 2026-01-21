import type { VanityStatus } from '@/lib/schemas/vanity'
import { cn } from '@/lib/utils'

interface VanityStatusBadgeProps {
	status: VanityStatus
	className?: string
}

const statusConfig: Record<VanityStatus, { label: string; className: string }> = {
	available: {
		label: 'Available',
		className: 'bg-gray-100 text-gray-700 border-gray-200',
	},
	pending_payment: {
		label: 'Awaiting Payment',
		className: 'bg-amber-100 text-amber-700 border-amber-200',
	},
	pending_confirmation: {
		label: 'Processing',
		className: 'bg-blue-100 text-blue-700 border-blue-200',
	},
	active: {
		label: 'Active',
		className: 'bg-green-100 text-green-700 border-green-200',
	},
	expired: {
		label: 'Expired',
		className: 'bg-red-100 text-red-700 border-red-200',
	},
	revoked: {
		label: 'Revoked',
		className: 'bg-gray-100 text-gray-500 border-gray-200',
	},
}

export function VanityStatusBadge({ status, className }: VanityStatusBadgeProps) {
	const config = statusConfig[status]

	return (
		<span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border', config.className, className)}>
			{config.label}
		</span>
	)
}
