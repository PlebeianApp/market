import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserWithAvatar } from '@/components/UserWithAvatar'
import { Loader2, ExternalLink } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { profileKeys } from '@/queries/queryKeyFactory'
import { fetchProfileByIdentifier } from '@/queries/profiles'
import { NDKEvent } from '@nostr-dev-kit/ndk'

const SEARCH_RELAYS = ['wss://relay.nostr.band', 'wss://search.nos.today', 'wss://nos.lol']
const DEBOUNCE_MS = 500

interface ProfileSearchProps {
	onSelect: (npub: string) => void
	placeholder?: string
}

export function ProfileSearch({ onSelect, placeholder = 'Search profiles or paste npub...' }: ProfileSearchProps) {
	const [searchQuery, setSearchQuery] = useState('')
	const [eventList, setEventList] = useState<Array<NDKEvent>>([])
	const [showResults, setShowResults] = useState(false)
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const resultsRef = useRef<HTMLDivElement>(null)

	// Check if the input is a valid npub
	const isValidNpub = (input: string): boolean => {
		try {
			const decoded = nip19.decode(input)
			return decoded.type === 'npub'
		} catch {
			return false
		}
	}

	// Use query for searching profiles
	const {
		data: searchResults,
		isLoading,
		refetch,
	} = useQuery({
		queryKey: [...profileKeys.all, 'search', searchQuery],
		queryFn: async () => {
			if (!searchQuery.trim()) return []

			const ndk = ndkActions.getNDK()
			if (!ndk) throw new Error('NDK not initialized')

			// Connect to search relays if not already connected
			for (const url of SEARCH_RELAYS) {
				try {
					await ndk.addExplicitRelay(url)
				} catch (error) {
					console.error(`Failed to connect to relay ${url}:`, error)
				}
			}

			// Create filter for profile search
			const filter = {
				kinds: [0],
				search: searchQuery,
				limit: 20,
			}

			// Fetch events
			const events = await ndk.fetchEvents(filter)
			return Array.from(events)
		},
		enabled: false, // Don't run query automatically
	})

	// Click outside to close results
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (resultsRef.current && !resultsRef.current.contains(event.target as Node)) {
				setShowResults(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			// Clear timeout
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	// Update events when search results come in
	useEffect(() => {
		if (searchResults) {
			setEventList(searchResults)
			setShowResults(true)
		}
	}, [searchResults])

	// Debounced search
	const debouncedSearch = () => {
		if (!searchQuery.trim()) {
			clearSearch()
			return
		}

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		debounceTimerRef.current = setTimeout(() => {
			refetch()
		}, DEBOUNCE_MS)
	}

	// Handle direct npub case with the profiles query
	const handleDirectNpubSearch = async (npub: string) => {
		try {
			await fetchProfileByIdentifier(npub)
			handleSelect(npub)
		} catch (error) {
			console.error('Error fetching profile by npub:', error)
		}
	}

	// Clear search results
	const clearSearch = () => {
		setEventList([])
		setShowResults(false)
	}

	// Handle selection
	const handleSelect = (npub: string) => {
		onSelect(npub)
		clearSearch()
		setSearchQuery('')
	}

	// Handle profile link click
	const handleProfileLinkClick = (e: React.MouseEvent) => {
		e.stopPropagation() // Prevent triggering the parent onClick
	}

	// Check if input is a valid npub
	useEffect(() => {
		if (searchQuery.trim()) {
			if (searchQuery.startsWith('npub') && isValidNpub(searchQuery)) {
				handleDirectNpubSearch(searchQuery)
			} else {
				debouncedSearch()
			}
		} else {
			clearSearch()
		}
	}, [searchQuery])

	return (
		<div className="w-full relative">
			<div className="relative">
				<Input
					type="search"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder={placeholder}
					onFocus={() => searchQuery.trim() && setShowResults(true)}
				/>
				{isLoading && (
					<div className="absolute right-3 top-1/2 transform -translate-y-1/2">
						<Loader2 className="h-4 w-4 animate-spin text-gray-400" />
					</div>
				)}
			</div>

			{showResults && (
				<div
					ref={resultsRef}
					className="absolute z-50 top-full mt-1 w-full bg-white rounded-md border border-gray-200 shadow-lg overflow-hidden"
				>
					<div className="max-h-[300px] overflow-y-auto p-1">
						{eventList.length === 0 ? (
							<div className="p-2 text-sm text-gray-500 text-center">{isLoading ? 'Searching...' : 'No profiles found.'}</div>
						) : (
							<div>
								{eventList.map((event) => {
									let profile = null
									try {
										profile = JSON.parse(event.content)
									} catch {
										profile = {}
									}

									const npub = nip19.npubEncode(event.pubkey)

									return (
										<div
											key={event.id}
											className="flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer rounded group"
											onClick={() => handleSelect(npub)}
											data-testid={`profile-search-result-${event.pubkey}`}
										>
											<UserWithAvatar pubkey={event.pubkey} size="sm" showBadge />
											<span className="flex flex-col flex-1">
												<span className="font-bold">{profile?.name || profile?.displayName || npub.slice(0, 10) + '...'}</span>
												{profile?.nip05 && <span className="text-xs">{profile.nip05}</span>}
												<span className="text-xs text-muted-foreground">
													{npub.slice(0, 12)}... {npub.slice(-6)}
												</span>
											</span>
											<Link
												to="/profile/$profileId"
												params={{ profileId: event.pubkey }}
												className="opacity-0 group-hover:opacity-100 transition-opacity"
												onClick={handleProfileLinkClick}
											>
												<Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="View profile">
													<ExternalLink className="h-4 w-4" />
												</Button>
											</Link>
										</div>
									)
								})}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
