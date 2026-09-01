import { configActions } from '@/lib/stores/config'
import { getAppRelaySet, ndkActions } from '@/lib/stores/ndk'
import { testLabelActions, type TestLabelInfo } from '@/lib/stores/testLabels'
import { fetchAdminSettings } from '@/queries/app-settings'
import { testLabelKeys } from '@/queries/queryKeyFactory'
import { collectTestLabelCoordinates, filterTestLabeledEvents } from '@/lib/utils/testLabelFilters'
import type { NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useMemo } from 'react'
import { testLabelStore } from '@/lib/stores/testLabels'
import {
	A_TAG,
	E_TAG,
	K_TAG,
	L_TAG,
	LABEL_DELETION_KIND,
	LABEL_EVENT_KIND,
	LABEL_NAMESPACE,
	LABEL_VALUE_TEST,
	l_TAG,
} from '@/lib/constants/testLabels'

/**
 * ADR-0009 — Test-listing curation via NIP-32 labels.
 *
 * Label events (kind 1985) mark a product/auction coordinate as a "test"
 * listing. Labels count only when signed by an authorized labeler (the admin
 * set). Un-labeling is a NIP-09 deletion event (kind 5) referencing the label
 * event's id in an `e` tag, signed by the same labeler.
 *
 * Coordinates are fetched in batches (one relay query per chunk) so feeds can
 * check every item on the page without N+1 queries. Results populate the
 * test-label store; the query-layer filter (`filterTestLabeledEvents`) reads
 * the store synchronously afterwards.
 */

// --- Fetch tuning ---

/** Max coordinates per relay filter (`#a` chunk) */
const TEST_LABEL_FETCH_CHUNK_SIZE = 100

/** Relay fetch timeout for label/deletion events */
const TEST_LABEL_FETCH_TIMEOUT_MS = 8000

/** How long a fetched label result stays fresh in the module cache */
const TEST_LABEL_CACHE_TTL_MS = 15_000

/** How long the authorized-labeler list stays fresh */
const AUTHORIZED_LABELERS_CACHE_TTL_MS = 15_000

interface CachedLabelEntry {
	fetchedAt: number
	label: TestLabelInfo | null
}

const testLabelCache = new Map<string, CachedLabelEntry>()

let authorizedLabelersCache: { fetchedAt: number; pubkeys: string[] } | null = null

const chunkStrings = (values: string[], size: number): string[][] => {
	const chunks: string[][] = []
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size))
	}
	return chunks
}

// --- Authorized labelers ---

/**
 * Authorized labelers = the app's admin set (ADR-0009). A dedicated moderator
 * list or automated labeler key can be enrolled later without protocol change.
 *
 * Returns null when the admin settings are not available yet (NDK/relay not
 * ready) — callers must treat that as "cannot determine authorization" and
 * fail open (no labels applied, store not marked loaded).
 */
export const getAuthorizedLabelerPubkeys = async (): Promise<string[] | null> => {
	const now = Date.now()
	if (authorizedLabelersCache && now - authorizedLabelersCache.fetchedAt < AUTHORIZED_LABELERS_CACHE_TTL_MS) {
		return authorizedLabelersCache.pubkeys
	}

	try {
		const settings = await fetchAdminSettings(configActions.getAppPublicKey())
		if (!settings) return null
		authorizedLabelersCache = { fetchedAt: now, pubkeys: settings.admins }
		return settings.admins
	} catch (error) {
		console.warn('Failed to fetch authorized labelers (admin settings):', error)
		return null
	}
}

// --- Event validation ---

/**
 * Item coordinates targeted by a label event's `a` tags.
 * Per ADR-0009 we only act on `a`-tag (item) targets — a `p` tag would label
 * the user and is intentionally out of scope.
 */
export const getLabelTargetCoordinates = (event: NDKEvent): string[] => {
	return event.tags.filter((tag) => tag[0] === A_TAG && !!tag[1]).map((tag) => tag[1])
}

/**
 * A label event counts only when:
 * - it is a kind-1985 event,
 * - signed by an authorized labeler,
 * - `L` tag is our namespace,
 * - `l` tag is `test` within our namespace,
 * - it targets at least one item coordinate (`a` tag).
 */
