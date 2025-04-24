import { cn } from '@/lib/utils'

interface PatternProps {
	pattern?: 'dots' | 'page'
	className?: string
}

export function Pattern({ pattern = 'dots', className }: PatternProps) {
	return (
		<div
			className={cn('absolute inset-0 w-full', pattern === 'dots' ? 'z-0 opacity-100' : '-z-10 opacity-25', className)}
			style={{
				background: `url(/images/${pattern}-min.png)`,
				backgroundRepeat: 'repeat',
				backgroundSize: 'auto',
			}}
		/>
	)
}
