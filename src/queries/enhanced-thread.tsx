// Enhanced thread queries using jumble patterns for proper feed loading
// Implements sophisticated thread construction, root finding, and relationship mapping

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'
import { configActions } from '@/lib/stores/config'
import { EnhancedFetchedNDKEvent, SUPPORTED_KINDS, getAugmentedRelayUrls } from './enhanced-firehose'

// Enhanced thread node structure
export type EnhancedThreadNode = {
	event: NDKEvent
	id: string
	parentId?: string
	rootId: string
	children: EnhancedThreadNode[]
	depth: number
	relaysSeen: string[]
	priority: number
	metadata: {
		isRoot: boolean
		replyCount: number
		hasMedia: boolean
		isLongForm: boolean
	}
}

// Enhanced thread structure with comprehensive metadata
export type EnhancedThreadStructure = {
	rootEvent: NDKEvent
	rootId: string
	nodes: Map<string, EnhancedThreadNode>
	tree: EnhancedThreadNode[]
	metadata: {
		totalReplies: number
		maxDepth: number
		participantCount: number
		hasMedia: boolean
		createdAt: number
		lastActivityAt: number
	}
}

// Thread query keys
export const enhancedThreadKeys = {
	all: ['enhanced-threads'] as const,
	root: (noteId: string) => [...enhancedThreadKeys.all, 'root', noteId] as const,
	structure: (rootId: string) => [...enhancedThreadKeys.all, 'structure', rootId] as const,
	parents: (noteId: string) => [...enhancedThreadKeys.all, 'parents', noteId] as const,
	context: (noteId: string, depth: number = 3) => [...enhancedThreadKeys.all, 'context', noteId, depth] as const,
} as const

/**
 * Enhanced root finding from e-tags with NIP-10 compliance
 */
export function findRootFromETags(event: NDKEvent): string | null {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return null

	// NIP-10: Prefer explicit root marker
	const rootTag = tags.find((tag: any) =>
		Array.isArray(tag) &&
		tag[0] === 'e' &&
		tag[3] === 'root' &&
		typeof tag[1] === 'string'
	)
	if (rootTag) return rootTag[1]

	// Fallback: first e-tag is typically the root
	const eTags = tags.filter((t: any) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string')
	if (eTags.length >= 1) {
		return eTags[0][1]
	}
	return null
}

/**
 * Enhanced parent finding with better NIP-10 support
 */
export function findParentsFromETags(event: NDKEvent): string[] {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return []

	const eTags = tags.filter((tag: any) => Array.isArray(tag) && tag[0] === 'e' && typeof tag[1] === 'string')
	
	// NIP-10: Use reply markers if present
	const replyTagged = eTags.filter((tag: any) => tag[3] === 'reply')
	if (replyTagged.length > 0) {
		return replyTagged.map((tag: any) => tag[1])
	}

	// Fallback: last e-tag is typically the direct parent
	if (eTags.length >= 2) {
		return [eTags[eTags.length - 1][1]]
	}

	// Single e-tag: ambiguous but assume parent
	if (eTags.length === 1) {
		return [eTags[0][1]]
	}

	return []
}

/**
 * Enhanced event fetching with better error handling and batching
 */
const eventBatchCache = new Map<string, Promise<NDKEvent | null>>()
const pendingEventBatches: string[] = []
const eventBatchSize = 100
let batchTimer: NodeJS.Timeout | null = null

async function processBatchedEvents(): Promise<void> {
	if (pendingEventBatches.length === 0) return
	
	const batchIds = [...pendingEventBatches]
	pendingEventBatches.length = 0 // Clear the pending batch
	
	const ndk = ndkActions.getNDK()
	if (!ndk) {
		console.warn('NDK not initialized for batch processing')
		// Resolve all promises with null if NDK is not initialized
		for (const id of batchIds) {
			const promise = eventBatchCache.get(id)
			if (promise) {
				const resolvePromise = (promise as any).__resolve
				if (typeof resolvePromise === 'function') {
					resolvePromise(null)
				}
				eventBatchCache.delete(id)
			}
		}
		return
	}
	
	try {
		const allRelays = await getAugmentedRelayUrls()
		const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
		
		// Create a filter with all the event IDs
		const filter: NDKFilter = {
			ids: batchIds,
			limit: batchIds.length * 2 // Allow some buffer for duplicates
		}
		
		// Fetch all events in a single query with timeout protection
		const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet)
		const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
			setTimeout(() => resolve(new Set()), 15000) // 15 second timeout for larger batches
		})
		
		const events = await Promise.race([fetchPromise, timeoutPromise])
		const eventMap = new Map<string, NDKEvent>()
		
		// Map events to their IDs
		Array.from(events).forEach(event => {
			const id = (event as any).id
			if (id) eventMap.set(id, event)
		})
		
		// Resolve all promises in the cache
		for (const id of batchIds) {
			const promise = eventBatchCache.get(id)
			if (promise) {
				// Get the resolve function from the promise
				const resolvePromise = (promise as any).__resolve
				if (typeof resolvePromise === 'function') {
					resolvePromise(eventMap.get(id) || null)
				}
				eventBatchCache.delete(id)
			}
		}
	} catch (error) {
		console.warn(`Failed to fetch batched events: ${error}`)
		// Resolve all promises with null on error
		for (const id of batchIds) {
			const promise = eventBatchCache.get(id)
			if (promise) {
				const resolvePromise = (promise as any).__resolve
				if (typeof resolvePromise === 'function') {
					resolvePromise(null)
				}
				eventBatchCache.delete(id)
			}
		}
	}
}

