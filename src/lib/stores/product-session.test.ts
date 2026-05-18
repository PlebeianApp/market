import { beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore, type ProductFormState } from '@/lib/stores/product'
import { uiStore } from '@/lib/stores/ui'

const DIRTY_CREATE_STATE: ProductFormState = {
	...DEFAULT_FORM_STATE,
	formSessionId: 7,
	activeTab: 'shipping',
	name: 'Leaked draft',
	summary: 'summary',
	description: 'stale description',
	price: '42',
	quantity: '2',
	mainCategory: 'Bitcoin',
	images: [{ imageUrl: 'https://example.com/image.png', imageOrder: 0 }],
	shippings: [{ shipping: { id: 'ship-1', name: 'Standard' }, extraCost: '10' }],
	isDirty: true,
}

const seedCreateDraft = () => {
	productFormStore.setState(() => ({
		...DIRTY_CREATE_STATE,
		images: [...DIRTY_CREATE_STATE.images],
		shippings: [...DIRTY_CREATE_STATE.shippings],
	}))
}

describe('product form session boundaries', () => {
	beforeEach(() => {
		productFormStore.setState(() => DEFAULT_FORM_STATE)
		uiStore.setState((state) => ({
			...state,
			drawers: {
				...state.drawers,
				createProduct: false,
			},
			activeElement: undefined,
			selectedCurrency: 'USD',
		}))
	})

	test('route create session starts from a fresh create contract', () => {
		seedCreateDraft()

		productFormActions.startCreateProductSession()

		expect(productFormStore.state).toMatchObject({
			...DEFAULT_FORM_STATE,
			currency: 'USD',
			currencyMode: 'fiat',
			formSessionId: DIRTY_CREATE_STATE.formSessionId + 1,
		})
	})

	test('drawer create uses the same fresh session contract', () => {
		seedCreateDraft()
		productFormActions.startCreateProductSession()
		const routeSessionState = productFormStore.state

		seedCreateDraft()
		productFormActions.openCreateProductDrawer()

		expect(productFormStore.state).toEqual(routeSessionState)
		expect(uiStore.state.drawers.createProduct).toBe(true)
		expect(uiStore.state.activeElement).toBe('drawer-createProduct')
	})

	test('repeated create sessions do not inherit prior mutable state', () => {
		productFormActions.startCreateProductSession()
		const firstSessionId = productFormStore.state.formSessionId

		productFormActions.updateValues({
			name: 'Abandoned product',
			description: 'should be cleared',
			activeTab: 'shipping',
			shippings: [{ shipping: { id: 'ship-2', name: 'Express' }, extraCost: '5' }],
		})

		productFormActions.startCreateProductSession()

		expect(productFormStore.state.name).toBe('')
		expect(productFormStore.state.description).toBe('')
		expect(productFormStore.state.activeTab).toBe('name')
		expect(productFormStore.state.shippings).toEqual([])
		expect(productFormStore.state.editingProductId).toBeNull()
		expect(productFormStore.state.formSessionId).toBe(firstSessionId + 1)
	})

	test('create after an abandoned attempt starts fresh again', () => {
		seedCreateDraft()

		productFormActions.openCreateProductDrawer()

		expect(productFormStore.state).toMatchObject({
			...DEFAULT_FORM_STATE,
			currency: 'USD',
			currencyMode: 'fiat',
			formSessionId: DIRTY_CREATE_STATE.formSessionId + 1,
		})
	})

	test('edit session initialization does not reuse mutable create state', () => {
		seedCreateDraft()

		productFormActions.startEditProductSession('existing-product-d-tag')

		expect(productFormStore.state).toMatchObject({
			...DEFAULT_FORM_STATE,
			editingProductId: 'existing-product-d-tag',
			currency: 'USD',
			currencyMode: 'fiat',
			formSessionId: DIRTY_CREATE_STATE.formSessionId + 1,
		})
		expect(productFormStore.state.name).toBe('')
		expect(productFormStore.state.shippings).toEqual([])
	})
})
