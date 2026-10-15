import type { ReactNode } from 'react'
import {
	getProductDescription,
	getProductImages,
	getProductPrice,
	getProductStock,
	getProductTitle,
	getProductVisibility,
	type ProductReadEvent,
} from '@sdk/commerce/discovery'
import { Eye, EyeOff, Clock, Package } from 'lucide-react'
import { UiImage } from '../provider/UiProvider'

export function DashboardProductTrigger({ product, renderImage }: { product: ProductReadEvent; renderImage?: (url: string) => ReactNode }) {
	const title = getProductTitle(product)
	const imageUrl = getProductImages(product)[0]?.[1]
	const visibility = getProductVisibility(product)?.[1] || 'on-sale'
	const visibilityIcon =
		visibility === 'hidden' ? (
			<EyeOff className="size-4 text-gray-500" aria-hidden="true" />
		) : visibility === 'pre-order' ? (
			<Clock className="size-4 text-blue-600" aria-hidden="true" />
		) : visibility === 'on-sale' ? (
			<Eye className="size-4 text-green-600" aria-hidden="true" />
		) : null

	return (
		<div className="flex min-w-0 items-center gap-2 overflow-hidden">
			{imageUrl ? (
				(renderImage?.(imageUrl) ?? <UiImage src={imageUrl} alt="" className="size-10 shrink-0 rounded object-cover" />)
			) : (
				<div className="flex size-10 shrink-0 items-center justify-center rounded bg-gray-100">
					<Package className="size-5 text-gray-400" aria-hidden="true" />
				</div>
			)}
			{visibilityIcon}
			<p className="truncate font-semibold">{title}</p>
		</div>
	)
}

export function DashboardProductDetails({
	product,
	renderImage,
	renderLink,
}: {
	product: ProductReadEvent
	renderImage?: (url: string, alt: string) => ReactNode
	renderLink: (children: ReactNode) => ReactNode
}) {
	const title = getProductTitle(product)
	const description = getProductDescription(product) || 'No description'
	const imageUrl = getProductImages(product)[0]?.[1]
	const priceTag = getProductPrice(product)
	const visibility = getProductVisibility(product)?.[1] || 'on-sale'
	const visibilityClass = visibility === 'hidden' ? 'text-gray-500' : visibility === 'pre-order' ? 'text-blue-600' : 'text-green-600'
	const stock = getProductStock(product)?.[1]

	return renderLink(
		<div className="space-y-3">
			{imageUrl && (
				<div className="h-32 w-full overflow-hidden rounded-md bg-gray-200">
					{renderImage?.(imageUrl, title) ?? <UiImage src={imageUrl} alt={title} className="h-full w-full object-cover" />}
				</div>
			)}
			<div>
				<p className="mb-1 text-sm text-gray-600">Description:</p>
				<p className="text-sm">{description}</p>
			</div>
			<div className="flex justify-between">
				<p className="text-sm text-gray-600">
					Price: <span className="font-medium">{priceTag ? `${priceTag[1]} ${priceTag[2]}` : 'Price not set'}</span>
				</p>
				<p className="text-sm text-gray-600">
					Visibility: <span className={`font-medium capitalize ${visibilityClass}`}>{visibility}</span>
				</p>
			</div>
			{stock && (
				<p className="text-sm text-gray-600">
					Stock: <span className="font-medium">{stock} in stock</span>
				</p>
			)}
			<p className="text-right text-xs text-gray-400">Click to view product page →</p>
		</div>,
	)
}
