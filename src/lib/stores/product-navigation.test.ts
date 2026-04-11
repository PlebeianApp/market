import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore } from '@/lib/stores/product'

describe('product form navigation semantics', () => {
	let timeoutCalls = 0
	const originalSetTimeout = globalThis.setTimeout
	const originalClearTimeout = globalThis.clearTimeout

	beforeEach(() => {
		timeoutCalls = 0
		globalThis.setTimeout = ((_handler: TimerHandler, _timeout?: number) => {
			timeoutCalls += 1
			return timeoutCalls as unknown as ReturnType<typeof setTimeout>
		}) as typeof setTimeout
		globalThis.clearTimeout = ((_id?: ReturnType<typeof setTimeout>) => {}) as typeof clearTimeout

		productFormStore.setState(() => DEFAULT_FORM_STATE)
	})

	afterEach(() => {
		globalThis.setTimeout = originalSetTimeout
		globalThis.clearTimeout = originalClearTimeout
	})

	test('changing active tab does not mark the draft dirty or schedule autosave', () => {
		productFormActions.setActiveTab('shipping')

		expect(productFormStore.state.activeTab).toBe('shipping')
		expect(productFormStore.state.isDirty).toBe(false)
		expect(timeoutCalls).toBe(0)
	})

	test('changing active tab does not mutate product fields', () => {
		productFormStore.setState((state) => ({
			...state,
			name: 'Existing name',
			description: 'Existing description',
			price: '42',
		}))

		productFormActions.setActiveTab('images')

		expect(productFormStore.state).toMatchObject({
			name: 'Existing name',
			description: 'Existing description',
			price: '42',
			activeTab: 'images',
			isDirty: false,
		})
		expect(timeoutCalls).toBe(0)
	})

	test('real product field edits still mark the draft dirty and schedule autosave', () => {
		productFormActions.updateValues({ name: 'Updated product' })

		expect(productFormStore.state.name).toBe('Updated product')
		expect(productFormStore.state.isDirty).toBe(true)
		expect(timeoutCalls).toBe(1)
	})

	test('reset restores the initial tab without marking the draft dirty', () => {
		productFormActions.updateValues({ name: 'Abandoned draft' })
		productFormActions.setActiveTab('shipping')

		productFormActions.reset()

		expect(productFormStore.state.activeTab).toBe('name')
		expect(productFormStore.state.isDirty).toBe(false)
	})
})
