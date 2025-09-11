import { createFileRoute, useLocation } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { type SVGProps, useEffect, useMemo, useState } from 'react'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { authorQueryOptions } from '@/queries/authors'
import { reactionsQueryOptions } from '@/queries/reactions'
import { ndkActions } from '@/lib/stores/ndk'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2, X, ArrowLeft } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'
import { findRootFromETags } from '@/queries/thread'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EmojiPicker from 'emoji-picker-react'

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
	const location = useLocation()
	const [isFiltersOpen, setIsFiltersOpen] = useState(false)
	const [loadingMode, setLoadingMode] = useState<null | 'all' | 'threads' | 'originals' | 'follows' | 'reactions'>(null)
	const [spinnerSettled, setSpinnerSettled] = useState(false)
	const { openThreadId, setOpenThreadId } = useThreadOpen()
	const [tagFilter, setTagFilter] = useState('')
	const [tagFilterInput, setTagFilterInput] = useState(tagFilter)
	const [authorFilter, setAuthorFilter] = useState('')
	const isBaseFeed = !tagFilter.trim() && !authorFilter.trim()
	const [filterMode, setFilterMode] = useState<'all' | 'threads' | 'originals' | 'follows' | 'reactions'>('all')
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
		...notesQueryOptions({ tag: tagFilter, author: authorFilter, follows: filterMode === 'follows' }),
		refetchOnWindowFocus: !isBaseFeed,
		refetchOnReconnect: !isBaseFeed,
		refetchInterval: false,
		staleTime: isBaseFeed ? Infinity : 0,
	})
	const { data: authorMeta } = useQuery({ ...authorQueryOptions(authorFilter), enabled: !!authorFilter }) as any
	// Current user for follows mode
	const [currentUserPk, setCurrentUserPk] = useState('')
	const { data: currentUserMeta } = useQuery({
		...authorQueryOptions(currentUserPk),
		enabled: !!currentUserPk && filterMode === 'follows',
	}) as any
	const currentUserDisplayName = currentUserMeta?.name || (currentUserPk ? currentUserPk.slice(0, 8) + '…' : '')
	const [showTop, setShowTop] = useState(false)
	// Overlay state for loading a new tag
	const [pendingTag, setPendingTag] = useState<string | null>(null)
	const [showTagOverlay, setShowTagOverlay] = useState(false)

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
				if (u?.pubkey) setCurrentUserPk(u.pubkey)
			} catch {}
		})()
	}, [])

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
			// sync filter mode from URL (?view)
			const desiredMode =
				incomingView === 'threads'
					? 'threads'
					: incomingView === 'originals'
						? 'originals'
						: incomingView === 'follows'
							? 'follows'
							: incomingView === 'reactions'
								? 'reactions'
								: 'all'
			if (desiredMode !== filterMode) {
				setFilterMode(desiredMode as any)
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
			scrollToTop()
		} catch {}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [location.href])

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
				let base = filterMode === 'all' ? all : filterMode === 'threads' ? withThreads : originals
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
			<div className="text-4xl font-heading sticky top-28 lg:top-20 sm:top-30 z-30 m-0 p-3 px-4 bg-secondary-black text-secondary flex justify-between items-center">
				{/* Left header: replace Firehose with thread/user/hashtag when active */}
				<span className="hidden lg:inline">
					{openThreadId ? (
						<span>Thread</span>
					) : authorFilter?.trim() ? (
						<span className="gap-1 items-center flex">
							<Button
								variant="primary"
								className="p-1 h-6 w-6 flex"
								title={tagFilter?.trim() ? 'Clear tag filter' : 'Clear user filter'}
								aria-label={tagFilter?.trim() ? 'Clear tag filter' : 'Clear user filter'}
								onClick={() => {
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											// If both tag and user filters are active, clear only the tag
											if (tagFilter?.trim()) {
												url.searchParams.delete('tag')
											} else {
												url.searchParams.delete('user')
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
									} catch {
										window.location.href = '/nostr'
									}
									// If both tag and user filters are active, clear only the tag
									if (tagFilter?.trim()) {
										setTagFilter('')
										setTagFilterInput('')
										setPendingTag(null)
									} else {
										setAuthorFilter('')
									}
									scrollToTop()
								}}
							>
								<ArrowLeft className="" />
							</Button>
							@{(authorMeta?.name || authorFilter.slice(0, 8)) + (authorMeta?.name ? '' : '…')}
							{tagFilter?.trim() ? ` / #${tagFilter.replace(/^#/, '')}` : ''}
						</span>
					) : tagFilter?.trim() ? (
						<span className="flex gap-1 items-center">
							<Button
								variant="primary"
								className="p-1 h-6 w-6 flex"
								title="Clear tag filter"
								aria-label="Clear tag filter"
								onClick={() => {
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.searchParams.delete('tag')
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
									} catch {
										window.location.href = '/nostr'
									}
									setTagFilter('')
									setTagFilterInput('')
									setPendingTag(null)
									scrollToTop()
								}}
							>
								<ArrowLeft className="items-center" />
							</Button>
							#{tagFilter.replace(/^#/, '')}
						</span>
					) : (
						<span>
       {filterMode === 'follows' ? (
								<span>{currentUserDisplayName ? `${currentUserDisplayName} follow feed` : 'Follow feed'}</span>
							) : filterMode === 'reactions' ? (
								<span>Reactions {selectedEmoji && selectedEmoji}</span>
							) : (
								<span>Firehose</span>
							)}
						</span>
					)}
				</span>
				<section className="items-center">
					<div className="flex gap-2">
						{openThreadId ? (
							<Button
								variant="primary"
								className="px-4 py-1 h-8 flex gap-1"
								onClick={() => {
									try {
										const currentId = openThreadId
										setOpenThreadId(null)
										// Remove threadview from URL to support Back navigation
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
											window.history.pushState({}, '', target)
											window.dispatchEvent(new PopStateEvent('popstate'))
										} catch {}
										// Defer scroll until after DOM re-renders out of thread mode
										let tries = 0
										const step = () => {
											tries++
											try {
												if (typeof window !== 'undefined' && currentId) {
													const el = document.querySelector(`[data-note-id="${currentId}"]`) as HTMLElement | null
													if (el) {
														el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
														return
													}
												}
											} catch {}
											if (tries < 3) requestAnimationFrame(step)
										}
										requestAnimationFrame(step)
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
							variant="primary"
							className="p-2 h-8 w-8 flex"
							onClick={() => {
								scrollToTop()
								// Also close any open thread when refreshing
								setOpenThreadId(null)
								refetch()
							}}
							title="Reload feed"
						>
							{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="i-refresh w-4 h-4" />}↻
						</Button>
						<Button
							variant="ghost"
							className="px-2 py-1 h-8"
							onClick={() => {
								setIsFiltersOpen(true)
								uiActions.openDrawer('filters')
							}}
							title="Open filters"
						>
							☰
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
				<DrawerContent>
					<DrawerHeader className="flex flex-row items-center justify-between p-4 border-b border-gray-800">
						<DrawerTitle id="drawer-filters-title">Filters</DrawerTitle>
						<DrawerClose className="text-secondary hover:bg-white/10" />
					</DrawerHeader>
					<div className="p-4 text-sm">
						<div className="mb-2 text-xs text-gray-400">Feed mode</div>
						<div className="flex flex-col gap-2">
							<Button
								variant={'ghost'}
								className="justify-start"
								onClick={() => {
									setLoadingMode('all')
									setSpinnerSettled(false)
									setFilterMode('all')
									setOpenThreadId(null)
									// Clear all filters
									setTagFilter('')
									setTagFilterInput('')
									setAuthorFilter('')
									setPendingTag(null)
									scrollToTop()
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.searchParams.delete('view')
											url.searchParams.delete('tag')
											url.searchParams.delete('user')
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
									{loadingMode === 'all' && isFiltersOpen && !tagFilter && !authorFilter ? (
										<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
									) : null}
									<span>Global</span>
								</span>
							</Button>
							<Button
								variant={filterMode === 'reactions' ? 'primary' : 'ghost'}
								className="justify-start"
								onClick={() => {
									setLoadingMode('reactions')
									setSpinnerSettled(false)
									setFilterMode('reactions')
									setOpenThreadId(null)
									try {
										if (typeof window !== 'undefined') {
											const url = new URL(window.location.href)
											url.searchParams.set('view', 'reactions')
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
									{loadingMode === 'reactions' && isFiltersOpen ? (
										<Loader2 className={`h-4 w-4 ${spinnerSettled ? '' : 'animate-spin'}`} />
									) : null}
									<span>Reactions</span>
								</span>
							</Button>
							<div className="pl-2 flex flex-col gap-2">
								<div className="flex gap-2 items-center">
									<span className="text-xs text-gray-500">Emoji:</span>
									<div className="w-16 h-8 px-2 rounded bg-transparent border border-gray-700 flex items-center justify-center">
										{selectedEmoji || "Any"}
									</div>
									<button className="h-8 px-2 rounded bg-white/10 text-secondary" onClick={() => setSelectedEmoji('')}>
										Clear
									</button>
								</div>
								<div className="mt-2">
									<EmojiPicker
										onEmojiClick={(emojiData) => setSelectedEmoji(emojiData.emoji)}
										width="100%"
										height="300px"
										previewConfig={{ showPreview: false }}
										searchDisabled={false}
										skinTonesDisabled
										theme="dark"
									/>
								</div>
							</div>
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
							<div className="mt-4">
								<Label htmlFor="tag-filter">tag filter</Label>
								<div className="flex gap-2 items-center">
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
												// Always update the filter, but only show overlay if a non-empty tag
												scrollToTop()
												setSpinnerSettled(false)
												setLoadingMode('all')
												setOpenThreadId(null)
												if (normalized.length > 0) {
													setPendingTag(normalized)
												}
												setTagFilter(normalized)
											}
										}}
										className="flex-1"
									/>
									<Button
										variant="ghost"
										className="p-2 h-9 w-9"
										onClick={() => {
											setTagFilterInput('')
											const el = document.getElementById('tag-filter') as HTMLInputElement | null
											el?.focus()
										}}
										title="Clear tag filter"
										aria-label="Clear tag filter"
										disabled={!tagFilterInput?.length}
									>
										<X className="h-4 w-4" />
									</Button>
								</div>
								<div className="text-xs text-gray-500 mt-1">Only fetch events that contain this #t tag</div>
							</div>
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
											url.searchParams.delete('view')
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
									<span>All ({counts.all})</span>
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
						</div>
					</div>
					<DrawerFooter className="p-4 border-t border-gray-800">
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => uiActions.closeDrawer('filters')}>
								Close
							</Button>
							{/* No Apply button needed since filter applies immediately */}
						</div>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			<div className="p-3">
				<div className="space-y-2 text-sm">
					{(() => {
						const base = filtered.filter(
							(wrapped: FetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id,
						)
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
			{/* Floating Back-to-Top Button */}
			<Button
				variant="primary"
				className={`fixed bottom-14 right-14 z-40 h-10 w-10 rounded-full px-0 lg:w-auto lg:px-4 flex items-center justify-center shadow-lg transition-opacity transition-colors duration-200 ${showTop ? 'opacity-100' : 'opacity-0 pointer-events-none'} hover:text-pink-500 hover:bg-blend-luminosity hover:bg-black`}
				onClick={() => {
					// Close any open thread to prevent auto-scroll back down
					setOpenThreadId(null)
					scrollToTop()
				}}
				title="Back to top"
				aria-label="Back to top"
			>
				<span className="hidden lg:inline text-base leading-none p-0 m-0">Back to top</span>
				<span className="text-lg ml-0 lg:ml-2" aria-hidden>
					🡅
				</span>
			</Button>
		</div>
	)
}
