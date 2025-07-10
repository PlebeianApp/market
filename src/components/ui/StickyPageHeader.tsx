import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface StickyPageHeaderProps {
	title: string
	children: ReactNode
	className?: string
	headerClassName?: string
	contentClassName?: string
}

export function StickyPageHeader({
	title,
	children,
	className,
	headerClassName,
	contentClassName,
}: StickyPageHeaderProps) {
	return (
		<div className={cn('', className)}>
			<div className={cn('hidden md:block sticky top-0 z-10 bg-white border-b py-4 px-4 md:px-8', headerClassName)}>
				<h1 className="text-2xl font-bold">{title}</h1>
			</div>
			<div className={cn('p-4 md:p-8', contentClassName)}>{children}</div>
		</div>
	)
} 