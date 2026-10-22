import type { NDKEvent } from '@/lib/nostr/ndk-events'

const PRODUCT_KIND = 30402
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/i
const PRODUCT_COORDINATE_PATTERN = /^30402:([0-9a-f]{64}):(.+)$/i
const NATURAL_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export interface ProductFamily {
	parent: NDKEvent
	variations: NDKEvent[]
	availableVariations: NDKEvent[]
}

export type ProductCatalogItem =
	| { kind: 'family'; product: NDKEvent; family: ProductFamily }
	| { kind: 'simple' | 'unresolved-variation'; product: NDKEvent }

export interface ProductCatalog {
	items: ProductCatalogItem[]
	families: ProductFamily[]
	unresolvedVariations: NDKEvent[]
	/** Advisory: true for a known capped read; false cannot prove every relay returned a complete result. */
	possiblyIncomplete: boolean
}

export interface ProductSelectionCartIdentity {
	id: string
	sellerPubkey: string
	amount: number
}

export interface ProductAddress {
	address: string
	pubkey: string
	dTag: string
}

export interface ProductSelectionEvents {
	selected: NDKEvent
	parent: NDKEvent | null
	parentRequired: boolean
	identity?: ProductSelectionIdentity
}

export interface ProductSelectionIdentity {
	source: 'coordinate' | 'legacy-event-id'
	requestedId: string
	canonicalDTag: string
}

export interface ResolvedProductIdentifier {
	event: NDKEvent
	identity: ProductSelectionIdentity
}

/**
 * Returns the verified family parent for a variation, or the selected product
 * itself only when no parent is required. A variation never falls back to the
 * child event as its own parent context.
 */
export const getProductSelectionContext = (selection: ProductSelectionEvents): NDKEvent | null =>
	selection.parentRequired ? selection.parent : selection.selected

export const isProductSelectionResolved = (selection: ProductSelectionEvents): boolean => getProductSelectionContext(selection) !== null

export const isProductSelectionValidForCartItem = (selection: ProductSelectionEvents, productId: string, sellerPubkey: string): boolean => {
	const normalizedSeller = sellerPubkey.trim().toLowerCase()
	if (!isProductSelectionResolved(selection) || getProductEventType(selection.selected) === 'variable') return false

	const selectedAddress = getProductAddress(selection.selected)
	const canonicalDTag = getProductDTag(selection.selected)
	if (!selectedAddress || !canonicalDTag || selection.selected.pubkey.trim().toLowerCase() !== normalizedSeller) return false

	if (selectedAddress === `${PRODUCT_KIND}:${normalizedSeller}:${productId}`) {
		return (
			!selection.identity ||
			(selection.identity.requestedId === productId &&
				selection.identity.canonicalDTag === canonicalDTag &&
				selection.identity.source === 'coordinate')
		)
	}

	return (
		selection.identity?.source === 'legacy-event-id' &&
		EVENT_ID_PATTERN.test(productId) &&
		selection.identity.requestedId === productId &&
		selection.identity.canonicalDTag === canonicalDTag
	)
}

const tagValues = (event: NDKEvent, name: string) => event.tags.filter((tag) => tag[0] === name)

export const getProductDTag = (event: NDKEvent): string | null => {
	const dTags = tagValues(event, 'd')
	if (dTags.length !== 1) return null
	return dTags[0]?.[1]?.trim() || null
}

export const getProductAddress = (event: NDKEvent): string | null => {
	const dTag = getProductDTag(event)
	const pubkey = event.pubkey.trim().toLowerCase()
	if (event.kind !== PRODUCT_KIND || !dTag || !PUBKEY_PATTERN.test(pubkey)) return null
	return `${PRODUCT_KIND}:${pubkey}:${dTag}`
}

export const parseProductAddress = (address: string): ProductAddress | null => {
	const match = PRODUCT_COORDINATE_PATTERN.exec(address.trim())
	if (!match) return null
	const pubkey = match[1].toLowerCase()
	const dTag = match[2].trim()
	if (!PUBKEY_PATTERN.test(pubkey) || !dTag) return null
	return { address: `${PRODUCT_KIND}:${pubkey}:${dTag}`, pubkey, dTag }
}

export const getProductEventType = (event: NDKEvent): string => tagValues(event, 'type')[0]?.[1] ?? 'simple'

export const isProductHidden = (event: NDKEvent): boolean => tagValues(event, 'visibility')[0]?.[1] === 'hidden'

export const isProductAvailable = (event: NDKEvent): boolean => {
	const visibility = tagValues(event, 'visibility')[0]?.[1] ?? 'on-sale'
	if (visibility === 'hidden') return false

	const stockValue = tagValues(event, 'stock')[0]?.[1]
	if (stockValue === undefined) return visibility === 'pre-order'
	if (!/^\d+$/.test(stockValue)) return false
	const stock = Number(stockValue)
	if (!Number.isSafeInteger(stock) || stock < 0) return false
	return visibility === 'pre-order' || stock > 0
}