async function fetchEventById(eventId: string): Promise<NDKEvent | null> {
	// Check if there's already a pending request for this event
	if (eventBatchCache.has(eventId)) {
		return eventBatchCache.get(eventId)!
	}
	
	// Create a new promise for this event
	let resolvePromise: (value: NDKEvent | null) => void = () => {}
	const promise = new Promise<NDKEvent | null>(resolve => {
		resolvePromise = resolve
	})
	
	// Store the resolve function with the promise
	;(promise as any).__resolve = resolvePromise
	eventBatchCache.set(eventId, promise)
	
	// Add to pending batch
	pendingEventBatches.push(eventId)
	
	// Set a timer to process the batch if it's not already set
	if (batchTimer === null) {
		batchTimer = setTimeout(() => {
			batchTimer = null
			processBatchedEvents()
		}, 10) // 10ms delay for batching
	}
	
	// If we have enough events, process the batch immediately
	if (pendingEventBatches.length >= eventBatchSize) {
		if (batchTimer !== null) {
			clearTimeout(batchTimer)
			batchTimer = null
		}
		processBatchedEvents()
	}
	
	return promise
}

/**
 * Enhanced root event finding with cycle detection and depth limits
 */
export async function findEnhancedRootEvent(noteId: string): Promise<{ rootEvent: NDKEvent; rootId: string } | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// Fetch the initial note
	const initialEvent = await fetchEventById(noteId)
	if (!initialEvent) return null

	// Check for explicit root marker
	const rootIdFromTags = findRootFromETags(initialEvent)
	if (rootIdFromTags) {
		const rootEvent = await fetchEventById(rootIdFromTags)
		if (rootEvent) {
			return { rootEvent, rootId: rootIdFromTags }
		}
	}

	// Enhanced traversal with cycle detection
	let currentEvent = initialEvent
	const visited = new Set<string>([noteId])
	const maxDepth = 50 // Prevent infinite loops
	
	for (let depth = 0; depth < maxDepth; depth++) {
		const parents = findParentsFromETags(currentEvent)
		
		if (parents.length === 0) {
			return { 
				rootEvent: currentEvent, 
				rootId: (currentEvent as any).id || noteId 
			}
		}

		// Try each parent until we find one
		let foundParent = false
		for (const parentId of parents) {
			if (visited.has(parentId)) continue // Cycle detection
			
			const parentEvent = await fetchEventById(parentId)
			if (parentEvent) {
				currentEvent = parentEvent
				visited.add(parentId)
				foundParent = true
				break
			}
		}

		if (!foundParent) {
			return { 
				rootEvent: currentEvent, 
				rootId: (currentEvent as any).id || noteId 
			}
		}
	}

	// Max depth reached
	return { 
		rootEvent: currentEvent, 
		rootId: (currentEvent as any).id || noteId 
	}
}

/**
 * Enhanced thread events fetching with iterative expansion
 */
