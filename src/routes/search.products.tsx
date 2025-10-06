import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useProductSearch, getProductTitle } from '@/queries/products'
import { ProductCard } from '@/components/ProductCard'
import { useEffect, useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

declare module '@tanstack/react-router' {
	interface FileRoutesByPath {
		'/search/products': {
			validateSearch: (search: Record<string, unknown>) => { q: string; sort?: string; exclude?: string }
		}
	}
}

// Define the route: /search/products?q=...
export const Route = createFileRoute('/search/products')({
	component: SearchProductsPage,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			q: (search.q as string) || '',
			sort: (search.sort as string) || 'newest',
			exclude: (search.exclude as string) || '',
		}
	},
})

function SearchProductsPage() {
	const { q, sort, exclude } = Route.useSearch()
	const navigate = useNavigate()
	const [localSort, setLocalSort] = useState(sort || 'newest')
	const [localExclude, setLocalExclude] = useState(exclude || '')

	const { data: rawResults = [], isFetching, refetch } = useProductSearch(q || '', { enabled: !!q?.trim(), limit: 40 })

	// Process results: filter out excluded terms and sort
	const results = useMemo(() => {
		let filtered = rawResults

		// Apply exclusion filter if there are exclude terms
		if (localExclude.trim()) {
			const excludeTerms = localExclude
				.toLowerCase()
				.split(/\s+/)
				.filter((term) => term.length > 0)
			filtered = rawResults.filter((event) => {
				const title = getProductTitle(event)?.toLowerCase() || ''
				const content = event.content?.toLowerCase() || ''
				const searchText = `${title} ${content}`

				// Exclude if any exclude term is found
				return !excludeTerms.some((term) => searchText.includes(term))
			})
		}

		// Apply sorting
		if (localSort === 'oldest') {
			return [...filtered].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
		} else {
			return [...filtered].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
		}
	}, [rawResults, localSort, localExclude])

	// Update URL when local state changes
	const updateSearch = (newSort?: string, newExclude?: string) => {
		navigate({
			to: '/search/products',
			search: {
				q,
				sort: newSort ?? localSort,
				exclude: newExclude ?? localExclude,
			},
			replace: true,
		})
	}

	// Handle sort change
	const handleSortChange = (value: string) => {
		setLocalSort(value)
		updateSearch(value, localExclude)
	}

	// Handle exclude change
	const handleExcludeChange = (value: string) => {
		setLocalExclude(value)
		updateSearch(localSort, value)
	}

	useEffect(() => {
		// If query changes to empty, redirect to home products
		if (!q?.trim()) {
			navigate({ to: '/products' })
			return
		}
		// Proactively refetch when landing here
		refetch()
	}, [q])

	// Sync local state with URL parameters
	useEffect(() => {
		setLocalSort(sort || 'newest')
		setLocalExclude(exclude || '')
	}, [sort, exclude])

	return (
		<div className="container mx-auto px-4 py-6">
			<h1 className="text-2xl font-heading mb-4">
				Search results for: <span className="text-secondary">{q}</span>
			</h1>

			{/* Filter and Sort Bar */}
			<div className="bg-gray-50 rounded-lg p-4 mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
				{/* Sort Radio Buttons */}
				<div className="flex items-center gap-2">
					<Label className="text-sm font-medium">Sort by:</Label>
					<RadioGroup value={localSort} onValueChange={handleSortChange} className="flex gap-4">
						<div className="flex items-center space-x-2">
							<RadioGroupItem value="newest" id="newest" />
							<Label htmlFor="newest" className="text-sm">
								Newest
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<RadioGroupItem value="oldest" id="oldest" />
							<Label htmlFor="oldest" className="text-sm">
								Oldest
							</Label>
						</div>
					</RadioGroup>
				</div>

				{/* Exclude Input */}
				<div className="flex items-center gap-2 flex-1 sm:max-w-md">
					<Label htmlFor="exclude" className="text-sm font-medium whitespace-nowrap">
						Exclude terms:
					</Label>
					<Input
						id="exclude"
						type="text"
						placeholder="Enter terms to exclude..."
						value={localExclude}
						onChange={(e) => handleExcludeChange(e.target.value)}
						className="flex-1"
					/>
				</div>
			</div>
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
