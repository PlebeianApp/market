import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions } from '../queries/products'
import { ProductCard } from '@/components/ProductCard'
import { ItemGrid } from '@/components/ItemGrid'

export const Route = createFileRoute('/products/')({
	loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(productsQueryOptions),
	component: ProductsRoute,
})

function ProductsRoute() {
	const productsQuery = useSuspenseQuery(productsQueryOptions)
	const products = productsQuery.data

	return (
		<div className="p-4 max-w-7xl mx-auto">
			<ItemGrid title="Nostr Products">
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</ItemGrid>
		</div>
	)
}