export const isValidAuthorizedTestLabel = (event: NDKEvent, authorizedLabelers: string[]): boolean => {
	if (event.kind !== LABEL_EVENT_KIND) return false
	// Only authorized labelers' labels count (ADR-0009)
	if (!authorizedLabelers.includes(event.pubkey)) return false
	// NIP-32: L tag must carry our namespace
	if (!event.tags.some((tag) => tag[0] === L_TAG && tag[1] === LABEL_NAMESPACE)) return false
	// NIP-32: l tag value must be "test" scoped to our namespace
	if (!event.tags.some((tag) => tag[0] === l_TAG && tag[1] === LABEL_VALUE_TEST && tag[2] === LABEL_NAMESPACE)) return false
	// Must target an item coordinate
	return event.tags.some((tag) => tag[0] === A_TAG && !!tag[1])
}

/**
 * NIP-09 deletion validation: a deletion applies to a label event only when
 * it references the label event's id in an `e` tag AND is signed by the same
 * pubkey as the label event (NIP-09 MUST). The `k` tag is a SHOULD — when
 * present it must declare kind 1985 to apply to our labels.
 */
export const isLabelDeletionForLabel = (deletion: NDKEvent, label: NDKEvent): boolean => {
	if (deletion.kind !== LABEL_DELETION_KIND) return false
	if (deletion.pubkey !== label.pubkey) return false
	const referencesLabel = deletion.tags.some((tag) => tag[0] === E_TAG && tag[1] === label.id)
	if (!referencesLabel) return false
	const kTags = deletion.tags.filter((tag) => tag[0] === K_TAG && tag[1]).map((tag) => tag[1])
	if (kTags.length > 0 && !kTags.includes(String(LABEL_EVENT_KIND))) return false
	return true
}

// --- Reconciliation (pure, unit-tested) ---

/**
 * Determine which coordinates carry an ACTIVE test label.
 *
 * A coordinate is labeled if ANY authorized label event targeting it has no
 * matching NIP-09 deletion (§7.7 of the handover). When several active labels
 * exist for one coordinate, the newest one's metadata is returned.
 *
 * @param labelEvents authorized kind-1985 label events
 * @param deletionEvents kind-5 deletion events that may reference those labels
 * @param requestedCoordinates when provided, only these coordinates are returned
 */
export const reconcileActiveTestLabels = (
	labelEvents: NDKEvent[],
	deletionEvents: NDKEvent[],
	requestedCoordinates?: string[],
): Map<string, TestLabelInfo> => {
	const requested = requestedCoordinates ? new Set(requestedCoordinates) : null

	// Newest active label per coordinate
	const activeByCoordinate = new Map<string, NDKEvent>()

	for (const label of labelEvents) {
		if (label.kind !== LABEL_EVENT_KIND) continue
		// Skip labels whose NIP-09 deletion has been seen — the item reappears
		const isDeleted = deletionEvents.some((deletion) => isLabelDeletionForLabel(deletion, label))
		if (isDeleted) continue

		for (const coordinate of getLabelTargetCoordinates(label)) {
			if (requested && !requested.has(coordinate)) continue
			const existing = activeByCoordinate.get(coordinate)
			if (!existing || (label.created_at ?? 0) >= (existing.created_at ?? 0)) {
				activeByCoordinate.set(coordinate, label)
			}
		}
	}

	const result = new Map<string, TestLabelInfo>()
	for (const [coordinate, label] of Array.from(activeByCoordinate)) {
		result.set(coordinate, { eventId: label.id, labelerPubkey: label.pubkey })
	}
	return result
}

// --- Relay fetching ---

