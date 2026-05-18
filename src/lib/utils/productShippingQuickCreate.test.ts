import { describe, expect, test } from 'bun:test'
import { attachShippingOptionByRef } from '@/lib/utils/productShippingQuickCreate'

describe('product shipping quick-create attachment', () => {
	test('attaches the created shipping option by canonical shipping ref', () => {
		expect(attachShippingOptionByRef([], '30406:merchant:new-option')).toEqual([
			{
				shippingRef: '30406:merchant:new-option',
				extraCost: '',
			},
		])
	})

	test('dedupe keys off canonical shipping ref, not title', () => {
		const existing = [
			{
				shippingRef: '30406:merchant:existing-option',
				extraCost: '',
			},
		]

		expect(attachShippingOptionByRef(existing, '30406:merchant:existing-option')).toEqual(existing)
		expect(attachShippingOptionByRef(existing, '30406:merchant:new-option')).toEqual([
			...existing,
			{
				shippingRef: '30406:merchant:new-option',
				extraCost: '',
			},
		])
	})

	test('attachment correctness does not depend on fetched catalog contents or title collisions', () => {
		const existing = [
			{
				shippingRef: '30406:merchant:older-standard',
				extraCost: '',
			},
		]

		const attached = attachShippingOptionByRef(existing, '30406:merchant:new-standard')

		expect(attached).toEqual([
			existing[0],
			{
				shippingRef: '30406:merchant:new-standard',
				extraCost: '',
			},
		])
	})
})
