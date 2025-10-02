import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useProductSearch, getProductTitle } from '@/queries/products'
import { ProductCard } from '@/components/ProductCard'
import { useEffect } from 'react'

// Define the route: /search/products?q=...
export const Route = createFileRoute('/search/products')({
	component: SearchProductsPage,
	validateSearch: (search: Record<string, unknown>) => {
		return { q: (search.q as string) || '' }
	},
})

function SearchProductsPage() {
	const { q } = Route.useSearch()
	const navigate = useNavigate()

	const { data: results = [], isFetching, refetch } = useProductSearch(q || '', { enabled: !!q?.trim(), limit: 40 })

	useEffect(() => {
		// If query changes to empty, redirect to home products
		if (!q?.trim()) {
			navigate({ to: '/products' })
			return
		}
		// Proactively refetch when landing here
		refetch()
	}, [q])

	return (
		<div className="container mx-auto px-4 py-6">
			<h1 className="text-2xl font-heading mb-4">Search results for: <span className="text-secondary">{q}</span></h1>
			{isFetching && results.length === 0 ? (
				<div className="py-12 text-center text-muted-foreground">Searching...</div>
			) : results.length === 0 ? (
				<div className="py-12 text-center">No products found.</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{results.map((event) => (
						<ProductCard key={event.id} product={event} />
					))}
				</div>
			)}
		</div>
	)
}