const fetchAuthorizedLabelEvents = async (coordinates: string[], adminPubkeys: string[], relaySet?: NDKRelaySet): Promise<NDKEvent[]> => {
	const labelEvents: NDKEvent[] = []
	for (const chunk of chunkStrings(coordinates, TEST_LABEL_FETCH_CHUNK_SIZE)) {
		// Batched relay query: one filter for the whole chunk of coordinates.
		// `#L` narrows to our namespace at the relay; tags are re-validated
		// client-side for relays that ignore unknown single-letter tag filters.
		const filter: NDKFilter = {
			kinds: [LABEL_EVENT_KIND],
			'#a': chunk,
			'#L': [LABEL_NAMESPACE],
			...(adminPubkeys.length > 0 ? { authors: adminPubkeys } : {}),
		}
		const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: TEST_LABEL_FETCH_TIMEOUT_MS, relaySet })
		labelEvents.push(...Array.from(events))
	}
	return labelEvents
}

const fetchLabelDeletionEvents = async (labelEventIds: string[], adminPubkeys: string[], relaySet?: NDKRelaySet): Promise<NDKEvent[]> => {
	const deletionEvents: NDKEvent[] = []
	for (const chunk of chunkStrings(labelEventIds, TEST_LABEL_FETCH_CHUNK_SIZE)) {
		const filter: NDKFilter = {
			kinds: [LABEL_DELETION_KIND],
			'#e': chunk,
			...(adminPubkeys.length > 0 ? { authors: adminPubkeys } : {}),
		}
		const events = await ndkActions.fetchEventsWithTimeout(filter, { timeoutMs: TEST_LABEL_FETCH_TIMEOUT_MS, relaySet })
		deletionEvents.push(...Array.from(events))
	}
	return deletionEvents
}

/**
 * Fetch the active test labels for a set of item coordinates.
 *
 * For each coordinate this looks for kind-1985 label events (filtered to
 * authorized labelers and our namespace) and reconciles them against kind-5
 * deletion events, so a freshly un-labeled item is not kept hidden by a stale
 * cached label (§7.5 of the handover).
 *
 * Results are cached per coordinate for {@link TEST_LABEL_CACHE_TTL_MS} and
 * the store is reconciled with the fetched truth.
 *
 * @returns Map of coordinate → label metadata for coordinates with an ACTIVE label
 */
export const fetchTestLabels = async (coordinates: string[]): Promise<Map<string, TestLabelInfo>> => {
	const uniqueCoordinates = Array.from(new Set(coordinates.filter(Boolean)))
	if (uniqueCoordinates.length === 0) return new Map()

	const now = Date.now()
	const result = new Map<string, TestLabelInfo>()
	const staleCoordinates: string[] = []

	for (const coordinate of uniqueCoordinates) {
		const cached = testLabelCache.get(coordinate)
		if (cached && now - cached.fetchedAt < TEST_LABEL_CACHE_TTL_MS) {
			if (cached.label) result.set(coordinate, cached.label)
		} else {
			staleCoordinates.push(coordinate)
		}
	}

	// Cache hits imply a prior successful fetch, so the store can be synced for them.
	let authorizationResolved = staleCoordinates.length === 0

	if (staleCoordinates.length > 0) {
		const adminPubkeys = await getAuthorizedLabelerPubkeys()
		if (adminPubkeys !== null) {
			authorizationResolved = true
			const ndk = ndkActions.getNDK()
			if (ndk) {
				let activeLabels = new Map<string, TestLabelInfo>()
				if (adminPubkeys.length > 0) {
					const relaySet = getAppRelaySet()
					const labelEvents = await fetchAuthorizedLabelEvents(staleCoordinates, adminPubkeys, relaySet)

					// Validate labels and collect their ids for the deletion lookup
					const candidateLabels = labelEvents.filter((event) => isValidAuthorizedTestLabel(event, adminPubkeys))
					const labelEventIds = Array.from(new Set(candidateLabels.map((event) => event.id).filter(Boolean)))

					const deletionEvents = labelEventIds.length > 0 ? await fetchLabelDeletionEvents(labelEventIds, adminPubkeys, relaySet) : []
					activeLabels = reconcileActiveTestLabels(candidateLabels, deletionEvents, staleCoordinates)
				}
				// An empty authorized set means no labels can exist — nothing to fetch.

				// Write-through cache (including "no label" results) and reconcile the store
				const fetchedAt = Date.now()
				for (const coordinate of staleCoordinates) {
					const label = activeLabels.get(coordinate) ?? null
					testLabelCache.set(coordinate, { fetchedAt, label })
					if (label) result.set(coordinate, label)
				}
				testLabelActions.applyFetchedLabels(activeLabels, staleCoordinates)
			}
			// If NDK is not ready the store stays "not loaded" — the filter is a
			// no-op so items are not hidden based on missing data.
		}
	}

	// Sync the store with the full known truth for the requested coordinates,
	// including cache-hit entries (keeps store and cache consistent after
	// optimistic updates). Skipped when authorization was unavailable — the
	// store must stay "not loaded" so filtering fails open.
	if (authorizationResolved) {
		testLabelActions.applyFetchedLabels(result, uniqueCoordinates)
	}

	return result
}

