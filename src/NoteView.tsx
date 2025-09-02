import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { authorQueryOptions } from '@/queries/authors.tsx'
import { Link } from '@tanstack/react-router'

interface NoteViewProps {
	note: NDKEvent
	showJson?: boolean
}

export function NoteView({ note, showJson = false }: NoteViewProps) {
	const { data: author, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(note.pubkey))
	// Safely handle possible undefined or non-numeric created_at from NDKEvent
	const createdAtSeconds =
		typeof note.created_at === 'number'
			? note.created_at
			: typeof (note as any).created_at === 'string'
				? parseInt((note as any).created_at, 10)
				: undefined
	const createdAtMs = Number.isFinite(createdAtSeconds) && createdAtSeconds! > 0 ? createdAtSeconds! * 1000 : undefined

	return (
		<div className="border p-4 rounded-lg">
			<div className="flex items-center mb-3">
				{isLoadingAuthor ? (
					<div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
				) : author?.picture ? (
					<img src={author.picture} alt={author.name || 'Profile'} className="w-10 h-10 rounded-full object-cover" />
				) : (
					<div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600">
						{author?.name?.[0]?.toUpperCase() || '?'}
					</div>
				)}
				<div className="ml-3">
					<div className="font-medium">
						{isLoadingAuthor ? (
							<div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
						) : (
							author?.name || note.pubkey.slice(0, 8) + '...'
						)}
					</div>
					<div className="text-xs text-gray-500">{createdAtMs ? new Date(createdAtMs).toLocaleString() : 'Unknown date'}</div>
				</div>
			</div>
			<p>{note.content}</p>
			<Link to="/notes/$noteId" params={{ noteId: note.id }} className="text-sm text-blue-500 underline mb-2 block mt-2">
				{note.id.slice(0, 8)}...
			</Link>
			{showJson && <pre className="bg-gray-100 p-4 rounded-lg whitespace-pre-wrap mt-4">{JSON.stringify(note, null, 2)}</pre>}
		</div>
	)
}
