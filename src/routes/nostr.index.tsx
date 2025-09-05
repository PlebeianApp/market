import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { notesQueryOptions, type FetchedNDKEvent } from '@/queries/firehose'
import { NoteView } from '@/components/NoteView.tsx'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const { data, isLoading, isError, error, refetch, isFetching } = useQuery(notesQueryOptions())

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
						<span>Filter</span>
						<Button
							variant="primary"
							className="p-2 h-8 w-8 flex items-center justify-center"
							onClick={() => {
								if (typeof window !== 'undefined') {
									window.scrollTo({ top: 0, behavior: 'smooth' })
								}
								refetch()
							}}
							title="Reload feed"
						>
							{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="i-refresh w-4 h-4" />}↻
						</Button>
					</div>
				</section>
			</div>
			<div className="p-3">
				<div className="space-y-2 text-sm">
					{notes
						.filter((wrapped: FetchedNDKEvent | undefined) => !!wrapped && !!wrapped.event && !!(wrapped.event as any).id)
						.map((wrapped: FetchedNDKEvent) => (
							<NoteView key={(wrapped.event as any).id as string} note={wrapped.event} />
						))}
				</div>
			</div>
			<div className="w-full p-4 flex items-center justify-center">
				<Button
					variant="primary"
					className="p-2 flex items-center justify-center"
					onClick={() => {
						if (typeof window !== 'undefined') {
							window.scrollTo({ top: 0, behavior: 'smooth' })
						}
					}}
				>
					back to top
				</Button>
			</div>
		</div>
	)
}
