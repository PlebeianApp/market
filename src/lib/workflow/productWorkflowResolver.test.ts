import { describe, expect, test } from 'bun:test'
import { resolveProductWorkflow } from '@/lib/workflow/productWorkflowResolver'

describe('resolveProductWorkflow', () => {
	test('keeps edit sessions independent from create-only setup rules', () => {
		const resolution = resolveProductWorkflow({
			mode: 'edit',
			editingProductId: 'product-123',
			v4vConfigurationState: 'never-configured',
		})

		expect(resolution).toEqual({
			mode: 'edit',
			initialTab: 'name',
			requiresV4VSetup: false,
		})
	})

	test('starts new sessions on name', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			v4vConfigurationState: 'configured-zero',
		})

		expect(resolution.initialTab).toBe('name')
		expect(resolution.requiresV4VSetup).toBe(false)
	})

	test('keeps create initial tab deterministic when V4V setup state is unknown', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			v4vConfigurationState: 'unknown',
		})

		expect(resolution.initialTab).toBe('name')
	})

	test('honors requestedTab in create flow', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			v4vConfigurationState: 'configured-zero',
			requestedTab: 'images',
		})

		expect(resolution.initialTab).toBe('images')
		expect(resolution.requiresV4VSetup).toBe(false)
	})

	test('requires V4V setup for create flow when V4V was never configured', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			v4vConfigurationState: 'never-configured',
		})

		expect(resolution.initialTab).toBe('name')
		expect(resolution.requiresV4VSetup).toBe(true)
	})

	test('honors requestedTab for create flow when V4V is configured', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			v4vConfigurationState: 'configured-zero',
			requestedTab: 'images',
		})

		expect(resolution.initialTab).toBe('images')
	})

	test('may honor requestedTab more freely in edit flow', () => {
		const resolution = resolveProductWorkflow({
			mode: 'edit',
			editingProductId: 'product-123',
			v4vConfigurationState: 'never-configured',
			requestedTab: 'images',
		})

		expect(resolution.initialTab).toBe('images')
		expect(resolution.requiresV4VSetup).toBe(false)
	})
})
