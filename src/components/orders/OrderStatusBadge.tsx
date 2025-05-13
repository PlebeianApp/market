import { ORDER_STATUS } from '@/lib/schemas/order'
import { Check, Clock, PackageCheck, PackageX, Truck } from 'lucide-react'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface OrderStatusBadgeProps {
	status: string
	iconOnly?: boolean
	className?: string
}

export function OrderStatusBadge({ status, iconOnly = false, className = '' }: OrderStatusBadgeProps) {
	const { bgColor, textColor, icon, description } = useMemo(() => {
		const statusLower = status.toLowerCase()

		switch (statusLower) {
			case ORDER_STATUS.CONFIRMED:
				return {
					bgColor: 'bg-blue-100',
					textColor: 'text-blue-800 dark:bg-blue-800/20 dark:text-blue-400',
					icon: <Check className="h-4 w-4 text-blue-500" />,
					description: 'Order confirmed and payment verified',
				}
			case ORDER_STATUS.PROCESSING:
				return {
					bgColor: 'bg-yellow-100',
					textColor: 'text-yellow-800 dark:bg-yellow-800/20 dark:text-yellow-400',
					icon: <Truck className="h-4 w-4 text-yellow-500" />,
					description: 'Order is being processed',
				}
			case ORDER_STATUS.COMPLETED:
				return {
					bgColor: 'bg-green-100',
					textColor: 'text-green-800 dark:bg-green-800/20 dark:text-green-400',
					icon: <PackageCheck className="h-4 w-4 text-green-500" />,
					description: 'Order successfully completed',
				}
			case ORDER_STATUS.CANCELLED:
				return {
					bgColor: 'bg-red-100',
					textColor: 'text-red-800 dark:bg-red-800/20 dark:text-red-400',
					icon: <PackageX className="h-4 w-4 text-red-500" />,
					description: 'Order has been cancelled',
				}
			case ORDER_STATUS.PENDING:
			default:
				return {
					bgColor: 'bg-gray-100',
					textColor: 'text-gray-800 dark:bg-gray-800/20 dark:text-gray-400',
					icon: <Clock className="h-4 w-4 text-gray-500" />,
					description: 'Awaiting confirmation',
				}
		}
	}, [status])

	if (iconOnly) {
		return (
			<span className={cn('inline-flex items-center justify-center', className)} title={description}>
				{icon}
			</span>
		)
	}

	return (
		<span
			className={cn('inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium', bgColor, textColor, className)}
			title={description}
		>
			{icon}
			<span className="capitalize">{status}</span>
		</span>
	)
}