/**
 * Resolve one exact, same-author kind-30402 parent reference. A variation with
 * no parent, multiple product parents, a malformed coordinate, or a foreign
 * author remains unresolved instead of being merged heuristically.
 */
export const getVariationParentAddress = (event: NDKEvent): string | null => {
	if (getProductEventType(event) !== 'variation') return null

	const productReferences = tagValues(event, 'a')
		.map((tag) => tag[1]?.trim())
		.filter((value): value is string => !!value?.startsWith('30402:'))
	if (productReferences.length !== 1) return null

	const parent = parseProductAddress(productReferences[0])
	if (!parent || parent.pubkey !== event.pubkey.trim().toLowerCase()) return null
	return parent.address
}

export const resolveProductSelectionParent = async (
	selected: NDKEvent,
	fetchParent: (pubkey: string, dTag: string) => Promise<NDKEvent | null>,
): Promise<NDKEvent | null> => {
	const parentAddress = getVariationParentAddress(selected)
	const parentCoordinates = parentAddress ? parseProductAddress(parentAddress) : null
	if (!parentCoordinates) return null

	const parent = await fetchParent(parentCoordinates.pubkey, parentCoordinates.dTag)
	if (!parent || getProductEventType(parent) !== 'variable' || getProductAddress(parent) !== parentCoordinates.address) return null
	return parent
}

/**
 * Resolve a persisted product identifier without confusing a 64-hex d-tag for
 * an event ID. The exact seller coordinate always wins. Legacy event-ID lookup
 * is attempted only after that coordinate is absent, and must map through a
 * same-author kind-30402 event to a currently resolvable canonical coordinate.
 */
export const resolveProductIdentifier = async (
	id: string,
	sellerPubkey: string,
	readers: {
		fetchByCoordinate: (pubkey: string, dTag: string) => Promise<NDKEvent | null>
		fetchByEventId: (eventId: string) => Promise<NDKEvent | null>
	},
): Promise<ResolvedProductIdentifier | null> => {
	const normalizedSeller = sellerPubkey.trim().toLowerCase()
	if (!id || !PUBKEY_PATTERN.test(normalizedSeller)) return null

	const expectedAddress = `${PRODUCT_KIND}:${normalizedSeller}:${id}`
	const coordinateEvent = await readers.fetchByCoordinate(normalizedSeller, id)
	if (coordinateEvent) {
		if (getProductAddress(coordinateEvent) !== expectedAddress) return null
		return {
			event: coordinateEvent,
			identity: { source: 'coordinate', requestedId: id, canonicalDTag: id },
		}
	}

	if (!EVENT_ID_PATTERN.test(id)) return null

	const legacyEvent = await readers.fetchByEventId(id)
	const legacyDTag = legacyEvent ? getProductDTag(legacyEvent) : null
	if (
		!legacyEvent ||
		legacyEvent.id !== id ||
		legacyEvent.kind !== PRODUCT_KIND ||
		legacyEvent.pubkey.trim().toLowerCase() !== normalizedSeller ||
		!legacyDTag
	) {
		return null
	}
	// If both interpretations use the same 64-hex value, two inconsistent
	// coordinate reads cannot establish which identity the persisted row meant.
	if (legacyDTag === id) return null

	const canonicalAddress = `${PRODUCT_KIND}:${normalizedSeller}:${legacyDTag}`
	const canonicalEvent = await readers.fetchByCoordinate(normalizedSeller, legacyDTag)
	if (!canonicalEvent || getProductAddress(canonicalEvent) !== canonicalAddress) return null

	return {
		event: canonicalEvent,
		identity: { source: 'legacy-event-id', requestedId: id, canonicalDTag: legacyDTag },
	}
}

const isNewerAddressableEvent = (candidate: NDKEvent, existing: NDKEvent): boolean => {
	const candidateTime = candidate.created_at ?? 0
	const existingTime = existing.created_at ?? 0
	if (candidateTime !== existingTime) return candidateTime > existingTime
	return candidate.id < existing.id
}

const byNewestFirst = (left: NDKEvent, right: NDKEvent) =>
	(right.created_at ?? 0) - (left.created_at ?? 0) || left.id.localeCompare(right.id)

export const getVariationLabel = (event: NDKEvent): string => {
	const displaySpecs = tagValues(event, 'spec')
		.map((tag) => ({ key: tag[1]?.trim() ?? '', value: tag[2]?.trim() ?? '' }))
		.filter(({ key, value }) => key && value && key.toLowerCase() !== 'sku')

	if (displaySpecs.length === 1) return displaySpecs[0].value
	if (displaySpecs.length > 1) return displaySpecs.map(({ key, value }) => `${key}: ${value}`).join(' / ')
	return tagValues(event, 'title')[0]?.[1]?.trim() || getProductDTag(event) || 'Option'
}

const byVariationLabel = (left: NDKEvent, right: NDKEvent) =>
	NATURAL_COLLATOR.compare(getVariationLabel(left), getVariationLabel(right)) || byNewestFirst(left, right)

