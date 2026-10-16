export type AuctionShippingRefInput = {
	shippingRef: string
	extraCost: string
}

export type ValidAuctionShippingRef = AuctionShippingRefInput & {
	status: 'valid'
	pubkey: string
	dTag: string
}

export type InvalidAuctionShippingRef = AuctionShippingRefInput & {
	status: 'invalid'
	pubkey: ''
	dTag: ''
}

export type AuctionShippingRef = ValidAuctionShippingRef | InvalidAuctionShippingRef

const SHIPPING_OPTION_KIND = '30406'
const NOSTR_PUBKEY_HEX = /^[0-9a-f]{64}$/i

export function parseAuctionShippingRef(shippingRef: string): Pick<ValidAuctionShippingRef, 'shippingRef' | 'pubkey' | 'dTag'> | null {
	const parts = shippingRef.split(':')
	if (parts.length !== 3) return null

	const [kind, pubkey, dTag] = parts
	if (kind !== SHIPPING_OPTION_KIND) return null
	if (!NOSTR_PUBKEY_HEX.test(pubkey)) return null
	if (!dTag) return null

	return { shippingRef, pubkey, dTag }
}

export function getUniqueAuctionShippingRefs(inputs: AuctionShippingRefInput[]): AuctionShippingRef[] {
	const seenShippingRefs = new Set<string>()
	const refs: AuctionShippingRef[] = []

	for (const input of inputs) {
		if (seenShippingRefs.has(input.shippingRef)) continue
		seenShippingRefs.add(input.shippingRef)

		const parsed = parseAuctionShippingRef(input.shippingRef)
		if (!parsed) {
			refs.push({ ...input, status: 'invalid', pubkey: '', dTag: '' })
			continue
		}

		refs.push({ ...input, ...parsed, status: 'valid' })
	}

	return refs
}
