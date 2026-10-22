import { describe, expect, test } from 'bun:test'
import {
	canContinueCheckoutPayment,
	canSubmitCheckoutShipping,
	deriveCheckoutProductSelectionState,
	type ProductSelectionQuerySnapshot,
} from '@/lib/checkout/productSelectionGuard'
import type { ProductSelectionEvents } from '@/queries/productFamilies'

const SELLER = 'a'.repeat(64)
const CHILD_D_TAG = 'variable-child'
const PARENT_D_TAG = 'variable-parent'
const product = { id: CHILD_D_TAG, sellerPubkey: SELLER }

const resolvedSelection: ProductSelectionEvents = {
	selected: {
		id: 'child-event',
		kind: 30402,
		pubkey: SELLER,
		created_at: 2,
		content: '',
		tags: [
			['d', CHILD_D_TAG],
			['type', 'variation', 'physical'],
			['a', `30402:${SELLER}:${PARENT_D_TAG}`],
		],
	} as any,
	parent: {
		id: 'parent-event',
		kind: 30402,
		pubkey: SELLER,
		created_at: 1,
		content: '',
		tags: [
			['d', PARENT_D_TAG],
			['type', 'variable', 'physical'],
		],
	} as any,
	parentRequired: true,
}

const variableContainerSelection: ProductSelectionEvents = {
	selected: resolvedSelection.parent!,
	parent: null,
	parentRequired: false,
}

const snapshot = (overrides: Partial<ProductSelectionQuerySnapshot>): ProductSelectionQuerySnapshot => ({
	isPending: false,
	isFetching: false,
	isError: false,
	isSuccess: true,
	data: resolvedSelection,
	...overrides,
})

describe('checkout product-selection transition guards', () => {
	test('blocks both checkout transitions while a stale-shipping item is still resolving', () => {
		const state = deriveCheckoutProductSelectionState([product], [snapshot({ isFetching: true })])

		expect(state).toBe('pending')
		expect(canSubmitCheckoutShipping(state, true)).toBe(false)
		expect(canContinueCheckoutPayment(state, true)).toBe(false)
	})

	test('blocks both checkout transitions after parent resolution rejects', () => {
		const state = deriveCheckoutProductSelectionState([product], [snapshot({ isError: true, isSuccess: false, data: undefined })])

		expect(state).toBe('invalid')
		expect(canSubmitCheckoutShipping(state, true)).toBe(false)
		expect(canContinueCheckoutPayment(state, true)).toBe(false)
	})

	test('blocks a variable container even when its exact coordinate resolves', () => {
		const variableProduct = { id: PARENT_D_TAG, sellerPubkey: SELLER }
		const state = deriveCheckoutProductSelectionState([variableProduct], [snapshot({ data: variableContainerSelection })])

		expect(state).toBe('invalid')
		expect(canSubmitCheckoutShipping(state, true)).toBe(false)
		expect(canContinueCheckoutPayment(state, true)).toBe(false)
	})

	test('allows both transitions only after the exact child and parent resolve', () => {
		const state = deriveCheckoutProductSelectionState([product], [snapshot({})])

		expect(state).toBe('resolved')
		expect(canSubmitCheckoutShipping(state, true)).toBe(true)
		expect(canContinueCheckoutPayment(state, true)).toBe(true)
	})
})