export function prepareProductCatalog(events: readonly NDKEvent[], options: { possiblyIncomplete?: boolean } = {}): ProductCatalog {
	const newestByAddress = new Map<string, NDKEvent>()

	for (const event of events) {
		const address = getProductAddress(event)
		if (!address) continue
		const existing = newestByAddress.get(address)
		if (!existing || isNewerAddressableEvent(event, existing)) newestByAddress.set(address, event)
	}

	const products = Array.from(newestByAddress.values())
	const variableParents = new Map(
		products.filter((event) => getProductEventType(event) === 'variable').map((event) => [getProductAddress(event)!, event]),
	)
	const variationsByParent = new Map<string, NDKEvent[]>()
	const unresolvedVariations: NDKEvent[] = []

	for (const event of products) {
		if (getProductEventType(event) !== 'variation') continue
		const parentAddress = getVariationParentAddress(event)
		const parent = parentAddress ? variableParents.get(parentAddress) : undefined
		if (!parent) {
			unresolvedVariations.push(event)
			continue
		}
		const siblings = variationsByParent.get(parentAddress!) ?? []
		siblings.push(event)
		variationsByParent.set(parentAddress!, siblings)
	}

	const families = Array.from(variableParents.entries()).map<ProductFamily>(([parentAddress, parent]) => {
		const variations = (variationsByParent.get(parentAddress) ?? [])
			.filter((variation) => !isProductHidden(variation))
			.sort(byVariationLabel)
		return {
			parent,
			variations,
			availableVariations: variations.filter(isProductAvailable),
		}
	})
	const familyByParentAddress = new Map(families.map((family) => [getProductAddress(family.parent)!, family]))
	const linkedVariationAddresses = new Set<string>(
		families.flatMap((family) => family.variations.map(getProductAddress)).filter((address): address is string => address !== null),
	)
	const items: ProductCatalogItem[] = []

	for (const event of products.sort(byNewestFirst)) {
		const type = getProductEventType(event)
		const address = getProductAddress(event)!
		if (type === 'variation' && linkedVariationAddresses.has(address)) continue

		if (type === 'variable') {
			const family = familyByParentAddress.get(address)!
			if (!isProductHidden(event) && family.availableVariations.length > 0) {
				items.push({ kind: 'family', product: event, family })
			}
			continue
		}

		if (isProductAvailable(event)) {
			items.push({ kind: type === 'variation' ? 'unresolved-variation' : 'simple', product: event })
		}
	}

	return {
		items,
		families,
		unresolvedVariations: unresolvedVariations.sort(byNewestFirst),
		possiblyIncomplete: options.possiblyIncomplete ?? false,
	}
}

export const findProductFamily = (catalog: ProductCatalog | undefined, event: NDKEvent | null): ProductFamily | null => {
	if (!catalog || !event) return null
	const address = getProductAddress(event)
	if (!address) return null
	return (
		catalog.families.find(
			(family) =>
				getProductAddress(family.parent) === address || family.variations.some((variation) => getProductAddress(variation) === address),
		) ?? null
	)
}

/**
 * Resolve a child by stable d-tag. Omitting `selectedDTag` allows the initial
 * available-child default; an explicit d-tag that is absent returns null so a
 * republish/removal cannot silently switch the buyer to another option.
 */
export const resolveProductVariation = (family: ProductFamily | null, selectedDTag?: string): NDKEvent | null => {
	if (!family) return null
	if (selectedDTag !== undefined) {
		return family.variations.find((variation) => getProductDTag(variation) === selectedDTag) ?? null
	}
	return family.availableVariations[0] ?? family.variations[0] ?? null
}

const getProductImages = (event: NDKEvent): string[][] =>
	tagValues(event, 'image').sort((left, right) => {
		if (left[3] && right[3]) return Number.parseInt(left[3], 10) - Number.parseInt(right[3], 10)
		return 0
	})

export const getProductSelectionImages = (parent: NDKEvent, selected: NDKEvent | null): string[][] => {
	const selectedImages = selected ? getProductImages(selected) : []
	return selectedImages.length > 0 ? selectedImages : getProductImages(parent)
}

export const getProductSelectionTags = (parent: NDKEvent, selected: NDKEvent | null, tagName: string): string[][] => {
	const selectedTags = selected ? tagValues(selected, tagName) : []
	return selectedTags.length > 0 ? selectedTags : tagValues(parent, tagName)
}

export const getProductSelectionCartIdentity = (event: NDKEvent, amount: number): ProductSelectionCartIdentity | null => {
	const id = getProductDTag(event)
	const sellerPubkey = event.pubkey.trim().toLowerCase()
	if (getProductEventType(event) === 'variable') return null
	if (!id || !PUBKEY_PATTERN.test(sellerPubkey) || !Number.isInteger(amount) || amount < 1) return null
	return { id, sellerPubkey, amount }
}
