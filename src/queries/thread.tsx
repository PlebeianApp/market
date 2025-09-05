// queries for thread analysis and construction

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { queryOptions } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { defaultRelaysUrls } from '@/lib/constants'

// Thread node structure for building tree
export type ThreadNode = {
	event: NDKEvent
	id: string
	parentId?: string
	rootId: string
	children: ThreadNode[]
	depth: number
}

// Thread structure with metadata
export type ThreadStructure = {
	rootEvent: NDKEvent
	rootId: string
	nodes: Map<string, ThreadNode>
	tree: ThreadNode[]
}

// Query keys for thread operations
export const threadKeys = {
	all: ['threads'] as const,
	root: (noteId: string) => [...threadKeys.all, 'root', noteId] as const,
	structure: (rootId: string) => [...threadKeys.all, 'structure', rootId] as const,
	parents: (noteId: string) => [...threadKeys.all, 'parents', noteId] as const,
} as const

/**
 * Find the root event ID from a note's "e" tags
 * Looks for tag with format ["e", "<event_id>", "<relay>", "root"]
 */
export function findRootFromETags(event: NDKEvent): string | null {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return null

	// Prefer explicit root marker when present per NIP-10
	const rootTag = tags.find((tag: any) =>
		Array.isArray(tag) &&
		tag[0] === 'e' &&
		tag[3] === 'root' &&
		typeof tag[1] === 'string'
	)
	if (rootTag) return rootTag[1]

	// Fallbacks when marker index 3 is missing or different ordering used:
	// - If there are 2+ e tags, the first is typically the root, last is the reply target
	// - If there is only 1 e tag, many clients still put the root there
	const eTags = tags.filter((t: any) => Array.isArray(t) && t[0] === 'e' && typeof t[1] === 'string')
	if (eTags.length >= 1) {
		return eTags[0][1]
	}
	return null
}

/**
 * Find parent event IDs from "e" tags (reply markers)
 * Returns array of parent event IDs this note replies to
 */
export function findParentsFromETags(event: NDKEvent): string[] {
	const tags = (event as any)?.tags
	if (!Array.isArray(tags)) return []

	// Per NIP-10: if markers are present, use reply markers as parents; otherwise,
	// when there are multiple e tags without markers, the last one is typically the direct parent.
	const eTags = tags.filter((tag: any) => Array.isArray(tag) && tag[0] === 'e' && typeof tag[1] === 'string')
	// Prefer explicit reply markers first
	const replyTagged = eTags.filter((tag: any) => tag[3] === 'reply')
	if (replyTagged.length > 0) {
		return replyTagged.map((tag: any) => tag[1])
	}
	// If no reply markers, but multiple e tags exist, consider the last as direct parent
	if (eTags.length >= 2) {
		return [eTags[eTags.length - 1][1]]
	}
	// If only one e tag exists and no markers, it's ambiguous; return it as parent to maintain linkage
	if (eTags.length === 1) {
		return [eTags[0][1]]
	}
	return []
}

/**
 * Fetch a single event by ID
 */
async function fetchEventById(eventId: string): Promise<NDKEvent | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	try {
		const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)
		const event = await ndk.fetchEvent(eventId, undefined, relaySet)
		return event
	} catch (error) {
		console.warn(`Failed to fetch event ${eventId}:`, error)
		return null
	}
}

/**
 * Find the root event for a given note
 * First checks for "root" marker in e tags, then traces back through reply parents
 */
export async function findRootEvent(noteId: string): Promise<{ rootEvent: NDKEvent; rootId: string } | null> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	// First, fetch the initial note
	const initialEvent = await fetchEventById(noteId)
	if (!initialEvent) return null

	// Check if it has a root marker in e tags
	const rootIdFromTags = findRootFromETags(initialEvent)
	if (rootIdFromTags) {
		const rootEvent = await fetchEventById(rootIdFromTags)
		if (rootEvent) {
			return { rootEvent, rootId: rootIdFromTags }
		}
	}

	// If no root marker found, trace back through reply parents
	let currentEvent = initialEvent
	const visited = new Set<string>([noteId])
	const maxDepth = 50 // Prevent infinite loops

	for (let depth = 0; depth < maxDepth; depth++) {
		const parents = findParentsFromETags(currentEvent)
		
		// If no parents, this is the root
		if (parents.length === 0) {
			return { 
				rootEvent: currentEvent, 
				rootId: (currentEvent as any).id || noteId 
			}
		}

		// Try to fetch the first parent (most recent reply)
		let foundParent = false
		for (const parentId of parents) {
			if (visited.has(parentId)) continue // Avoid cycles
			
			const parentEvent = await fetchEventById(parentId)
			if (parentEvent) {
				currentEvent = parentEvent
				visited.add(parentId)
				foundParent = true
				break
			}
		}

		if (!foundParent) {
			// No parent found, current event is the root
			return { 
				rootEvent: currentEvent, 
				rootId: (currentEvent as any).id || noteId 
			}
		}
	}

	// Reached max depth, return current as root
	return { 
		rootEvent: currentEvent, 
		rootId: (currentEvent as any).id || noteId 
	}
}

