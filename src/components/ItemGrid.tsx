import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ItemGridProps {
	children: ReactNode
	className?: string
	title?: ReactNode
}

export function ItemGrid({ children, className, title }: ItemGridProps) {
	return (
		<div>
			{title && <div className="mb-4">{typeof title === 'string' ? <h1 className="text-2xl font-heading">{title}</h1> : title}</div>}
			<div className={cn('grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-16', className)}>{children}</div>
		</div>
	)
}
