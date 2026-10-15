import { Media } from '@/components/Media'
import { getCoordsFromATag } from '@/lib/utils/coords'
import { fetchProductByATag, productKeys } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { ProductDisplayView } from '@ui/components/ProductDisplayView'

interface ProductDisplayComponentProps {
	productCoords: string
	index: number
	onMoveUp?: () => void
	onMoveDown?: () => void
	onRemove: () => void
	canMoveUp?: boolean
	canMoveDown?: boolean
	isReordering?: boolean
	isRemoving: boolean
}

export function ProductDisplayComponent({
	productCoords,
	index,
	onMoveUp,
	onMoveDown,
	onRemove,
	canMoveUp,
	canMoveDown,
	isReordering,
	isRemoving,
}: ProductDisplayComponentProps) {
	// Parse coordinates to get product ID
	const coords = getCoordsFromATag(productCoords)
	const productId = coords.identifier

	// Fetch product data
	const { data: product, isLoading } = useQuery({
		queryKey: productKeys.byATag(coords.pubkey, productId),
		queryFn: () => fetchProductByATag(coords.pubkey, productId),
		enabled: !!productId && !!coords.pubkey,
	})

	return (
		<ProductDisplayView
			product={product ?? null}
			productId={productId}
			index={index}
			isLoading={isLoading}
			onMoveUp={onMoveUp}
			onMoveDown={onMoveDown}
			onRemove={onRemove}
			canMoveUp={canMoveUp}
			canMoveDown={canMoveDown}
			isReordering={isReordering}
			isRemoving={isRemoving}
			renderImage={(url, title) => <Media src={url} alt={title} className="h-full w-full object-cover" />}
		/>
	)
}
