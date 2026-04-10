import { describe, expect, test } from 'bun:test'
import { shouldRequireV4VSetup } from './v4vSetup'

describe('shouldRequireV4VSetup', () => {
	test('requires V4V setup for create flow when merchant never configured V4V', () => {
		expect(
			shouldRequireV4VSetup({
				editingProductId: null,
				isLoadingV4V: false,
				v4vConfigurationState: 'never-configured',
			}),
		).toBe(true)
	})

	test('does not require V4V setup for create flow when merchant configured 0%', () => {
		expect(
			shouldRequireV4VSetup({
				editingProductId: null,
				isLoadingV4V: false,
				v4vConfigurationState: 'configured-zero',
			}),
		).toBe(false)
	})

	test('does not require V4V setup for edit flow when merchant never configured V4V', () => {
		expect(
			shouldRequireV4VSetup({
				editingProductId: 'existing-product',
				isLoadingV4V: false,
				v4vConfigurationState: 'never-configured',
			}),
		).toBe(false)
	})

	test('does not require V4V setup for edit flow when merchant configured 0%', () => {
		expect(
			shouldRequireV4VSetup({
				editingProductId: 'existing-product',
				isLoadingV4V: false,
				v4vConfigurationState: 'configured-zero',
			}),
		).toBe(false)
	})
})
