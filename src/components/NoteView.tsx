import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQuery } from '@tanstack/react-query'
import { authorQueryOptions } from '@/queries/authors.tsx'
import { threadStructureQueryOptions, type ThreadNode, type ThreadStructure, findRootFromETags } from '@/queries/thread.tsx'
import { reactionsQueryOptions } from '@/queries/reactions'
import { Link } from '@tanstack/react-router'
import { type JSX, type SVGProps, useEffect, useRef, useState, useMemo } from 'react'
import { useThreadOpen } from '@/state/threadOpenStore'

function SpoolIcon(props: SVGProps<SVGSVGElement>) {
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
			<path d="M12 3v18" />
			<path d="M8 7l4-4 4 4" />
			<path d="M8 17l4 4 4-4" />
		</svg>
	)
}

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

	function isMediaUrl(u: string): boolean {
		const exts = /\.(jpg|jpeg|png|webp|gif|mp4|mov)(?:$|[?#])/i
		try {
			const urlObj = new URL(u)
			return exts.test(urlObj.pathname)
		} catch {
			return exts.test(u)
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

		// Always render as a regular clickable link (no inline images)
		nodes.push(
			<a
				key={`u-${match.index}`}
				href={actual}
				target="_blank"
				rel="noopener noreferrer"
				className="text-blue-600 hover:underline break-words"
				onClick={onClick}
				title={isMediaUrl(actual) ? 'This media could be NSFW' : undefined}
			>
				{actual}
			</a>,
		)

		lastIndex = match.index + match[0].length
	}
	if (lastIndex < content.length) {
		nodes.push(content.slice(lastIndex))
	}
	return nodes
}

function CollapsibleContent({ children, className }: { children: any; className?: string }) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	const [needsClamp, setNeedsClamp] = useState(false)
	const [expanded, setExpanded] = useState(false)

	useEffect(() => {
		const check = () => {
			const el = containerRef.current
			if (!el) return
			const maxPx = Math.round(window.innerHeight * 0.25)
			// If scrollHeight is larger than 25vh, we need to clamp
			setNeedsClamp(el.scrollHeight > maxPx + 2)
		}
		check()
		window.addEventListener('resize', check)
		return () => window.removeEventListener('resize', check)
	}, [children])

	const onShowMore = (e: any) => {
		e.preventDefault()
		e.stopPropagation()
		setExpanded(true)
	}

	const baseWrapStyle = { overflowWrap: 'anywhere' as const, wordBreak: 'break-word' as const }
	const contentStyle = !expanded && needsClamp ? { maxHeight: '25vh', overflow: 'hidden' as const, ...baseWrapStyle } : baseWrapStyle

	return (
		<div>
			<div ref={containerRef} style={contentStyle} className={className}>
				{children}
			</div>
			{!expanded && needsClamp ? (
				<div className="relative -mt-8 pt-8">
					<div className="absolute inset-x-0 -top-8 h-16 bg-gradient-to-b from-transparent to-white pointer-events-none"></div>
					<button
						className="relative w-full text-sm text-blue-600 hover:underline bg-white/80 px-2 py-1 border rounded"
						onClick={onShowMore}
						title="Show more"
						aria-expanded={expanded}
					>
						Show more
					</button>
				</div>
			) : null}
		</div>
	)
}

interface NoteViewProps {
	note: NDKEvent
	readOnlyInThread?: boolean
	reactionsMap?: Record<string, Record<string, number>>
}

interface ThreadViewProps {
	threadStructure: ThreadStructure
	highlightedNoteId: string
	reactionsMap?: Record<string, Record<string, number>>
}

function ThreadNodeView({ node, highlightedNoteId, reactionsMap }: { node: ThreadNode; highlightedNoteId: string; reactionsMap?: Record<string, Record<string, number>> }) {
	const isHighlighted = node.id === highlightedNoteId
	const indentLevel = Math.min(node.depth, 5) // Limit indentation depth

	return (
		<div className="mb-2" data-highlighted={isHighlighted || undefined} data-node-id={node.id}>
			<div className="thread-node border-l pl-2 border-transparent" style={{ marginLeft: `${indentLevel * 16}px` }}>
				<NoteView note={node.event} readOnlyInThread reactionsMap={reactionsMap} />
			</div>
			{node.children.map((child) => (
				<ThreadNodeView key={child.id} node={child} highlightedNoteId={highlightedNoteId} reactionsMap={reactionsMap} />
			))}
		</div>
	)
}

function ThreadView({ threadStructure, highlightedNoteId, reactionsMap: propReactionsMap }: ThreadViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null)
	
	// Get the IDs of all notes in the thread structure
	const noteIds = useMemo(() => {
		const ids: string[] = []
		if (threadStructure && threadStructure.nodes) {
			threadStructure.nodes.forEach((node) => {
				if (node.id) {
					ids.push(node.id)
				}
			})
		}
		return ids
	}, [threadStructure])
	
	// Fetch reactions for all notes in the thread if not provided via props
	const { data: fetchedReactionsMap } = useQuery({
		...reactionsQueryOptions(noteIds),
		enabled: noteIds.length > 0 && !propReactionsMap,
	})
	
	// Use provided reactionsMap from props if available, otherwise use fetched data
	const reactionsMap = propReactionsMap || fetchedReactionsMap

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
				<ThreadNodeView key={rootNode.id} node={rootNode} highlightedNoteId={highlightedNoteId} reactionsMap={reactionsMap} />
			))}
		</div>
	)
}

