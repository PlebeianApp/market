import { createFileRoute, useLocation, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { authActions, authStore } from '@/lib/stores/auth'
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'
import { type JSX, type SVGProps, useEffect, useMemo, useState, useRef } from 'react'
import { enhancedNotesQueryOptions, type EnhancedFetchedNDKEvent, cleanupStaleEvents, SUPPORTED_KINDS, getAugmentedRelayUrls } from '@/queries/enhanced-firehose'
import { authorQueryOptions } from '@/queries/authors'
import { reactionsQueryOptions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { writeRelaysUrls, defaultRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'
import { toast } from 'sonner'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2, X, ArrowLeft, LogOut, LucideRefreshCw, RefreshCw } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'
import { findRootFromETags } from '@/queries/enhanced-thread'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmojiPicker, { Theme } from 'emoji-picker-react'
import { goBackWithTimeLimit } from '@/lib/navigation'
import { useConfigQuery } from '@/queries/config'
import { CartButton } from '@/components/CartButton'
import { Profile } from '@/components/Profile'
import { noteKeys } from '@/queries/queryKeyFactory'

// Function to check if there's a previous entry in browser history
function canGoBack(): boolean {
	if (typeof window === 'undefined') return false
	// window.history.length can vary by browser. Treat >1 as having something to go back to.
	return (window.history.length || 0) > 1
}
// Backwards-compat helper for existing logic
function isAtStartOfHistory(): boolean {
	return !canGoBack()
}

// Utility function to format timestamp as "X seconds ago"
function formatTimeAgo(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (seconds < 60) {
		return `${seconds}s ago`
	} else if (minutes < 60) {
		return `${minutes}m ago`
	} else if (hours < 24) {
		return `${hours}h ago`
	} else {
		return `${days}d ago`
	}
}

// View mode state management with localStorage persistence
const VIEW_TIMESTAMPS_KEY = 'nostr_view_timestamps'
const VIEW_POSITIONS_KEY = 'nostr_view_positions'
const VIEW_CACHE_KEY = 'nostr_view_cache'
// Persisted list of recently opened user feed pubkeys
const USER_FEEDS_KEY = 'nostr_user_feeds'

interface ViewState {
	lastRefreshTimestamp: number
	scrollPosition: number
	cachedData?: EnhancedFetchedNDKEvent[]
}

function getViewStateKey(filterMode: string, tagFilter: string, authorFilter: string): string {
	return `${filterMode}-${tagFilter || ''}-${authorFilter || ''}`
}

function saveViewState(key: string, state: ViewState): void {
	try {
		const allStates = JSON.parse(localStorage.getItem(VIEW_TIMESTAMPS_KEY) || '{}')
		allStates[key] = state
		localStorage.setItem(VIEW_TIMESTAMPS_KEY, JSON.stringify(allStates))
	} catch (error) {
		console.warn('Failed to save view state:', error)
	}
}

function loadViewState(key: string): ViewState | null {
	try {
		const allStates = JSON.parse(localStorage.getItem(VIEW_TIMESTAMPS_KEY) || '{}')
		return allStates[key] || null
	} catch (error) {
		console.warn('Failed to load view state:', error)
		return null
	}
}

function CollapseVerticalIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			<path d="M12 3v9" />
			<path d="M8 8l4 4 4-4" />
			<path d="M12 21v-9" />
			<path d="M8 16l4-4 4 4" />
		</svg>
	)
}

