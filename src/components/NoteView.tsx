import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { authorQueryOptions } from '@/queries/authors.tsx'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'

interface NoteViewProps {
	note: NDKEvent
}

export function NoteView({ note }: NoteViewProps) {
	const [showJson, setShowJson] = useState(false)
	const { data: author, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(note.pubkey))
	// Safely handle possible undefined or non-numeric created_at from NDKEvent
	const createdAtSeconds =
		typeof note.created_at === 'number'
			? note.created_at
			: typeof (note as any).created_at === 'string'
				? parseInt((note as any).created_at, 10)
				: undefined
	const createdAtMs = Number.isFinite(createdAtSeconds) && createdAtSeconds! > 0 ? createdAtSeconds! * 1000 : undefined

	// Determine if this note is a reply by checking for an ["e", "<id>", "reply"] tag
	const isReply = Array.isArray((note as any).tags)
		? ((note as any).tags as any[]).some((t: any) => (Array.isArray(t) && t[0] === 'e' && t[3] === 'reply') || note.kind == 1111)
		: false

	// For display next to reply indicator, prefer the local 'e' tag with marker 'root' (index 3), using its index 1 as the id
	const rootIdFromTags =
		Array.isArray((note as any).tags)
			? ((note as any).tags as any[]).find(
					(t: any) => Array.isArray(t) && t[0] === 'e' && t[3] === 'root' && typeof t[1] === 'string',
				)?.[1]
			: undefined
	const displayRootId = rootIdFromTags || (note.id as string | undefined) || ''

	return (
		<div className="border p-3 rounded-lg">
			<div className="flex items-center justify-between mb-1">
				<div className="flex items-center">
					<Link to={`/profile/${note.pubkey}`}>
						{isLoadingAuthor ? (
							<div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
						) : author?.picture ? (
							<img src={author.picture} alt={author.name || 'Profile'} className="w-10 h-10 rounded-full object-cover" />
						) : (
							<div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600">
								{author?.name?.[0]?.toUpperCase() || '?'}
							</div>
						)}
					</Link>
					<div className="ml-3">
						<Link to={`/profile/${note.pubkey}`}>
							<div className="font-medium">
								{isLoadingAuthor ? (
									<div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
								) : (
									author?.name || note.pubkey.slice(0, 8) + '...'
								)}
							</div>
						</Link>
						<div className="text-xs text-gray-500">{createdAtMs ? new Date(createdAtMs).toLocaleString() : 'Unknown date'}</div>
					</div>
				</div>
				<div className="ml-2 flex items-center gap-2">
					{isReply && (
						<div className="ml-2 flex items-center gap-1">
 						<span className="text-xs text-gray-500 font-mono break-all" title="Thread root id">
 							{displayRootId}
 						</span>
							<div className="text-lg" title="Reply" aria-label="Reply" role="img">↩</div>
						</div>
					)}
					<button
						className="px-2 py-1 text-xs border rounded hover:bg-gray-100 text-gray-600"
						aria-pressed={showJson}
 					aria-controls={`note-json-${(note as any)?.id ?? note.pubkey ?? Math.random().toString(36).slice(2)}`}
						onClick={() => setShowJson((v) => !v)}
						title={showJson ? 'Hide raw JSON' : 'Show raw JSON'}
					>
						&lt;/&gt;
					</button>
				</div>
			</div>
			<Link to="/nostr" className="p-3 break-words text-sm block hover:underline" title="Open thread">
				{note.content}
			</Link>
			{/* Raw event pretty printed */}
			{(() => {
				let raw: any
				try {
					raw = typeof (note as any).rawEvent === 'function' ? (note as any).rawEvent() : note
				} catch (e) {
					raw = note
				}
				let json = ''
				try {
					json = JSON.stringify(raw, null, 2)
				} catch (e) {
					json = String(raw)
				}
				return showJson ? (
					<pre
						id={`note-json-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
						className="mt-2 p-3 bg-gray-50 border rounded text-xs overflow-auto max-h-80 whitespace-pre-wrap"
					>
						{json}
					</pre>
				) : null
			})()}
		</div>
	)
}
