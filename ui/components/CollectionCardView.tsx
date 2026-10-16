import type { ComponentProps, ReactNode } from 'react'
import {
	getCollectionId,
	getCollectionImages,
	getCollectionSummary,
	getCollectionTitle,
	type CollectionReadEvent,
} from '@sdk/commerce/collections'
import { UiImage } from '../provider/UiProvider'
import { cn } from '../utils/cn'

export interface CollectionCardViewProps extends Omit<ComponentProps<'div'>, 'children'> {
	collection: CollectionReadEvent
	renderLink: (children: ReactNode, collectionId: string, className?: string) => ReactNode
	renderImage?: (imageUrl: string, title: string) => ReactNode
	renderSeller?: ReactNode
}

/** Collection presentation from SDK read data; routing and seller UI stay with the host. */
export function CollectionCardView({ collection, renderLink, renderImage, renderSeller, className, ...props }: CollectionCardViewProps) {
	const collectionId = getCollectionId(collection)
	const title = getCollectionTitle(collection)
	const summary = getCollectionSummary(collection)
	const imageUrl = getCollectionImages(collection)[0]?.[1]

	return (
		<div className={cn('flex flex-col rounded-lg border border-zinc-800 bg-white shadow-sm', className)} {...props}>
			{renderLink(
				imageUrl ? (
					(renderImage?.(imageUrl, title) ?? <UiImage src={imageUrl} alt={title} className="h-full w-full object-cover" />)
				) : (
					<div className="flex h-full w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400">No image</div>
				),
				collectionId,
				'relative block aspect-square overflow-hidden border-b border-zinc-800',
			)}

			<div className="flex flex-grow flex-col gap-2 p-4">
				{renderLink(
					<>
						<h2 className="overflow-hidden truncate whitespace-nowrap border-b border-[var(--light-gray)] pb-2 text-lg font-black">
							{title}
						</h2>
						<div className="text-md font-medium">{summary}</div>
					</>,
					collectionId,
					'block',
				)}

				<div className="flex-grow" />
				{renderSeller && <div className="flex flex-row items-center gap-2 text-sm">by {renderSeller}</div>}
			</div>
		</div>
	)
}