// Lightweight URL linkifier for plain text (http/https only)
function linkifyPlainText(text: string): (string | JSX.Element)[] {
	const parts: (string | JSX.Element)[] = []
	const regex = /(https?:\/\/[^\s<]+)/gi
	let lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
		const url = match[0]
		parts.push(
			<a key={`lk-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-words">
				{url}
			</a>,
		)
		lastIndex = match.index + match[0].length
	}
	if (lastIndex < text.length) parts.push(text.slice(lastIndex))
	return parts
}

// Profile banner displayed at the top of a user's feed (based on kind 0 profile metadata)
function ProfileBanner({
	pubkey,
	name,
	picture,
	about,
	isLoading,
}: {
	pubkey: string
	name?: string
	picture?: string
	about?: string
	isLoading?: boolean
}) {
	// Clamp to 4 lines with a revealer
	const contentRef = useRef<HTMLDivElement | null>(null)
	const [expanded, setExpanded] = useState(false)
	const [needsClamp, setNeedsClamp] = useState(false)

	useEffect(() => {
		const el = contentRef.current
		if (!el) return
		// Measure after layout
		const id = window.setTimeout(() => {
			try {
				setNeedsClamp(el.scrollHeight > el.clientHeight + 1)
			} catch {}
		}, 0)
		return () => window.clearTimeout(id)
	}, [about, expanded])

	const displayName = name || pubkey?.slice(0, 8) + '…'

	return (
		<div className="mb-3">
			<div className="w-full rounded-md border border-gray-200 bg-white p-3">
				<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
					{/* Left: avatar + name */}
					<div className="flex items-center gap-3 min-w-0">
						{picture ? (
							<img src={picture} alt={displayName} className="w-16 h-16 rounded-full object-cover border" />
						) : (
							<div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xl border">
								{(displayName || 'U').slice(0, 1).toUpperCase()}
							</div>
						)}
						<div className="min-w-0">
							<div className="text-xl font-semibold leading-tight truncate">{isLoading ? 'Loading…' : displayName}</div>
							<div className="text-xs text-gray-500 truncate">{pubkey}</div>
						</div>
					</div>
					{/* Right: about (linkified) */}
					<div className="md:w-1/2">
						<div
							ref={contentRef}
							className="text-sm text-gray-800"
							style={
								!expanded
									? {
										display: '-webkit-box',
										WebkitLineClamp: 4 as any,
										WebkitBoxOrient: 'vertical' as any,
										overflow: 'hidden',
										wordBreak: 'break-word',
									}
									: { wordBreak: 'break-word' }
							}
						>
							{about ? linkifyPlainText(about) : <span className="text-gray-500">No bio</span>}
						</div>
						{!expanded && needsClamp ? (
							<div className="mt-1">
								<button
									type="button"
									className="text-blue-600 hover:underline text-sm"
									onClick={() => setExpanded(true)}
								>
									Show more
								</button>
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	)
}

// Chip component for user feed list that shows username instead of pubkey
function UserFeedChip({
	pk,
	isActive,
	onOpen,
	onRemove,
}: {
	pk: string
	isActive: boolean
	onOpen: () => void
	onRemove: () => void
}) {
	const { data: author, isLoading } = useQuery({ ...authorQueryOptions(pk), enabled: !!pk }) as any
	const displayName = isLoading ? 'Loading…' : (author?.name || author?.displayName || author?.nip05 || (pk.slice(0, 8) + '…'))
	return (
		<div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${isActive ? 'bg-secondary text-white border-secondary' : 'bg-gray-100 text-gray-800 border-gray-200'}`}>
			<button type="button" className="text-sm hover:underline" onClick={onOpen} title={`Open user feed ${displayName}`}>
				{displayName}
			</button>
			<button type="button" className={`ml-1 rounded-full p-0.5 ${isActive ? 'hover:bg-white/20' : 'hover:bg-gray-200'}`} onClick={onRemove} title="Remove from list" aria-label="Remove user from saved list">
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	)
}

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const { data: config } = useConfigQuery()
	const location = useLocation()
	const queryClient = useQueryClient()
	const [isFiltersOpen, setIsFiltersOpen] = useState(false)
	const [loadingMode, setLoadingMode] = useState<null | 'all' | 'threads' | 'originals' | 'follows' | 'reactions' | 'hashtag'>(null)
	const [spinnerSettled, setSpinnerSettled] = useState(false)
	const { openThreadId, setOpenThreadId, feedScrollY, setFeedScrollY, clickedEventId, setClickedEventId } = useThreadOpen()
	const [tagFilter, setTagFilter] = useState('')
	const [tagFilterInput, setTagFilterInput] = useState(tagFilter)
	const [authorFilter, setAuthorFilter] = useState('')
	// Recently opened user feeds (persisted)
	const [userFeeds, setUserFeeds] = useState<string[]>([])
	const [filterMode, setFilterMode] = useState<'all' | 'threads' | 'originals' | 'follows' | 'reactions' | 'hashtag'>('all')
	const isBaseFeed = filterMode !== 'hashtag' && !authorFilter.trim()
	const [previousFilterMode, setPreviousFilterMode] = useState<'all' | 'threads' | 'originals' | 'follows' | 'hashtag'>('all')

	// Load saved user feeds on mount
	useEffect(() => {
		try {
			const raw = localStorage.getItem(USER_FEEDS_KEY) || '[]'
			const arr = JSON.parse(raw)
			if (Array.isArray(arr)) {
				setUserFeeds(arr.filter((s: any) => typeof s === 'string'))
			}
		} catch {}
	}, [])
	// Persist user feeds when changed
	useEffect(() => {
		try {
			localStorage.setItem(USER_FEEDS_KEY, JSON.stringify(userFeeds))
		} catch {}
	}, [userFeeds])
	// When a user feed is opened, add it to the saved list (most recent first)
	useEffect(() => {
		if ((authorFilter || '').trim()) {
			setUserFeeds((prev) => {
				const pk = (authorFilter || '').trim()
				const next = [pk, ...prev.filter((p) => p !== pk)]
				return next.slice(0, 12)
			})
		}
	}, [authorFilter])

	function navigateToUserFeed(hexPubkey: string) {
		try {
			if (typeof window === 'undefined') return
			const url = new URL(window.location.href)
			url.search = ''
			url.searchParams.set('user', hexPubkey)
			const target = url.pathname.startsWith('/nostr')
				? url.search
					? `/nostr${url.search}`
					: '/nostr'
				: url.search
					? `${url.pathname}${url.search}`
					: url.pathname
			window.history.pushState({}, '', target)
			window.dispatchEvent(new PopStateEvent('popstate'))
		} catch {}
	}

	// Determine an initial limit that will overflow the viewport a bit so the feed feels full
	function getInitialFeedLimit(): number {
		try {
			if (typeof window !== 'undefined' && typeof window.innerHeight === 'number') {
				const h = Math.max(400, window.innerHeight)
				const estItemHeight = 220 // rough average card height
				const perView = Math.ceil(h / estItemHeight)
				// Add buffer to ensure overflow
				return Math.max(20, perView + 8)
			}
		} catch {}
		return 30
	}
	const [eventLimit, setEventLimit] = useState(getInitialFeedLimit())
	// Store all loaded events, so we can append new ones without reloading
	const [allLoadedEvents, setAllLoadedEvents] = useState<EnhancedFetchedNDKEvent[]>([])
	// Current user for follows mode
	const [currentUserPk, setCurrentUserPk] = useState('')

	// Track cache cleanup stats for debugging
	const [lastCleanupStats, setLastCleanupStats] = useState<{
		timestamp: number
		removedCount: number
	} | null>(null)
	const notesOpts = useMemo(() => {
		// Hashtag view is independent: only in 'hashtag' mode do we apply the tag filter.
		// Reactions mode is global only.
		if (filterMode === 'reactions') return { tag: '', author: '', follows: false, limit: eventLimit }
		if (filterMode === 'hashtag') return { tag: tagFilter, author: '', follows: false, limit: eventLimit }
		if (filterMode === 'follows') return { tag: '', author: '', follows: true, limit: eventLimit }
		return { tag: '', author: authorFilter, follows: false, limit: eventLimit }
	}, [filterMode, tagFilter, authorFilter, eventLimit])
	const {
		data: pagesData,
		isLoading,
		isError,
		error,
		refetch: doRefetch,
		isFetching,
		fetchNextPage,
		fetchPreviousPage,
		hasNextPage,
		hasPreviousPage,
	} = useInfiniteQuery({
		queryKey: [
			'enhanced-infinite',
			notesOpts.tag || '',
			notesOpts.author || '',
			notesOpts.follows ? 'follows' : 'all',
			filterMode === 'follows' ? (currentUserPk || 'anon') : '',
			(SUPPORTED_KINDS as any).join(','),
		],
		initialPageParam: { since: undefined as number | undefined, until: undefined as number | undefined },
		getNextPageParam: (lastPage: any) => (lastPage?.oldest ? { until: Math.max(0, (lastPage.oldest as number) - 1) } : undefined),
		getPreviousPageParam: (firstPage: any) => (firstPage?.newest ? { since: Math.max(0, (firstPage.newest as number) + 1) } : undefined),
		queryFn: async ({ pageParam }: any) => {
			const { fetchEnhancedNotesPage } = await import('@/queries/enhanced-firehose')
			const pageSize = 4
				const res = await fetchEnhancedNotesPage(
					filterMode === 'follows'
						? { tag: '', author: '', follows: true, kinds: [...SUPPORTED_KINDS] as any }
						: { tag: notesOpts.tag || '', author: notesOpts.author || '', follows: false, kinds: [...SUPPORTED_KINDS] as any },
					{ since: pageParam?.since, until: pageParam?.until, pageSize },
				)
				return res
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchInterval: false,
		staleTime: Infinity,
	} as any)
	const flatPages = useMemo(() => (pagesData?.pages ? (pagesData.pages as any[]).flatMap((p: any) => p.items || []) : []), [pagesData])
	const data = allLoadedEvents.length > 0 ? allLoadedEvents : flatPages
	const { data: authorMeta } = useQuery({ ...authorQueryOptions(authorFilter), enabled: !!authorFilter }) as any

	// Helper to optimistically prepend a just-published event to the feed
	const addToFeed = (wrapped: EnhancedFetchedNDKEvent) => {
		try {
			const id = (((wrapped.event as any)?.id as string) || '').trim()
			if (!id) return
			setAllLoadedEvents((prev) => {
				if (prev.some((w) => ((((w.event as any)?.id as string) || '').trim()) === id)) return prev
				return [wrapped, ...prev]
			})
		} catch {}
	}

	// Expose a global hook so components like NoteView can push freshly created events into the feed immediately
	useEffect(() => {
		;(window as any).__nostrAddToFeed = (ev: any) => {
			try {
				const eventObj = ev && ev.event ? ev.event : ev
				if (!eventObj) return
				const wrapped: EnhancedFetchedNDKEvent = {
					event: eventObj,
					fetchedAt: Date.now(),
					relaysSeen: [],
					isFromCache: false,
					priority: 1,
				} as any
				addToFeed(wrapped)
			} catch {}
		}
		return () => {
			try {
				if ((window as any).__nostrAddToFeed) delete (window as any).__nostrAddToFeed
			} catch {}
		}
	}, [])

	// Override refetch to apply pending live notes when available
	const refetch = async () => {
		if (pendingNewNotes.length > 0) {
			applyPendingNotes()
			// Schedule another scroll-to-top to override any delayed scroll restoration in callers
			setTimeout(() => {
				try {
					scrollToTop()
				} catch {}
			}, 120)
			return { data: allLoadedEvents } as any
		}
		return await doRefetch()
	}
	// React to auth store changes (login/logout) to keep currentUserPk in sync
	const { isAuthenticated: authIsAuthenticated, user: authUser } = useStore(authStore) as any
	const { data: currentUserMeta } = useQuery({
		...authorQueryOptions(currentUserPk),
		enabled: !!currentUserPk && filterMode === 'follows',
	}) as any
	const currentUserDisplayName = currentUserMeta?.name || (currentUserPk ? currentUserPk.slice(0, 8) + '…' : '')
	// Track when the user's follow list cannot be found (for follows view)
	const [followsListNotFound, setFollowsListNotFound] = useState(false)
	// Get the newest note timestamp for display
	const newestNoteTimestamp = data && data.length > 0 ? data[0].fetchedAt : null

	// Helper function to update the URL with the latest timestamp
	const updateLatestTimestampInUrl = (timestamp: number) => {
		try {
			if (typeof window === 'undefined') return
			const url = new URL(window.location.href)
			const unixTimestamp = Math.floor(timestamp / 1000) // Convert ms to seconds
			url.searchParams.set('latest', unixTimestamp.toString())
			const target = url.pathname.startsWith('/nostr')
				? url.search
					? `/nostr${url.search}`
					: '/nostr'
				: url.search
					? `${url.pathname}${url.search}`
					: url.pathname
			window.history.replaceState({}, '', target)
		} catch {}
	}

	// View state management
	const currentViewKey = getViewStateKey(filterMode, tagFilter, authorFilter)
	const [viewStates, setViewStates] = useState<Record<string, ViewState>>({})
	const [lastRefreshTimestamp, setLastRefreshTimestamp] = useState<number | null>(null)
	const [hasNewerNotes, setHasNewerNotes] = useState(false)
	// Live updates: hold incoming notes and their authors until user loads them
	const [pendingNewNotes, setPendingNewNotes] = useState<EnhancedFetchedNDKEvent[]>([])
	const [newNoteAuthors, setNewNoteAuthors] = useState<string[]>([])
	// When a feed appears empty, force a loading state and trigger background refetches instead of falling back to Global
	const [forceFeedLoading, setForceFeedLoading] = useState(false)
	const emptyViewKeyRef = useRef<string>('')
	const emptyRetryRef = useRef<number>(0)

	const [showTop, setShowTop] = useState(false)
	// Overlay state for loading a new tag
	const [pendingTag, setPendingTag] = useState<string | null>(null)
	const [showTagOverlay, setShowTagOverlay] = useState(false)
	const [showHomeNavigation, setShowHomeNavigation] = useState(false)
	const [logoButtonHighlighted, setLogoButtonHighlighted] = useState(false)
	// Composer state
	const [isComposeOpen, setIsComposeOpen] = useState(false)
	const [composeText, setComposeText] = useState('')
	const [composeImages, setComposeImages] = useState<File[]>([])
	const [showEmojiPicker, setShowEmojiPicker] = useState(false)
	const [isComposeLarge, setIsComposeLarge] = useState(false)
	// Track lg breakpoint to position floating buttons relative to feed panel
	const [isLg, setIsLg] = useState(false)
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			const mql = window.matchMedia('(min-width: 1024px)')
			const handler = (e: MediaQueryListEvent | MediaQueryList) => {
				// Support both modern and older APIs
				const matches = 'matches' in e ? (e as MediaQueryListEvent).matches : (e as MediaQueryList).matches
				setIsLg(matches)
			}
			// Initialize
			setIsLg(mql.matches)
			if (typeof mql.addEventListener === 'function') {
				mql.addEventListener('change', handler as any)
				return () => mql.removeEventListener('change', handler as any)
			} else if (typeof (mql as any).addListener === 'function') {
				;(mql as any).addListener(handler)
				return () => (mql as any).removeListener(handler)
			}
		} catch {}
	}, [])
	// Compute horizontal offset for floating buttons: on lg with sidebar visible, shift by sidebar width (20rem)
	const floatingRight = isLg ? (openThreadId ? '3.5rem' : 'calc(20rem + 3.5rem)') : '3.5rem'

	// Load view state when switching views
	useEffect(() => {
		// Reset event limit to a value that ensures the feed will overflow the viewport
		setEventLimit(getInitialFeedLimit())
		// Clear accumulated events when view changes
		setAllLoadedEvents([])
		// Reset prefetch tracker for the new view
		lastPrefetchLimitRef.current = 0

		const savedState = loadViewState(currentViewKey)
		if (savedState) {
			setLastRefreshTimestamp(savedState.lastRefreshTimestamp)
			// Restore scroll position after data loads
			if (savedState.scrollPosition > 0) {
				setTimeout(() => {
					window.scrollTo({ top: savedState.scrollPosition, behavior: 'auto' })
				}, 100)
			}
		} else {
			setLastRefreshTimestamp(null)
		}
	}, [currentViewKey])

	// Update URL with latest timestamp when data loads or changes
	useEffect(() => {
		if (newestNoteTimestamp && !isLoading) {
			updateLatestTimestampInUrl(newestNoteTimestamp)
		}
	}, [newestNoteTimestamp, isLoading])

	// Live subscription for new notes matching current view
	useEffect(() => {
		let sub: any | null = null
		let stopped = false
		;(async () => {
			try {
				const ndk = ndkActions.getNDK()
				if (!ndk) return
				const allRelays = await getAugmentedRelayUrls()
				const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
				// Start after newest currently shown to avoid duplicates
				const since = Math.floor((newestNoteTimestamp || Date.now()) / 1000)
				const filter: any = { kinds: SUPPORTED_KINDS as any, since }
				if (filterMode === 'hashtag' && (tagFilter || '').trim()) {
					;(filter as any)['#t'] = [(tagFilter || '').trim().toLowerCase()]
				}
				if (authorFilter && filterMode !== 'hashtag' && filterMode !== 'reactions' && !(filterMode === 'follows')) {
					filter.authors = [authorFilter]
				}
				if (filterMode === 'follows') {
					try {
						const user = await ndkActions.getUser()
						const pubkey = (user as any)?.pubkey as string | undefined
						if (!pubkey) return
						const contactsFilter: any = { kinds: [3], authors: [pubkey], limit: 1 }
						const contacts = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
						const arr = Array.from(contacts)
						if (arr.length > 0) {
							const latest = arr.sort((a, b) => ((b as any).created_at ?? 0) - ((a as any).created_at ?? 0))[0] as any
							const pTags = (latest?.tags || []).filter((t: any) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string')
							let follows: string[] = pTags.map((t: any) => t[1])
							// Always include the logged-in user's own pubkey in the follows live subscription
							if (pubkey && !follows.includes(pubkey)) follows = [...follows, pubkey]
							if (follows.length > 0) (filter as any).authors = follows
						}
					} catch {}
				}
				if (stopped) return
				sub = (ndk as any).subscribe(filter, undefined, relaySet)
				sub.on('event', (ev: any) => {
					try {
						const id = (ev as any)?.id || ''
						if (!id) return
						setPendingNewNotes((prev) => {
							const existsInPending = prev.some((w) => (((w.event as any)?.id as string) || '') === id)
							const existsInLoaded = (allLoadedEvents || []).some((w) => (((w.event as any)?.id as string) || '') === id)
							if (existsInPending || existsInLoaded) return prev
							const wrapped: EnhancedFetchedNDKEvent = {
								event: ev,
								fetchedAt: Date.now(),
								relaysSeen: [],
								isFromCache: false,
								priority: 1,
							}
							return [wrapped, ...prev]
						})
						setNewNoteAuthors((prev) => {
							const pk = (ev as any)?.pubkey as string
							if (!pk || prev.includes(pk)) return prev
							return [pk, ...prev].slice(0, 12)
						})
						setHasNewerNotes(true)
					} catch {}
				})
			} catch {}
		})()
		return () => {
			stopped = true
			try {
				sub?.stop?.()
			} catch {}
		}
	}, [filterMode, tagFilter, authorFilter, newestNoteTimestamp])

	// Update allLoadedEvents when infinite pages data arrives
	useEffect(() => {
		const flat = pagesData?.pages ? (pagesData.pages as any[]).flatMap((p: any) => p.items || []) : []
		setAllLoadedEvents(flat)
	}, [pagesData])

	// Save current view state before switching
	const saveCurrentViewState = () => {
		const scrollPosition = window.scrollY || document.documentElement.scrollTop || 0
		const state: ViewState = {
			lastRefreshTimestamp: lastRefreshTimestamp || Date.now(),
			scrollPosition,
			cachedData: data,
		}
		saveViewState(currentViewKey, state)
	}

	// Detect newer notes compared to last refresh timestamp
	useEffect(() => {
		if (data && data.length > 0 && lastRefreshTimestamp) {
			const hasNewer = data.some((note) => note.fetchedAt > lastRefreshTimestamp)
			setHasNewerNotes(hasNewer)
		} else {
			setHasNewerNotes(false)
		}
	}, [data, lastRefreshTimestamp])

	const scrollToTop = () => {
		if (typeof window === 'undefined') return
		try {
			const targets: (Element | null | undefined)[] = [document.scrollingElement as Element | null, document.documentElement, document.body]
			targets.forEach((t) => {
				if (t && 'scrollTop' in t) {
					;(t as any).scrollTop = 0
				}
			})
			if (typeof window.scrollTo === 'function') {
				// use instant jump to ensure top
				window.scrollTo(0, 0)
			}
			// run a second pass on next frame to combat layout shifts
			requestAnimationFrame(() => {
				try {
					targets.forEach((t) => {
						if (t && 'scrollTop' in t) {
							;(t as any).scrollTop = 0
						}
					})
					if (typeof window.scrollTo === 'function') {
						window.scrollTo(0, 0)
					}
				} catch {}
			})
		} catch (_) {
			// noop
		}
	}

	// Apply pending live notes: prepend them and scroll to top
	const applyPendingNotes = () => {
		try {
			setOpenThreadId(null)
			setAllLoadedEvents((prev) => {
				const existingIds = new Set(prev.map((w) => ((w.event as any)?.id as string) || ''))
				const fresh = pendingNewNotes.filter((w) => {
					const id = ((w.event as any)?.id as string) || ''
					return id && !existingIds.has(id)
				})
				return [...fresh, ...prev]
			})
			setPendingNewNotes([])
			setNewNoteAuthors([])
			setHasNewerNotes(false)
			scrollToTop()
		} catch {}
	}

	// Helper to force immediate refresh after switching feed modes
	const scheduleImmediateRefresh = () => {
		try {
			setSpinnerSettled(false)
			setOpenThreadId(null)
			setAllLoadedEvents([])
			setEventLimit(getInitialFeedLimit())
			scrollToTop()
			setTimeout(() => {
				try {
					doRefetch()
				} catch {}
			}, 30)
		} catch {}
	}

	// Unified reload button behavior
	const reloadFeed = async () => {
		if (pendingNewNotes.length > 0) {
			applyPendingNotes()
			return
		}
		// Preserve scroll position when refreshing
		const currentScrollPosition = window.scrollY || document.documentElement.scrollTop || 0
		setOpenThreadId(null)
		setLastRefreshTimestamp(Date.now())
		setHasNewerNotes(false)
		// Force reactions to refresh for currently visible notes
		setReactionsReloadToken((t) => t + 1)
		const result = await refetch()
		// Update URL with newest timestamp after successful refetch
		if (result.data && result.data.length > 0) {
			updateLatestTimestampInUrl(result.data[0].fetchedAt)
		}
		// Restore scroll position after content update
		setTimeout(() => {
			window.scrollTo({ top: currentScrollPosition, behavior: 'auto' })
		}, 50)
	}

	useEffect(() => {
		// Only scroll to top on initial page load, not on updates
		// This prevents the view from jumping when new events are loaded
		if (typeof window !== 'undefined' && window.history.state?.nostrInitialLoad !== true) {
			scrollToTop()
			// Mark that we've already done the initial scroll
			window.history.replaceState({ ...window.history.state, nostrInitialLoad: true }, '')
		}

		// Load current user pubkey for follows mode header
		;(async () => {
			try {
				const u = await ndkActions.getUser()
				if (u?.pubkey) {
					setCurrentUserPk(u.pubkey)
					// If landing fresh (no history), no explicit view in URL, and no tag/user/thread specified,
					// default to follows feed for logged-in users
					try {
						if (typeof window !== 'undefined') {
							const url = new URL(window.location.href)
							const hasExplicitView = url.searchParams.has('view')
							const hasTag = !!(url.searchParams.get('tag') || '').trim()
							const hasUser = !!(url.searchParams.get('user') || '').trim()
							const hasThread = !!(url.searchParams.get('threadview') || '').trim()
							if (isAtStartOfHistory() && !hasExplicitView && !hasTag && !hasUser && !hasThread) {
								// Set local state first to render immediately
								setFilterMode('all')
								// Update URL to reflect global view
								url.searchParams.set('view', 'global')
								url.searchParams.delete('emoji')
								url.searchParams.delete('tag')
								const target = url.pathname.startsWith('/nostr')
									? url.search
										? `/nostr${url.search}`
										: '/nostr'
									: url.search
										? `${url.pathname}${url.search}`
										: url.pathname
								window.history.replaceState({ ...window.history.state, nostrInitialLoad: true }, '', target)
								// Trigger listeners to sync state from URL effect without adding history
								window.dispatchEvent(new PopStateEvent('popstate'))
							}
						}
					} catch {}
				}
			} catch {}
		})()
	}, [])

	// Keep currentUserPk synced with auth store (login/logout)
	useEffect(() => {
		try {
			const nextPk = authIsAuthenticated && (authUser as any)?.pubkey ? (authUser as any).pubkey : ''
			if (nextPk !== currentUserPk) {
				setCurrentUserPk(nextPk)
				// If user logged out while in follows, downgrade to global and clean URL
				if (!nextPk && filterMode === 'follows') {
					setFilterMode('all')
					if (typeof window !== 'undefined') {
						const url = new URL(window.location.href)
						// If view was explicitly set to follows, remove it
						if ((url.searchParams.get('view') || '').toLowerCase() === 'follows') {
							url.searchParams.delete('view')
							const target = url.pathname.startsWith('/nostr')
								? url.search
									? `/nostr${url.search}`
									: '/nostr'
								: url.search
									? `${url.pathname}${url.search}`
									: url.pathname
							window.history.replaceState({}, '', target)
							window.dispatchEvent(new PopStateEvent('popstate'))
						}
					}
				}
			}
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authIsAuthenticated, (authUser as any)?.pubkey])

	// When a user logs in during the session, switch to follows if appropriate
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			// If we now have a currentUserPk and we're not explicitly in another constrained view,
			// prefer switching to follows to satisfy the UX requirement that follows appears after login.
			if (currentUserPk) {
				const url = new URL(window.location.href)
				const hasExplicitView = url.searchParams.has('view')
				const hasTag = !!(url.searchParams.get('tag') || '').trim()
				const hasUser = !!(url.searchParams.get('user') || '').trim()
				const hasThread = !!(url.searchParams.get('threadview') || '').trim()
				const requestedView = (url.searchParams.get('view') || '').toLowerCase()
				// If the user explicitly asked for reactions or hashtag, do not override.
				const isSpecial = requestedView === 'reactions' || requestedView === 'hashtag'
				if (!hasTag && !hasUser && !hasThread && !isSpecial) {
					// If there was no explicit view or it was previously downgraded to 'all', switch to follows
					if (!hasExplicitView || requestedView === 'all' || requestedView === '') {
						setFilterMode('all')
						url.searchParams.set('view', 'global')
						url.searchParams.delete('emoji')
						url.searchParams.delete('tag')
						const target = url.pathname.startsWith('/nostr')
							? url.search
								? `/nostr${url.search}`
								: '/nostr'
							: url.search
								? `${url.pathname}${url.search}`
								: url.pathname
						window.history.replaceState({}, '', target)
						window.dispatchEvent(new PopStateEvent('popstate'))
					}
				}
			}
		} catch {}
	}, [currentUserPk])

	// Background prefetch for Follows feed so it loads while user browses other views
	useEffect(() => {
		try {
			if (!currentUserPk) return
			// If already on follows view, the main query is active; skip background prefetch
			if (filterMode === 'follows') return

			let stopped = false
			const prefetch = () => {
				if (stopped) return
				try {
					// Prefetch with a reasonable batch size so switching is instant
					const limit = Math.max(30, eventLimit)
					queryClient.prefetchQuery({
						...enhancedNotesQueryOptions({ tag: '', author: '', follows: true, limit, cacheKey: currentUserPk || 'anon' }),
					})
				} catch {}
			}

			// Prefetch immediately on login or view change
			prefetch()
			// And keep it warm every 5 minutes in the background to reduce continuous reloading
			const id = window.setInterval(prefetch, 5 * 60 * 1000)
			return () => {
				stopped = true
				window.clearInterval(id)
			}
		} catch {}
	}, [currentUserPk, filterMode, eventLimit, queryClient])

	// Apply tag/user/view/threadview from URL when location changes
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			const searchStr = window.location.search || ''
			const sp = new URLSearchParams(searchStr)
			const incomingTag = (sp.get('tag') || '').replace(/^#/, '').trim().toLowerCase()
			const incomingUser = (sp.get('user') || '').trim()
			const incomingView = (sp.get('view') || '').trim().toLowerCase()
			const incomingThread = (sp.get('threadview') || '').trim()
			const incomingEmojiRaw = sp.get('emoji') || ''
			const incomingEmoji = incomingEmojiRaw
			// sync filter mode from URL (?view) or presence of ?emoji
			const desiredMode =
				incomingView === 'threads'
					? 'threads'
					: incomingView === 'originals'
						? 'originals'
						: incomingView === 'reactions' || (!!incomingEmoji && incomingEmoji.trim() !== '')
							? 'reactions'
							: incomingView === 'hashtag' || (!!incomingTag && incomingTag !== '')
								? 'hashtag'
								: incomingView === 'follows'
									? 'follows'
									: 'all'
			// Prevent follows mode when logged out
			const guardedDesiredMode = desiredMode === 'follows' && !currentUserPk ? 'all' : desiredMode
			if (guardedDesiredMode !== filterMode) {
				setFilterMode(guardedDesiredMode as any)
				// If we downgraded from follows to all, also clean the URL
				try {
					if (typeof window !== 'undefined' && desiredMode === 'follows' && !currentUserPk) {
						const url = new URL(window.location.href)
						url.searchParams.delete('view')
						const target = url.pathname.startsWith('/nostr')
							? url.search
								? `/nostr${url.search}`
								: '/nostr'
							: url.search
								? `${url.pathname}${url.search}`
								: url.pathname
						window.history.replaceState({}, '', target)
						window.dispatchEvent(new PopStateEvent('popstate'))
					}
				} catch {}
			}
			// Sync selected emoji from URL when present
			if ((incomingEmoji || '') !== selectedEmoji) {
				setSelectedEmoji(incomingEmoji || '')
			}
			// Sync thread open state from ?threadview
			if (incomingThread && incomingThread !== openThreadId) {
				setOpenThreadId(incomingThread)
				// Also record this as the last clicked to keep highlight consistent (and persisted)
				setClickedEventId(incomingThread)
			} else if (!incomingThread && openThreadId) {
				setOpenThreadId(null)
			}
			if (incomingTag && incomingTag !== tagFilter.toLowerCase()) {
				setPendingTag(incomingTag)
				setTagFilter(incomingTag)
				setTagFilterInput('#' + incomingTag)
			}
			// Handle "own" view: show only current user's notes
			if (incomingView === 'own') {
				if (currentUserPk && authorFilter !== currentUserPk) {
					setAuthorFilter(currentUserPk)
				}
			} else if (incomingUser !== authorFilter) {
				setAuthorFilter(incomingUser)
			}
			// Only auto-scroll to top on general navigation, not when viewing a thread
			if (!incomingThread) {
				scrollToTop()
			}
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.href])

	// When tag view is active or a tag is present in the URL, remove all other query params (keep only `tag`).
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			const url = new URL(window.location.href)
			const rawTag = (url.searchParams.get('tag') || '').trim()
			if (!rawTag) return
			let changed = false
			// Remove everything except 'tag'
			for (const key of Array.from(url.searchParams.keys())) {
				if (key !== 'tag') {
					url.searchParams.delete(key)
					changed = true
				}
			}
			if (changed) {
				const target = url.pathname.startsWith('/nostr')
					? url.search
						? `/nostr${url.search}`
						: '/nostr'
					: url.search
						? `${url.pathname}${url.search}`
						: url.pathname
				window.history.replaceState({}, '', target)
				window.dispatchEvent(new PopStateEvent('popstate'))
			}
		} catch {}
	}, [location.href])

	// When navigating to a specific user feed, force a refresh to load newest posts from that user
	useEffect(() => {
		try {
			// Only trigger when an explicit author filter is active (and not hashtag or reactions views)
			if (authorFilter && filterMode !== 'hashtag' && filterMode !== 'reactions') {
				setSpinnerSettled(false)
				setOpenThreadId(null)
				setAllLoadedEvents([])
				setEventLimit(getInitialFeedLimit())
				// Scroll to top for fresh context
				scrollToTop()
				// Trigger a refetch from network
				try {
					doRefetch()
				} catch {}
			}
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [authorFilter])

	// Immediately refresh when feed mode changes (e.g., user clicks a feed mode button)
	useEffect(() => {
		try {
			// Reset view and fetch fresh items for the new mode
			setSpinnerSettled(false)
			setOpenThreadId(null)
			setAllLoadedEvents([])
			setEventLimit(getInitialFeedLimit())
			scrollToTop()
			// Trigger an immediate refetch
			try {
				doRefetch()
			} catch {}
		} catch {}
		// We intentionally depend only on filterMode to catch user-driven changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filterMode])

	// Previously: auto-fallback to global view if follows mode returned empty data.
	// This caused unintended switching from Follows to Global during transient empty states.
	// We now keep the Follows view selected even if it currently has no items.
	useEffect(() => {
		if (filterMode === 'follows' && !isLoading && data && Array.isArray(data) && data.length === 0 && currentUserPk) {
			console.debug('Follows feed currently empty; staying on Follows view')
		}
	}, [filterMode, isLoading, data, currentUserPk])

	// When in follows view, check for presence of the user's contact list (kind:3).
	// If no contact list is found, show a helpful message to the user.
	useEffect(() => {
		let cancelled = false
		;(async () => {
			try {
				// Reset flag by default
				setFollowsListNotFound(false)
				if (filterMode !== 'follows') return
				if (!currentUserPk) return
				const ndk = ndkActions.getNDK()
				if (!ndk) return
				const allRelays = await getAugmentedRelayUrls()
				const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
				const contactsFilter: any = { kinds: [3], authors: [currentUserPk], limit: 1 }
				try {
					const contacts = await ndk.fetchEvents(contactsFilter, undefined, relaySet)
					const arr = Array.from(contacts)
					if (!cancelled) {
						setFollowsListNotFound(arr.length === 0)
					}
				} catch (_) {
					if (!cancelled) setFollowsListNotFound(true)
				}
			} catch (_) {
				if (!cancelled) setFollowsListNotFound(false)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [filterMode, currentUserPk])

	// Generic handler: if current view returns no items, do not fall back to Global.
	// Instead, show a loading state and trigger a background refetch with limited retries.
	useEffect(() => {
		try {
			const currentKey = currentViewKey
			// Reset retry counter if the view key changed
			if (emptyViewKeyRef.current !== currentKey) {
				emptyViewKeyRef.current = currentKey
				emptyRetryRef.current = 0
			}
			const noItems = Array.isArray(data) ? data.length === 0 : false
			if (noItems && !isLoading && !isFetching) {
				setForceFeedLoading(true)
				if (emptyRetryRef.current < 3) {
					emptyRetryRef.current += 1
					// Add delay before refetch to prevent continuous reloading
					setTimeout(() => {
						try {
							doRefetch()
						} catch {}
					}, 2000) // 2 second delay between retries
				}
			} else if (!noItems) {
				// Once we have items, clear the forced loading state
				setForceFeedLoading(false)
			}
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentViewKey, data, isLoading, isFetching])

	// Ensure 'tag' is not present in the URL when not in hashtag view
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			if (filterMode === 'hashtag') return
			const url = new URL(window.location.href)
			if (url.searchParams.has('tag')) {
				url.searchParams.delete('tag')
				const target = url.pathname.startsWith('/nostr')
					? url.search
						? `/nostr${url.search}`
						: '/nostr'
					: url.search
						? `${url.pathname}${url.search}`
						: url.pathname
				window.history.replaceState({}, '', target)
				window.dispatchEvent(new PopStateEvent('popstate'))
			}
		} catch {}
	}, [filterMode])

	// Ref to track if we're already loading more content
	const isLoadingMoreRef = useRef(false)
	// Remember the last prefetch limit we requested to avoid duplicate work
	const lastPrefetchLimitRef = useRef<number>(0)

	useEffect(() => {
		if (typeof window === 'undefined') return

		// Reset the loading ref when fetch completes
		if (!isFetching && !isLoading) {
			isLoadingMoreRef.current = false
		}
	}, [isFetching, isLoading])

	useEffect(() => {
		if (typeof window === 'undefined') return

		let scrollTimeout: number | null = null

		const onScroll = () => {
			try {
				const threshold = window.innerHeight / 4
				setShowTop(window.scrollY > threshold)

				// Clear any pending timeout
				if (scrollTimeout) {
					window.clearTimeout(scrollTimeout)
				}

				// Debounce the scroll event (wait 100ms before checking)
				scrollTimeout = window.setTimeout(() => {
					// If a thread is open, do not attempt to load more feed items
					if (openThreadId) return
					// Check if we need to load more content
					if (!isFetching && !isLoading && !isLoadingMoreRef.current) {
						const scrollPosition = window.scrollY
						const windowHeight = window.innerHeight
						const documentHeight = document.documentElement.scrollHeight

 					// Calculate how far down the user has scrolled (as a percentage)
 					const scrollPercentage = (scrollPosition + windowHeight) / documentHeight

 					// When the user is 75% of the way to the bottom, load the next page (4 items)
 					if (scrollPercentage >= 0.75 && !isFetching && !isLoading && !isLoadingMoreRef.current) {
 						isLoadingMoreRef.current = true
 						fetchNextPage().finally(() => {
 							isLoadingMoreRef.current = false
 						})
 					}
					}
				}, 100)
			} catch (_) {
				// noop
			}
		}

		onScroll()
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => {
			window.removeEventListener('scroll', onScroll)
			if (scrollTimeout) {
				window.clearTimeout(scrollTimeout)
			}
		}
	}, [isFetching, isLoading, openThreadId, eventLimit, notesOpts])

	// Overscroll edge triggers to load in appropriate direction
	const topOverscrollRef = useRef<{count:number; lastTs:number}>({ count: 0, lastTs: 0 })
	const bottomOverscrollRef = useRef<{count:number; lastTs:number}>({ count: 0, lastTs: 0 })
	const touchStartYRef = useRef<number | null>(null)
	const topEdgeLoadingRef = useRef(false)

	const triggerLoadAtTop = async () => {
		if (openThreadId) return
		if (topEdgeLoadingRef.current) return
		topEdgeLoadingRef.current = true
		try {
			if (pendingNewNotes.length > 0) {
				applyPendingNotes()
			} else {
				await fetchPreviousPage()
			}
		} catch {}
		finally {
			setTimeout(() => {
				topEdgeLoadingRef.current = false
			}, 150)
		}
	}

	const triggerLoadAtBottom = () => {
		if (openThreadId) return
		if (isLoadingMoreRef.current) return
		isLoadingMoreRef.current = true
		fetchNextPage().finally(() => {
			isLoadingMoreRef.current = false
		})
	}

	useEffect(() => {
		if (typeof window === 'undefined') return
		const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 1
		const atBottom = () => {
			const scrollPosition = window.scrollY || document.documentElement.scrollTop || 0
			const windowHeight = window.innerHeight
			const documentHeight = document.documentElement.scrollHeight
			return scrollPosition + windowHeight >= documentHeight - 2
		}
		const handleWheel = (e: WheelEvent) => {
			const now = Date.now()
			if (now - topOverscrollRef.current.lastTs > 800) topOverscrollRef.current.count = 0
			if (now - bottomOverscrollRef.current.lastTs > 800) bottomOverscrollRef.current.count = 0
			if (atTop() && e.deltaY < -5) {
				topOverscrollRef.current.count++
				topOverscrollRef.current.lastTs = now
				if (topOverscrollRef.current.count >= 3) {
					triggerLoadAtTop()
					topOverscrollRef.current.count = 0
				}
			} else if (atBottom() && e.deltaY > 5) {
				bottomOverscrollRef.current.count++
				bottomOverscrollRef.current.lastTs = now
				if (bottomOverscrollRef.current.count >= 2) {
					triggerLoadAtBottom()
					bottomOverscrollRef.current.count = 0
				}
			}
		}
		const onTouchStart = (e: TouchEvent) => {
			touchStartYRef.current = e.touches && e.touches.length ? e.touches[0].clientY : null
		}
		const onTouchMove = (e: TouchEvent) => {
			const y0 = touchStartYRef.current
			if (y0 == null) return
			const y = e.touches && e.touches.length ? e.touches[0].clientY : y0
			const dy = y - y0
			const now = Date.now()
			if (now - topOverscrollRef.current.lastTs > 900) topOverscrollRef.current.count = 0
			if (now - bottomOverscrollRef.current.lastTs > 900) bottomOverscrollRef.current.count = 0
			if (atTop() && dy > 40) {
				topOverscrollRef.current.count++
				topOverscrollRef.current.lastTs = now
				if (topOverscrollRef.current.count >= 1) {
					triggerLoadAtTop()
					topOverscrollRef.current.count = 0
				}
			}
			if (atBottom() && dy < -40) {
				bottomOverscrollRef.current.count++
				bottomOverscrollRef.current.lastTs = now
				if (bottomOverscrollRef.current.count >= 1) {
					triggerLoadAtBottom()
					bottomOverscrollRef.current.count = 0
				}
			}
		}
		const onTouchEnd = () => {
			touchStartYRef.current = null
		}
		window.addEventListener('wheel', handleWheel, { passive: true })
		window.addEventListener('touchstart', onTouchStart, { passive: true })
		window.addEventListener('touchmove', onTouchMove, { passive: true })
		window.addEventListener('touchend', onTouchEnd, { passive: true })
		return () => {
			window.removeEventListener('wheel', handleWheel as any)
			window.removeEventListener('touchstart', onTouchStart as any)
			window.removeEventListener('touchmove', onTouchMove as any)
			window.removeEventListener('touchend', onTouchEnd as any)
		}
	}, [pendingNewNotes.length, openThreadId, isFetching, isLoading, eventLimit, notesOpts])

	// Use the accumulated events instead of just the latest query data
	const notes = allLoadedEvents.length > 0 ? allLoadedEvents : data || []
	// State for selected emoji in reactions view (must be declared before use in useMemo)
	const [selectedEmoji, setSelectedEmoji] = useState<string>('')
 // Token to force update of reactions when feed reloads
	const [reactionsReloadToken, setReactionsReloadToken] = useState(0)

	// Reactions fetching based on currently visible notes
	// When in reactions view, use a stable reference to prevent continuous reloading
	const noteIdsForReactions = useMemo(() => {
		const noteIds = (notes as EnhancedFetchedNDKEvent[]).map((w) => (w.event as any)?.id as string).filter(Boolean)
		// In reactions view, we want to prevent reloading unless the filter criteria actually changes
		// The reactions query should only reload when selectedEmoji changes, not when new notes are added
		return noteIds
	}, filterMode === 'reactions' ? [selectedEmoji] : [notes])
 const { data: reactionsMap } = useQuery({
		...reactionsQueryOptions(noteIdsForReactions, selectedEmoji || undefined, reactionsReloadToken),
	}) as any

	const { filtered, counts } = useMemo(() => {
		const all = notes as EnhancedFetchedNDKEvent[]
		// Build a set of rootIds that have at least one reply
		const rootsWithReplies = new Set<string>()
		for (const w of all) {
			const e: any = w.event as any
			// Treat as reply if:
			// - kind 1111 (explicit reply kind), OR
			// - kind 1 with any 'e' tags (even without explicit 'reply' marker)
			const eTags = Array.isArray(e.tags)
				? (e.tags as any[]).filter((t: any) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string')
				: []
			const hasReplyMarker = Array.isArray(e.tags)
				? (e.tags as any[]).some((t: any) => Array.isArray(t) && t[0] === 'e' && t[3] === 'reply')
				: false
			const isReply = e.kind === 1111 || (e.kind === 1 && (hasReplyMarker || eTags.length > 0))
			if (isReply) {
				const rid = (findRootFromETags as any)?.(e) || eTags.find((t: any) => t[3] === 'root')?.[1] || eTags[0]?.[1]
				if (typeof rid === 'string' && rid) rootsWithReplies.add(rid)
			}
		}
		const isRootFn = (e: any) => {
			if (e.kind !== 1) return false
			const eTags = Array.isArray(e.tags)
				? (e.tags as any[]).filter((t: any) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string')
				: []
			// Original post (first post in a thread) should have no e-tags
			return eTags.length === 0
		}
		const roots = all.filter((w) => {
			const e: any = w.event as any
			const id = e.id as string | undefined
			if (!id) return false
			return isRootFn(e)
		})
		const withThreads = roots.filter((w) => rootsWithReplies.has(((w.event as any).id as string) || ''))
		const originals = roots.filter((w) => !rootsWithReplies.has(((w.event as any).id as string) || ''))
		return {
			filtered: (() => {
				// When in reactions mode, use all notes as base so we can filter by reactions later
				let base = filterMode === 'reactions' ? all : filterMode === 'all' ? all : filterMode === 'threads' ? withThreads : originals
				base = base.filter((w) => {
					const e: any = w.event as any
					const tags = Array.isArray(e.tags) ? (e.tags as any[]) : []
					const hasNSFWTag = tags.some((t) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string' && t[1].toLowerCase() === 'nsfw')
					return !hasNSFWTag
				})
				return base
			})(),
			counts: {
				all: all.length,
				threads: withThreads.length,
				originals: originals.length,
			},
		}
	}, [data, filterMode])

	// Periodically clean up stale events from cache to free memory
	useEffect(() => {
		// Run cache cleanup every 5 minutes (adjust this interval as needed)
		const CLEANUP_INTERVAL = 1000 * 60 * 5 // 5 minutes

		// Run initial cleanup
		const initialCleanup = () => {
			try {
				// Use 1 hour as the max age for stale events (adjust as needed)
				const MAX_AGE = 1000 * 60 * 60 // 1 hour
				const removedCount = cleanupStaleEvents(MAX_AGE)

				// Update stats for debugging
				if (removedCount > 0) {
					setLastCleanupStats({
						timestamp: Date.now(),
						removedCount,
					})
					console.log(`Cache cleanup: removed ${removedCount} stale events`)
				}
			} catch (error) {
				console.error('Error during cache cleanup:', error)
			}
		}

		// Run cleanup periodically
		const cleanupInterval = setInterval(initialCleanup, CLEANUP_INTERVAL)

		// Run initial cleanup after a short delay
		const initialTimeout = setTimeout(initialCleanup, 10000)

		// Clean up intervals on unmount
		return () => {
			clearInterval(cleanupInterval)
			clearTimeout(initialTimeout)
		}
	}, [])

	// Stop spinner animation when the feed + thread view have committed a re-render
	useEffect(() => {
		if (!loadingMode) return
		// Wait for commit to DOM then mark as settled (stop spinning)
		const id = requestAnimationFrame(() => setSpinnerSettled(true))
		return () => cancelAnimationFrame(id)
	}, [filtered, loadingMode])

	// After spinner settles, close the drawer automatically
	useEffect(() => {
		if (!loadingMode) return
		if (!isFiltersOpen) return
		if (spinnerSettled) {
			uiActions.closeDrawer('filters')
		}
	}, [spinnerSettled, loadingMode, isFiltersOpen])

	// Clear pending tag marker once the fetch for it completes (no overlay)
	useEffect(() => {
		if (pendingTag === null) return
		if (!isFetching && tagFilter.replace(/^#/, '') === pendingTag) {
			setPendingTag(null)
		}
	}, [isFetching, tagFilter, pendingTag])

	// Now that all hooks are called, avoid blanking the page; show inline messages only
	const showInitialSpinner = isLoading
	const showError = isError

	return (
		<div className="relative items-center">
			<div className="text-4xl font-heading sticky top-0 lg:top-20 z-30 m-0 p-3 px-4 bg-secondary-black text-secondary flex justify-between items-center">
				{/* Left header: replace Firehose with thread/user/hashtag when active */}
				<span className="flex items-center gap-0 justify-start">
					{/* Home button - site logo button matching main page */}
					<Link
						to="/"
						title="Go to home page"
						aria-label="Go to home page"
						className="lg:hidden"
						onClick={() => {
							if (showHomeNavigation) {
								setShowHomeNavigation(false)
							} else {
								setShowHomeNavigation(true)
							}
						}}
					>
						{config?.appSettings?.picture && (
							<img src={config.appSettings.picture} alt={config.appSettings.displayName} className="w-16 px-2" />
						)}
					</Link>
					{/* Back button - visible in all views except at start of history */}
					{!showHomeNavigation && (
						<Button
							variant="primary"
							className="p-2 mx-2 h-10 w-10 lg:h-8 lg:w-8 flex"
							title="Go back"
							aria-label="Go back"
							disabled={!canGoBack()}
							onClick={() => {
								try {
									if (openThreadId) {
										// Close thread view and restore scroll
										setOpenThreadId(null)
										setClickedEventId(null)
										try {
											const url = new URL(window.location.href)
											url.searchParams.delete('threadview')
											const target = url.pathname.startsWith('/nostr')
												? url.search
													? `/nostr${url.search}`
													: '/nostr'
												: url.search
													? `${url.pathname}${url.search}`
													: url.pathname
											window.history.replaceState({}, '', target)
											window.dispatchEvent(new PopStateEvent('popstate'))
										} catch {}
										if (feedScrollY != null) {
											window.scrollTo({ top: feedScrollY })
											setFeedScrollY(null)
										}
									} else {
										goBackWithTimeLimit()
									}
								} catch {}
							}}
						>
							<ArrowLeft className="h-8 w-8 lg:h-4 lg:w-4" />
						</Button>
					)}
					{showHomeNavigation ? (
						<div className="flex items-center gap-2">
							<Link to="/" className="hover:text-secondary text-sm">
								Home
							</Link>
							<div className="flex gap-4 ml-4">
								<Link to="/products" className="hover:text-secondary text-sm">
									Products
								</Link>
								<Link to="/community" className="hover:text-secondary text-sm">
									Community
								</Link>
								<Link
									to="/nostr"
									search={{
										view: authIsAuthenticated ? 'follows' : undefined,
									}}
									className="hover:text-secondary text-sm"
								>
									Nostr
								</Link>
							</div>
						</div>
					) : openThreadId ? (
						<span className="flex items-center gap-2">
							Thread
							<Button
								variant="primary"
								className="px-2 py-1 h-6 flex gap-1 lg:hidden"
								onClick={() => {
									try {
										setOpenThreadId(null)
										setClickedEventId(null)
										// Remove threadview from URL without navigating back
										try {
											const url = new URL(window.location.href)
											url.searchParams.delete('threadview')
											const target = url.pathname.startsWith('/nostr')
												? url.search
													? `/nostr${url.search}`
													: '/nostr'
												: url.search
													? `${url.pathname}${url.search}`
													: url.pathname
											window.history.replaceState({}, '', target)
											window.dispatchEvent(new PopStateEvent('popstate'))
										} catch {}
										if (feedScrollY != null) {
											window.scrollTo({ top: feedScrollY })
											setFeedScrollY(null)
										}
									} catch {}
								}}
								title="Close thread"
								aria-label="Close thread"
							>
								<CollapseVerticalIcon className="h-4 w-4" />
							</Button>
							<Button
								variant="primary"
								className={`p-2 h-8 w-8 flex ${hasNewerNotes ? 'animate-pulse' : ''}`}
								onClick={async () => {
									// Preserve scroll position when refreshing
									const currentScrollPosition = window.scrollY || document.documentElement.scrollTop || 0
									setOpenThreadId(null)
									setLastRefreshTimestamp(Date.now())
									setHasNewerNotes(false)
									const result = await refetch()
									// Update URL with newest timestamp after successful refetch
									if (result.data && result.data.length > 0) {
										updateLatestTimestampInUrl(result.data[0].fetchedAt)
									}
									// Restore scroll position after content update
									setTimeout(() => {
										window.scrollTo({ top: currentScrollPosition, behavior: 'auto' })
									}, 50)
								}}
								title="Reload feed"
								aria-label="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
							</Button>
							{newestNoteTimestamp && <span className="text-xs text-muted-foreground ml-2">{formatTimeAgo(newestNoteTimestamp)}</span>}
						</span>
					) : authorFilter?.trim() ? (
						<span className="gap-2 items-center flex">
							@{(authorMeta?.name || authorFilter.slice(0, 8)) + (authorMeta?.name ? '' : '…')}
							<Button
								variant="primary"
								className={`p-2 h-8 w-8 flex ${hasNewerNotes ? 'animate-pulse' : ''}`}
								onClick={async () => {
									// Preserve scroll position when refreshing
									const currentScrollPosition = window.scrollY || document.documentElement.scrollTop || 0
									setOpenThreadId(null)
									setLastRefreshTimestamp(Date.now())
									setHasNewerNotes(false)
									const result = await refetch()
									// Update URL with newest timestamp after successful refetch
									if (result.data && result.data.length > 0) {
										updateLatestTimestampInUrl(result.data[0].fetchedAt)
									}
									// Restore scroll position after content update
									setTimeout(() => {
										window.scrollTo({ top: currentScrollPosition, behavior: 'auto' })
									}, 50)
								}}
								title="Reload feed"
								aria-label="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
							</Button>
							{newestNoteTimestamp && <span className="text-xs text-muted-foreground ml-2">{formatTimeAgo(newestNoteTimestamp)}</span>}
						</span>
					) : filterMode === 'hashtag' && tagFilter?.trim() ? (
						<span className="flex gap-2 items-center">
							#{tagFilter.replace(/^#/, '')}
							<Button
								variant="primary"
								className={`p-2 h-8 w-8 flex ${hasNewerNotes ? 'animate-pulse' : ''}`}
								onClick={async () => {
									// Preserve scroll position when refreshing
									const currentScrollPosition = window.scrollY || document.documentElement.scrollTop || 0
									setOpenThreadId(null)
									setLastRefreshTimestamp(Date.now())
									setHasNewerNotes(false)
									const result = await refetch()
									// Update URL with newest timestamp after successful refetch
									if (result.data && result.data.length > 0) {
										updateLatestTimestampInUrl(result.data[0].fetchedAt)
									}
									// Restore scroll position after content update
									setTimeout(() => {
										window.scrollTo({ top: currentScrollPosition, behavior: 'auto' })
									}, 50)
								}}
								title="Reload feed"
								aria-label="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
							</Button>
							{newestNoteTimestamp && <span className="text-xs text-muted-foreground ml-2">{formatTimeAgo(newestNoteTimestamp)}</span>}
						</span>
					) : (
						<span className="flex items-center gap-2">
							{filterMode === 'follows' ? (
								<span>{currentUserDisplayName ? `${currentUserDisplayName} follow feed` : 'Follow feed'}</span>
							) : filterMode === 'reactions' ? (
								<span className="flex gap-1 items-center">Reactions {selectedEmoji && selectedEmoji}</span>
							) : filterMode === 'threads' ? (
								<span>Firehose - threads</span>
							) : filterMode === 'originals' ? (
								<span>Firehose - original posts</span>
							) : (
								<span>Firehose - global</span>
							)}
							<Button
								variant="primary"
								className={`p-2 h-10 w-10 flex ${hasNewerNotes ? 'animate-pulse' : ''}`}
								onClick={async () => {
									// Preserve scroll position when refreshing
									const currentScrollPosition = window.scrollY || document.documentElement.scrollTop || 0
									setOpenThreadId(null)
									setLastRefreshTimestamp(Date.now())
									setHasNewerNotes(false)
									const result = await refetch()
									// Update URL with newest timestamp after successful refetch
									if (result.data && result.data.length > 0) {
										updateLatestTimestampInUrl(result.data[0].fetchedAt)
									}
									// Restore scroll position after content update
									setTimeout(() => {
										window.scrollTo({ top: currentScrollPosition, behavior: 'auto' })
									}, 50)
								}}
								title="Reload feed"
								aria-label="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
							</Button>
							{newestNoteTimestamp && <span className="text-xs text-muted-foreground ml-2">{formatTimeAgo(newestNoteTimestamp)}</span>}
						</span>
					)}
				</span>
				<section className="items-center">
					{/*<div className="flex justify-center mt-8">*/}
					{/*	<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-16 h-16" />*/}
					{/*</div>*/}
					<div className="flex gap-2">
						{/*<Button*/}
						{/*	variant={logoButtonHighlighted ? 'primary' : 'ghost'}*/}
						{/*	className={`p-2 h-8 w-8 flex items-center justify-center ${logoButtonHighlighted ? 'bg-secondary text-primary' : 'hover:bg-white/10'}`}*/}
						{/*	onClick={() => {*/}
						{/*		setLogoButtonHighlighted(!logoButtonHighlighted)*/}
						{/*	}}*/}
						{/*	title="Toggle logo button"*/}
						{/*	aria-label="Toggle logo button"*/}
						{/*>*/}
						{/*	<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-4 h-4" />*/}
						{/*</Button>*/}
						{openThreadId ? (
							<Button
								variant="primary"
								className="px-4 py-1 h-8 hidden lg:flex gap-1"
								onClick={() => {
									try {
										setOpenThreadId(null)
										setClickedEventId(null)
										// Remove threadview from URL without navigating back
										try {
											const url = new URL(window.location.href)
											url.searchParams.delete('threadview')
											const target = url.pathname.startsWith('/nostr')
												? url.search
													? `/nostr${url.search}`
													: '/nostr'
												: url.search
													? `${url.pathname}${url.search}`
													: url.pathname
											window.history.replaceState({}, '', target)
											window.dispatchEvent(new PopStateEvent('popstate'))
										} catch {}
										if (feedScrollY != null) {
											window.scrollTo({ top: feedScrollY })
											setFeedScrollY(null)
										}
									} catch {}
								}}
								title="Close thread"
								aria-label="Close thread"
							>
								<span className="hidden lg:inline">close thread</span>
								<CollapseVerticalIcon className="h-5 w-5 ml-0 lg:ml-0" />
							</Button>
						) : null}
						<Button
							variant="ghost"
							className="px-4 py-2 h-16 w-16 lg:px-2 lg:py-1 lg:h-8 lg:w-auto lg:hidden"
							onClick={() => {
								setIsFiltersOpen(true)
								uiActions.openDrawer('filters')
							}}
							title="Open filters"
						>
							<span className="text-2xl lg:text-base">☰</span>
						</Button>
					</div>
				</section>
			</div>

			{/* Inline status row below header */}
			{showError && <div className="px-4 py-2 text-red-500">Error loading feed: {(error as Error)?.message}</div>}
			{showInitialSpinner && (
				<div className="px-4 py-2 text-gray-400 inline-flex gap-2">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>Loading feed…</span>
				</div>
			)}
			{!showInitialSpinner && filtered.length === 0 && (
				filterMode === 'follows' && currentUserPk && followsListNotFound ? (
					<div className="px-4 py-2 text-gray-400">cannot find your follow list</div>
				) : (
					<div className="px-4 py-2 text-gray-400">No notes found.</div>
				)
			)}

			{/* Filters Drawer */}
			<div className="lg:hidden">
				<Drawer
					type="filters"
					side="right"
					className="bg-secondary-black text-secondary"
					onOpenChange={(open: boolean) => {
						setIsFiltersOpen(open)
						if (!open) {
							setLoadingMode(null)
						} else {
							setSpinnerSettled(false)
						}
					}}
				>
					<DrawerContent className="relative">
						{/* Close (X) button at right edge */}
						<DrawerClose className="absolute top-2 right-2 text-secondary hover:bg-white/10">
							<div className="w-8 h-8 p-3">
								<X className="w-5 h-5" />
							</div>
						</DrawerClose>
						<DrawerHeader className="drawer-filters-title">
							<DrawerContent>
								{/* Action row: small screens only */}
								<div className="lg:hidden flex items-center gap-2 mb-2">
									<CartButton size="icon" />
									{/* Dashboard (authenticated only) */}
 								{authIsAuthenticated ? (
 									<Link to="/dashboard">
 										<Button variant="primary" size="icon" title="Dashboard" aria-label="Dashboard">
 											<span className="i-dashboard w-6 h-6" />
 										</Button>
 									</Link>
 								) : null}
 								{/* Profile (authenticated only) */}
 								{authIsAuthenticated ? <Profile compact /> : null}
 								{/* Logout (authenticated only) */}
 								{authIsAuthenticated ? (
 									<Button variant="primary" size="icon" title="Log out" aria-label="Log out" onClick={() => authActions.logout()}>
 										<LogOut className="w-6 h-6" />
 									</Button>
 								) : null}
 								{/* View selectors */}
 								<div className="flex gap-2 ml-auto">
 									{authIsAuthenticated ? (
 										<Button
 											variant={filterMode === 'follows' ? 'primary' : 'ghost'}
 											className="px-3 py-1 h-8"
 											onClick={() => {
 												setLoadingMode('follows')
 												setSpinnerSettled(false)
 												setFilterMode('follows')
 												setOpenThreadId(null)
 												try {
 													if (typeof window !== 'undefined') {
 														const url = new URL(window.location.href)
 														url.search = ''
 														url.searchParams.set('view', 'follows')
 														const target = url.pathname.startsWith('/nostr')
 															? url.search
 																? `/nostr${url.search}`
 																: '/nostr'
 															: url.search
 																? `${url.pathname}${url.search}`
 																: url.pathname
 														window.history.pushState({}, '', target)
 														window.dispatchEvent(new PopStateEvent('popstate'))
 													}
 												} catch {}
 											}}
 										>
 											Follows
 										</Button>
 									) : null}
 									{authIsAuthenticated ? (
 										<Button
 											variant={authorFilter && currentUserPk && authorFilter === currentUserPk ? 'primary' : 'ghost'}
 											className="px-3 py-1 h-8"
 											onClick={() => {
 												if (!currentUserPk) return
 												setLoadingMode('all')
 												setSpinnerSettled(false)
 												setFilterMode('all')
 												setOpenThreadId(null)
 												setAuthorFilter(currentUserPk)
 												try {
 													if (typeof window !== 'undefined') {
 														const url = new URL(window.location.href)
 														url.search = ''
 														url.searchParams.set('view', 'own')
 														url.searchParams.set('user', currentUserPk)
 														const target = url.pathname.startsWith('/nostr')
 															? url.search
 																? `/nostr${url.search}`
 																: '/nostr'
 															: url.search
 																? `${url.pathname}${url.search}`
 																: url.pathname
 														window.history.pushState({}, '', target)
 														window.dispatchEvent(new PopStateEvent('popstate'))
 													}
 												} catch {}
 											}}
 										>
 											Own notes
 										</Button>
 									) : null}
 									<Button
 										variant={filterMode === 'all' ? 'primary' : 'ghost'}
 										className="px-3 py-1 h-8"
 										onClick={() => {
 											setLoadingMode('all')
 											setSpinnerSettled(false)
 											setFilterMode('all')
 											setOpenThreadId(null)
 											try {
 												if (typeof window !== 'undefined') {
 													const url = new URL(window.location.href)
 													url.search = ''
 													url.searchParams.set('view', 'global')
 													const target = url.pathname.startsWith('/nostr')
 														? url.search
 															? `/nostr${url.search}`
 															: '/nostr'
 														: url.search
 															? `${url.pathname}${url.search}`
 															: url.pathname
 													window.history.pushState({}, '', target)
 													window.dispatchEvent(new PopStateEvent('popstate'))
 												}
 											} catch {}
 										}}
 									>
 										Global
 									</Button>
 								</div>
								</div>
							</DrawerContent>
							{/*<DrawerTitle id="drawer-filters-title">Filters</DrawerTitle>*/}
						</DrawerHeader>
						<div className="p-4 text-sm">
							{/* Divider below action row (hidden on lg) */}
							{/*<div className="lg:hidden border-t border-gray-800 my-2"></div>*/}
							<h2 className="lg:hidden text-base font-semibold mb-2">Filters</h2>
							<div className="flex flex-col gap-2">
								<Button
									variant={filterMode === 'all' ? 'primary' : 'ghost'}
									className="justify-start"
									onClick={() => {
										setLoadingMode('all')
										setSpinnerSettled(false)
										setFilterMode('all')
										setOpenThreadId(null)
										try {
											if (typeof window !== 'undefined') {
												const url = new URL(window.location.href)
												// Keep only view=global
												url.search = ''
												url.searchParams.set('view', 'global')
												const target = url.pathname.startsWith('/nostr')
													? url.search
														? `/nostr${url.search}`
														: '/nostr'
													: url.search
														? `${url.pathname}${url.search}`
														: url.pathname
												window.history.pushState({}, '', target)
												window.dispatchEvent(new PopStateEvent('popstate'))
											}
										} catch {}
										// keep drawer open until spinner settles
									}}
								>
									<span className="inline-flex items-center gap-2">
										{loadingMode === 'all' && isFiltersOpen ? (
											<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
										) : null}
										<span>Global ({counts.all})</span>
									</span>
								</Button>
								{authIsAuthenticated ? (
									<Button
										variant={authorFilter && currentUserPk && authorFilter === currentUserPk ? 'primary' : 'ghost'}
										className="justify-start"
										onClick={() => {
											if (!currentUserPk) return
											setLoadingMode('all')
											setSpinnerSettled(false)
											setFilterMode('all')
											setOpenThreadId(null)
											setAuthorFilter(currentUserPk)
											try {
												if (typeof window !== 'undefined') {
													const url = new URL(window.location.href)
													url.search = ''
													url.searchParams.set('view', 'own')
													url.searchParams.set('user', currentUserPk)
													const target = url.pathname.startsWith('/nostr')
														? url.search
															? `/nostr${url.search}`
															: '/nostr'
														: url.search
															? `${url.pathname}${url.search}`
															: url.pathname
													window.history.pushState({}, '', target)
													window.dispatchEvent(new PopStateEvent('popstate'))
												}
											} catch {}
										}}
									>
										<span className="inline-flex items-center gap-2">
											{loadingMode === 'all' && isFiltersOpen ? (
												<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
											) : null}
											<span>Own notes</span>
										</span>
									</Button>
								) : null}
								<div className="mt-4 px-4">
									<Label htmlFor="tag-filter">Tags</Label>
									<div className="flex gap-2 items-center">
										<div className="relative flex-1">
											<Input
												id="tag-filter"
												placeholder="#news or news"
												value={tagFilterInput}
												onChange={(e) => {
													setTagFilterInput(e.target.value)
												}}
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														const normalized = (tagFilterInput || '').replace(/^#/, '').trim()
														// Switch to independent hashtag mode when a tag is entered
														scrollToTop()
														setSpinnerSettled(false)
														setLoadingMode('hashtag')
														setFilterMode('hashtag')
														setOpenThreadId(null)
														if (normalized.length > 0) {
															setPendingTag(normalized)
														}
														setTagFilter(normalized)
														// Update URL to explicit hashtag view
														try {
															if (typeof window !== 'undefined') {
																const url = new URL(window.location.href)
																// Keep only tag (and explicit view=hashtag when present)
																url.search = ''
																if (normalized) {
																	url.searchParams.set('view', 'hashtag')
																	url.searchParams.set('tag', normalized)
																}
																const target = url.pathname.startsWith('/nostr')
																	? url.search
																		? `/nostr${url.search}`
																		: '/nostr'
																	: url.search
																		? `${url.pathname}${url.search}`
																		: url.pathname
																window.history.pushState({}, '', target)
																window.dispatchEvent(new PopStateEvent('popstate'))
															}
														} catch {}
													}
												}}
												className="w-full pr-8"
											/>
											{tagFilterInput?.length ? (
												<button
													type="button"
													className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
													onClick={() => {
														// Clear the input and active tag filter, and return to follows/global
														setTagFilterInput('')
														setTagFilter('')
														setSpinnerSettled(false)
														if (currentUserPk) {
															setLoadingMode('follows')
															setFilterMode('follows')
														} else {
															setLoadingMode('all')
															setFilterMode('all')
														}
														setOpenThreadId(null)
														try {
															if (typeof window !== 'undefined') {
																const url = new URL(window.location.href)
																// Clear all params; then set only view=global
																url.search = ''
																url.searchParams.set('view', 'global')
																const target = url.pathname.startsWith('/nostr')
																	? url.search
																		? `/nostr${url.search}`
																		: '/nostr'
																	: url.search
																		? `${url.pathname}${url.search}`
																		: url.pathname
																window.history.pushState({}, '', target)
																window.dispatchEvent(new PopStateEvent('popstate'))
															}
														} catch {}
														const el = document.getElementById('tag-filter') as HTMLInputElement | null
														el?.focus()
													}}
													title="Clear tag filter"
													aria-label="Clear tag filter"
												>
													<X className="h-4 w-4" />
												</button>
											) : null}
										</div>
										<Button
											variant="primary"
											className="h-9 px-3"
											onClick={() => {
												const normalized = (tagFilterInput || '').replace(/^#/, '').trim()
												if (!normalized) return
												// Perform same action as Enter
												scrollToTop()
												setSpinnerSettled(false)
												setLoadingMode('hashtag')
												setFilterMode('hashtag')
												setOpenThreadId(null)
												setPendingTag(normalized)
												setTagFilter(normalized)
												try {
													if (typeof window !== 'undefined') {
														const url = new URL(window.location.href)
														// Keep only tag (and explicit view=hashtag)
														url.search = ''
														url.searchParams.set('view', 'hashtag')
														url.searchParams.set('tag', normalized)
														const target = url.pathname.startsWith('/nostr')
															? url.search
																? `/nostr${url.search}`
																: '/nostr'
															: url.search
																? `${url.pathname}${url.search}`
																: url.pathname
														window.history.pushState({}, '', target)
														window.dispatchEvent(new PopStateEvent('popstate'))
													}
												} catch {}
											}}
											title="Apply hashtag filter"
											aria-label="Apply hashtag filter"
											disabled={!(tagFilterInput || '').replace(/^#/, '').trim().length}
										>
											⤶
										</Button>
									</div>
								</div>
								<div className="flex gap-2 items-center px-3 py-2 mt-3 mb-1 font-medium">
									<span>Reactions</span>
								</div>
								<div className="pl-2 flex flex-col gap-2">
									<div className="flex gap-2 items-center px-2">
										<span className="text-xs text-gray-500">Emoji:</span>
										<div className="w-16 h-8 py-0 rounded bg-transparent border border-gray-700 flex items-center justify-center">
											{selectedEmoji || 'Any'}
										</div>
										<button
											className="h-8 px-2 rounded bg-white/10 text-secondary"
											onClick={() => {
												// Clear the emoji filter
												setSelectedEmoji('')

												// Return to previous filter mode if in reactions mode
												if (filterMode === 'reactions') {
													setLoadingMode(previousFilterMode)
													setSpinnerSettled(false)
													setFilterMode(previousFilterMode)

													// Update URL
													try {
														if (typeof window !== 'undefined') {
															const url = new URL(window.location.href)
															if (previousFilterMode === 'all') {
																url.searchParams.delete('view')
															} else {
																url.searchParams.set('view', previousFilterMode)
															}
															url.searchParams.delete('emoji')
															if (previousFilterMode !== 'hashtag') {
																url.searchParams.delete('tag')
															}
															const target = url.pathname.startsWith('/nostr')
																? url.search
																	? `/nostr${url.search}`
																	: '/nostr'
																: url.search
																	? `${url.pathname}${url.search}`
																	: url.pathname
															window.history.pushState({}, '', target)
															window.dispatchEvent(new PopStateEvent('popstate'))
														}
													} catch {}
												}
											}}
										>
											Clear
										</button>
									</div>
									<div className="mt-2 p-2">
										<EmojiPicker
											onEmojiClick={(emojiData) => {
												// Save current filter mode if not already in reactions mode
												if (filterMode !== 'reactions') {
													setPreviousFilterMode(filterMode as 'all' | 'threads' | 'originals' | 'follows' | 'hashtag')
												}

												// Set the emoji and switch to reactions mode
												setSelectedEmoji(emojiData.emoji)
												setLoadingMode('reactions')
												setSpinnerSettled(false)
												setFilterMode('reactions')
												setOpenThreadId(null)

												// Update URL
												try {
													if (typeof window !== 'undefined') {
														const url = new URL(window.location.href)
														// Keep only view and emoji
														url.search = ''
														url.searchParams.set('view', 'reactions')
														url.searchParams.set('emoji', emojiData.emoji)
														const target = url.pathname.startsWith('/nostr')
															? url.search
																? `/nostr${url.search}`
																: '/nostr'
															: url.search
																? `${url.pathname}${url.search}`
																: url.pathname
														window.history.pushState({}, '', target)
														window.dispatchEvent(new PopStateEvent('popstate'))
													}
												} catch {}
											}}
											width="100%"
											// height="300px"
											previewConfig={{ showPreview: false }}
											searchDisabled={false}
											skinTonesDisabled
											theme={Theme.DARK}
										/>
									</div>
								</div>
							</div>
						</div>
					</DrawerContent>
				</Drawer>
			</div>

			{/* Large-screen fixed Filters sidebar (hidden during thread view) */}
			{!openThreadId ? (
				<aside className="hidden lg:block fixed right-0 top-24 h-[calc(100vh-6rem)] w-80 overflow-y-auto bg-secondary-black text-secondary p-4 border-l border-gray-800">
					<h2 className="text-lg font-semibold mb-2">Filters</h2>
					<div className="text-sm">
						<div className="flex flex-col gap-2">
									{authIsAuthenticated ? (
										<Button
											variant={filterMode === 'follows' ? 'primary' : 'ghost'}
											className="justify-start"
											onClick={() => {
												setLoadingMode('follows')
												setSpinnerSettled(false)
												setFilterMode('follows')
												setOpenThreadId(null)
												try {
													if (typeof window !== 'undefined') {
														const url = new URL(window.location.href)
														url.search = ''
														url.searchParams.set('view', 'follows')
														const target = url.pathname.startsWith('/nostr')
															? url.search
																? `/nostr${url.search}`
																: '/nostr'
															: url.search
																? `${url.pathname}${url.search}`
																: url.pathname
														window.history.pushState({}, '', target)
														window.dispatchEvent(new PopStateEvent('popstate'))
													}
												} catch {}
											}}
										>
											<span className="inline-flex items-center gap-2">
												{loadingMode === 'follows' && !isFiltersOpen ? (
													<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
												) : null}
												<span>Follows</span>
											</span>
										</Button>
									) : null}
									{authIsAuthenticated ? (
										<Button
											variant={authorFilter && currentUserPk && authorFilter === currentUserPk ? 'primary' : 'ghost'}
											className="justify-start"
											onClick={() => {
												if (!currentUserPk) return
												setLoadingMode('all')
												setSpinnerSettled(false)
												setFilterMode('all')
												setOpenThreadId(null)
												setAuthorFilter(currentUserPk)
												try {
													if (typeof window !== 'undefined') {
														const url = new URL(window.location.href)
														url.search = ''
														url.searchParams.set('view', 'own')
														url.searchParams.set('user', currentUserPk)
														const target = url.pathname.startsWith('/nostr')
															? url.search
																? `/nostr${url.search}`
																: '/nostr'
															: url.search
																? `${url.pathname}${url.search}`
																: url.pathname
														window.history.pushState({}, '', target)
														window.dispatchEvent(new PopStateEvent('popstate'))
													}
												} catch {}
											}}
										>
											<span className="inline-flex items-center gap-2">
												{loadingMode === 'all' && !isFiltersOpen ? (
													<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
												) : null}
												<span>Own notes</span>
											</span>
										</Button>
									) : null}
									<Button
								variant={filterMode === 'all' ? 'primary' : 'ghost'}
								className="justify-start"
								onClick={() => {
									setLoadingMode('all')
									setSpinnerSettled(false)
									setFilterMode('all')
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.search = ''
											url.searchParams.set('view', 'global')
											const target = url.pathname.startsWith('/nostr')
												? url.search
													? `/nostr${url.search}`
													: '/nostr'
												: url.search
													? `${url.pathname}${url.search}`
													: url.pathname
											window.history.pushState({}, '', target)
											window.dispatchEvent(new PopStateEvent('popstate'))
										}
									} catch {}
								}}
							>
								<span className="inline-flex items-center gap-2">
									{loadingMode === 'all' && !isFiltersOpen ? (
										<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
									) : null}
									<span>Global ({counts.all})</span>
								</span>
							</Button>
 						<div className="mt-4 px-4">
 							<Label>User feeds</Label>
 							{userFeeds.length === 0 ? (
 								<div className="text-xs text-gray-400 mt-1">None yet</div>
 							) : (
 								<div className="mt-2 flex flex-wrap gap-2">
 									{userFeeds.map((pk) => {
 										const isActive = pk === authorFilter
 										return (
 											<UserFeedChip
 												key={pk}
 												pk={pk}
 												isActive={isActive}
 												onOpen={() => {
 													navigateToUserFeed(pk)
 													setIsFiltersOpen(false)
 												}}
 												onRemove={() => {
 													setUserFeeds((prev) => prev.filter((p) => p !== pk))
 													try {
 														if (pk === authorFilter) {
 															// Clear current user filter and navigate back to global
 															setAuthorFilter('')
 															const url = new URL(window.location.href)
 															url.search = ''
 															url.searchParams.set('view', 'global')
 															const target = url.pathname.startsWith('/nostr')
 																? url.search
 																	? `/nostr${url.search}`
 																	: '/nostr'
 																: url.search
 																	? `${url.pathname}${url.search}`
 																	: url.pathname
 															window.history.pushState({}, '', target)
 															window.dispatchEvent(new PopStateEvent('popstate'))
 														}
 													} catch {}
 												}}
 											/>
 										)
 									})}
 								</div>
 							)}
 						</div>
							<div className="mt-4 px-4">
								<Label htmlFor="tag-filter">Tags</Label>
								<div className="flex gap-2 items-center">
									<div className="relative flex-1">
										<Input
											id="tag-filter"
											placeholder="#news or news"
											value={tagFilterInput}
											onChange={(e) => {
												setTagFilterInput(e.target.value)
											}}
											onKeyDown={(e) => {
												if (e.key === 'Enter') {
													const normalized = (tagFilterInput || '').replace(/^#/, '').trim()
													// Switch to independent hashtag mode when a tag is entered
													scrollToTop()
													setSpinnerSettled(false)
													setLoadingMode('hashtag')
													setFilterMode('hashtag')
													setOpenThreadId(null)
													if (normalized.length > 0) {
														setPendingTag(normalized)
													}
													setTagFilter(normalized)
													// Update URL to explicit hashtag view
													try {
														if (typeof window !== 'undefined') {
															const url = new URL(window.location.href)
															url.search = ''
															if (normalized) {
																url.searchParams.set('view', 'hashtag')
																url.searchParams.set('tag', normalized)
															}
															const target = url.pathname.startsWith('/nostr')
																? url.search
																	? `/nostr${url.search}`
																	: '/nostr'
																: url.search
																	? `${url.pathname}${url.search}`
																	: url.pathname
															window.history.pushState({}, '', target)
															window.dispatchEvent(new PopStateEvent('popstate'))
														}
													} catch {}
												}
											}}
											className="w-full pr-8"
										/>
										{tagFilterInput?.length ? (
											<button
												type="button"
												className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
												onClick={() => {
   										// Clear the input and active tag filter, and return to Global
   										setTagFilterInput('')
   										setTagFilter('')
   										setSpinnerSettled(false)
   										setLoadingMode('all')
   										setFilterMode('all')
   										setOpenThreadId(null)
   										try {
   											if (typeof window !== 'undefined') {
   												const url = new URL(window.location.href)
   												url.search = ''
   												url.searchParams.set('view', 'global')
   												const target = url.pathname.startsWith('/nostr')
   													? url.search
   														? `/nostr${url.search}`
   														: '/nostr'
   													: url.search
   														? `${url.pathname}${url.search}`
   														: url.pathname
   												window.history.pushState({}, '', target)
   												window.dispatchEvent(new PopStateEvent('popstate'))
   											}
   										} catch {}
   										const el = document.getElementById('tag-filter') as HTMLInputElement | null
   										el?.focus()
												}}
												title="Clear tag filter"
												aria-label="Clear tag filter"
											>
												<X className="h-4 w-4" />
											</button>
										) : null}
									</div>
									<Button
										variant="primary"
										className="h-9 px-3"
										onClick={() => {
											const normalized = (tagFilterInput || '').replace(/^#/, '').trim()
											if (!normalized) return
											// Perform same action as Enter
											scrollToTop()
											setSpinnerSettled(false)
											setLoadingMode('hashtag')
											setFilterMode('hashtag')
											setOpenThreadId(null)
											setPendingTag(normalized)
											setTagFilter(normalized)
											try {
												if (typeof window !== 'undefined') {
													const url = new URL(window.location.href)
													url.search = ''
													url.searchParams.set('view', 'hashtag')
													url.searchParams.set('tag', normalized)
													const target = url.pathname.startsWith('/nostr')
														? url.search
															? `/nostr${url.search}`
															: '/nostr'
														: url.search
															? `${url.pathname}${url.search}`
															: url.pathname
													window.history.pushState({}, '', target)
													window.dispatchEvent(new PopStateEvent('popstate'))
												}
											} catch {}
										}}
										title="Apply hashtag filter"
										aria-label="Apply hashtag filter"
										disabled={!(tagFilterInput || '').replace(/^#/, '').trim().length}
									>
										⤶
									</Button>
								</div>
							</div>
							<div className="flex gap-2 items-center px-3 py-2 mt-3 mb-1 font-medium">
								<span>Reactions</span>
							</div>
							<div className="pl-2 flex flex-col gap-2">
								<div className="flex gap-2 items-center px-2">
									<span className="text-xs text-gray-500">Emoji:</span>
									<div className="w-16 h-8 py-0 rounded bg-transparent border border-gray-700 flex items-center justify-center">
										{selectedEmoji || 'Any'}
									</div>
									<button
										className="h-8 px-2 rounded bg-white/10 text-secondary"
										onClick={() => {
											// Clear the emoji filter and revert to previous mode locally; URL will sync elsewhere
											setSelectedEmoji('')
											if (filterMode === 'reactions') {
												setLoadingMode(previousFilterMode)
												setSpinnerSettled(false)
												setFilterMode(previousFilterMode)
											}
										}}
									>
										Clear
									</button>
								</div>
								<div className="mt-2 p-2">
									<EmojiPicker
										onEmojiClick={(emojiData) => {
											if (filterMode !== 'reactions') {
												setPreviousFilterMode(filterMode as 'all' | 'threads' | 'originals' | 'follows' | 'hashtag')
											}
											setSelectedEmoji(emojiData.emoji)
											setLoadingMode('reactions')
											setSpinnerSettled(false)
											setFilterMode('reactions')
											setOpenThreadId(null)
											try {
												if (typeof window !== 'undefined') {
													const url = new URL(window.location.href)
													url.search = ''
													url.searchParams.set('view', 'reactions')
													url.searchParams.set('emoji', emojiData.emoji)
													const target = url.pathname.startsWith('/nostr')
														? url.search
															? `/nostr${url.search}`
															: '/nostr'
														: url.search
															? `${url.pathname}${url.search}`
															: url.pathname
													window.history.pushState({}, '', target)
													window.dispatchEvent(new PopStateEvent('popstate'))
												}
											} catch {}
										}}
										width="100%"
										previewConfig={{ showPreview: false }}
										searchDisabled={false}
										skinTonesDisabled
										theme={Theme.DARK}
									/>
								</div>
							</div>
						</div>
					</div>
				</aside>
			) : null}

			<div
				className={
					'py-3 px-3 lg:px-3 ' + (openThreadId ? '' : 'lg:mr-80') + (isComposeOpen ? (isComposeLarge ? ' pb-[50vh]' : ' pb-32') : '')
				}
			>
				{/* Cover/banner background behind the view header when in a user's feed */}
				{authorFilter && (authorMeta as any) ? (() => {
					const coverUrl = (authorMeta as any)?.banner || (authorMeta as any)?.cover || (authorMeta as any)?.cover_image || ''
					return coverUrl ? (
						<div
							className="fixed top-0 left-0 right-0 h-32 md:h-40 z-0 pointer-events-none"
							style={{
								backgroundImage: `url("${coverUrl}")`,
								backgroundSize: 'cover',
								backgroundPosition: 'center',
								backgroundRepeat: 'no-repeat',
							}}
						>
							<div className="w-full h-full bg-black/20" />
						</div>
					) : null
				})() : null}

				{/* Profile banner shown on user feed views */}
				{authorFilter ? (
					<ProfileBanner
						pubkey={authorFilter}
						name={(authorMeta as any)?.name || (authorMeta as any)?.displayName || (authorMeta as any)?.nip05}
						picture={(authorMeta as any)?.picture}
						about={(authorMeta as any)?.about}
						isLoading={!authorMeta}
					/>
				) : null}

				{/* Floating New Notes Banner near top-right (disabled as per new UX: use pulsing reload button instead) */}
				{pendingNewNotes.length > 0 && false ? (
					<div className="group fixed top-16 z-40" style={{ right: floatingRight }}>
						<div className="absolute top-1/2 right-full -translate-y-1/2 mr-3 pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100">
							<span className="px-3 py-1 rounded-full bg-black/70 text-white text-sm shadow whitespace-nowrap text-right">
								Load new notes
							</span>
						</div>
						<Button
							variant="primary"
							className={`h-10 rounded-full px-3 flex items-center gap-2 shadow-lg transition-colors duration-200 hover:bg-white`}
							onClick={() => {
								// Close any open thread for a predictable top scroll
								setOpenThreadId(null)
								// Prepend pending notes (dedup)
								setAllLoadedEvents((prev) => {
									const existingIds = new Set(prev.map((w) => ((w.event as any)?.id as string) || ''))
									const fresh = pendingNewNotes.filter((w) => {
										const id = ((w.event as any)?.id as string) || ''
										return id && !existingIds.has(id)
									})
									return [...fresh, ...prev]
								})
								setPendingNewNotes([])
								setNewNoteAuthors([])
								scrollToTop()
							}}
							title="Load new notes and scroll to top"
							aria-label="Load new notes"
						>
							<span className="text-base" aria-hidden>
								🆕
							</span>
							<span className="text-sm font-medium">New notes from:</span>
							<div className="flex -space-x-2">
								{Array.from(new Set(newNoteAuthors))
									.slice(0, 8)
									.map((pk) => (
										<div
											key={pk}
											className="w-6 h-6 rounded-full bg-gray-200 border border-white text-[10px] flex items-center justify-center text-gray-700"
											title={pk}
										>
											{pk.slice(0, 2)}
										</div>
									))}
							</div>
						</Button>
					</div>
				) : null}
				<div className="space-y-2 text-sm">
					{(() => {
						const base = filtered.filter(
							(wrapped: EnhancedFetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id,
						)
						// If a thread is open, render only that thread's root note, and let NoteView show the full indented thread
						if (openThreadId) {
							const match = base.find((w) => ((w.event as any)?.id as string) === openThreadId)
							return match
								? [<NoteView key={(match.event as any).id as string} note={match.event} reactionsMap={reactionsMap || {}} />]
								: null
						}
						const toShow =
							filterMode === 'reactions'
								? base.filter((w) => {
										const id = ((w.event as any)?.id as string) || ''
										const emap = reactionsMap?.[id]
										if (!emap) return false
										return selectedEmoji ? !!emap[selectedEmoji] : Object.keys(emap).length > 0
									})
								: base
						if (toShow.length === 0) {
							return (
								<div className="p-6 text-center text-gray-500 flex flex-col items-center justify-center">
									<Loader2 className={`h-5 w-5 mb-2 ${forceFeedLoading || isLoading || isFetching ? 'animate-spin' : ''}`} />
									<div>{forceFeedLoading || isLoading || isFetching ? 'Loading feed…' : 'No posts yet'}</div>
								</div>
							)
						}
						return toShow.map((wrapped: EnhancedFetchedNDKEvent) => (
							<NoteView key={(wrapped.event as any).id as string} note={wrapped.event} reactionsMap={reactionsMap || {}} />
						))
					})()}
				</div>
			</div>
			{/* Floating Back-to-Top Button with left fade-in label */}
			<div
				className={`group fixed ${isComposeOpen ? (isComposeLarge ? 'bottom-[calc(50vh+3rem)]' : 'bottom-40') : authIsAuthenticated ? 'bottom-36' : 'bottom-12'} z-40 ${showTop ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
				style={{ right: floatingRight }}
			>
				{/* Label pill to the left */}
				<div className="absolute top-1/2 right-full -translate-y-1/2 mr-3 pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100">
					<span className="px-3 py-1 rounded-full bg-black/70 text-white text-sm shadow whitespace-nowrap text-right">Back to top</span>
				</div>
				<Button
					variant="primary"
					className={`h-10 w-10 rounded-full px-0 flex items-center justify-center shadow-lg transition-colors duration-200 hover:bg-white`}
					onClick={() => {
						// Close any open thread to prevent auto-scroll back down
						setOpenThreadId(null)
						scrollToTop()
					}}
					title="Back to top"
					aria-label="Back to top"
				>
					<span className="text-lg" aria-hidden>
						🡅
					</span>
				</Button>
			</div>

			{/* Floating New Note Button (below Back-to-Top) with left fade-in label */}
			{!isComposeOpen && authIsAuthenticated ? (
				<div className="group fixed bottom-12 z-40" style={{ right: floatingRight }}>
					{/* Label pill to the left */}
					<div className="absolute top-1/2 right-full -translate-y-1/2 mr-3 pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100">
						<span className="px-4 py-1.5 rounded-full bg-black/70 text-white text-lg shadow">Compose</span>
					</div>
					<Button
						variant="primary"
						className={`h-20 w-20 rounded-full px-0 flex items-center justify-center shadow-lg transition-colors duration-200 hover:bg-white`}
						onClick={() => {
							setIsComposeOpen((v) => !v)
						}}
						title="New note"
						aria-label="New note"
					>
						<span className="text-2xl align-baseline" aria-hidden>
							✍
						</span>
					</Button>
				</div>
			) : null}
			{/* Bottom Compose Panel */}
			{isComposeOpen ? (
				<div className={`fixed bottom-0 left-0 z-40 ${openThreadId ? 'right-0' : 'right-0 lg:right-80'}`}>
					<div className="border-t border-black/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-lg">
						<form
							className={`flex items-stretch gap-2 ${isComposeLarge ? 'h-[50vh] p-0' : 'min-h-24 p-3'}`}
							onSubmit={async (e) => {
								e.preventDefault()

								// Don't send empty messages
								if (!composeText.trim()) return

								try {
									// Get NDK instance and signer
									const ndk = ndkActions.getNDK()
									if (!ndk) {
										toast.error('Not connected to Nostr network')
										return
									}

									const signer = ndkActions.getSigner()
									if (!signer) {
										toast.error('Please log in to send notes')
										return
									}

									// Create the kind 1 text note event
									const event = new NDKEvent(ndk)
									event.kind = 1
									event.content = composeText.trim()
									event.tags = []

									// Sign the event (do not block UI on publish)
									await event.sign(signer)

									// Create wrapped event for immediate feed updates
     				const wrappedEvent = {
     					event: event,
     					fetchedAt: Date.now(),
     					relaysSeen: [],
     					isFromCache: false,
     					priority: 1, // High priority for new notes
     				}

     				// Prepend to current feed immediately
     				addToFeed(wrappedEvent as any)

									// Get current user pubkey for follow & author feed
									const user = await ndkActions.getUser()
									const currentUserPubkey = user?.pubkey

									// Optimistically update feeds immediately
									const globalKey = [...noteKeys.all, 'enhanced-list', '', '', '']
									queryClient.setQueryData(globalKey, (oldData: any) => {
										if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
										return [wrappedEvent]
									})

									if (currentUserPubkey) {
										const followsKey = [...noteKeys.all, 'enhanced-list', '', '', 'follows']
										// Legacy follows key update (without cacheKey) for backward compatibility
										queryClient.setQueryData(followsKey, (oldData: any) => {
											if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
											return [wrappedEvent]
										})
										// New follows key with cacheKey = current user pubkey
										const followsKeyWithUser = [...noteKeys.all, 'enhanced-list', '', '', 'follows', currentUserPubkey, (SUPPORTED_KINDS as any).join(',')]
										queryClient.setQueryData(followsKeyWithUser, (oldData: any) => {
											if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
											return [wrappedEvent]
										})
										// Author's own posts view
										const authorKey = [...noteKeys.all, 'enhanced-list', '', currentUserPubkey, '']
										queryClient.setQueryData(authorKey, (oldData: any) => {
											if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
											return [wrappedEvent]
										})
									}

									// Clear the compose form and close
									setComposeText('')
									setComposeImages([])
									setIsComposeOpen(false)

									// Inform user and publish in background
									toast.info('Posting in background...', { duration: 1500 })

									// Fire-and-forget background publishing with simple retries
									;(async () => {
										const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
										const maxAttempts = 3
										for (let attempt = 1; attempt <= maxAttempts; attempt++) {
											try {
												await event.publish(publishRelaySet)
												console.log('Note published successfully:', event.id)
												return
											} catch (err) {
												console.warn(`Publish attempt ${attempt} failed`, err)
												await new Promise((r) => setTimeout(r, 1000 * attempt))
											}
										}
										console.error('Failed to publish note after retries:', event.id)
									})()
								} catch (error) {
									console.error('Failed to send note:', error)
									toast.error('Failed to publish note. Please try again.')
								}
							}}
						>
							{isComposeLarge ? (
								<>
									{/* Expanded layout - all buttons right-aligned */}
									<div className="flex-1 flex flex-col w-all pr-1 p-2">
										<textarea
											value={composeText}
											onChange={(e) => setComposeText(e.target.value)}
											placeholder="Write a note..."
											className="w-full flex-1 p-2 rounded-md border border-black/20 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
										/>
										{composeImages.length > 0 ? (
											<div className="mt-2 flex flex-wrap gap-2">
												{composeImages.map((f, idx) => (
													<span key={idx} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border">
														{f.name}
													</span>
												))}
											</div>
										) : null}
									</div>
									{/* Top-right flowing downward buttons */}
									<div className="flex flex-col gap-2 p-1">
										<Button
											type="button"
											variant="primary"
											size="icon"
											title="Close"
											aria-label="Close compose"
											onClick={() => {
												setIsComposeOpen(false)
											}}
										>
											<span aria-hidden>X</span>
										</Button>
										<Button
											type="button"
											variant="tertiary"
											size="icon"
											title="Return to small mode"
											aria-label="Return to small mode"
											onClick={() => {
												setIsComposeLarge((v) => !v)
											}}
										>
											<span aria-hidden className="items-center text-2xl">
												⇓
											</span>
										</Button>
										<div className="flex-1" />
										{/*</div>*/}
										{/* Bottom-right flowing upward buttons */}
										{/*<div className="flex flex-col-reverse gap-2 p-3 pb-3">*/}
										{/* Emoji */}
										<div className="relative">
											<Button
												type="button"
												variant="tertiary"
												size="icon"
												onClick={() => setShowEmojiPicker((v) => !v)}
												title="Emoji"
												aria-label="Emoji"
											>
												<span aria-hidden>😊</span>
											</Button>
											{showEmojiPicker ? (
												<div className="absolute bottom-12 right-0 z-50">
													<EmojiPicker
														onEmojiClick={(emojiData) => {
															setComposeText((t) => t + emojiData.emoji)
														}}
														width={300}
														previewConfig={{ showPreview: false }}
														searchDisabled={false}
														skinTonesDisabled
														theme={Theme.DARK}
													/>
												</div>
											) : null}
										</div>
										{/* Image upload */}
										<>
											<input
												id="compose-image-input"
												type="file"
												accept="image/*"
												multiple
												className="hidden"
												onChange={(e) => {
													const files = Array.from(e.target.files || [])
													setComposeImages((prev) => [...prev, ...files])
													e.currentTarget.value = ''
												}}
											/>
											<label htmlFor="compose-image-input">
												<Button type="button" variant="tertiary" size="icon" title="Add image" aria-label="Add image">
													<span aria-hidden>🖼️</span>
												</Button>
											</label>
										</>
										<Button
											type="button"
											variant="primary"
											size="icon"
											title="Send"
											aria-label="Send"
											disabled={!composeText.trim() && composeImages.length === 0}
											onClick={async () => {
												// Don't send empty messages
												if (!composeText.trim()) return

												try {
													// Get NDK instance and signer
													const ndk = ndkActions.getNDK()
													if (!ndk) {
														toast.error('Not connected to Nostr network')
														return
													}

													const signer = ndkActions.getSigner()
													if (!signer) {
														toast.error('Please log in to send notes')
														return
													}

													// Create the kind 1 text note event
													const event = new NDKEvent(ndk)
													event.kind = 1
													event.content = composeText.trim()
													event.tags = []

													// Sign the event (do not block UI on publish)
													await event.sign(signer)

													// Create wrapped event for immediate feed updates
													const wrappedEvent = {
														event: event,
														fetchedAt: Date.now(),
														relaysSeen: [],
														isFromCache: false,
														priority: 1,
													}

													// Get current user pubkey for follow & author feed
													const user = await ndkActions.getUser()
													const currentUserPubkey = user?.pubkey

													// Optimistically update feeds immediately
													const globalKey = [...noteKeys.all, 'enhanced-list', '', '', '']
													queryClient.setQueryData(globalKey, (oldData: any) => {
														if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
														return [wrappedEvent]
													})

													if (currentUserPubkey) {
														const followsKey = [...noteKeys.all, 'enhanced-list', '', '', 'follows']
														queryClient.setQueryData(followsKey, (oldData: any) => {
															if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
															return [wrappedEvent]
														})
														const authorKey = [...noteKeys.all, 'enhanced-list', '', currentUserPubkey, '']
														queryClient.setQueryData(authorKey, (oldData: any) => {
															if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
															return [wrappedEvent]
														})
													}

													// Clear the compose form and close
													setComposeText('')
													setComposeImages([])
													setIsComposeOpen(false)

													// Inform user and publish in background
													toast.info('Posting in background...', { duration: 1500 })

													// Fire-and-forget background publishing with simple retries
													;(async () => {
														const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
														const maxAttempts = 3
														for (let attempt = 1; attempt <= maxAttempts; attempt++) {
															try {
																await event.publish(publishRelaySet)
																console.log('Note published successfully:', event.id)
																return
															} catch (err) {
																console.warn(`Publish attempt ${attempt} failed`, err)
																await new Promise((r) => setTimeout(r, 1000 * attempt))
															}
														}
														console.error('Failed to publish note after retries:', event.id)
													})()
												} catch (error) {
													console.error('Failed to send note:', error)
													toast.error('Failed to publish note. Please try again.')
												}
											}}
										>
											{/* Paper airplane right icon */}
											<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="w-5 h-5"
												aria-hidden
											>
												<path d="M22 2L11 13" />
												<path d="M22 2l-7 20-4-9-9-4 20-7z" />
											</svg>
										</Button>
									</div>
								</>
							) : (
								<>
									{/* Small layout - all buttons right-aligned */}
									<div className="flex-1 flex pr-2">
										<textarea
											value={composeText}
											onChange={(e) => setComposeText(e.target.value)}
											placeholder="Write a note..."
											className="w-full flex-1 p-0 rounded-md border border-black/20 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none h-[88px]"
										/>
										{composeImages.length > 0 ? (
											<div className="mt-2 flex gap-2">
												{composeImages.map((f, idx) => (
													<span key={idx} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border">
														{f.name}
													</span>
												))}
											</div>
										) : null}
									</div>
									<div className="flex flex-col gap-2">
										{/* Close button on separate line */}
										<div className="flex justify-end gap-2">
											<Button
												type="button"
												variant="tertiary"
												size="icon"
												title="Expand to large mode"
												aria-label="Expand to large mode"
												onClick={() => {
													setIsComposeLarge((v) => !v)
												}}
											>
												<span aria-hidden className="items-center text-2xl">
													⇑
												</span>
											</Button>
											<Button
												type="button"
												variant="primary"
												size="icon"
												title="Close"
												aria-label="Close compose"
												onClick={() => {
													setIsComposeOpen(false)
												}}
											>
												<span aria-hidden>X</span>
											</Button>
										</div>
										{/* Bottom three buttons on same line */}
										<div className="flex gap-2 justify-end">
											{/* Image upload */}
											<>
												<input
													id="compose-image-input"
													type="file"
													accept="image/*"
													multiple
													className="hidden"
													onChange={(e) => {
														const files = Array.from(e.target.files || [])
														setComposeImages((prev) => [...prev, ...files])
														e.currentTarget.value = ''
													}}
												/>
												<label htmlFor="compose-image-input">
													<Button type="button" variant="tertiary" size="icon" title="Add image" aria-label="Add image">
														<span aria-hidden>🖼️</span>
													</Button>
												</label>
											</>
											{/* Emoji */}
											<div className="relative">
												<Button
													type="button"
													variant="tertiary"
													size="icon"
													onClick={() => setShowEmojiPicker((v) => !v)}
													title="Emoji"
													aria-label="Emoji"
												>
													<span aria-hidden>😊</span>
												</Button>
												{showEmojiPicker ? (
													<div className="absolute bottom-12 right-0 z-50">
														<EmojiPicker
															onEmojiClick={(emojiData) => {
																setComposeText((t) => t + emojiData.emoji)
															}}
															width={300}
															previewConfig={{ showPreview: false }}
															searchDisabled={false}
															skinTonesDisabled
															theme={Theme.DARK}
														/>
													</div>
												) : null}
											</div>
											{/* Send */}
											<Button
												type="button"
												variant="primary"
												size="icon"
												title="Send"
												aria-label="Send"
												disabled={!composeText.trim() && composeImages.length === 0}
												onClick={async () => {
													// Don't send empty messages
													if (!composeText.trim()) return

													try {
														// Get NDK instance and signer
														const ndk = ndkActions.getNDK()
														if (!ndk) {
															toast.error('Not connected to Nostr network')
															return
														}

														const signer = ndkActions.getSigner()
														if (!signer) {
															toast.error('Please log in to send notes')
															return
														}

														// Create the kind 1 text note event
														const event = new NDKEvent(ndk)
														event.kind = 1
														event.content = composeText.trim()
														event.tags = []

														// Sign the event (do not block UI on publish)
														await event.sign(signer)

														// Create wrapped event for immediate feed updates
														const wrappedEvent = {
															event: event,
															fetchedAt: Date.now(),
															relaysSeen: [],
															isFromCache: false,
															priority: 1,
														}

														// Get current user pubkey for follow & author feed
														const user = await ndkActions.getUser()
														const currentUserPubkey = user?.pubkey

														// Optimistically update feeds immediately
														const globalKey = [...noteKeys.all, 'enhanced-list', '', '', '']
														queryClient.setQueryData(globalKey, (oldData: any) => {
															if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
															return [wrappedEvent]
														})

														if (currentUserPubkey) {
															const followsKey = [...noteKeys.all, 'enhanced-list', '', '', 'follows']
															queryClient.setQueryData(followsKey, (oldData: any) => {
																if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
																return [wrappedEvent]
															})
															const authorKey = [...noteKeys.all, 'enhanced-list', '', currentUserPubkey, '']
															queryClient.setQueryData(authorKey, (oldData: any) => {
																if (oldData && Array.isArray(oldData)) return [wrappedEvent, ...oldData]
																return [wrappedEvent]
															})
														}

														// Clear the compose form and close
														setComposeText('')
														setComposeImages([])
														setIsComposeOpen(false)

														// Inform user and publish in background
														toast.info('Posting in background...', { duration: 1500 })

														// Fire-and-forget background publishing with simple retries
														;(async () => {
															const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
															const maxAttempts = 3
															for (let attempt = 1; attempt <= maxAttempts; attempt++) {
																try {
																	await event.publish(publishRelaySet)
																	console.log('Note published successfully:', event.id)
																	return
																} catch (err) {
																	console.warn(`Publish attempt ${attempt} failed`, err)
																	await new Promise((r) => setTimeout(r, 1000 * attempt))
																}
															}
															console.error('Failed to publish note after retries:', event.id)
														})()
													} catch (error) {
														console.error('Failed to send note:', error)
														toast.error('Failed to publish note. Please try again.')
													}
												}}
											>
												{/* Paper airplane right icon */}
												<svg
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="w-5 h-5"
													aria-hidden
												>
													<path d="M22 2L11 13" />
													<path d="M22 2l-7 20-4-9-9-4 20-7z" />
												</svg>
											</Button>
										</div>
									</div>
								</>
							)}
						</form>
					</div>
				</div>
			) : null}
		</div>
	)
}
