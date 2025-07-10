import { cn } from '@/lib/utils'

export function DetailField({
	label,
	value,
	className,
	valueClassName,
}: {
	label: React.ReactNode
	value: React.ReactNode
	className?: string
	valueClassName?: string
}) {
	return (
		<div className={cn('flex justify-between items-start text-sm gap-2', className)}>
			<span className="text-muted-foreground whitespace-nowrap">{label}</span>
			<p className={cn('font-medium text-right', valueClassName)}>{value}</p>
		</div>
	)
} 