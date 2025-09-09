import { createFileRoute, useLocation } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { authorQueryOptions } from '@/queries/authors'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2, X, Eraser } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'
import { findRootFromETags } from '@/queries/thread'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const location = useLocation()
	const [isFiltersOpen, setIsFiltersOpen] = useState(false)
	const [loadingMode, setLoadingMode] = useState<null | 'all' | 'threads' | 'originals'>(null)
	const [spinnerSettled, setSpinnerSettled] = useState(false)
	const { setOpenThreadId } = useThreadOpen()
	const [tagFilter, setTagFilter] = useState('')
	const [tagFilterInput, setTagFilterInput] = useState(tagFilter)
	const [authorFilter, setAuthorFilter] = useState('')
	const isBaseFeed = !tagFilter.trim() && !authorFilter.trim()
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
		...notesQueryOptions({ tag: tagFilter, author: authorFilter }),
		refetchOnWindowFocus: !isBaseFeed,
		refetchOnReconnect: !isBaseFeed,
		refetchInterval: false,
		staleTime: isBaseFeed ? Infinity : 0,
	})
	const { data: authorMeta } = useQuery({ ...authorQueryOptions(authorFilter), enabled: !!authorFilter }) as any
	const [showTop, setShowTop] = useState(false)
	const [filterMode, setFilterMode] = useState<'all' | 'threads' | 'originals'>('all')
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
	}, [])

	// Apply tag/user from URL (?tag=...&user=...) when location changes
	useEffect(() => {
		try {
			if (typeof window === 'undefined') return
			const searchStr = window.location.search || ''
			const sp = new URLSearchParams(searchStr)
			const incomingTag = (sp.get('tag') || '').replace(/^#/, '').trim().toLowerCase()
			const incomingUser = (sp.get('user') || '').trim()
			setOpenThreadId(null)
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
	const showInitialSpinner = isLoading && !data?.length
	const showError = isError

	return (
		<div className="relative">
			<div className="text-4xl font-heading sticky top-20 z-30 m-0 p-3 px-4 bg-secondary-black text-secondary flex items-center justify-between relative">
				<span>Firehose</span>
				{/* Centered active hashtag */}
				{tagFilter?.trim() ? (
					<span className="absolute left-1/2 -translate-x-1/2 text-base font-normal inline-flex items-center gap-1">
						#{tagFilter.replace(/^#/, '')}
						<Button
							variant="primary"
							className="p-1 h-6 w-6 flex items-center justify-center"
							title="Clear tag filter"
							aria-label="Clear tag filter"
							onClick={() => {
								setOpenThreadId(null)
								try {
									if (typeof window !== 'undefined') {
										const url = new URL(window.location.href)
										url.searchParams.delete('tag')
										// If no other filters remain, normalize to /nostr path
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
									// Fallback
									window.location.href = '/nostr'
								}
								setTagFilter('')
								setTagFilterInput('')
								setPendingTag(null)
								scrollToTop()
							}}
						>
							<Eraser className="h-4 w-4" />
						</Button>
					</span>
				) : null}
				{/* Centered active user filter (pubkey) */}
				{!tagFilter?.trim() && authorFilter?.trim() ? (
					<span className="absolute left-1/2 -translate-x-1/2 text-base font-normal inline-flex items-center gap-1">
						@{(authorMeta?.name || authorFilter.slice(0, 8)) + (authorMeta?.name ? '' : '…')}
						<Button
							variant="primary"
							className="p-1 h-6 w-6 flex items-center justify-center"
							title="Clear user filter"
							aria-label="Clear user filter"
							onClick={() => {
								setOpenThreadId(null)
								try {
									if (typeof window !== 'undefined') {
										const url = new URL(window.location.href)
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
								} catch {
									window.location.href = '/nostr'
								}
								setAuthorFilter('')
								scrollToTop()
							}}
						>
							<Eraser className="h-4 w-4" />
						</Button>
					</span>
				) : null}
				<section className="text-base font-normal">
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							className="p-2 h-8 w-8 flex items-center justify-center"
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
				<div className="px-4 py-2 text-gray-400 inline-flex items-center gap-2">
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
					{filtered
						.filter((wrapped: FetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id)
						.map((wrapped: FetchedNDKEvent) => (
							<NoteView key={(wrapped.event as any).id as string} note={wrapped.event} />
						))}
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
