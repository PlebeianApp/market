export interface ShippingRefEntry {
	shippingRef: string
	extraCost: string
	pubkey: string
	dTag: string
	isValid: boolean
}

export function dedupeAndParseShippingRefs(shippingOptions: Array<{ shippingRef: string; extraCost: string }>): ShippingRefEntry[] {
	const seen = new Set<string>()
	return shippingOptions.reduce<ShippingRefEntry[]>((acc, item) => {
		const dedupeKey = `${item.shippingRef}|${item.extraCost}`
		if (seen.has(dedupeKey)) return acc
		seen.add(dedupeKey)

		const parts = item.shippingRef.split(':')
		if (parts.length === 3 && parts[0] === '30406') {
			acc.push({ ...item, pubkey: parts[1], dTag: parts[2], isValid: true })
		} else {
			acc.push({ ...item, pubkey: '', dTag: '', isValid: false })
		}
		return acc
	}, [])
}
