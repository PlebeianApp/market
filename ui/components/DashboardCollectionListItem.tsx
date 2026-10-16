import type { ReactNode } from 'react'
import { UiImage } from '../provider/UiProvider'
import {
	getCollectionImages,
	getCollectionProductReferences,
	getCollectionSummary,
	getCollectionTitle,
	type CollectionReadEvent,
} from '@sdk/commerce/collections'

export function DashboardCollectionTrigger({ collection }: { collection: CollectionReadEvent }) {
	return (
		<div>
			<p className="font-semibold">{getCollectionTitle(collection)}</p>
		</div>
	)
}

export function DashboardCollectionDetails({
	collection,
	renderImage,
}: {
	collection: CollectionReadEvent & { content?: string }
	renderImage?: (url: string) => ReactNode
}) {
	const summary = getCollectionSummary(collection)
	const description = collection.content || ''
	const productCount = getCollectionProductReferences(collection).length
	const headerImage = getCollectionImages(collection)[0]?.[1]

	return (
		<div className="border-t bg-gray-50 p-4">
			<div className="space-y-3">
				{headerImage && (
					<div className="h-32 w-full overflow-hidden rounded-md bg-gray-200">
						{renderImage?.(headerImage) ?? <UiImage src={headerImage} alt="Collection header" className="h-full w-full object-cover" />}
					</div>
				)}
				{summary && (
					<div>
						<p className="mb-1 text-sm text-gray-600">Summary:</p>
						<p className="text-sm">{summary}</p>
					</div>
				)}
				{description && (
					<div>
						<p className="mb-1 text-sm text-gray-600">Description:</p>
						<p className="text-sm">{description}</p>
					</div>
				)}
				<div className="text-sm text-gray-600">
					Products: <span className="font-medium">{productCount}</span>
				</div>
			</div>
		</div>
	)
}
