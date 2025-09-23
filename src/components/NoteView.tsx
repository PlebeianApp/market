import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authorQueryOptions } from '@/queries/authors.tsx'
import {
	enhancedThreadStructureQueryOptions,
	type EnhancedThreadNode,
	type EnhancedThreadStructure,
	findRootFromETags,
} from '@/queries/enhanced-thread.tsx'
import { updateEventDisplayTime } from '@/queries/enhanced-firehose'
import { nip19 } from 'nostr-tools'
import { reactionsQueryOptions } from '@/queries/reactions'
import { Link } from '@tanstack/react-router'
import { type JSX, type SVGProps, useEffect, useRef, useState, useMemo } from 'react'
import { useThreadOpen } from '@/state/threadOpenStore'
import { useAuth } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { Button } from '@/components/ui/button'
import EmojiPicker from 'emoji-picker-react'
import { toast } from 'sonner'
import { writeRelaysUrls } from '@/lib/constants'

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
	threadStructure: EnhancedThreadStructure
	highlightedNoteId: string
	reactionsMap?: Record<string, Record<string, number>>
}

function ThreadNodeView({
	node,
	highlightedNoteId,
	reactionsMap,
}: {
	node: EnhancedThreadNode
	highlightedNoteId: string
	reactionsMap?: Record<string, Record<string, number>>
}) {
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

	// Determine if the provided reactions map covers all thread notes
	const hasSufficientReactions = useMemo(() => {
		if (!propReactionsMap) return false
		for (const id of noteIds) {
			if (!propReactionsMap[id]) return false
		}
		return true
	}, [propReactionsMap, noteIds])

	// Fetch reactions for all notes in the thread when needed
	const { data: fetchedReactionsMap } = useQuery<Record<string, Record<string, number>>>(
		{
			...reactionsQueryOptions(noteIds),
			enabled: noteIds.length > 0 && !hasSufficientReactions,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			keepPreviousData: true,
			staleTime: 60_000,
		} as any,
	)

	// Use provided reactionsMap only if it fully covers the thread; otherwise, use fetched data
	const reactionsMap: Record<string, Record<string, number>> | undefined = hasSufficientReactions
		? propReactionsMap
		: fetchedReactionsMap || undefined

	useEffect(() => {
		// Wait one frame to ensure children are rendered
		const id = requestAnimationFrame(() => {
			try {
				const container = containerRef.current
				if (!container) return
				const targetEl = container.querySelector(`[data-node-id="${highlightedNoteId}"]`) as HTMLElement | null
				if (!targetEl) return
				const rect = targetEl.getBoundingClientRect()
				const scrollTop = window.pageYOffset || document.documentElement.scrollTop
				const elementCenterOffset = rect.top + rect.height / 2
				const viewportCenter = window.innerHeight / 2
				const desiredTop = scrollTop + (elementCenterOffset - viewportCenter)
				window.scrollTo({ top: Math.max(0, desiredTop) })
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
	// Access query client for optimistic updates
	const queryClient = useQueryClient()

	// Reference to track note visibility
	const noteRef = useRef<HTMLDivElement>(null)

	// Set up intersection observer to track when note is displayed
	useEffect(() => {
		// Get the note ID
		const noteId = (note as any)?.id
		if (!noteId || !noteRef.current) return

		// Create observer to track visibility
		const observer = new IntersectionObserver(
			(entries) => {
				// When note becomes visible
				if (entries[0].isIntersecting) {
					// Update the display timestamp
					updateEventDisplayTime(noteId)
				}
			},
			{ threshold: 0.5 }, // Consider visible when 50% of note is in viewport
		)

		// Start observing the note element
		observer.observe(noteRef.current)

		// Clean up observer on unmount
		return () => {
			observer.disconnect()
		}
	}, [note])

	// Memoized reactions computation to prevent re-rendering
	const reactionsData = useMemo(() => {
		try {
			const id = ((note as any)?.id || '') as string
			const emap = id && reactionsMap ? reactionsMap[id] : undefined
			const entries = emap ? Object.entries(emap) : []
			return { id, entries }
		} catch {
			return { id: '', entries: [] }
		}
	}, [note, reactionsMap])

	// Memoized hashtags computation to prevent re-rendering
	const hashtagsData = useMemo(() => {
		try {
			const tagsArr = Array.isArray((note as any)?.tags) ? ((note as any).tags as any[]) : []
			const tTags = tagsArr.filter((t) => Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string')
			const hashSet = new Set(tTags.map((t) => String(t[1]).replace(/^#/, '').trim()).filter((v) => v.length > 0))
			const hashtags = Array.from(hashSet)
			return hashtags
		} catch {
			return []
		}
	}, [note])

	// Process note content based on kind and format for display
	const displayContent = (() => {
		try {
			// Check if this is a kind 6 repost event
			const kind = (note as any)?.kind

			// For kind 6 (repost), try to extract content from the embedded note
			if (kind === 6) {
				// The content of a kind 6 event should be the JSON of the reposted note
				const raw = ((note as any)?.content || '') as string
				if (!raw) return ''

				try {
					// Try to parse the JSON to extract the reposted note
					const repostedNote = JSON.parse(raw)
					// Use the content from the reposted note
					if (repostedNote && typeof repostedNote.content === 'string') {
						return repostedNote.content
					}
				} catch (jsonError) {
					console.warn('Failed to parse repost content JSON:', jsonError)
					// Fallback to showing raw content or a placeholder
					return raw.length > 100 ? raw.substring(0, 100) + '...' : raw
				}
			}

			// For other kinds, process normally
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
		} catch (error) {
			console.error('Error processing note content:', error)
			return ((note as any)?.content || '') as string
		}
	})()
	// Define view mode constants
	const VIEW_MODE = {
		NONE: 'none',
		JSON: 'json',
		REPLY: 'reply',
		QUOTE: 'quote',
		REPOST: 'repost',
	} as const

	const [viewMode, setViewMode] = useState<(typeof VIEW_MODE)[keyof typeof VIEW_MODE]>(VIEW_MODE.NONE)
	// Separate state for reply and quote modes
	const [replyText, setReplyText] = useState('')
	const [replyImages, setReplyImages] = useState<File[]>([])
	const [quoteText, setQuoteText] = useState('')
	const [quoteImages, setQuoteImages] = useState<File[]>([])
	const [showEmojiPicker, setShowEmojiPicker] = useState(false)
	// Flag to track if a repost is in progress
	const [isReposting, setIsReposting] = useState(false)

	// Create refs outside of conditional rendering
	const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null)
	const quoteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

	// Create a NIP-19 nevent entity for the note with relay hints
	const createNip19NoteReference = () => {
		try {
			// Get the note ID
			const id = (note as any)?.id || ''
			if (!id) return ''

			// Get relay hints from the note tags
			const relays: string[] = []
			if (Array.isArray((note as any)?.tags)) {
				const relayTags = ((note as any).tags as any[]).filter(
					(t) => Array.isArray(t) && t[0] === 'r' && typeof t[1] === 'string' && t[1].startsWith('wss://'),
				)
				relayTags.forEach((tag) => {
					if (!relays.includes(tag[1])) {
						relays.push(tag[1])
					}
				})
			}

			// Add some default relays if none are found
			if (relays.length === 0) {
				relays.push('wss://relay.damus.io', 'wss://nos.lol')
			}

			// Create the NIP-19 nevent entity
			return nip19.neventEncode({
				id,
				relays,
				author: note.pubkey,
			})
		} catch (error) {
			console.error('Error creating NIP-19 note reference:', error)
			return ''
		}
	}

	// Create NIP-19 reference for quote functionality
	const nip19Reference = useMemo(() => createNip19NoteReference(), [note])

	// Handle quote mode text setting and cursor positioning
	useEffect(() => {
		if (viewMode === VIEW_MODE.QUOTE && !quoteText && nip19Reference) {
			// Set initial text with a blank line at the top
			setQuoteText(`\nnostr:${nip19Reference}`)

			// Focus the textarea and set cursor to the start
			setTimeout(() => {
				if (quoteTextareaRef.current) {
					quoteTextareaRef.current.focus()
					quoteTextareaRef.current.setSelectionRange(0, 0)
				}
			}, 50)
		}
	}, [viewMode, nip19Reference, quoteText])
	const { openThreadId, setOpenThreadId, feedScrollY, setFeedScrollY, clickedEventId, setClickedEventId } = useThreadOpen()
	const isLastViewedThread = useMemo(() => {
		try {
			const currentId = ((note as any)?.id || '') as string
			return !!currentId && clickedEventId === currentId
		} catch {
			return false
		}
	}, [clickedEventId, note])
	const { isAuthenticated } = useAuth()
	const noteIdForThread = ((note as any)?.id || findRootFromETags?.(note) || '') as string
	const showThread = !readOnlyInThread && openThreadId === noteIdForThread
	const { data: author, isLoading: isLoadingAuthor } = useQuery(authorQueryOptions(note.pubkey))
	const noteId = (note as any)?.id || findRootFromETags?.(note) || ''
	// Only load thread data if we're viewing a thread or inside a thread to improve initial feed performance
	const [isHovering, setIsHovering] = useState(false)
	// Use delayed hover state to prevent loading thread data during quick scrolling/browsing
	const [delayedHover, setDelayedHover] = useState(false)

	// Set up delay for hover loading to prevent unnecessary loads during quick scrolling
	useEffect(() => {
		let timerId: NodeJS.Timeout | null = null
		if (isHovering) {
			timerId = setTimeout(() => {
				setDelayedHover(true)
			}, 500) // 500ms delay before loading thread data on hover
		} else {
			setDelayedHover(false)
		}
		return () => {
			if (timerId) clearTimeout(timerId)
		}
	}, [isHovering])

	// Track note visibility to prioritize thread loading from top of list
	const [isVisible, setIsVisible] = useState(false)

	// Set up intersection observer to detect when notes are visible
	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					setIsVisible(true)
				}
			},
			{ threshold: 0.1 }, // 10% visibility is enough to trigger
		)

		if (noteRef.current) {
			observer.observe(noteRef.current)
		}

		return () => {
			if (noteRef.current) {
				observer.unobserve(noteRef.current)
			}
		}
	}, [])

	// Immediate thread loading for visible notes, to prioritize top of list
	// Once a note is visible, we'll always keep its isVisible state true even if scrolled away
	// This ensures we fetch thread data immediately for notes at the top of the list
	const needsThreadData = showThread || readOnlyInThread || delayedHover || isVisible
	const { data: threadStructure, isLoading: isLoadingThread } = useQuery({
		...enhancedThreadStructureQueryOptions(noteId),
		enabled: needsThreadData,
		// Prevent any automatic refetches while viewing a thread to stop reloads
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchInterval: false,
		staleTime: Infinity,
	})
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
	// Show clickable appearance by default for top-level notes until we know it doesn't have replies
	const isClickablePanel =
		!readOnlyInThread &&
		(!needsThreadData || (needsThreadData && !isLoadingThread && !!threadStructure && (threadStructure.nodes?.size || 0) > 1))

	// When thread is open (and not rendering inside thread), replace whole frame with a single combined thread panel
	if (!readOnlyInThread && openThreadId === noteIdForThread) {
		return (
			<div className="relative">
				<div className="p-3 bg-white text-black border border-gray-700 rounded-lg">
					{isLoadingThread ? (
						<div className="text-sm text-gray-500">Loading thread...</div>
					) : threadStructure ? (
						<>
							<ThreadView
								threadStructure={threadStructure}
								highlightedNoteId={(clickedEventId || (note as any).id) as string}
								reactionsMap={reactionsMap}
							/>
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
			ref={noteRef}
			data-note-id={noteIdForThread}
			data-last-viewed={isLastViewedThread || undefined}
			className={`group border p-3 z-20 rounded-lg transition-colors duration-150 ${isClickablePanel ? 'hover:bg-gray-100' : 'hover:bg-gray-100/50'} ${isLastViewedThread ? 'bg-primary/10 ring-2 ring-primary' : ''}`}
			onMouseEnter={() => !readOnlyInThread && setIsHovering(true)}
			onMouseLeave={() => !readOnlyInThread && setIsHovering(false)}
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
								// Keep only user param
								url.search = ''
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
								<div className="font-medium flex items-center">
									{isLoadingAuthor ? (
										<div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
									) : (
										<>
											{author?.name || note.pubkey.slice(0, 8) + '...'}
											{(note as any)?.kind === 6 && (
												<span className="ml-2 text-xs text-gray-500 bg-gray-100 px-1 rounded" title="Reposted note">
													Repost
												</span>
											)}
										</>
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
								// Keep only user param
								url.search = ''
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
							<div className="font-medium flex items-center">
								{isLoadingAuthor ? (
									<div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div>
								) : (
									<>
										{author?.name || note.pubkey.slice(0, 8) + '...'}
										{(note as any)?.kind === 6 && (
											<span className="ml-2 text-xs text-gray-500 bg-gray-100 px-1 rounded" title="Reposted note">
												Repost
											</span>
										)}
									</>
								)}
							</div>
							<div className="text-xs text-gray-500">{createdAtMs ? new Date(createdAtMs).toLocaleString() : 'Unknown date'}</div>
						</div>
					</Link>
				)}
				<div className="ml-2 flex items-center gap-2">
					{!readOnlyInThread && (needsThreadData ? !!threadStructure && (threadStructure.nodes?.size || 0) > 1 : true) ? (
						<button
 						className={`h-8 w-8 inline-flex items-center justify-center text-xs rounded-full outline-none focus:outline-none focus:ring-0 border-0 transition-colors transition-shadow hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 hover:ring-offset-white ${showThread || isLastViewedThread ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
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
										window.history.replaceState({}, '', target)
										window.dispatchEvent(new PopStateEvent('popstate'))
									} catch {}
									// Restore scroll position if we saved one
									try {
										if (typeof window !== 'undefined' && feedScrollY != null) {
											window.scrollTo({ top: feedScrollY })
											setFeedScrollY(null)
										}
									} catch {}
								} else {
									// Save current feed scroll before opening thread
									try {
										if (typeof window !== 'undefined') setFeedScrollY(window.scrollY)
									} catch {}
									setOpenThreadId(noteIdForThread)
									setClickedEventId(((note as any)?.id || '') as string)
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
							{isLoadingThread && delayedHover ? (
								<span className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
							) : (
								<SpoolIcon className="h-4 w-4 hover:bg-grey-300" />
							)}
						</button>
					) : null}
					{/* Right-side actions: reply, repost, quote (icons only on <1024px; icon + label on wide) */}
					{isAuthenticated && (
						<div className="flex items-center gap-2">
							<button
								className="h-8 rounded-full bg-white text-gray-700 hover:bg-gray-100 px-2 inline-flex items-center gap-1 border border-gray-200"
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									console.log('reply')
									setViewMode((v) => (v === VIEW_MODE.REPLY ? VIEW_MODE.NONE : VIEW_MODE.REPLY))
								}}
								title={viewMode === VIEW_MODE.REPLY ? 'Hide reply' : 'Reply to this note'}
								aria-label="reply"
								aria-pressed={viewMode === VIEW_MODE.REPLY}
							>
								<span aria-hidden>🗨</span>
								<span className="hidden lg:inline">reply</span>
							</button>
							{viewMode === VIEW_MODE.REPOST ? (
								<button
									className="h-8 rounded-full bg-secondary text-white hover:bg-secondary/90 px-2 inline-flex items-center gap-1 border border-secondary"
									onClick={async (e) => {
										e.preventDefault()
										e.stopPropagation()
										// Implement repost functionality (publishing kind 6 event)
										if (isReposting) return

										setIsReposting(true)
										try {
											// Get NDK instance
											const ndk = ndkActions.getNDK()
											if (!ndk) {
												toast.error('Not connected to Nostr network')
												setIsReposting(false)
												return
											}

											const signer = ndkActions.getSigner()
											if (!signer) {
												toast.error('Please log in to repost')
												setIsReposting(false)
												return
											}

											// Validate that note has a valid ID
											const noteId = (note as any)?.id || ''
											if (!noteId) {
												toast.error('Cannot repost: Note ID is missing or invalid')
												setIsReposting(false)
												return
											}

											// Show loading toast
											const loadingToastId = toast.loading('Reposting...')

											// Create repost event (kind 6)
											const event = new NDKEvent(ndk)
											event.kind = 6

											// Set content to stringified JSON of the reposted note
											try {
												const noteJson = note.rawEvent ? note.rawEvent() : note
												event.content = JSON.stringify(noteJson)
											} catch (error) {
												console.error('Error stringifying note:', error)
												event.content = ''
											}

											// Add tags
											event.tags = []

											// Add e tag with the ID of the note being reposted
											event.tags.push(['e', noteId, '', ''])

											// Add p tag with the pubkey of the author of the reposted note
											event.tags.push(['p', note.pubkey])

											// Sign and publish the event
											await event.sign(signer)

											// Create a relay set for publishing
											const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
											await event.publish(publishRelaySet)

											console.log('Repost published successfully:', event.id)
											console.log('Published event JSON:', JSON.stringify(event.rawEvent()))

											// Show success message
											toast.dismiss(loadingToastId)
											toast.success('Repost published successfully!')

											// Reset view mode
											setViewMode(VIEW_MODE.NONE)
										} catch (error) {
											console.error('Failed to repost:', error)
											toast.error('Failed to repost. Please try again.')
										} finally {
											setIsReposting(false)
										}
									}}
									title="Send repost"
									aria-label="send repost"
									disabled={isReposting}
								>
									<span aria-hidden>♻</span>
									<span className="lg:inline">SNED!</span>
								</button>
							) : (
								<button
									className="h-8 rounded-full bg-white text-gray-700 hover:bg-gray-100 px-2 inline-flex items-center gap-1 border border-gray-200"
									onClick={(e) => {
										e.preventDefault()
										e.stopPropagation()
										console.log('Toggle repost mode')
										setViewMode((v) => (v === VIEW_MODE.REPOST ? VIEW_MODE.NONE : VIEW_MODE.REPOST))
									}}
									title="Repost this note"
									aria-label="repost"
									aria-pressed={false}
								>
									<span aria-hidden>♻</span>
									<span className="hidden lg:inline">repost</span>
								</button>
							)}
							<button
								className="h-8 rounded-full bg-white text-gray-700 hover:bg-gray-100 px-2 inline-flex items-center gap-1 border border-gray-200"
								onClick={(e) => {
									e.preventDefault()
									e.stopPropagation()
									console.log('Toggle quote mode')
									setViewMode((v) => (v === VIEW_MODE.QUOTE ? VIEW_MODE.NONE : VIEW_MODE.QUOTE))
								}}
								title={viewMode === VIEW_MODE.QUOTE ? 'Hide quote' : 'Quote this note'}
								aria-label="quote"
								aria-pressed={viewMode === VIEW_MODE.QUOTE}
							>
								<span aria-hidden>💬</span>
								<span className="hidden lg:inline">quote</span>
							</button>
						</div>
					)}
				</div>
			</div>
			<div className="flex gap-2">
				<div className="flex-1">
					{readOnlyInThread ? (
						<CollapsibleContent className="px-2 py-1 text-md text-left break-words whitespace-pre-wrap align-text-top w-full hover:bg-grey-300 aria-hidden:true">
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
						aria-pressed={viewMode === VIEW_MODE.JSON}
						aria-controls={`note-json-${(note as any)?.id ?? note.pubkey ?? Math.random().toString(36).slice(2)}`}
						onClick={(e) => {
							e.preventDefault()
							e.stopPropagation()
							console.log('Toggle JSON view')
							setViewMode((v) => (v === VIEW_MODE.JSON ? VIEW_MODE.NONE : VIEW_MODE.JSON))
						}}
						title={viewMode === VIEW_MODE.JSON ? 'Hide raw JSON' : 'Show raw JSON'}
					>
						&lt;/&gt;
					</button>
				</div>
			</div>
			{/* Reactions row (shown above hashtags) */}
			<div className="mt-2 pt-2 border-t border-gray-200">
				<div className="text-xs text-gray-700 flex flex-wrap items-center gap-2">
					<span className="text-gray-500">Reactions:</span>
					{reactionsData.entries.map(([emo, cnt]) => (
						<button
							key={emo}
							className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 hover:bg-gray-200 focus:outline-none"
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								try {
									const url = new URL(window.location.href)
									// Keep only view and emoji
									url.search = ''
									url.searchParams.set('view', 'reactions')
									url.searchParams.set('emoji', emo)
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
									window.location.href = `/nostr?view=reactions&emoji=${encodeURIComponent(emo)}`
								}
							}}
							title={`Open reactions feed for ${emo}`}
							aria-label={`Open reactions feed for ${emo}`}
						>
							<span>{emo}</span>
							{cnt > 1 ? <span className="text-gray-500">{cnt}</span> : null}
						</button>
					))}
				</div>
			</div>
			{/* Hashtags section */}
			<div className="mt-2 pt-2 border-t border-gray-200">
				<div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
					<span className="text-gray-500">Hashtags:</span>
					{hashtagsData.map((tag) => (
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
			{/* Panel for different view modes */}
			{(() => {
				// Different content based on viewMode
				if (viewMode === VIEW_MODE.NONE) {
					return null
				} else if (viewMode === VIEW_MODE.JSON) {
					// Raw JSON view
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

					return (
						<pre
							id={`note-json-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
							className="mt-2 p-3 bg-gray-50 border rounded text-xs overflow-auto max-h-80 whitespace-pre-wrap"
						>
							{json}
						</pre>
					)
				} else if (viewMode === VIEW_MODE.REPLY) {
					// Reply compose panel
					return (
						<div
							id={`note-compose-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
							className="mt-2 border rounded overflow-hidden min-h-[150px] flex flex-col"
						>
							<div className="bg-white border-b border-gray-200 flex flex-col flex-1">
								<div className="flex items-stretch gap-2 p-3 flex-1">
									<div className="flex-1 flex flex-col w-all">
										<textarea
											ref={replyTextareaRef}
											value={replyText}
											onChange={(e) => setReplyText(e.target.value)}
											placeholder="Write a reply..."
											className="w-full p-2 rounded-md border border-black/20 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none flex-1 min-h-[100px]"
										/>
										{replyImages.length > 0 ? (
											<div className="mt-2 flex flex-wrap gap-2">
												{replyImages.map((f, idx) => (
													<span key={idx} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border">
														{f.name}
													</span>
												))}
											</div>
										) : null}
									</div>

									{/* Right column buttons */}
									<div className="flex flex-col gap-2">
										<Button
											type="button"
											variant="secondary"
											size="icon"
											title="Close"
											aria-label="Close compose"
											onClick={() => {
												setViewMode(VIEW_MODE.NONE)
											}}
											className="h-8 w-8 rounded-full flex items-center justify-center"
										>
											<span aria-hidden>X</span>
										</Button>

										{/* Emoji */}
										<div className="relative">
											<Button
												type="button"
												variant="secondary"
												size="icon"
												onClick={() => setShowEmojiPicker((v) => !v)}
												title="Emoji"
												aria-label="Emoji"
												className="h-8 w-8 rounded-full flex items-center justify-center"
											>
												<span aria-hidden>😊</span>
											</Button>
											{showEmojiPicker ? (
												<div className="absolute bottom-12 right-0 z-50">
															<EmojiPicker
																onEmojiClick={(emojiData) => {
																	setReplyText((t) => t + emojiData.emoji)
																	setShowEmojiPicker(false)
																}}
																width={300}
																previewConfig={{ showPreview: false }}
																searchDisabled={false}
																skinTonesDisabled
															/> 
												</div>
											) : null}
										</div>

										{/* Image upload */}
										<>
											<input
												id={`compose-image-input-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
												type="file"
												accept="image/*"
												multiple
												className="hidden"
												onChange={(e) => {
													const files = Array.from(e.target.files || [])
													setReplyImages((prev) => [...prev, ...files])
													e.currentTarget.value = ''
												}}
											/>
											<label htmlFor={`compose-image-input-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}>
												<Button
													type="button"
													variant="secondary"
													size="icon"
													title="Add image"
													aria-label="Add image"
													className="h-8 w-8 rounded-full flex items-center justify-center"
												>
													<span aria-hidden>🖼️</span>
												</Button>
											</label>
										</>

										{/* Send button */}
										<Button
											type="button"
											variant="primary"
											size="icon"
											title="Send"
											aria-label="Send"
											disabled={!replyText.trim() && replyImages.length === 0}
											className="h-8 w-8 rounded-full flex items-center justify-center"
											onClick={async () => {
												try {
													// Get NDK instance
													const ndk = ndkActions.getNDK()
													if (!ndk) {
														toast.error('Not connected to Nostr network')
														return
													}

													const signer = ndkActions.getSigner()
													if (!signer) {
														toast.error('Please log in to reply')
														return
													}

													// Show loading toast
													const loadingToastId = toast.loading('Sending reply...')

													// Create reply event (kind 1)
													const event = new NDKEvent(ndk)
													event.kind = 1
													event.content = replyText.trim()

													// Add tags for threading according to NIP-10
													event.tags = []

													// Add "e" tag with root marker if available
													const rootId = rootIdFromTags || (note.id as string)
													if (rootId) {
														event.tags.push(['e', rootId, '', 'root'])
													}

													// Add "e" tag with reply marker for the direct parent
													event.tags.push(['e', note.id as string, '', 'reply'])

													// Add "p" tag for the author of the note being replied to
													event.tags.push(['p', note.pubkey])

													// Get all p tags from the parent note to maintain thread participants
													if (Array.isArray((note as any)?.tags)) {
														const parentPTags = ((note as any).tags as any[]).filter(
															(t) => Array.isArray(t) && t[0] === 'p' && typeof t[1] === 'string',
														)

														// Add all unique p tags from the parent note
														parentPTags.forEach((tag) => {
															const pubkey = tag[1]
															// Only add if not already added and not the current user
															if (pubkey !== note.pubkey && !event.tags.some((t) => t[0] === 'p' && t[1] === pubkey)) {
																event.tags.push(['p', pubkey])
															}
														})
													}

													// Sign and publish the event
													await event.sign(signer)

													// Create a relay set for publishing
													const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
													await event.publish(publishRelaySet)

													console.log('Reply published successfully:', event.id)
													console.log('Published event JSON:', JSON.stringify(event.rawEvent()))

													// Show success message
													toast.dismiss(loadingToastId)
													toast.success('Reply published successfully!')

													// Reset view mode and text
													setReplyText('')
													setReplyImages([])
													setViewMode(VIEW_MODE.NONE)
												} catch (error) {
													console.error('Failed to send reply:', error)
													toast.error('Failed to send reply. Please try again.')
												}
											}}
										>
											{/* Paper airplane right icon */}
											<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="w-4 h-4"
												aria-hidden
											>
												<path d="M22 2L11 13" />
												<path d="M22 2L15 22L11 13L2 9L22 2Z" />
											</svg>
										</Button>
									</div>
								</div>
							</div>
						</div>
					)
				} else if (viewMode === VIEW_MODE.REPOST) {
					// Repost mode - shows a confirmation UI
					return (
						<div
							id={`note-repost-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
							className="mt-2 border rounded overflow-hidden p-4 bg-gray-50"
						>
							<div className="text-center mb-4">
								<h3 className="text-lg font-medium">Repost this note?</h3>
								<p className="text-sm text-gray-600 mt-1">
									This will share the note with your followers. The original author will be credited.
								</p>
							</div>

							<div className="border rounded-md p-3 bg-white mb-4">
								<div className="text-sm text-gray-800">{displayContent}</div>
								<div className="text-xs text-gray-500 mt-2">— {note.pubkey?.slice(0, 8)}...</div>
							</div>

							<div className="flex justify-center gap-2">
								<Button type="button" variant="secondary" onClick={() => setViewMode(VIEW_MODE.NONE)} className="px-4">
									Cancel
								</Button>

															<Button
																type="button"
																variant="primary"
																className="bg-secondary text-white hover:bg-secondary/90 px-4"
																disabled={isReposting}
																onClick={async () => {
										if (isReposting) return

										setIsReposting(true)
										try {
											// Get NDK instance
											const ndk = ndkActions.getNDK()
											if (!ndk) {
												toast.error('Not connected to Nostr network')
												setIsReposting(false)
												return
											}

											const signer = ndkActions.getSigner()
											if (!signer) {
												toast.error('Please log in to repost')
												setIsReposting(false)
												return
											}

											// Validate that note has a valid ID
											const noteId = (note as any)?.id || ''
											if (!noteId) {
												toast.error('Cannot repost: Note ID is missing or invalid')
												setIsReposting(false)
												return
											}

											// Show loading toast
											const loadingToastId = toast.loading('Reposting...')

											// Create repost event (kind 6)
											const event = new NDKEvent(ndk)
											event.kind = 6

											// Set content to stringified JSON of the reposted note
											try {
												const noteJson = note.rawEvent ? note.rawEvent() : note
												event.content = JSON.stringify(noteJson)
											} catch (error) {
												console.error('Error stringifying note:', error)
												event.content = ''
											}

											// Add tags
											event.tags = []

											// Add e tag with the ID of the note being reposted
											event.tags.push(['e', noteId, '', ''])

											// Add p tag with the pubkey of the author of the reposted note
											event.tags.push(['p', note.pubkey])

											// Sign and publish the event
											await event.sign(signer)

											// Create a relay set for publishing
											const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
											await event.publish(publishRelaySet)

											console.log('Repost published successfully:', event.id)
											console.log('Published event JSON:', JSON.stringify(event.rawEvent()))

											// Show success message
											toast.dismiss(loadingToastId)
											toast.success('Repost published successfully!')

											// Reset view mode
											setViewMode(VIEW_MODE.NONE)
										} catch (error) {
											console.error('Failed to repost:', error)
											toast.error('Failed to repost. Please try again.')
										} finally {
											setIsReposting(false)
										}
									}}
								>
									{isReposting ? 'Reposting...' : 'SNED!'}
								</Button>
							</div>
						</div>
					)
				} else if (viewMode === VIEW_MODE.QUOTE) {
					// Quote compose panel - similar to reply but with the note reference pre-pasted

					return (
						<div
							id={`note-quote-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
							className="mt-2 border rounded overflow-hidden min-h-[150px] flex flex-col"
						>
							<div className="bg-white border-b border-gray-200 flex flex-col flex-1">
								<div className="flex items-stretch gap-2 p-3 flex-1">
									<div className="flex-1 flex flex-col w-all">
										<textarea
											ref={quoteTextareaRef}
											value={quoteText}
											onChange={(e) => setQuoteText(e.target.value)}
											placeholder="Write a quote..."
											className="w-full p-2 rounded-md border border-black/20 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none flex-1 min-h-[100px]"
										/>
										{quoteImages.length > 0 ? (
											<div className="mt-2 flex flex-wrap gap-2">
												{quoteImages.map((f, idx) => (
													<span key={idx} className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground border">
														{f.name}
													</span>
												))}
											</div>
										) : null}
									</div>

									{/* Right column buttons */}
									<div className="flex flex-col gap-2">
										<Button
											type="button"
											variant="secondary"
											size="icon"
											title="Close"
											aria-label="Close compose"
											onClick={() => {
												setViewMode(VIEW_MODE.NONE)
											}}
											className="h-8 w-8 rounded-full flex items-center justify-center"
										>
											<span aria-hidden>X</span>
										</Button>

										{/* Emoji */}
										<div className="relative">
											<Button
												type="button"
												variant="secondary"
												size="icon"
												onClick={() => setShowEmojiPicker((v) => !v)}
												title="Emoji"
												aria-label="Emoji"
												className="h-8 w-8 rounded-full flex items-center justify-center"
											>
												<span aria-hidden>😊</span>
											</Button>
											{showEmojiPicker ? (
												<div className="absolute bottom-12 right-0 z-50">
															<EmojiPicker
																onEmojiClick={(emojiData) => {
																	setQuoteText((t) => t + emojiData.emoji)
																	setShowEmojiPicker(false)
																}}
																width={300}
																previewConfig={{ showPreview: false }}
																searchDisabled={false}
																skinTonesDisabled
															/> 
												</div>
											) : null}
										</div>

										{/* Image upload */}
										<>
											<input
												id={`quote-image-input-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}
												type="file"
												accept="image/*"
												multiple
												className="hidden"
												onChange={(e) => {
													const files = Array.from(e.target.files || [])
													setQuoteImages((prev) => [...prev, ...files])
													e.currentTarget.value = ''
												}}
											/>
											<label htmlFor={`quote-image-input-${(note as any)?.id ?? note.pubkey ?? 'unknown'}`}>
												<Button
													type="button"
													variant="secondary"
													size="icon"
													title="Add image"
													aria-label="Add image"
													className="h-8 w-8 rounded-full flex items-center justify-center"
												>
													<span aria-hidden>🖼️</span>
												</Button>
											</label>
										</>

										{/* Send button */}
										<Button
											type="button"
											variant="primary"
											size="icon"
											title="Send"
											aria-label="Send"
											disabled={!quoteText.trim() && quoteImages.length === 0}
											className="h-8 w-8 rounded-full flex items-center justify-center"
											onClick={async () => {
												try {
													// Get NDK instance
													const ndk = ndkActions.getNDK()
													if (!ndk) {
														toast.error('Not connected to Nostr network')
														return
													}

													const signer = ndkActions.getSigner()
													if (!signer) {
														toast.error('Please log in to quote')
														return
													}

													// Show loading toast
													const loadingToastId = toast.loading('Sending quote post...')

													// Create quote event (kind 1 with q tag)
													const event = new NDKEvent(ndk)
													event.kind = 1
													event.content = quoteText.trim()

													// Add tags for quote post according to NIP-18
													event.tags = []

													// Add "q" tag with quoted note ID and relay hint
													event.tags.push(['q', note.id as string, '', note.pubkey])

													// Add "p" tag for the author of the note being quoted
													event.tags.push(['p', note.pubkey])

													// Sign and publish the event
													await event.sign(signer)

													// Create a relay set for publishing
													const publishRelaySet = NDKRelaySet.fromRelayUrls(writeRelaysUrls, ndk)
													await event.publish(publishRelaySet)

													console.log('Quote post published successfully:', event.id)
													console.log('Published event JSON:', JSON.stringify(event.rawEvent()))

													// Show success message
													toast.dismiss(loadingToastId)
													toast.success('Quote post published successfully!')

													// Reset view mode and text
													setQuoteText('')
													setQuoteImages([])
													setViewMode(VIEW_MODE.NONE)
												} catch (error) {
													console.error('Failed to send quote post:', error)
													toast.error('Failed to send quote post. Please try again.')
												}
											}}
										>
											{/* Paper airplane right icon */}
											<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="w-4 h-4"
												aria-hidden
											>
												<path d="M22 2L11 13" />
												<path d="M22 2L15 22L11 13L2 9L22 2Z" />
											</svg>
										</Button>
									</div>
								</div>
							</div>
						</div>
					)
				}

				return null
			})()}
		</div>
	)
}
