import { describe, expect, test } from 'bun:test'
import { resolveProductWorkflow } from '@/lib/workflow/productWorkflowResolver'

describe('resolveProductWorkflow', () => {
	test('keeps edit sessions independent from create-only setup rules', () => {
		const resolution = resolveProductWorkflow({
			mode: 'edit',
			editingProductId: 'product-123',
			shippingState: 'empty',
			v4vConfigurationState: 'never-configured',
		})

		expect(resolution).toEqual({
			mode: 'edit',
			isBootstrapReady: true,
			initialTab: 'name',
			shouldStartAtShipping: false,
			requiresV4VSetup: false,
		})
	})

	test('starts new sessions on name when setup truth says shipping is empty', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'empty',
			v4vConfigurationState: 'configured-zero',
		})

		expect(resolution.initialTab).toBe('name')
		expect(resolution.shouldStartAtShipping).toBe(false)
		expect(resolution.requiresV4VSetup).toBe(false)
	})

	test('waits for loading shipping truth before choosing an initial create step', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'loading',
			v4vConfigurationState: 'loading',
		})

		expect(resolution.isBootstrapReady).toBe(false)
		expect(resolution.initialTab).toBe('name')
	})

	test('falls back to name when setup truth is unknown but keeps the result deterministic', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'unknown',
			v4vConfigurationState: 'unknown',
		})

		expect(resolution.isBootstrapReady).toBe(true)
		expect(resolution.initialTab).toBe('name')
	})

	test('honors requestedTab in create flow when setup truth says shipping is empty', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'empty',
			v4vConfigurationState: 'configured-zero',
			requestedTab: 'images',
		})

		expect(resolution.isBootstrapReady).toBe(true)
		expect(resolution.initialTab).toBe('images')
		expect(resolution.shouldStartAtShipping).toBe(false)
		expect(resolution.requiresV4VSetup).toBe(false)
	})

	test('requires V4V setup for create flow when V4V was never configured', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'empty',
			v4vConfigurationState: 'never-configured',
		})

		expect(resolution.isBootstrapReady).toBe(true)
		expect(resolution.initialTab).toBe('name')
		expect(resolution.shouldStartAtShipping).toBe(false)
		expect(resolution.requiresV4VSetup).toBe(true)
	})

	test('honors requestedTab for create flow when bootstrap policy is ready', () => {
		const resolution = resolveProductWorkflow({
			mode: 'create',
			shippingState: 'ready',
			v4vConfigurationState: 'configured-zero',
			requestedTab: 'images',
		})

		expect(resolution.isBootstrapReady).toBe(true)
		expect(resolution.initialTab).toBe('images')
		expect(resolution.shouldStartAtShipping).toBe(false)
	})

	test('may honor requestedTab more freely in edit flow', () => {
		const resolution = resolveProductWorkflow({
			mode: 'edit',
			editingProductId: 'product-123',
			shippingState: 'empty',
			v4vConfigurationState: 'never-configured',
			requestedTab: 'images',
		})

		expect(resolution.isBootstrapReady).toBe(true)
		expect(resolution.initialTab).toBe('images')
		expect(resolution.shouldStartAtShipping).toBe(false)
		expect(resolution.requiresV4VSetup).toBe(false)
	})
})
