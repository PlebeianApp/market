import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { authorQueryOptions } from '@/queries/authors.tsx'
import { threadStructureQueryOptions, type ThreadNode, type ThreadStructure, findRootFromETags } from '@/queries/thread.tsx'
import { Link } from '@tanstack/react-router'
import { type JSX, useEffect, useRef, useState } from 'react'

function linkifyContent(content: string, opts?: { stopPropagation?: boolean }) {
	// Basic URL regex for http/https, stop at whitespace or angle bracket
	const urlRegex = /(https?:\/\/[^\s<]+)/gi
	const nodes: (string | JSX.Element)[] = []
	let lastIndex = 0
	let match: RegExpExecArray | null

	function isImageUrl(u: string): boolean {
		try {
			const urlObj = new URL(u)
			const pathname = urlObj.pathname.toLowerCase()
			// Include common browser-renderable formats
			return /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|apng)(?:$|\?)/i.test(pathname)
		} catch {
			// Fallback simple test when URL constructor fails
			return /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|apng)(?:$|\?)/i.test(u.toLowerCase())
		}
	}

	while ((match = urlRegex.exec(content)) !== null) {
		const url = match[1]
		// push preceding text
		if (match.index > lastIndex) {
			nodes.push(content.slice(lastIndex, match.index))
		}
		// Trim common trailing punctuation without breaking parentheses balance
		let display = url
		let actual = url
		const trailing = [')', '.', ',', '!', '?', ':', ';']
		while (trailing.includes(display.slice(-1))) {
			// avoid stripping matching ) if there is an unmatched (
			if (display.endsWith(')')) {
				const left = (display.match(/\(/g) || []).length
				const right = (display.match(/\)/g) || []).length
				if (right <= left) break
			}
			display = display.slice(0, -1)
		}
		actual = display
		const onClick: React.MouseEventHandler<HTMLAnchorElement> | undefined = opts?.stopPropagation
			? (e) => {
					e.preventDefault()
					e.stopPropagation()
					try {
						window.open(actual, '_blank', 'noopener,noreferrer')
					} catch {}
				}
			: undefined

		if (isImageUrl(actual)) {
			// Render image inline within a separating block, clickable only on the image itself
			nodes.push(
				<div key={`img-${match.index}`} className="my-2 w-full">
					<img
						src={actual}
						alt={actual}
						className="max-w-full h-auto rounded border border-gray-200 max-h-[50vh] object-contain cursor-pointer"
						loading="lazy"
						onClick={(e) => {
							if (opts?.stopPropagation) {
								e.stopPropagation()
								e.preventDefault()
							}
							try {
								window.open(actual, '_blank', 'noopener,noreferrer')
							} catch {}
						}}
					/>
				</div>,
			)
		} else {
			// Fallback to regular clickable link
			nodes.push(
				<a
					key={`u-${match.index}`}
					href={actual}
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-600 hover:underline break-words"
					onClick={onClick}
				>
					{actual}
				</a>,
			)
		}

		lastIndex = match.index + match[0].length
	}
	if (lastIndex < content.length) {
		nodes.push(content.slice(lastIndex))
	}
	return nodes
}

interface NoteViewProps {
	note: NDKEvent
	readOnlyInThread?: boolean
}

interface ThreadViewProps {
	threadStructure: ThreadStructure
	highlightedNoteId: string
}

function ThreadNodeView({ node, highlightedNoteId }: { node: ThreadNode; highlightedNoteId: string }) {
	const isHighlighted = node.id === highlightedNoteId
	const indentLevel = Math.min(node.depth, 5) // Limit indentation depth

	return (
		<div className="mb-2" data-highlighted={isHighlighted || undefined} data-node-id={node.id}>
			<div className="thread-node border-l pl-2 border-transparent" style={{ marginLeft: `${indentLevel * 16}px` }}>
				<NoteView note={node.event} readOnlyInThread />
			</div>
			{node.children.map((child) => (
				<ThreadNodeView key={child.id} node={child} highlightedNoteId={highlightedNoteId} />
			))}
		</div>
	)
}

function ThreadView({ threadStructure, highlightedNoteId }: ThreadViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		// Wait one frame to ensure children are rendered
		const id = requestAnimationFrame(() => {
			try {
				const container = containerRef.current
				if (!container) return
				const highlighted = container.querySelector('[data-highlighted="true"]') as HTMLElement | null
				if (highlighted) {
					// Center the highlighted note in the visible area of the thread panel
					highlighted.scrollIntoView({
						block: 'center',
						inline: 'nearest',
						behavior: 'smooth',
					})
				}
			} catch {}
		})
		return () => cancelAnimationFrame(id)
	}, [threadStructure, highlightedNoteId])
	return (
		<div ref={containerRef} className="text-sm">
			{/*<div className="mb-2 text-xs text-gray-600 font-medium">Thread ({threadStructure.nodes.size} notes)</div>*/}
			{threadStructure.tree.map((rootNode) => (
				<ThreadNodeView key={rootNode.id} node={rootNode} highlightedNoteId={highlightedNoteId} />
			))}
		</div>
	)
}

import { useThreadOpen } from '@/state/threadOpenStore'

