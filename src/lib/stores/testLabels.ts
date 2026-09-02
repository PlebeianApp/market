import { Store } from '@tanstack/store'

/**
 * Metadata for an active test label on one item coordinate.
 */
export interface TestLabelInfo {
	/** id of the kind-1985 label event (needed to reference in the NIP-09 deletion) */
	eventId: string
	/** pubkey of the authorized labeler who applied the label */
	labelerPubkey: string
}

export interface TestLabelState {
	// Coordinates ("kind:pubkey:identifier") carrying an active test label
	testLabelCoordinates: Set<string>

	// coordinate -> id of the active label event (referenced by the NIP-09 deletion)
	labelEventIds: Map<string, string>

	// coordinate -> pubkey of the labeler who applied the active label
	labelerPubkeys: Map<string, string>

	// Whether the user opted to reveal test-labeled items in browsing surfaces
	showTestListings: boolean

	// Metadata
	lastUpdated: number
	isLoaded: boolean
}

const initialState: TestLabelState = {
	testLabelCoordinates: new Set<string>(),
	labelEventIds: new Map<string, string>(),
	labelerPubkeys: new Map<string, string>(),
	showTestListings: false,
	lastUpdated: 0,
	isLoaded: false,
}

export const testLabelStore = new Store<TestLabelState>(initialState)

export const testLabelActions = {
	/**
	 * Mark a coordinate as test-labeled.
	 * @param coordinate "kind:pubkey:identifier" of the labeled item
	 * @param eventId id of the active kind-1985 label event
	 * @param labelerPubkey pubkey of the labeler who applied the label
	 */
	setLabel: (coordinate: string, eventId: string, labelerPubkey?: string) => {
		if (!coordinate) return

		testLabelStore.setState((state) => {
			const testLabelCoordinates = new Set(state.testLabelCoordinates)
			const labelEventIds = new Map(state.labelEventIds)
			const labelerPubkeys = new Map(state.labelerPubkeys)

			testLabelCoordinates.add(coordinate)
			if (eventId) labelEventIds.set(coordinate, eventId)
			if (labelerPubkey) labelerPubkeys.set(coordinate, labelerPubkey)

			return {
				...state,
				testLabelCoordinates,
				labelEventIds,
				labelerPubkeys,
				lastUpdated: Date.now(),
			}
		})
	},

	/**
	 * Remove the test label from a coordinate (deletion seen or optimistic un-label).
	 */
	removeLabel: (coordinate: string) => {
		if (!coordinate) return

		testLabelStore.setState((state) => {
			if (!state.testLabelCoordinates.has(coordinate)) return state

			const testLabelCoordinates = new Set(state.testLabelCoordinates)
			const labelEventIds = new Map(state.labelEventIds)
			const labelerPubkeys = new Map(state.labelerPubkeys)

			testLabelCoordinates.delete(coordinate)
			labelEventIds.delete(coordinate)
			labelerPubkeys.delete(coordinate)

			return {
				...state,
				testLabelCoordinates,
				labelEventIds,
				labelerPubkeys,
				lastUpdated: Date.now(),
			}
		})
	},

	/**
	 * Reconcile the store with freshly fetched label truth for a batch of
	 * coordinates. Coordinates present in `labels` are marked labeled; every
	 * other coordinate in `fetchedCoordinates` is treated as un-labeled.
	 * Coordinates outside `fetchedCoordinates` are left untouched.
	 */
	applyFetchedLabels: (labels: Map<string, TestLabelInfo>, fetchedCoordinates: string[]) => {
		const uniqueCoordinates = Array.from(new Set(fetchedCoordinates.filter(Boolean)))
		if (uniqueCoordinates.length === 0) return

		testLabelStore.setState((state) => {
			const testLabelCoordinates = new Set(state.testLabelCoordinates)
			const labelEventIds = new Map(state.labelEventIds)
			const labelerPubkeys = new Map(state.labelerPubkeys)

			for (const coordinate of uniqueCoordinates) {
				const label = labels.get(coordinate)
				if (label) {
					testLabelCoordinates.add(coordinate)
					if (label.eventId) labelEventIds.set(coordinate, label.eventId)
					if (label.labelerPubkey) labelerPubkeys.set(coordinate, label.labelerPubkey)
				} else {
					testLabelCoordinates.delete(coordinate)
					labelEventIds.delete(coordinate)
					labelerPubkeys.delete(coordinate)
				}
			}

			return {
				...state,
				testLabelCoordinates,
				labelEventIds,
				labelerPubkeys,
				lastUpdated: Date.now(),
				isLoaded: true,
			}
		})
	},

	/**
	 * Check if a coordinate carries an active test label
	 */
	isTestLabeled: (coordinate: string): boolean => {
		if (!coordinate) return false
		return testLabelStore.state.testLabelCoordinates.has(coordinate)
	},

	/**
	 * Get the id of the active label event for a coordinate
	 * (referenced by the NIP-09 deletion when un-labeling)
	 */
	getLabelEventId: (coordinate: string): string | undefined => {
		return testLabelStore.state.labelEventIds.get(coordinate)
	},

	/**
	 * Get the pubkey of the labeler who applied the active label
	 */
	getLabelerPubkey: (coordinate: string): string | undefined => {
		return testLabelStore.state.labelerPubkeys.get(coordinate)
	},

	/**
	 * Get all test-labeled coordinates
	 */
	getTestLabeledCoordinates: (): string[] => {
		return Array.from(testLabelStore.state.testLabelCoordinates)
	},

	/**
	 * Check if labels have been loaded (at least one label check completed)
	 */
	areLabelsLoaded: (): boolean => {
		return testLabelStore.state.isLoaded
	},

	/**
	 * Get last update timestamp
	 */
	getLastUpdated: (): number => {
		return testLabelStore.state.lastUpdated
	},

	/**
	 * Set whether test-labeled items are revealed in browsing surfaces.
	 */
	setShowTestListings: (show: boolean) => {
		testLabelStore.setState((state) => ({
			...state,
			showTestListings: show,
		}))
	},

	/**
	 * Toggle whether test-labeled items are revealed in browsing surfaces.
	 */
	toggleShowTestListings: () => {
		testLabelStore.setState((state) => ({
			...state,
			showTestListings: !state.showTestListings,
		}))
	},

	/**
	 * Clear all label data (reset to initial state)
	 */
	clearLabels: () => {
		testLabelStore.setState((state) => ({
			...state,
			...initialState,
		}))
	},
}

// React hook for consuming the store
export const useTestLabelStore = () => {
	return {
		...testLabelStore.state,
		...testLabelActions,
	}
}
