export function syncMintSelection(
	prevAvailable: string[],
	currentAvailable: string[],
	currentSelection: string[],
	userRemovedMints: Set<string>,
): string[] {
	const addedMints = currentAvailable.filter((m) => !prevAvailable.includes(m) && !userRemovedMints.has(m) && !currentSelection.includes(m))

	return [...currentSelection, ...addedMints]
}
