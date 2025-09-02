import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { notesQueryOptions } from '@/queries/firehose'
import { NoteView } from '@/NoteView'

export const Route = createFileRoute('/nostr/')({
	component: FirehoseComponent,
})

function FirehoseComponent() {
	const { data, isLoading, isError, error } = useQuery(notesQueryOptions())

	if (isLoading) return <div>Loading feed…</div>
	if (isError) return <div className="text-red-600">Error loading feed: {(error as Error)?.message}</div>

	const notes = data || []

	if (notes.length === 0) {
		return <div>No notes found.</div>
	}

	return (
		<div className="space-y-4">
			{notes.map((note) => (
				<NoteView key={note.id} note={note} />
			))}
		</div>
	)
}
