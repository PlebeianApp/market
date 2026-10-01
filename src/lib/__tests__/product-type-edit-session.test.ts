import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as actualProductQueries from '@/queries/products'
import * as actualProductFormStorage from '@/lib/utils/productFormStorage'

// Serve edit loads from a fixture event and capture publishes, so the product
// form store runs without relay/network side effects.
type FixtureEvent = Awaited<ReturnType<typeof actualProductQueries.fetchProduct>>
let fixtureEvent: FixtureEvent = null

mock.module('@/queries/products', () => ({
	...actualProductQueries,
	fetchProduct: mock(async () => fixtureEvent),
}))

mock.module('@/publish/products', () => ({
	publishProduct: mock(async () => 'test-published-event-id'),
	updateProduct: mock(async () => 'test-updated-event-id'),
}))

mock.module('@/lib/utils/productFormStorage', () => ({
	...actualProductFormStorage,
	saveProductFormDraft: mock(async () => {}),
}))

import { assertVariationHasParent, productFormTypeFromTags } from '@/lib/utils/productType'
import { saveProductFormDraft } from '@/lib/utils/productFormStorage'
import { publishProduct, updateProduct } from '@/publish/products'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore } from '@/lib/stores/product'

const publishMock = publishProduct as ReturnType<typeof mock>
const saveDraftMock = saveProductFormDraft as ReturnType<typeof mock>
const updateMock = updateProduct as ReturnType<typeof mock>

// Plain object standing in for an NDKEvent; the product getters only read these fields
const listing = (dTag: string, extraTags: string[][]): FixtureEvent =>
	({
		kind: 30402,
		pubkey: 'a'.repeat(64),
		created_at: 1_700_000_000,
		content: 'Description',
		tags: [['d', dTag], ['title', 'Marmalade'], ['price', '5000', 'SATS'], ['stock', '3'], ['t', 'Food'], ...extraTags],
	}) as unknown as FixtureEvent

const publishedFormData = (mockFn: ReturnType<typeof mock>) => mockFn.mock.calls.at(-1)?.[1]

describe('product type across edit sessions', () => {
	beforeEach(() => {
		productFormStore.setState(() => DEFAULT_FORM_STATE)
		publishMock.mockClear()
		updateMock.mockClear()
		fixtureEvent = null
	})

	test('editing a listing without a type tag keeps it single', async () => {
		fixtureEvent = listing('shopstr-listing', [])

		await productFormActions.loadProductForEdit('event-id')

		expect(productFormStore.state.editingProductId).toBe('shopstr-listing')
		expect(productFormStore.state.productType).toBe('single')

		await productFormActions.continuePublishing({} as any, {} as any)
		expect(updateMock.mock.calls.at(-1)?.[0]).toBe('shopstr-listing')
		expect(publishedFormData(updateMock).productType).toBe('single')
	})

	test('editing a digital listing keeps its format', async () => {
		fixtureEvent = listing('ebook', [['type', 'simple', 'digital']])

		await productFormActions.loadProductForEdit('event-id')
		await productFormActions.continuePublishing({} as any, {} as any)

		expect(publishedFormData(updateMock)).toMatchObject({ productType: 'single', format: 'digital' })
	})

	test('a genuine variable listing still loads as variable', async () => {
		fixtureEvent = listing('family', [['type', 'variable', 'physical']])

		await productFormActions.loadProductForEdit('event-id')

		expect(productFormStore.state.productType).toBe('variable')
	})

	test('editing a listing without a type tag republishes it without one', async () => {
		fixtureEvent = listing('shopstr-listing', [])

		await productFormActions.loadProductForEdit('event-id')
		await productFormActions.continuePublishing({} as any, {} as any)

		expect(publishedFormData(updateMock).preservedTypeTag).toBeNull()
	})

	test('editing a variation child keeps its type tag and parent reference', async () => {
		const parent = ['a', `30402:${'a'.repeat(64)}:parent-d`]
		fixtureEvent = listing('child', [['type', 'variation', 'physical'], parent])

		await productFormActions.loadProductForEdit('event-id')
		await productFormActions.continuePublishing({} as any, {} as any)

		expect(publishedFormData(updateMock)).toMatchObject({
			preservedTypeTag: ['type', 'variation', 'physical'],
			preservedParentTag: parent,
		})
	})

	test('a variation child with an invalid parent reference is not republished', async () => {
		fixtureEvent = listing('child', [
			['type', 'variation', 'physical'],
			['a', 'not-a-ref'],
		])

		await productFormActions.loadProductForEdit('event-id')

		expect(() => assertVariationHasParent(productFormTypeFromTags(fixtureEvent!.tags))).toThrow('no valid parent')
	})

	test('leaving an edit before the debounce fires still saves the draft', async () => {
		saveDraftMock.mockClear()
		fixtureEvent = listing('ebook', [['type', 'simple', 'physical']])
		await productFormActions.loadProductForEdit('event-id')

		productFormActions.updateValues({ name: 'Typed just now' })
		productFormActions.endEditProductSession('ebook')

		expect(saveDraftMock).toHaveBeenCalledTimes(1)
		expect(saveDraftMock.mock.calls[0]?.[1]).toMatchObject({ name: 'Typed just now' })
	})

	test('leaving an abandoned variable edit resets the form', async () => {
		fixtureEvent = listing('family', [['type', 'variable', 'physical']])
		await productFormActions.loadProductForEdit('event-id')

		productFormActions.endEditProductSession('family')

		expect(productFormStore.state.editingProductId).toBeNull()
		expect(productFormStore.state.productType).toBe('single')
		expect(productFormStore.state.name).toBe('')
	})

	test('leaving an edit does not reset a session that already replaced it', async () => {
		fixtureEvent = listing('family', [['type', 'variable', 'physical']])
		await productFormActions.loadProductForEdit('event-id')

		productFormActions.startCreateProductSession()
		productFormActions.updateValues({ name: 'New product' })
		productFormActions.endEditProductSession('family')

		expect(productFormStore.state.name).toBe('New product')
	})
})