export function NoteView({ note, readOnlyInThread }: NoteViewProps) {
	const [showJson, setShowJson] = useState(false)
	const { openThreadId, setOpenThreadId } = useThreadOpen()
	const noteIdForThread = ((note as any)?.id || findRootFromETags?.(note) || '') as string
	const showThread = !readOnlyInThread && openThreadId === noteIdForThread
	const { data: author, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(note.pubkey))
	const noteId = (note as any)?.id || findRootFromETags?.(note) || ''
	const { data: threadStructure, isLoading: isLoadingThread } = useQuery(threadStructureQueryOptions(noteId))
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
	const rootIdFromTags = Array.isArray((note as any).tags)
		? ((note as any).tags as any[]).find((t: any) => Array.isArray(t) && t[0] === 'e' && t[3] === 'root' && typeof t[1] === 'string')?.[1]
		: undefined
	const displayRootId = rootIdFromTags || (note.id as string | undefined) || ''

	// Determine if the whole panel should show a darker hover (only when clickable)
	const isClickablePanel = !readOnlyInThread && !isLoadingThread && !!threadStructure && (threadStructure.nodes?.size || 0) > 1

	// When thread is open (and not rendering inside thread), replace whole frame with a single combined thread panel
	if (!readOnlyInThread && openThreadId === noteIdForThread) {
		return (
			<div>
				<div className="p-3 bg-black text-white border border-gray-700 rounded-lg">
					<div className="mb-2 flex items-center justify-end">
						<button
							className="ml-auto text-xs px-2 py-1 border rounded hover:bg-gray-100"
							onClick={() => setOpenThreadId(null)}
							title="Close thread"
						>
							Close thread
						</button>
					</div>
					{isLoadingThread ? (
						<div className="text-sm text-gray-500">Loading thread...</div>
					) : threadStructure ? (
						<>
							<ThreadView threadStructure={threadStructure} highlightedNoteId={(note as any).id} />
						</>
					) : (
						<div className="text-sm text-gray-500">No thread data available</div>
					)}
				</div>
			</div>
		)
	}
	return (
		<div
			className={`group border p-3 z-20 rounded-lg  transition-colors duration-150 ${isClickablePanel ? 'hover:bg-gray-100' : 'hover:bg-gray-100/50'}`}
			role={isClickablePanel ? 'button' : undefined}
			tabIndex={isClickablePanel ? 0 : undefined}
			onClick={
				isClickablePanel
					? () => {
							// Toggle the thread view when clicking anywhere on the panel (except header)
							if (openThreadId === noteIdForThread) {
								setOpenThreadId(null)
							} else {
								setOpenThreadId(noteIdForThread)
							}
						}
					: undefined
			}
			onKeyDown={
				isClickablePanel
					? (e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								if (openThreadId === noteIdForThread) {
									setOpenThreadId(null)
								} else {
									setOpenThreadId(noteIdForThread)
								}
							}
						}
					: undefined
			}
		>
			<div className="flex items-center justify-between mb-1" onClick={(e) => e.stopPropagation()}>
				{readOnlyInThread ? (
					<Link to={`/profile/${note.pubkey}`} className="flex items-center  pr-2" onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center  pr-2 hover:bg-gray-100">
							<div>
								{isLoadingAuthor ? (
									<div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
								) : author?.picture ? (
									<img src={author.picture} alt={author.name || 'Profile'} className="w-10 h-10 rounded-full object-cover" />
								) : (
									<div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600">
										{author?.name?.[0]?.toUpperCase() || '?'}
									</div>
								)}
							</div>
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
					</Link>
				) : (
					<Link to={`/profile/${note.pubkey}`} className="flex items-center pr-2 hover:bg-grey-200" onClick={(e) => e.stopPropagation()}>
						<div>
							{isLoadingAuthor ? (
								<div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse"></div>
							) : author?.picture ? (
								<img src={author.picture} alt={author.name || 'Profile'} className="w-10 h-10 rounded-full object-cover" />
							) : (
								<div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600">
									{author?.name?.[0]?.toUpperCase() || '?'}
								</div>
							)}
						</div>
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
					</Link>
				)}
				<div className="ml-2 flex items-center gap-2">
					<button
						className="h-8 w-8 inline-flex items-center justify-center text-xs rounded-full bg-white text-gray-600 hover:bg-gray-100 outline-none focus:outline-none focus:ring-0 border-0"
						aria-pressed={showJson}
						aria-controls={`note-json-${(note as any)?.id ?? note.pubkey ?? Math.random().toString(36).slice(2)}`}
						onClick={() => setShowJson((v) => !v)}
						title={showJson ? 'Hide raw JSON' : 'Show raw JSON'}
					>
						&lt;/&gt;
					</button>
				</div>
			</div>
			{readOnlyInThread ? (
				<div className="px-2 py-1 text-md text-left break-words whitespace-pre-wrap align-text-top w-full hover:bg-grey-300">
					{note.content}
				</div>
			) : (
				(() => {
					const hasThreadItems = !!threadStructure && (threadStructure.nodes?.size || 0) > 1
					const disabled = !isLoadingThread && !hasThreadItems
					const handleClick = () => {
						if (disabled) return
						// Open this thread and implicitly close others by setting global openThreadId
						if (openThreadId === noteIdForThread) {
							setOpenThreadId(null)
						} else {
							setOpenThreadId(noteIdForThread)
						}
					}
					return (
						<div
							className={`px-2 py-1 text-md text-left break-words whitespace-pre-wrap align-text-top w-full rounded-md transition-colors cursor-pointer duration-150`}
						>
							{linkifyContent(note.content, { stopPropagation: true })}
						</div>
					)
				})()
			)}
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
