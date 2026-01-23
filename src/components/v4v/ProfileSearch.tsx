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
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'

// Known relays that support NIP-50 search
const PROFILE_SEARCH_RELAYS = [
	'wss://relay.nostr.band',
	'wss://search.nos.today',
	'wss://nos.lol',
	'wss://nostr.wine',
	'wss://relay.primal.net',
]
const DEBOUNCE_MS = 300
const SEARCH_TIMEOUT_MS = 3000

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

	// Check if the input is a valid hex pubkey (64 hex chars)
	const isValidHexPubkey = (input: string): boolean => {
		return /^[0-9a-f]{64}$/i.test(input)
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

			// Create a relay set from the NIP-50 search relays
			const relaySet = NDKRelaySet.fromRelayUrls(PROFILE_SEARCH_RELAYS, ndk)

			// Connect to the search relays if not already connected
			const connectionResults = await Promise.allSettled(
				Array.from(relaySet.relays).map(async (relay) => {
					if (relay.status !== 1) {
						// 1 = CONNECTED
						try {
							await relay.connect()
							return { url: relay.url, connected: true }
						} catch {
							return { url: relay.url, connected: false }
						}
					}
					return { url: relay.url, connected: true }
				}),
			)

			// Count successful connections from the results (not relay.status which may not update immediately)
			const successful = connectionResults.filter((r) => r.status === 'fulfilled' && r.value.connected)
			const successfulConnections = successful.length
			console.log(
				'[ProfileSearch] Connected to relays:',
				successful.map((r) => (r as PromiseFulfilledResult<{ url: string; connected: boolean }>).value.url),
			)

			if (successfulConnections === 0) {
				console.warn('[ProfileSearch] No relays connected, search will fail')
				return []
			}

			// Create filter for profile search (NIP-50)
			const filter = {
				kinds: [0],
				search: searchQuery,
				limit: 20,
			}

			// Use subscription to collect results as they arrive (more reliable than fetchEvents for NIP-50)
			return new Promise<NDKEvent[]>((resolve) => {
				// Deduplicate by pubkey, keeping the newest event for each profile
				const profilesByPubkey = new Map<string, NDKEvent>()

				console.log('[ProfileSearch] Searching for:', searchQuery, 'on', successfulConnections, 'relays')

				const sub = ndk.subscribe(filter, { closeOnEose: false }, relaySet)

				sub.on('event', (event: NDKEvent) => {
					const existing = profilesByPubkey.get(event.pubkey)
					// Keep the newest event for each pubkey
					if (!existing || (event.created_at ?? 0) > (existing.created_at ?? 0)) {
						profilesByPubkey.set(event.pubkey, event)
					}
				})

				// Resolve after timeout with deduplicated results
				setTimeout(() => {
					sub.stop()
					const results = Array.from(profilesByPubkey.values())
					console.log('[ProfileSearch] Finished with', results.length, 'unique profiles')
					resolve(results)
				}, SEARCH_TIMEOUT_MS)
			})
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
	const handleProfileLinkClick = (e: React.MouseEvent, npub: string) => {
		e.stopPropagation() // Prevent triggering the parent onClick
		e.preventDefault()
		window.open(`https://njump.me/${npub}`, '_blank', 'noopener,noreferrer')
	}

	// Check if input is a valid npub or hex pubkey
	useEffect(() => {
		if (searchQuery.trim()) {
			const trimmed = searchQuery.trim()
			if (trimmed.startsWith('npub') && isValidNpub(trimmed)) {
				handleDirectNpubSearch(trimmed)
			} else if (isValidHexPubkey(trimmed)) {
				// Convert hex to npub and do direct lookup
				const npub = nip19.npubEncode(trimmed)
				handleDirectNpubSearch(npub)
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
											<UserWithAvatar pubkey={event.pubkey} size="sm" showBadge disableLink={true} />
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
												onClick={(e) => handleProfileLinkClick(e, npub)}
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