/**
 * Drop the module-level label cache (all coordinates, or one).
 * Called after publishing label/deletion events so the next fetch reconciles
 * with the relay instead of serving a stale cache entry.
 */
export const invalidateTestLabelCache = (coordinate?: string) => {
	if (coordinate) {
		testLabelCache.delete(coordinate)
	} else {
		testLabelCache.clear()
	}
}

/**
 * Write a label result into the module cache as if freshly fetched.
 * Used by the publish flows to keep the optimistic store state consistent
 * with the cache during the relay round-trip (prevents a concurrent refetch
 * from reverting the optimistic update before propagation completes).
 */
export const setCachedTestLabel = (coordinate: string, label: TestLabelInfo | null) => {
	if (!coordinate) return
	testLabelCache.set(coordinate, { fetchedAt: Date.now(), label })
}

/**
 * Fetch labels for all item coordinates in an event list, then filter out
 * test-labeled items. This is the complete per-fetch label check used across
 * the product/auction fetch pipeline (Approach A in the handover: pre-fetch
 * labels, then apply the synchronous store-based filter).
 *
 * Pipeline position: NDK fetch → filterDeleted* → filterBlacklistedEvents →
 * excludeTestLabeledEvents → (business filters) → return.
 */
export const excludeTestLabeledEvents = async <T extends NDKEvent>(events: T[]): Promise<T[]> => {
	const coordinates = collectTestLabelCoordinates(events)
	if (coordinates.length === 0) return events

	await fetchTestLabels(coordinates)

	return filterTestLabeledEvents(events)
}

// --- React Query hooks ---

/**
 * Fetch test labels for a batch of coordinates and populate the label store.
 * The query key is the sorted, deduplicated coordinate set so different
 * orderings don't bust the cache.
 */
export const useTestLabels = (coordinates: string[]) => {
	const stableCoordinates = useMemo(() => Array.from(new Set(coordinates.filter(Boolean))).sort(), [coordinates.join(',')])

	return useQuery({
		queryKey: testLabelKeys.forCoordinates(stableCoordinates),
		queryFn: () => fetchTestLabels(stableCoordinates),
		enabled: stableCoordinates.length > 0,
		staleTime: TEST_LABEL_CACHE_TTL_MS,
		gcTime: 60_000,
	})
}

/**
 * Reactive label state for a single coordinate. Fetches the label from the
 * relay on mount (populating the store) and keeps the component in sync with
 * store updates (e.g. optimistic mark/un-mark).
 */
export const useTestLabelForCoordinate = (coordinate: string | undefined) => {
	useTestLabels(coordinate ? [coordinate] : [])

	const isLabeled = useStore(testLabelStore, (state) => (coordinate ? state.testLabelCoordinates.has(coordinate) : false))
	const labelEventId = useStore(testLabelStore, (state) => (coordinate ? (state.labelEventIds.get(coordinate) ?? '') : ''))
	const labelerPubkey = useStore(testLabelStore, (state) => (coordinate ? (state.labelerPubkeys.get(coordinate) ?? '') : ''))

	return { isLabeled, labelEventId, labelerPubkey }
}

/**
 * Invalidate the test-label caches (module cache + React Query) after a
 * label or deletion was published.
 */
export const invalidateTestLabelCaches = async (queryClient: QueryClient, coordinate?: string) => {
	invalidateTestLabelCache(coordinate)
	await queryClient.invalidateQueries({ queryKey: testLabelKeys.all })
}
