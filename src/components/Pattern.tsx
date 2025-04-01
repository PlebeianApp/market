import React from 'react'
import { cn } from '@/lib/utils'

interface PatternProps {
	pattern?: 'dots' | 'page'
	className?: string
}

export function Pattern({ pattern = 'dots', className }: PatternProps) {
	return (
		<div
			className={cn('fixed inset-0 -z-0 min-h-full w-full', className)}
			style={{
				background: `url(/images/${pattern}-min.png)`,
				backgroundRepeat: 'repeat',
				backgroundSize: 'auto',
				bottom: 0,
				top: 0,
				left: 0,
				right: 0,
			}}
		/>
	)
}
