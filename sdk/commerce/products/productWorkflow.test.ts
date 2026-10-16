import { describe, expect, test } from 'bun:test'
import { resolveProductWorkflow, type SellerProductFormTab } from './productWorkflow'

describe('resolveProductWorkflow', () => {
	test('create flow requires setup only when V4V is never configured', () => {
		expect(resolveProductWorkflow({ mode: 'create', v4vConfigurationState: 'never-configured' })).toEqual({
			mode: 'create',
			initialTab: 'name',
			requiresV4VSetup: true,
		})
		expect(resolveProductWorkflow({ mode: 'create', v4vConfigurationState: 'configured-zero' }).requiresV4VSetup).toBe(false)
	})

	test('edit flow never requires create-only V4V setup and honors a requested tab', () => {
		const requestedTab: SellerProductFormTab = 'images'
		expect(
			resolveProductWorkflow({
				mode: 'edit',
				editingProductId: 'product-1',
				v4vConfigurationState: 'never-configured',
				requestedTab,
			}),
		).toEqual({ mode: 'edit', initialTab: 'images', requiresV4VSetup: false })
	})
})
