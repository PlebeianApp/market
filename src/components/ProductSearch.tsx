import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Link, useNavigate } from '@tanstack/react-router'
import {
	useProductSearch,
	getProductTitle,
	getProductId,
	getProductImages,
	getProductPubkey,
	productQueryOptions,
} from '@/queries/products'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { useQueryClient } from '@tanstack/react-query'

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
				className="px-4 w-full text-md bg-primary/90 text-gray-100 placeholder:text-gray-300 border-none focus-visible:ring-offset-0 focus:ring-2 focus:ring-secondary rounded-[999px] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
			/>

			<div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-2">
				{search ? (
					<button onClick={clearSearch} className="text-white/50 hover:text-white transition-colors">
						<span className="i-close w-5 h-5 text-secondary" />
					</button>
				) : (
					<span className="i-search w-5 h-5 text-secondary" />
				)}
			</div>

			{showResults && (
				<div className="p-2 flex flex-col gap-2 absolute top-full mt-2 bg-[#1c1c1c] rounded-lg shadow-lg w-full lg:w-[480px] lg:left-auto lg:right-0 z-40">
					{results.length === 0 ? (
						<div className="p-4 text-center text-white">{isFetching ? 'Searching...' : 'No products found'}</div>
					) : (
						<div className="max-h-[320px] overflow-y-auto divide-y divide-white/10">
							{results.map((ev) => {
								const title = getProductTitle(ev)
								const id = getProductId(ev)
								const images = getProductImages(ev)
								const sellerPubkey = getProductPubkey(ev)
								const mainImage = images?.[0]?.[1] // First image URL

								return (
									<Link
										to="/products/$productId"
										params={{ productId: ev.id }}
										key={ev.id}
										className="flex items-center gap-3 p-2 rounded hover:bg-white/5"
										onClick={() => {
											queryClient.setQueryData(productQueryOptions(ev.id).queryKey, ev)
											setShowResults(false)
										}}
									>
										{/* Product Image */}
										{mainImage && <img src={mainImage} alt={title || 'Product'} className="w-8 h-8 rounded object-cover shrink-0" />}

										{/* Content Section */}
										<div className="flex-1 min-w-0 flex items-center gap-2">
											<span className="text-sm text-white truncate">{title || id || ev.id}</span>
											{sellerPubkey && (
												<>
													<span className="text-xs text-gray-400">by</span>
													<UserWithAvatar pubkey={sellerPubkey} size="sm" showBadge={false} disableLink={true} />
												</>
											)}
										</div>

										<span className="i-external-link w-4 h-4 text-secondary shrink-0" />
									</Link>
								)
							})}
						</div>
					)}
					<div className="pt-1">
						<button
							onClick={onShowResultsPage}
							className="w-full text-center text-xs font-medium text-secondary hover:text-white transition-colors py-2"
						>
							Show search results in page
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