async function fetchEnhancedThreadEvents(rootId: string): Promise<NDKEvent[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const allRelays = await getAugmentedRelayUrls()
	const relaySet = NDKRelaySet.fromRelayUrls(allRelays, ndk)
	const maxIterations = 5
	const maxTotal = 1000 // Increased for better thread coverage
	const knownEvents = new Map<string, NDKEvent>()
	const frontier = new Set<string>([rootId])
	const visitedFrontier = new Set<string>()

	// Always include the root event
	const rootEvent = await fetchEventById(rootId)
	if (rootEvent && (rootEvent as any).id) {
		knownEvents.set((rootEvent as any).id as string, rootEvent)
	}

	for (let i = 0; i < maxIterations && knownEvents.size < maxTotal && frontier.size > 0; i++) {
		// Build batch of IDs to query
		const batchIds = Array.from(frontier)
			.filter((id) => !visitedFrontier.has(id))
			.slice(0, 50) // Increased batch size
		
		if (batchIds.length === 0) break
		
		batchIds.forEach((id) => visitedFrontier.add(id))

		const filter: NDKFilter = {
			kinds: SUPPORTED_KINDS,
			"#e": batchIds,
			limit: 300, // Increased limit
		}

		try {
			const events = await ndk.fetchEvents(filter, undefined, relaySet)
			const fetched = Array.from(events) as NDKEvent[]

			// Enhanced filtering
			const validEvents = fetched.filter((e) => {
				const id = (e as any).id as string
				return id && !knownEvents.has(id) && isValidThreadEvent(e)
			})

			// Add to known events and expand frontier
			for (const ev of validEvents) {
				const id = (ev as any).id as string
				knownEvents.set(id, ev)
				frontier.add(id) // Expand frontier for next iteration
			}
		} catch (error) {
			console.warn(`Failed to fetch thread events for batch ${i}:`, error)
		}

		if (knownEvents.size >= maxTotal) break
	}

	return Array.from(knownEvents.values())
}

/**
 * Enhanced event validation for threads
 */
function isValidThreadEvent(event: NDKEvent): boolean {
	try {
		const tags = (event as any)?.tags
		const content = (event as any)?.content

		// Basic validation
		if (!event || !(event as any).id) return false

		// Check for NSFW
		if (Array.isArray(tags)) {
			const hasNsfwTag = tags.some((t: any) => 
				Array.isArray(t) && t[0] === 't' && typeof t[1] === 'string' && t[1].toLowerCase() === 'nsfw'
			)
			if (hasNsfwTag) return false
		}

		if (typeof content === 'string') {
			const hasNsfwContent = /(^|\W)#nsfw(\W|$)/i.test(content)
			if (hasNsfwContent) return false
		}

		// Check for client:Mostr tag
		if (Array.isArray(tags)) {
			const hasMostrTag = tags.some((tag: any) => 
				Array.isArray(tag) && tag.length >= 2 && tag[0] === 'client' && tag[1] === 'Mostr'
			)
			if (hasMostrTag) return false
		}

		return true
	} catch {
		return false
	}
}

/**
 * Enhanced metadata calculation
 */
function calculateNodeMetadata(event: NDKEvent): EnhancedThreadNode['metadata'] {
	const kind = (event as any).kind
	const content = (event as any)?.content || ''
	
	return {
		isRoot: !findParentsFromETags(event).length,
		replyCount: 0, // Will be calculated during tree building
		hasMedia: [20, 21, 22].includes(kind) || /\.(jpg|jpeg|png|gif|webp|mp4|webm)/i.test(content),
		isLongForm: kind === 30023
	}
}

/**
 * Enhanced priority calculation for thread nodes
 */
function calculateThreadPriority(event: NDKEvent, depth: number): number {
	const now = Date.now() / 1000
	const age = now - ((event as any).created_at || 0)
	const ageScore = Math.max(0, 1 - (age / (24 * 60 * 60))) // Decay over 24 hours
	
	// Depth penalty (deeper = lower priority)
	const depthScore = Math.max(0.1, 1 - (depth * 0.2))
	
	// Kind bonus
	const kind = (event as any).kind
	let kindScore = 0.5
	
	if (kind === 1) kindScore = 1.0 // Text notes
	else if (kind === 6) kindScore = 0.9 // Reposts
	else if ([20, 21, 22].includes(kind)) kindScore = 0.8 // Media
	else if (kind === 30023) kindScore = 0.7 // Articles
	
	return ageScore * depthScore * kindScore
}

/**
 * Enhanced recursive children building with metadata
 */
function buildEnhancedChildren(parent: EnhancedThreadNode, currentDepth: number, nodes: Map<string, EnhancedThreadNode>) {
	const children = Array.from(nodes.values()).filter(node => 
		node.parentId === parent.id && node.id !== parent.id
	)
	
	for (const child of children) {
		child.depth = currentDepth + 1
		child.priority = calculateThreadPriority(child.event, child.depth)
		parent.children.push(child)
		parent.metadata.replyCount++
		buildEnhancedChildren(child, child.depth, nodes)
	}
	
	// Enhanced sorting: priority first, then creation time
	parent.children.sort((a, b) => {
		const priorityDiff = b.priority - a.priority
		if (Math.abs(priorityDiff) > 0.1) return priorityDiff
		return ((a.event as any).created_at || 0) - ((b.event as any).created_at || 0)
	})
}

/**
 * Enhanced thread tree building with comprehensive metadata
 */