export function NoteView({ note, readOnlyInThread, reactionsMap }: NoteViewProps) {
	// Remove a trailing hashtag-only line from the note content for display
	const displayContent = (() => {
		try {
			const raw = ((note as any)?.content || '') as string
			if (!raw) return raw
			const lines = raw.replace(/\r\n?/g, '\n').split('\n')
			let i = lines.length - 1
			while (i >= 0 && lines[i].trim() === '') i--
			if (i < 0) return raw
			const tokens = lines[i].trim().split(/\s+/)
			if (tokens.length === 0) return raw
			const hashRe = /^#([A-Za-z0-9_-]+)$/
			const onlyHashes = tokens.every((t) => hashRe.test(t))
			if (!onlyHashes) return raw
			const newLines = lines.slice(0, i)
			while (newLines.length > 0 && newLines[newLines.length - 1].trim() === '') newLines.pop()
			return newLines.join('\n')
		} catch {
			return ((note as any)?.content || '') as string
		}
	})()
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
			<div className="relative">
				{/*/!* Floating Close Thread button at top-right, matching Back-to-Top responsive text behavior *!/*/}
				{/*<button*/}
				{/*	className={`fixed top-24 right-14 z-40 h-10 w-10 rounded-full px-0 lg:w-auto lg:px-4 inline-flex items-center justify-center shadow-lg transition-opacity transition-colors duration-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-blue-600`}*/}
				{/*	onClick={() => setOpenThreadId(null)}*/}
				{/*	title="Close thread"*/}
				{/*	aria-label="Close thread"*/}
				{/*>*/}
				{/*	<span className="hidden lg:inline text-base leading-none p-0 m-0">close thread</span>*/}
				{/*	<CollapseVerticalIcon className="h-5 w-5 ml-0 lg:ml-2" />*/}
				{/*</button>*/}
				<div className="p-3 bg-white text-black border border-gray-700 rounded-lg">
					{isLoadingThread ? (
						<div className="text-sm text-gray-500">Loading thread...</div>
					) : threadStructure ? (
						<>
							<ThreadView threadStructure={threadStructure} highlightedNoteId={(note as any).id} reactionsMap={reactionsMap} />
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
			data-note-id={noteIdForThread}
			className={`group border p-3 z-20 rounded-lg  transition-colors duration-150 ${isClickablePanel ? 'hover:bg-gray-100' : 'hover:bg-gray-100/50'}`}
		>
			<div className="flex items-center justify-between mb-1" onClick={(e) => e.stopPropagation()}>
				{readOnlyInThread ? (
					<Link
						to={`/nostr?user=${note.pubkey}`}
						className="flex items-center  pr-2"
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							// Clear any open thread when switching to user view
							setOpenThreadId(null)
							try {
								const url = new URL(window.location.href)
								url.searchParams.delete('threadview')
								url.searchParams.set('user', String(note.pubkey))
								const target = url.pathname.startsWith('/nostr')
									? url.search
										? `/nostr${url.search}`
										: '/nostr'
									: url.search
										? `${url.pathname}${url.search}`
										: url.pathname
								window.history.pushState({}, '', target)
								window.dispatchEvent(new PopStateEvent('popstate'))
							} catch {
								window.location.href = `/nostr?user=${encodeURIComponent(String(note.pubkey))}`
							}
						}}
					>
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
					<Link
						to={`/nostr?user=${note.pubkey}`}
						className="flex items-center pr-2 hover:bg-grey-200"
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							// Clear any open thread when switching to user view
							setOpenThreadId(null)
							try {
								const url = new URL(window.location.href)
								url.searchParams.delete('threadview')
								url.searchParams.set('user', String(note.pubkey))
								const target = url.pathname.startsWith('/nostr')
									? url.search
										? `/nostr${url.search}`
										: '/nostr'
									: url.search
										? `${url.pathname}${url.search}`
										: url.pathname
								window.history.pushState({}, '', target)
								window.dispatchEvent(new PopStateEvent('popstate'))
							} catch {
								window.location.href = `/nostr?user=${encodeURIComponent(String(note.pubkey))}`
							}
						}}
					>
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
					{isClickablePanel ? (
						<button
							className={`h-8 w-8 inline-flex items-center justify-center text-xs rounded-full outline-none focus:outline-none focus:ring-0 border-0 transition-colors transition-shadow hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 hover:ring-offset-white ${
								showThread ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-white text-gray-600 hover:bg-gray-100'
							}`}
							aria-pressed={showThread}
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								if (openThreadId === noteIdForThread) {
									setOpenThreadId(null)
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
								} else {
									setOpenThreadId(noteIdForThread)
									try {
										const url = new URL(window.location.href)
										url.searchParams.set('threadview', noteIdForThread)
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
								}
							}}
							title={showThread ? 'Hide thread' : 'View thread'}
							aria-label={showThread ? 'Hide thread' : 'View thread'}
						>
							<SpoolIcon className="h-4 w-4 hover:bg-grey-300" />
						</button>
					) : null}
				</div>
			</div>
			<div className="flex gap-2">
				<div className="flex-1">
					{readOnlyInThread ? (
						<CollapsibleContent className="px-2 py-1 text-md text-left break-words whitespace-pre-wrap align-text-top w-full hover:bg-grey-300">
							{linkifyContent(displayContent, { stopPropagation: true })}
						</CollapsibleContent>
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
								<CollapsibleContent
									className={`px-2 py-1 text-md text-left break-words whitespace-pre-wrap align-text-top w-full rounded-md transition-colors duration-150 hover:bg-grey-300`}
								>
									{linkifyContent(displayContent, { stopPropagation: true })}
								</CollapsibleContent>
							)
						})()
					)}
				</div>
				<div className="flex flex-col justify-end">
					<button
						className="h-8 w-8 inline-flex items-center justify-center text-xs rounded-full bg-white text-gray-600 hover:bg-gray-100 outline-none focus:outline-none focus:ring-0 border-0"
						aria-pressed={showJson}
						aria-controls={`note-json-${(note as any)?.id ?? note.pubkey ?? Math.random().toString(36).slice(2)}`}
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							setShowJson((v) => !v)
						}}
						title={showJson ? 'Hide raw JSON' : 'Show raw JSON'}
					>
						&lt;/&gt;
					</button>
				</div>
			</div>
			{/* Reactions row (shown above hashtags) */}
			{(() => {
				try {
					const id = ((note as any)?.id || '') as string
		      const emap = id && reactionsMap ? reactionsMap[id] : undefined
					if (!emap) return null
					const entries = Object.entries(emap)
					if (entries.length === 0) return null
					return (
						<div className="mt-2 pt-2 border-t border-gray-200">
							<div className="text-xs text-gray-700 flex flex-wrap items-center gap-2">
								<span className="text-gray-500">Reactions:</span>
								{entries.map(([emo, cnt]) => (
									<span key={emo} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200">
										<span>{emo}</span>
										{cnt > 1 ? <span className="text-gray-500">{cnt}</span> : null}
									</span>
								))}
							</div>
						</div>
					)
				} catch {
					return null
				}
			})()}
			{/* Hashtags section */}
			{(() => {
				try {
					const tagsArr = Array.isArray((note as any)?.tags) ? ((note as any).tags as any[]) : []
					const tTags = tagsArr.filter((t) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string')
					const hashSet = new Set(tTags.map((t) => String(t[1]).replace(/^#/, '').trim()).filter((v) => v.length > 0))
					const hashtags = Array.from(hashSet)
					if (hashtags.length === 0) return null
					return (
						<div className="mt-2 pt-2 border-t border-gray-200">
							<div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
								<span className="text-gray-500">Hashtags:</span>
								{hashtags.map((tag) => (
									<Link
										key={tag}
										to={`/nostr?tag=${encodeURIComponent(tag)}`}
										className="text-blue-600 hover:underline"
										onClick={(e) => {
											e.preventDefault()
											e.stopPropagation()
											// Clear any open thread when switching to hashtag view
											setOpenThreadId(null)
											// Use window.location to ensure URL updates query param for the feed page
											try {
												const url = new URL(window.location.href)
												url.searchParams.delete('threadview')
												url.searchParams.set('tag', tag)
												// Preserve existing author filter if present
												const target = url.pathname.startsWith('/nostr')
													? url.search
														? `/nostr${url.search}`
														: '/nostr'
													: url.search
														? `${url.pathname}${url.search}`
														: url.pathname
												window.history.pushState({}, '', target)
												window.dispatchEvent(new PopStateEvent('popstate'))
											} catch {
												// Fallback navigation
												window.location.href = `/nostr?tag=${encodeURIComponent(tag)}`
											}
										}}
									>
										#{tag}
									</Link>
								))}
							</div>
						</div>
					)
				} catch {
					return null
				}
		   })()}
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
