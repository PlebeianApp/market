import { describe, expect, test } from 'bun:test'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import {
	findProductFamily,
	getProductSelectionCartIdentity,
	getProductSelectionImages,
	getProductSelectionTags,
	getVariationLabel,
	isProductAvailable,
	prepareProductCatalog,
	resolveProductVariation,
	resolveProductSelectionParent,
} from '@/queries/productFamilies'

const SELLER = 'a'.repeat(64)
const OTHER_SELLER = 'b'.repeat(64)

const product = (
	dTag: string,
	type: 'simple' | 'variable' | 'variation',
	options: {
		pubkey?: string
		stock?: number | string
		createdAt?: number
		parent?: string
		images?: string[]
		specs?: Array<[string, string]>
		price?: [number, string]
		visibility?: 'hidden' | 'on-sale' | 'pre-order'
		shippingOptions?: string[]
	} = {},
): NDKEvent =>
	({
		id: `${dTag}-${options.createdAt ?? 1}`,
		kind: 30402,
		pubkey: options.pubkey ?? SELLER,
		created_at: options.createdAt ?? 1,
		content: '',
		tags: [
			['d', dTag],
			['title', dTag],
			['type', type, 'physical'],
			['visibility', options.visibility ?? 'on-sale'],
			...(options.stock === undefined ? [] : [['stock', String(options.stock)]]),
			...(options.parent ? [['a', options.parent]] : []),
			...(options.images ?? []).map((url) => ['image', url]),
			...(options.shippingOptions ?? []).map((reference) => ['shipping_option', reference]),
			...(options.specs ?? []).map(([key, value]) => ['spec', key, value]),
			...(options.price ? [['price', String(options.price[0]), options.price[1]]] : []),
		],
	}) as unknown as NDKEvent

const parentAddress = (dTag: string, pubkey = SELLER) => `30402:${pubkey}:${dTag}`

describe('prepareProductCatalog', () => {
	test('groups a stock-zero parent with available children before filtering', () => {
		const parent = product('shirt', 'variable', { stock: 0, images: ['https://example.com/parent.jpg'] })
		const small = product('shirt-small', 'variation', {
			stock: 2,
			parent: parentAddress('shirt'),
			specs: [
				['Size', 'S'],
				['SKU', 'SHIRT-S'],
			],
		})
		const medium = product('shirt-medium', 'variation', {
			stock: 3,
			parent: parentAddress('shirt'),
			specs: [
				['Option 1', 'M'],
				['SKU', 'SHIRT-M'],
			],
		})

		const catalog = prepareProductCatalog([small, parent, medium])

		expect(catalog.items).toHaveLength(1)
		expect(catalog.items[0]?.kind).toBe('family')
		expect(catalog.families[0]?.availableVariations).toHaveLength(2)
		expect(getProductSelectionImages(parent, small).map((tag) => tag[1])).toEqual(['https://example.com/parent.jpg'])
		expect(getVariationLabel(small)).toBe('S')
		expect(getVariationLabel(medium)).toBe('M')
	})

	test('prefers a selected child image over parent images', () => {
		const parent = product('cloak', 'variable', { stock: 0, images: ['https://example.com/parent.jpg'] })
		const child = product('cloak-xs', 'variation', {
			stock: 1,
			parent: parentAddress('cloak'),
			images: ['https://example.com/child.jpg'],
		})

		expect(getProductSelectionImages(parent, child).map((tag) => tag[1])).toEqual(['https://example.com/child.jpg'])
	})

	test('leaves a simple product unchanged', () => {
		const simple = product('book', 'simple', { stock: 4 })
		const catalog = prepareProductCatalog([simple])

		expect(catalog.items).toEqual([{ kind: 'simple', product: simple }])
		expect(catalog.families).toEqual([])
	})

	test('does not make a family purchasable when every child is sold out', () => {
		const parent = product('sold-shirt', 'variable', { stock: 0 })
		const child = product('sold-shirt-s', 'variation', { stock: 0, parent: parentAddress('sold-shirt') })
		const catalog = prepareProductCatalog([parent, child])

		expect(catalog.items).toEqual([])
		expect(catalog.families[0]?.variations).toEqual([child])
		expect(catalog.families[0]?.availableVariations).toEqual([])
	})

	test('preserves a missing-parent child as unresolved and marks a capped read incomplete', () => {
		const orphan = product('orphan', 'variation', { stock: 2, parent: parentAddress('missing') })
		const catalog = prepareProductCatalog([orphan], { possiblyIncomplete: true })

		expect(catalog.items).toEqual([{ kind: 'unresolved-variation', product: orphan }])
		expect(catalog.unresolvedVariations).toEqual([orphan])
		expect(catalog.possiblyIncomplete).toBe(true)
	})

	test('keeps a partial family bounded to children actually present', () => {
		const parent = product('partial', 'variable', { stock: 0 })
		const presentChild = product('partial-s', 'variation', { stock: 1, parent: parentAddress('partial') })
		const catalog = prepareProductCatalog([parent, presentChild], { possiblyIncomplete: true })

		expect(catalog.families[0]?.variations).toEqual([presentChild])
		expect(catalog.items[0]?.kind).toBe('family')
	})

	test('rejects a foreign-author parent relation instead of merging it', () => {
		const foreignParent = product('foreign-parent', 'variable', { pubkey: OTHER_SELLER, stock: 0 })
		const spoofedChild = product('spoofed', 'variation', {
			stock: 1,
			parent: parentAddress('foreign-parent', OTHER_SELLER),
		})
		const catalog = prepareProductCatalog([foreignParent, spoofedChild])

		expect(catalog.families[0]?.variations).toEqual([])
		expect(catalog.unresolvedVariations).toEqual([spoofedChild])
		expect(catalog.items).toContainEqual({ kind: 'unresolved-variation', product: spoofedChild })
	})

	test('rejects a variation with multiple product-parent references', () => {
		const firstParent = product('first', 'variable', { stock: 0 })
		const secondParent = product('second', 'variable', { stock: 0 })
		const child = product('ambiguous', 'variation', { stock: 1, parent: parentAddress('first') })
		child.tags.push(['a', parentAddress('second')])

		const catalog = prepareProductCatalog([firstParent, secondParent, child])

		expect(catalog.families.every((family) => family.variations.length === 0)).toBe(true)
		expect(catalog.unresolvedVariations).toEqual([child])
	})

	test('uses the newest signed coordinate version deterministically', () => {
		const old = product('book', 'simple', { stock: 1, createdAt: 1 })
		const current = product('book', 'simple', { stock: 4, createdAt: 2 })

		expect(prepareProductCatalog([current, old]).items).toEqual([{ kind: 'simple', product: current }])
	})

	test('uses one strict availability predicate for preorders and malformed stock', () => {
		expect(isProductAvailable(product('preorder-no-stock', 'simple', { visibility: 'pre-order' }))).toBe(true)
		expect(isProductAvailable(product('normal-no-stock', 'simple'))).toBe(false)
		expect(isProductAvailable(product('negative', 'simple', { stock: -1 }))).toBe(false)
		expect(isProductAvailable(product('malformed', 'simple', { stock: '3 units' }))).toBe(false)
		expect(isProductAvailable(product('preorder-malformed', 'simple', { stock: '-1', visibility: 'pre-order' }))).toBe(false)
		expect(isProductAvailable(product('preorder-zero', 'simple', { stock: 0, visibility: 'pre-order' }))).toBe(true)
	})
})