function buildEnhancedThreadTree(events: NDKEvent[], rootId: string): EnhancedThreadStructure {
	const nodes = new Map<string, EnhancedThreadNode>()
	const rootEvent = events.find(e => (e as any).id === rootId)
	
	if (!rootEvent) {
		throw new Error(`Root event ${rootId} not found in events`)
	}

	const participants = new Set<string>()
	let lastActivity = 0
	let hasMediaInThread = false

	// Create enhanced nodes
	for (const event of events) {
		const eventId = (event as any).id
		if (!eventId) continue

		const parents = findParentsFromETags(event)
		let parentId = parents.length > 0 ? parents[0] : undefined
		
		if (eventId === rootId) {
			parentId = undefined
		}

		const metadata = calculateNodeMetadata(event)
		if (metadata.hasMedia) hasMediaInThread = true

		const node: EnhancedThreadNode = {
			event,
			id: eventId,
			parentId,
			rootId,
			children: [],
			depth: 0,
			relaysSeen: [], // Will be populated if relay info available
			priority: 0, // Will be calculated
			metadata
		}

		nodes.set(eventId, node)
		participants.add((event as any).pubkey)
		
		const createdAt = (event as any).created_at || 0
		if (createdAt > lastActivity) {
			lastActivity = createdAt
		}
	}

	// Build tree structure
	const tree: EnhancedThreadNode[] = []
	const rootNode = nodes.get(rootId)
	
	if (rootNode) {
		rootNode.depth = 0
		rootNode.priority = calculateThreadPriority(rootNode.event, 0)
		tree.push(rootNode)
		buildEnhancedChildren(rootNode, 0, nodes)
	}

	// Calculate thread metadata
	const allNodes = Array.from(nodes.values())
	const maxDepth = Math.max(...allNodes.map(n => n.depth))
	const totalReplies = allNodes.length - 1 // Exclude root

	return {
		rootEvent,
		rootId,
		nodes,
		tree,
		metadata: {
			totalReplies,
			maxDepth,
			participantCount: participants.size,
			hasMedia: hasMediaInThread,
			createdAt: (rootEvent as any).created_at || 0,
			lastActivityAt: lastActivity
		}
	}
}

/**
 * Enhanced thread structure construction
 */
export async function constructEnhancedThreadStructure(noteId: string): Promise<EnhancedThreadStructure | null> {
	try {
		// Find the root event
		const rootInfo = await findEnhancedRootEvent(noteId)
		if (!rootInfo) return null

		const { rootId, rootEvent } = rootInfo

		// Validate root event
		if (!isValidThreadEvent(rootEvent)) return null

		// Fetch all thread events
		const threadEvents = await fetchEnhancedThreadEvents(rootId)
		
		// Build enhanced tree structure
		const threadStructure = buildEnhancedThreadTree(threadEvents, rootId)
		
		return threadStructure
	} catch (error) {
		console.error('Failed to construct enhanced thread structure:', error)
		return null
	}
}

/**
 * Enhanced context fetching for better thread understanding
 */
export async function fetchThreadContext(noteId: string, contextDepth: number = 3): Promise<NDKEvent[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const context: NDKEvent[] = []
	const visited = new Set<string>()
	
	try {
		// Get the note and trace back for context
		let currentId = noteId
		
		for (let i = 0; i < contextDepth && !visited.has(currentId); i++) {
			visited.add(currentId)
			
			const event = await fetchEventById(currentId)
			if (!event || !isValidThreadEvent(event)) break
			
			context.unshift(event) // Add to beginning for chronological order
			
			const parents = findParentsFromETags(event)
			if (parents.length === 0) break
			
			currentId = parents[0] // Follow first parent
		}
		
		return context
	} catch (error) {
		console.error('Failed to fetch thread context:', error)
		return []
	}
}

// Enhanced query options
export const enhancedRootEventQueryOptions = (noteId: string) =>
	queryOptions({
		queryKey: enhancedThreadKeys.root(noteId),
		queryFn: () => findEnhancedRootEvent(noteId),
		staleTime: 10 * 60 * 1000, // 10 minutes
	})

export const enhancedThreadStructureQueryOptions = (noteId: string) =>
	queryOptions({
		queryKey: enhancedThreadKeys.structure(noteId),
		queryFn: () => constructEnhancedThreadStructure(noteId),
		staleTime: 5 * 60 * 1000, // 5 minutes
	})

export const enhancedThreadContextQueryOptions = (noteId: string, depth: number = 3) =>
	queryOptions({
		queryKey: enhancedThreadKeys.context(noteId, depth),
		queryFn: () => fetchThreadContext(noteId, depth),
		staleTime: 5 * 60 * 1000, // 5 minutes
	})