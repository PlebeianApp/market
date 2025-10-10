import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ItemGridProps {
	children: ReactNode
	className?: string
	title?: ReactNode
	cols?: 1 | 2 | 3 | 4 | 5 | 6
	smCols?: 1 | 2 | 3 | 4 | 5 | 6
	lgCols?: 1 | 2 | 3 | 4 | 5 | 6
	xlCols?: 1 | 2 | 3 | 4 | 5 | 6
	gap?: 4 | 6 | 8 | 12 | 16
}

export function ItemGrid({ children, className, title, cols = 1, smCols = 3, lgCols = 4, xlCols = 5, gap = 16 }: ItemGridProps) {
	const colsMap = {
		1: 'grid-cols-1',
		2: 'grid-cols-2',
		3: 'grid-cols-3',
		4: 'grid-cols-4',
		5: 'grid-cols-5',
		6: 'grid-cols-6',
	}

	const smColsMap = {
		1: 'sm:grid-cols-1',
		2: 'sm:grid-cols-2',
		3: 'sm:grid-cols-3',
		4: 'sm:grid-cols-4',
		5: 'sm:grid-cols-5',
		6: 'sm:grid-cols-6',
	}

	const lgColsMap = {
		1: 'lg:grid-cols-1',
		2: 'lg:grid-cols-2',
		3: 'lg:grid-cols-3',
		4: 'lg:grid-cols-4',
		5: 'lg:grid-cols-5',
		6: 'lg:grid-cols-6',
	}

	const xlColsMap = {
		1: 'xl:grid-cols-1',
		2: 'xl:grid-cols-2',
		3: 'xl:grid-cols-3',
		4: 'xl:grid-cols-4',
		5: 'xl:grid-cols-5',
		6: 'xl:grid-cols-6',
	}

	const gapMap = {
		4: 'gap-4',
		6: 'gap-6',
		8: 'gap-8',
		12: 'gap-12',
		16: 'gap-16',
	}

	return (
		<div>
			{title && (
				<div className="mb-4">
					{typeof title === 'string' ? <h1 className="text-2xl font-heading text-center sm:text-left">{title}</h1> : title}
				</div>
			)}
			<div className={cn('grid', colsMap[cols], smColsMap[smCols], lgColsMap[lgCols], xlColsMap[xlCols], gapMap[gap], className)}>
				{children}
			</div>
		</div>
	)
}