describe('product selection', () => {
	test('keeps the selected child identity for cart and checkout', () => {
		const parent = product('shirt', 'variable', {
			stock: 0,
			images: ['https://example.com/parent.jpg'],
			price: [999, 'USD'],
		})
		const child = product('shirt-medium', 'variation', {
			stock: 3,
			parent: parentAddress('shirt'),
			images: ['https://example.com/child-medium.jpg'],
			price: [1200, 'SAT'],
			specs: [['Option 1', 'M']],
		})
		const catalog = prepareProductCatalog([parent, child])
		const family = findProductFamily(catalog, parent)
		const selected = resolveProductVariation(family, 'shirt-medium')

		expect(selected).toBe(child)
		expect(selected?.tags.find((tag) => tag[0] === 'price')?.slice(1)).toEqual(['1200', 'SAT'])
		expect(selected?.tags.find((tag) => tag[0] === 'stock')?.[1]).toBe('3')
		expect(getProductSelectionImages(parent, selected).map((tag) => tag[1])).toEqual(['https://example.com/child-medium.jpg'])
		expect(getProductSelectionCartIdentity(selected!, 2)).toEqual({ id: 'shirt-medium', sellerPubkey: SELLER, amount: 2 })
		expect(getProductSelectionCartIdentity(parent, 2)).toBeNull()
	})

	test('keeps a stable d-tag selection across republish and requires reselection after disappearance', () => {
		const parent = product('shirt', 'variable', { stock: 0 })
		const oldChild = product('shirt-medium', 'variation', {
			stock: 3,
			createdAt: 1,
			parent: parentAddress('shirt'),
			price: [1000, 'SAT'],
		})
		const republishedChild = product('shirt-medium', 'variation', {
			stock: 5,
			createdAt: 2,
			parent: parentAddress('shirt'),
			price: [1200, 'SAT'],
		})
		const sibling = product('shirt-large', 'variation', { stock: 4, parent: parentAddress('shirt') })
		const currentFamily = findProductFamily(prepareProductCatalog([parent, oldChild, republishedChild, sibling]), parent)

		expect(resolveProductVariation(currentFamily, 'shirt-medium')).toBe(republishedChild)
		expect(resolveProductVariation(currentFamily, 'removed-option')).toBeNull()
		expect(resolveProductVariation(currentFamily)).toBe(sibling)
	})

	test('resolves exact parent fallback tags without changing selected child identity', async () => {
		const shippingRef = `30406:${SELLER}:standard`
		const parent = product('shirt', 'variable', {
			stock: 0,
			images: ['https://example.com/parent.jpg'],
			shippingOptions: [shippingRef],
		})
		const child = product('shirt-small', 'variation', {
			stock: 2,
			parent: parentAddress('shirt'),
			price: [800, 'SAT'],
		})
		const resolvedParent = await resolveProductSelectionParent(child, async (pubkey, dTag) =>
			pubkey === SELLER && dTag === 'shirt' ? parent : null,
		)

		expect(resolvedParent).toBe(parent)
		expect(getProductSelectionImages(resolvedParent!, child).map((tag) => tag[1])).toEqual(['https://example.com/parent.jpg'])
		expect(getProductSelectionTags(resolvedParent!, child, 'shipping_option')).toEqual([['shipping_option', shippingRef]])
		expect(getProductSelectionCartIdentity(child, 1)?.id).toBe('shirt-small')
	})
})
