import type { ComponentProps } from 'react'
import { getCollectionId, getCollectionTitle, type CollectionReadEvent } from '@sdk/commerce/collections'
import { cn } from '../utils/cn'

export interface CollectionSelectFieldProps extends Omit<ComponentProps<'select'>, 'children' | 'onChange' | 'value'> {
	collections: readonly CollectionReadEvent[]
	value: string
	emptyValue?: string
	emptyLabel?: string
	onValueChange: (value: string) => void
}

/** Collection selector UI backed by SDK collection projections; fetching and form state stay with the host. */
export function CollectionSelectField({
	collections,
	value,
	emptyValue = 'none',
	emptyLabel = 'Not In A Collection',
	onValueChange,
	className,
	...props
}: CollectionSelectFieldProps) {
	return (
		<select
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
			className={cn('h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground', className)}
			{...props}
		>
			<option value={emptyValue}>{emptyLabel}</option>
			{collections.map((collection) => {
				const id = getCollectionId(collection)
				return (
					<option key={id} value={id}>
						{getCollectionTitle(collection)}
					</option>
				)
			})}
		</select>
	)
}
