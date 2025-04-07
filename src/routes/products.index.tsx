import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions } from '../queries/products'
import { ProductCard } from '@/components/ProductCard'

export const Route = createFileRoute('/products/')({
	loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(productsQueryOptions),
	component: ProductsRoute,
})

function ProductsRoute() {
	const productsQuery = useSuspenseQuery(productsQueryOptions)
	const products = productsQuery.data

	return (
		<div className="p-4 max-w-7xl mx-auto">
			<h1 className="text-2xl font-bold mb-4">Nostr Products</h1>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-16">
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</div>
		</div>
	)
}
