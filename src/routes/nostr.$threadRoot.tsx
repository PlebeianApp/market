import { createFileRoute, useParams, useSearch, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { threadQueryOptions, type ThreadEvent } from '@/queries/thread-view'
import { NoteView } from '@/NoteView'

export const Route = createFileRoute('/nostr/$threadRoot')({
	component: NostrThreadComponent,
})

function NostrThreadComponent() {
	const { threadRoot } = useParams({ from: '/nostr/$threadRoot' })
	const search = useSearch({ from: '/nostr/$threadRoot' }) as { note?: string }
	const { data, isLoading, isError, error } = useQuery(threadQueryOptions(threadRoot))

	if (isLoading) return <div className="p-4">Loading thread…</div>
	if (isError) return <div className="p-4 text-red-600">Error: {(error as Error)?.message}</div>

	const ordered = data?.ordered ?? []

	return (
		<div className="p-3 space-y-2">
			<div className="sticky top-20 z-30 m-0 p-3 px-4 bg-secondary-black text-secondary flex items-center justify-between">
				<span className="text-xl font-heading">Thread</span>
				<Link to="/nostr" className="text-sm underline">
					Back to Firehose
				</Link>
			</div>
			{ordered.length === 0 ? (
				<div>No events in this thread.</div>
			) : (
				<div className="space-y-2">
					{ordered.map((fe: ThreadEvent) => (
						<div
							key={(fe.event as any).id as string}
							style={{ marginLeft: `${fe.depth * 20}px` }}
							className={fe.depth > 0 ? 'border-l-2 border-gray-200 pl-3' : ''}
						>
							<NoteView note={fe.event} />
						</div>
					))}
				</div>
			)}
		</div>
	)
}
