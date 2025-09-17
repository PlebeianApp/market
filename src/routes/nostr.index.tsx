import { createFileRoute, useLocation, Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { authActions, authStore } from '@/lib/stores/auth'
import { useQuery } from '@tanstack/react-query'
import { type SVGProps, useEffect, useMemo, useState } from 'react'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { authorQueryOptions } from '@/queries/authors'
import { reactionsQueryOptions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2, X, ArrowLeft, LogOut, LucideRefreshCw, RefreshCw } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'
import { findRootFromETags } from '@/queries/thread'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmojiPicker from 'emoji-picker-react'
import { goBackWithTimeLimit } from '@/lib/navigation'
import { useConfigQuery } from '@/queries/config'
import { CartButton } from '@/components/CartButton'
import { Profile } from '@/components/Profile'

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

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const { data: config } = useConfigQuery()
	const location = useLocation()
	const [isFiltersOpen, setIsFiltersOpen] = useState(false)
	const [loadingMode, setLoadingMode] = useState<null | 'all' | 'threads' | 'originals' | 'follows' | 'reactions'>(null)
	const [spinnerSettled, setSpinnerSettled] = useState(false)
	const { openThreadId, setOpenThreadId, feedScrollY, setFeedScrollY, clickedEventId, setClickedEventId } = useThreadOpen()
	const [tagFilter, setTagFilter] = useState('')
	const [tagFilterInput, setTagFilterInput] = useState(tagFilter)
	const [authorFilter, setAuthorFilter] = useState('')
	const [filterMode, setFilterMode] = useState<'all' | 'threads' | 'originals' | 'follows' | 'reactions' | 'hashtag'>('all')
	const isBaseFeed = filterMode !== 'hashtag' && !authorFilter.trim()
	const [previousFilterMode, setPreviousFilterMode] = useState<'all' | 'threads' | 'originals' | 'follows' | 'hashtag'>('all')
	const notesOpts = useMemo(() => {
		// Hashtag view is independent: only in 'hashtag' mode do we apply the tag filter.
		// Reactions mode is global only.
		if (filterMode === 'reactions') return { tag: '', author: '', follows: false }
		if (filterMode === 'hashtag') return { tag: tagFilter, author: '', follows: false }
		return { tag: '', author: authorFilter, follows: filterMode === 'follows' }
	}, [filterMode, tagFilter, authorFilter])
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
		...notesQueryOptions(notesOpts),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchInterval: false,
		staleTime: Infinity,
	})
	const { data: authorMeta } = useQuery({ ...authorQueryOptions(authorFilter), enabled: !!authorFilter }) as any
	// Current user for follows mode
	const [currentUserPk, setCurrentUserPk] = useState('')
	// React to auth store changes (login/logout) to keep currentUserPk in sync
	const { isAuthenticated: authIsAuthenticated, user: authUser } = useStore(authStore) as any
	const { data: currentUserMeta } = useQuery({
		...authorQueryOptions(currentUserPk),
		enabled: !!currentUserPk && filterMode === 'follows',
	}) as any
	const currentUserDisplayName = currentUserMeta?.name || (currentUserPk ? currentUserPk.slice(0, 8) + '…' : '')
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

	useEffect(() => {
		scrollToTop()
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
								setFilterMode('follows')
								// Update URL to reflect follows view
								url.searchParams.set('view', 'follows')
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
						setFilterMode('follows')
						url.searchParams.set('view', 'follows')
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
						: incomingView === 'follows'
							? 'follows'
							: incomingView === 'reactions' || (!!incomingEmoji && incomingEmoji.trim() !== '')
								? 'reactions'
								: incomingView === 'hashtag' || (!!incomingTag && incomingTag !== '')
									? 'hashtag'
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
			} else if (!incomingThread && openThreadId) {
				setOpenThreadId(null)
			}
			if (incomingTag && incomingTag !== tagFilter.toLowerCase()) {
				setPendingTag(incomingTag)
				setTagFilter(incomingTag)
				setTagFilterInput('#' + incomingTag)
			}
			if (incomingUser !== authorFilter) {
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

	// Auto-fallback to global view if follows mode returns empty data
	useEffect(() => {
		// Only apply this logic when in follows mode and data has loaded
		if (filterMode === 'follows' && !isLoading && data && Array.isArray(data) && data.length === 0 && currentUserPk) {
			console.log('No follow list found, switching to global view')
			setFilterMode('all')
			// Update URL to remove follows view parameter
			if (typeof window !== 'undefined') {
				try {
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
				} catch {}
			}
		}
	}, [filterMode, isLoading, data, currentUserPk])

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

	useEffect(() => {
		if (typeof window === 'undefined') return
		const onScroll = () => {
			try {
				const threshold = window.innerHeight / 4
				setShowTop(window.scrollY > threshold)
			} catch (_) {
				// noop
			}
		}
		onScroll()
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	}, [])

	const notes = data || []
	// Reactions fetching based on currently visible notes
	const noteIdsForReactions = useMemo(
		() => (notes as FetchedNDKEvent[]).map((w) => (w.event as any)?.id as string).filter(Boolean),
		[notes],
	)
	const [selectedEmoji, setSelectedEmoji] = useState<string>('')
	const { data: reactionsMap } = useQuery({
		...reactionsQueryOptions(noteIdsForReactions, selectedEmoji || undefined),
	}) as any

	const { filtered, counts } = useMemo(() => {
		const all = (data || []) as FetchedNDKEvent[]
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
							className="p-2 mx-2 h-16 w-16 lg:h-8 lg:w-8 flex"
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
							<RefreshCw
								className={`h-6 w-6 flex cursor-pointer ${isFetching ? 'animate-spin' : ''}`}
								onClick={() => {
									scrollToTop()
									setOpenThreadId(null)
									refetch()
								}}
								title="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <p className="font-heading h-4 w-4">↻</p>}
							</RefreshCw>
						</span>
					) : authorFilter?.trim() ? (
						<span className="gap-2 items-center flex">
							@{(authorMeta?.name || authorFilter.slice(0, 8)) + (authorMeta?.name ? '' : '…')}
							<RefreshCw
								className={`h-6 w-6 flex cursor-pointer ${isFetching ? 'animate-spin' : ''}`}
								onClick={() => {
									scrollToTop()
									setOpenThreadId(null)
									refetch()
								}}
								title="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <p className="font-heading h-4 w-4">↻</p>}
							</RefreshCw>
						</span>
					) : filterMode === 'hashtag' && tagFilter?.trim() ? (
						<span className="flex gap-2 items-center">
							#{tagFilter.replace(/^#/, '')}
							<RefreshCw
								className={`h-6 w-6 flex cursor-pointer ${isFetching ? 'animate-spin' : ''}`}
								onClick={() => {
									scrollToTop()
									setOpenThreadId(null)
									refetch()
								}}
								title="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <p className="font-heading h-4 w-4">↻</p>}
							</RefreshCw>
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
							<RefreshCw
								className={`h-6 w-6 flex cursor-pointer ${isFetching ? 'animate-spin' : ''}`}
								onClick={() => {
									scrollToTop()
									setOpenThreadId(null)
									refetch()
								}}
								title="Reload feed"
							>
								{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <p className="font-heading h-4 w-4">↻</p>}
							</RefreshCw>
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
			{!showInitialSpinner && filtered.length === 0 && <div className="px-4 py-2 text-gray-400">No notes found.</div>}

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
								</div>
							</DrawerContent>
							{/*<DrawerTitle id="drawer-filters-title">Filters</DrawerTitle>*/}
						</DrawerHeader>
						<div className="p-4 text-sm">
							{/* Divider below action row (hidden on lg) */}
							{/*<div className="lg:hidden border-t border-gray-800 my-2"></div>*/}
							<h2 className="lg:hidden text-base font-semibold mb-2">Filters</h2>
							<div className="flex flex-col gap-2">
								{currentUserPk ? (
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
													// Keep only view=follows
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
											// keep drawer open until spinner settles
										}}
									>
										<span className="inline-flex items-center gap-2">
											{loadingMode === 'follows' && isFiltersOpen ? (
												<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
											) : null}
											<span>Follows</span>
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
								<Button
									variant={filterMode === 'threads' ? 'primary' : 'ghost'}
									className="justify-start"
									onClick={() => {
										setLoadingMode('threads')
										setSpinnerSettled(false)
										setFilterMode('threads')
										setOpenThreadId(null)
										try {
											if (typeof window !== 'undefined') {
												const url = new URL(window.location.href)
												// Keep only view=threads
												url.search = ''
												url.searchParams.set('view', 'threads')
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
										{loadingMode === 'threads' && isFiltersOpen ? (
											<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
										) : null}
										<span>Threads ({counts.threads})</span>
									</span>
								</Button>
								<Button
									variant={filterMode === 'originals' ? 'primary' : 'ghost'}
									className="justify-start"
									onClick={() => {
										setLoadingMode('originals')
										setSpinnerSettled(false)
										setFilterMode('originals')
										setOpenThreadId(null)
										try {
											if (typeof window !== 'undefined') {
												const url = new URL(window.location.href)
												// Keep only view=originals
												url.search = ''
												url.searchParams.set('view', 'originals')
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
										{loadingMode === 'originals' && isFiltersOpen ? (
											<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
										) : null}
										<span>Original posts ({counts.originals})</span>
									</span>
								</Button>
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
																// Clear all params; then set only view depending on auth
																url.search = ''
																if (currentUserPk) {
																	url.searchParams.set('view', 'follows')
																} else {
																	url.searchParams.set('view', 'global')
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
											theme="dark"
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
							{currentUserPk ? (
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
							<Button
								variant={filterMode === 'threads' ? 'primary' : 'ghost'}
								className="justify-start"
								onClick={() => {
									setLoadingMode('threads')
									setSpinnerSettled(false)
									setFilterMode('threads')
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.search = ''
											url.searchParams.set('view', 'threads')
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
									{loadingMode === 'threads' && !isFiltersOpen ? (
										<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
									) : null}
									<span>Threads ({counts.threads})</span>
								</span>
							</Button>
							<Button
								variant={filterMode === 'originals' ? 'primary' : 'ghost'}
								className="justify-start"
								onClick={() => {
									setLoadingMode('originals')
									setSpinnerSettled(false)
									setFilterMode('originals')
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.search = ''
											url.searchParams.set('view', 'originals')
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
									{loadingMode === 'originals' && !isFiltersOpen ? (
										<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
									) : null}
									<span>Original posts ({counts.originals})</span>
								</span>
							</Button>
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
															url.search = ''
															if (currentUserPk) {
																url.searchParams.set('view', 'follows')
															} else {
																url.searchParams.set('view', 'global')
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
										theme="dark"
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
				<div className="space-y-2 text-sm">
					{(() => {
						const base = filtered.filter(
							(wrapped: FetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id,
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
						return toShow.map((wrapped: FetchedNDKEvent) => (
							<NoteView key={(wrapped.event as any).id as string} note={wrapped.event} reactionsMap={reactionsMap || {}} />
						))
					})()}
				</div>
			</div>
			{/* Floating Back-to-Top Button with left fade-in label */}
			<div
				className={`group fixed ${isComposeOpen ? (isComposeLarge ? 'bottom-[calc(50vh+3rem)]' : 'bottom-40') : 'bottom-36'} z-40 ${showTop ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
			{!isComposeOpen ? (
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
							className={`p-3 flex items-stretch gap-2 ${isComposeLarge ? 'h-[50vh]' : 'min-h-32'}`}
							onSubmit={(e) => {
								e.preventDefault()
								try {
									console.log('Send note:', { text: composeText, images: composeImages })
								} catch {}
								setComposeText('')
								setComposeImages([])
								setIsComposeOpen(false)
							}}
						>
							<div className="flex-1 flex flex-col">
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
							<div className="flex flex-col gap-2">
								{/* Top row - Toggle and Close buttons (right-justified) */}
								<div className="flex justify-end items-end gap-1 text-xl">
									<Button
										type="button"
										variant="tertiary"
										size="icon"
										title={isComposeLarge ? 'Return to small mode' : 'Expand to large mode'}
										aria-label={isComposeLarge ? 'Return to small mode' : 'Expand to large mode'}
										onClick={() => {
											setIsComposeLarge((v) => !v)
										}}
									>
										<span aria-hidden className="items-center text-2xl">
											{isComposeLarge ? '⇓' : '⇕'}
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
								<div className="flex flex-grow justify-end items-end">
									{/*<Button*/}
									{/*	type="button"*/}
									{/*	variant="tertiary"*/}
									{/*	size="icon"*/}
									{/*	title="Close"*/}
									{/*	aria-label="Close compose"*/}
									{/*	onClick={() => {*/}
									{/*		setIsComposeOpen(false)*/}
									{/*	}}*/}
									{/*>*/}
									{/*	<span aria-hidden>✖</span>*/}
									{/*</Button>*/}
								</div>
								{/* Bottom row - Image, Emoji, Send buttons */}
								<div className="flex items-end gap-1">
									{/* Image upload */}
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
													theme="dark"
												/>
											</div>
										) : null}
									</div>
									{/* Spacer to expand and fill available space */}
									<div className="flex-grow"></div>
									{/* Send */}
									<Button
										type="submit"
										variant="primary"
										size="icon"
										title="Send"
										aria-label="Send"
										disabled={!composeText.trim() && composeImages.length === 0}
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
						</form>
					</div>
				</div>
			) : null}
		</div>
	)
}
