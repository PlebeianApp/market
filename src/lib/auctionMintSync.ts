export function syncMintSelection(prevAvailable: string[], currentAvailable: string[], currentSelection: string[]): string[] {
	const removedMints = prevAvailable.filter((m) => !currentAvailable.includes(m))
	const addedMints = currentAvailable.filter((m) => !prevAvailable.includes(m))

	return [...currentSelection.filter((m) => !removedMints.includes(m)), ...addedMints]
}
