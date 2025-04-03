import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { productsQueryOptions } from '../queries/products'

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
					<div key={product.id} className="border border-zinc-800 rounded-lg overflow-hidden bg-white shadow-sm flex flex-col">
						{/* Square aspect ratio container for image */}
						<div className="relative aspect-square border-b border-zinc-800">
							{product.images && product.images.length > 0 ? (
								<img src={product.images[0].url} alt={product.title} className="w-full h-full object-cover" />
							) : (
								<div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">No image</div>
							)}
						</div>

						<div className="p-2 flex flex-col gap-2 flex-grow">
							{/* Product title */}
							<h2 className="text-sm font-medium border-b border-[var(--light-gray)] pb-2">{product.title}</h2>

							{/* Pricing section */}
							<div className="flex justify-between items-center">
								<div className="flex flex-col gap-1">
									{product.price && (
										<p className="text-xs text-gray-500">
											{product.price.amount} {product.price.currency}
										</p>
									)}
									{/* Sats price - more prominent */}
									<p className="text-sm font-medium">
										{product.price ? Math.round(parseFloat(product.price.amount) * 220).toLocaleString() : '0'} Sats
									</p>
								</div>

								{/* Stock indicator - right aligned */}
								{product.stock !== undefined && (
									<div className="bg-[var(--light-gray)] font-medium px-4 py-1 rounded-full text-xs">{product.stock} in stock</div>
								)}
							</div>

							{/* Add a flex spacer to push the button to the bottom */}
							<div className="flex-grow"></div>

							{/* Add to cart button */}
							<div className="flex gap-2">
								<button className="bg-black text-white py-3 px-4 rounded-lg flex-grow font-medium">Add to Cart</button>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
