import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from '@/components/ui/drawer'
import { uiActions } from '@/lib/stores/ui'
import { useThreadOpen } from '@/state/threadOpenStore'

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const { setOpenThreadId } = useThreadOpen()
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery(notesQueryOptions())
	const [showTop, setShowTop] = useState(false)

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

	if (isLoading) return <div className="flex justify-center items-center h-screen">Loading feed…</div>
	if (isError) return <div className="text-red-600">Error loading feed: {(error as Error)?.message}</div>

	const notes = data || []

	if (notes.length === 0) {
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
						<Button variant="ghost" className="px-2 py-1 h-8" onClick={() => uiActions.openDrawer('filters')} title="Open filters">
							☰
						</Button>
					</div>
				</section>
			</div>

			{/* Filters Drawer */}
			<Drawer type="filters" side="right" className="bg-secondary-black text-secondary">
				<DrawerContent>
					<DrawerHeader className="flex flex-row items-center justify-between p-4 border-b border-gray-800">
						<DrawerTitle id="drawer-filters-title">Filters</DrawerTitle>
						<DrawerClose className="text-secondary hover:bg-white/10" />
					</DrawerHeader>
					<div className="p-4 text-sm">
						{/* TODO: add filter controls here as needed */}
						<div className="text-muted-foreground">No specific filters yet.</div>
					</div>
					<DrawerFooter className="p-4 border-t border-gray-800">
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => uiActions.closeDrawer('filters')}>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={() => {
									if (typeof window !== 'undefined') {
										window.scrollTo({ top: 0, behavior: 'smooth' })
									}
									uiActions.closeDrawer('filters')
									refetch()
								}}
							>
								Apply
							</Button>
						</div>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>

			<div className="p-3">
				<div className="space-y-2 text-sm">
					{notes
						.filter((wrapped: FetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id)
						.map((wrapped: FetchedNDKEvent) => (
							<NoteView key={(wrapped.event as any).id as string} note={wrapped.event} />
						))}
				</div>
			</div>
			{/* Floating Back-to-Top Button */}
			<Button
				variant="primary"
				className={`fixed bottom-4 right-4 z-40 h-10 w-10 rounded-full px-0 lg:w-auto lg:px-4 flex items-center justify-center shadow-lg transition-opacity transition-colors duration-200 ${showTop ? 'opacity-100' : 'opacity-0 pointer-events-none'} hover:text-pink-500 hover:bg-blend-luminosity hover:bg-black`}
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
