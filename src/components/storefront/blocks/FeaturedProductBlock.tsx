import { ProductCard } from '@/components/ProductCard'
import { cn } from '@/lib/utils'
import { productsByPubkeyQueryOptions, getProductId } from '@/queries/products'
import { useQuery } from '@tanstack/react-query'
import { useStorefrontContext } from '../StorefrontContext'
import { StorefrontEditorHint, StorefrontSection } from './shared'

export interface FeaturedProductBlockProps {
	productDTag: string
}

/**
 * A single highlighted listing, referenced by its `d` tag.
 *
 * Resolved out of the author's own listing set rather than by a direct lookup,
 * which is what makes the reference safe: the identity of the product is
 * `(author pubkey from context, d tag from the document)`, so a page cannot
 * point at an arbitrary event id and display a stranger's listing under the
 * author's name.
 */
export function FeaturedProductBlock({ productDTag }: FeaturedProductBlockProps) {
	const { pubkey, isEditing } = useStorefrontContext()
	const { data: products, isLoading, isError } = useQuery(productsByPubkeyQueryOptions(pubkey))

	if (productDTag.trim().length === 0) {
		return isEditing ? (
			<StorefrontSection className="py-6">
				<StorefrontEditorHint>Choose a product to feature.</StorefrontEditorHint>
			</StorefrontSection>
		) : null
	}

	const product = (products ?? []).find((candidate) => getProductId(candidate) === productDTag)

	if (isLoading) {
		return (
			<StorefrontSection width="narrow" className="py-6">
				<p className="text-center text-muted-foreground">Loading…</p>
			</StorefrontSection>
		)
	}

	// A featured product that no longer exists (unlisted, sold out, or deleted)
	// renders as nothing for visitors rather than as a broken slot. The author
	// still sees why, because the editor hint is theirs alone.
	if (!product) {
		if (!isEditing) return null
		return (
			<StorefrontSection className="py-6">
				<StorefrontEditorHint>
					{isError
						? 'This product could not be loaded — check your relay connection.'
						: `No published product matches "${productDTag}". It may be hidden, out of stock, or deleted.`}
				</StorefrontEditorHint>
			</StorefrontSection>
		)
	}

	return (
		<StorefrontSection width="narrow" className={cn('py-8', isEditing && 'pointer-events-none')}>
			<ProductCard product={product} />
		</StorefrontSection>
	)
}
