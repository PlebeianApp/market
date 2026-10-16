import { useState, useRef, useEffect } from 'react'
import { Input } from '@ui/primitives/input'
import { useNavigate } from '@tanstack/react-router'
import { useProductSearch, productQueryOptions } from '@/queries/products'
import { useQueryClient } from '@tanstack/react-query'
import { UserCard } from './UserCard'
import { ProductSearchResults } from '@ui/components/ProductSearchResults'
import { Media } from '@ui/components/Media'

const DEBOUNCE_MS = 500

export function ProductSearch() {
	const [search, setSearch] = useState('')
	const [showResults, setShowResults] = useState(false)
	const searchContainerRef = useRef<HTMLDivElement>(null)
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	const { data: results = [], isFetching, refetch } = useProductSearch(search, { enabled: false, limit: 20 })

	const handleFocus = () => {
		if (search.trim()) setShowResults(true)
	}

	const clearSearch = () => {
		setSearch('')
		setShowResults(false)
		if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
	}

	// Handle clicks outside the search container
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
				setShowResults(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
		}
	}, [])

	// Debounce search input and trigger query
	useEffect(() => {
		if (!search.trim()) {
			setShowResults(false)
			return
		}
		if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
		debounceTimerRef.current = setTimeout(() => {
			refetch()
			setShowResults(true)
		}, DEBOUNCE_MS)
	}, [search])

	const onShowResultsPage = () => {
		if (!search.trim()) return
		navigate({ to: '/search/products', search: { q: search } })
		setShowResults(false)
	}

	return (
		<div className="relative w-full" ref={searchContainerRef}>
			<Input
				type="search"
				placeholder="Search Products"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				onFocus={handleFocus}
				className="px-4 w-full text-base! h-10 bg-primary/90 text-gray-100 placeholder:text-gray-300 border-none focus-visible:ring-offset-0 focus:ring-2 focus:ring-secondary rounded-[999px] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
			/>

			<div className="absolute right-4 top-1/2 -translate-y-2.5 flex gap-2">
				{search ? (
					<button onClick={clearSearch} className="text-white/50 hover:text-white transition-colors">
						<span className="i-close w-5 h-5 text-secondary" />
					</button>
				) : (
					<span className="i-search w-5 h-5 text-secondary" />
				)}
			</div>

			{showResults && (
				<div className="absolute top-full right-0 z-40 mt-2 w-full lg:w-[480px]">
					<ProductSearchResults
						products={results}
						isLoading={isFetching}
						onSelect={(product) => {
							queryClient.setQueryData(productQueryOptions(product.id).queryKey, product)
							navigate({ to: '/products/$productId', params: { productId: product.id } })
							setShowResults(false)
						}}
						onShowAll={onShowResultsPage}
						renderImage={(imageUrl, title) => (
							<Media src={imageUrl} alt={title || 'Product'} className="size-8 shrink-0 rounded object-cover" />
						)}
						renderSeller={(pubkey) => <UserCard pubkey={pubkey} size="xs" onPress="none" />}
					/>
				</div>
			)}
		</div>
	)
}
