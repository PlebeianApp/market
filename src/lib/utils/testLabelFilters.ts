import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { TEST_LABEL_AUCTION_KIND, TEST_LABEL_PRODUCT_KIND } from '@/lib/constants/testLabels'
import { testLabelActions } from '@/lib/stores/testLabels'
import { getATagFromCoords } from './coords'

/**
 * ADR-0009 — Test-listing curation filters.
 *
 * Synchronous store reads mirroring `blacklistFilters.ts`. The relay fetch
 * that populates the store happens first, via `fetchTestLabels` /
 * `excludeTestLabeledEvents` (see src/queries/testLabels.tsx).
 */

/**
 * Item coordinate ("kind:pubkey:identifier") of a product/auction event,
 * or null for events that cannot carry a test label.
 */
export const getItemTestLabelCoordinate = (event: NDKEvent): string | null => {
	if (event.kind !== TEST_LABEL_PRODUCT_KIND && event.kind !== TEST_LABEL_AUCTION_KIND) return null
	const dTag = event.tagValue('d')
	if (!dTag) return null
	return getATagFromCoords({ kind: event.kind, pubkey: event.pubkey, identifier: dTag })
}

/**
 * Collect the unique item coordinates referenced by an array of events.
 * Used to batch the label fetch for a page of items before filtering.
 */
export const collectTestLabelCoordinates = (events: NDKEvent[]): string[] => {
	const coordinates = new Set<string>()
	for (const event of events) {
		const coordinate = getItemTestLabelCoordinate(event)
		if (coordinate) coordinates.add(coordinate)
	}
	return Array.from(coordinates)
}

/**
 * Filter out test-labeled items from an array of events.
 *
 * Must be called AFTER filterBlacklistedEvents and filterDeleted* (ADR-0009:
 * the label check runs alongside the existing delete and blacklist checks,
 * before queries return data).
 *
 * Synchronous store read — if labels have not been loaded yet the filter
 * fails open and returns all events.
 */
export const filterTestLabeledEvents = <T extends NDKEvent>(events: T[]): T[] => {
	if (!testLabelActions.areLabelsLoaded()) {
		return events // Return all if labels not loaded yet
	}

	return events.filter((event) => !isItemEventTestLabeled(event))
}

/**
 * Check if any item event (product or auction) carries an active test label
 */
export const isItemEventTestLabeled = (event: NDKEvent): boolean => {
	const coordinate = getItemTestLabelCoordinate(event)
	if (!coordinate) return false
	return testLabelActions.isTestLabeled(coordinate)
}

/**
 * Check if a product event carries an active test label
 */
export const isProductTestLabeled = (event: NDKEvent): boolean => {
	if (event.kind !== TEST_LABEL_PRODUCT_KIND) return false
	return isItemEventTestLabeled(event)
}

/**
 * Check if an auction event carries an active test label
 */
export const isAuctionTestLabeled = (event: NDKEvent): boolean => {
	if (event.kind !== TEST_LABEL_AUCTION_KIND) return false
	return isItemEventTestLabeled(event)
}

/**
 * Filter item coordinates, dropping test-labeled ones
 */
export const filterTestLabeledCoordinates = (coordinates: string[]): string[] => {
	return coordinates.filter((coordinate) => !testLabelActions.isTestLabeled(coordinate))
}

/**
 * React hook that returns filter functions with reactive updates
 * Use this in components that need to react to test-label changes
 */
export const useTestLabelFilters = () => {
	return {
		filterEvents: filterTestLabeledEvents,
		isProductTestLabeled,
		isAuctionTestLabeled,
		isItemTestLabeled: isItemEventTestLabeled,
		filterCoordinates: filterTestLabeledCoordinates,
	}
}