/**
 * Fetch all events in a thread starting from root
 */
async function fetchThreadEvents(rootId: string): Promise<NDKEvent[]> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')

	const relaySet = NDKRelaySet.fromRelayUrls(defaultRelaysUrls, ndk)

	// Iteratively fetch replies that reference the root or any known ancestor ids.
	const maxIterations = 5
	const maxTotal = 500
	const knownEvents = new Map<string, NDKEvent>()
	const frontier = new Set<string>([rootId])
	const visitedFrontier = new Set<string>()

	// Always include the root event
	const rootEvent = await fetchEventById(rootId)
	if (rootEvent && (rootEvent as any).id) {
		knownEvents.set((rootEvent as any).id as string, rootEvent)
	}

	for (let i = 0; i < maxIterations && knownEvents.size < maxTotal && frontier.size > 0; i++) {
		// Build batch of ids to query this iteration (exclude those already used)
		const batchIds = Array.from(frontier).filter((id) => !visitedFrontier.has(id)).slice(0, 30)
		if (batchIds.length === 0) break
		batchIds.forEach((id) => visitedFrontier.add(id))

		const filter: NDKFilter = {
			kinds: [1, 1111],
			"#e": batchIds,
			limit: 200,
		}
		const events = await ndk.fetchEvents(filter, undefined, relaySet)
		const fetched = Array.from(events) as NDKEvent[]

		// Add to known and expand the frontier with their ids
		for (const ev of fetched) {
			const id = (ev as any).id as string | undefined
			if (!id) continue
			if (!knownEvents.has(id)) {
				knownEvents.set(id, ev)
				// Add to frontier so we can find replies to this reply in next iterations
				frontier.add(id)
			}
		}

		// Safety cap
		if (knownEvents.size >= maxTotal) break
	}

	// Return unique list of events
	return Array.from(knownEvents.values())
}

/**
 * Recursively build children for thread tree
 */
function buildChildren(parent: ThreadNode, currentDepth: number, nodes: Map<string, ThreadNode>) {
	for (const node of Array.from(nodes.values())) {
		if (node.parentId === parent.id && node.id !== parent.id) {
			node.depth = currentDepth + 1
			parent.children.push(node)
			buildChildren(node, node.depth, nodes)
		}
	}
	// Sort children by creation time
	parent.children.sort((a, b) => 
		((a.event as any).created_at || 0) - ((b.event as any).created_at || 0)
	)
}

/**
 * Build thread tree structure from events
 */
function buildThreadTree(events: NDKEvent[], rootId: string): ThreadStructure {
	const nodes = new Map<string, ThreadNode>()
	const rootEvent = events.find(e => (e as any).id === rootId)
	
	if (!rootEvent) {
		throw new Error(`Root event ${rootId} not found in events`)
	}

	// Create nodes for all events
	for (const event of events) {
		const eventId = (event as any).id
		if (!eventId) continue

		const parents = findParentsFromETags(event)
		let parentId = parents.length > 0 ? parents[0] : undefined // Use first parent
		
		// For direct replies to root, keep the root as parent
		// Only set to undefined if this IS the root event
		if (eventId === rootId) {
			parentId = undefined
		}

		const node: ThreadNode = {
			event,
			id: eventId,
			parentId,
			rootId,
			children: [],
			depth: 0, // Will be calculated later
		}

		nodes.set(eventId, node)
	}

	// Build parent-child relationships and calculate depth
	const tree: ThreadNode[] = []
	const rootNode = nodes.get(rootId)
	
	if (rootNode) {
		rootNode.depth = 0
		tree.push(rootNode)
		buildChildren(rootNode, 0, nodes)
	}

	return {
		rootEvent,
		rootId,
		nodes,
		tree,
	}
}

/**
 * Construct complete thread structure for a note
 */
export async function constructThreadStructure(noteId: string): Promise<ThreadStructure | null> {
	try {
		// Find the root event
		const rootInfo = await findRootEvent(noteId)
		if (!rootInfo) return null

		const { rootId } = rootInfo

		// Fetch all events in the thread
		const threadEvents = await fetchThreadEvents(rootId)
		
		// Build the tree structure
		const threadStructure = buildThreadTree(threadEvents, rootId)
		
		return threadStructure
	} catch (error) {
		console.error('Failed to construct thread structure:', error)
		return null
	}
}

// Query options for finding root event
export const rootEventQueryOptions = (noteId: string) =>
	queryOptions({
		queryKey: threadKeys.root(noteId),
		queryFn: () => findRootEvent(noteId),
		staleTime: 5 * 60 * 1000, // 5 minutes
	})

// Query options for constructing thread structure  
export const threadStructureQueryOptions = (noteId: string) =>
	queryOptions({
		queryKey: threadKeys.structure(noteId),
		queryFn: () => constructThreadStructure(noteId),
		staleTime: 2 * 60 * 1000, // 2 minutes
	})