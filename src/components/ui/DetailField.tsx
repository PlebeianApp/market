import { cn } from '@/lib/utils'

export function DetailField({
	label,
	value,
	className,
}: {
	label: React.ReactNode
	value: React.ReactNode
	className?: string
}) {
	return (
		<div className={cn('flex justify-between items-center text-sm', className)}>
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono">{value}</span>
		</div>
	)
} 