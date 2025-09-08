import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'
import { findRootFromETags } from '@/queries/thread'

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const [isFiltersOpen, setIsFiltersOpen] = useState(false)
	const [loadingMode, setLoadingMode] = useState<null | 'all' | 'threads' | 'originals'>(null)
	const [spinnerSettled, setSpinnerSettled] = useState(false)
	const { setOpenThreadId } = useThreadOpen()
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery(notesQueryOptions())
	const [showTop, setShowTop] = useState(false)
	const [filterMode, setFilterMode] = useState<'all' | 'threads' | 'originals'>('all')

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

	// Now that all hooks are called, we can return early based on state
	if (isLoading) return <div className="flex justify-center items-center h-screen">Loading feed…</div>
	if (isError) return <div className="text-red-600">Error loading feed: {(error as Error)?.message}</div>

	if (!isLoading && filtered.length === 0) {
		return <div>No notes found.</div>
	}

	return (
		<div>
			<div className="text-4xl font-heading sticky top-20 z-30 m-0 p-3 px-4 bg-secondary-black text-secondary flex items-center justify-between">
				<span>Firehose</span>
				<section className="text-base font-normal">
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							className="p-2 h-8 w-8 flex items-center justify-center"
							onClick={() => {
								if (typeof window !== 'undefined') {
									window.scrollTo({ top: 0, behavior: 'smooth' })
								}
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
					if (typeof window !== 'undefined') {
						window.scrollTo({ top: 0, behavior: 'smooth' })
					}
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
