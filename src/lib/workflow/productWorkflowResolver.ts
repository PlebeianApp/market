import type { ProductFormTab } from '@/lib/stores/product'

export type ProductWorkflowMode = 'create' | 'edit'

export type ShippingSetupState = 'unknown' | 'loading' | 'empty' | 'ready'

export type V4VSetupState = 'unknown' | 'loading' | 'never-configured' | 'configured-zero' | 'configured-nonzero'

export type ProductWorkflowResolverInput = {
	mode: ProductWorkflowMode
	editingProductId?: string | null
	shippingState: ShippingSetupState
	v4vConfigurationState: V4VSetupState
	requestedTab?: ProductFormTab | null
}

export type ProductWorkflowResolution = {
	mode: ProductWorkflowMode
	isBootstrapReady: boolean
	initialTab: ProductFormTab
	shouldStartAtShipping: boolean
	requiresV4VSetup: boolean
}

export function resolveProductWorkflow(input: ProductWorkflowResolverInput): ProductWorkflowResolution {
	const mode = input.mode === 'edit' || input.editingProductId ? 'edit' : 'create'
	const requestedTab = input.requestedTab ?? null

	if (mode === 'edit') {
		const initialTab: ProductFormTab = requestedTab ?? 'name'

		return {
			mode,
			isBootstrapReady: true,
			initialTab,
			shouldStartAtShipping: false,
			requiresV4VSetup: false,
		}
	}

	return {
		mode,
		isBootstrapReady: input.shippingState !== 'loading',
		initialTab: requestedTab ?? 'name',
		shouldStartAtShipping: false,
		requiresV4VSetup: input.v4vConfigurationState === 'never-configured',
	}
}
