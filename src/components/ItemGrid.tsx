import type { ReactNode } from 'react'

interface ItemGridProps {
	children: ReactNode
	className?: string
	title?: string
}

export function ItemGrid({ children, className = '', title }: ItemGridProps) {
	return (
		<div>
			{title && <h1 className="text-2xl mb-4 font-heading">{title}</h1>}
			<div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-16 ${className}`}>{children}</div>
		</div>
	)
}
