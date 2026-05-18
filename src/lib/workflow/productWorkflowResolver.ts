import type { ProductFormTab } from '@/lib/stores/product'

export type ProductWorkflowMode = 'create' | 'edit'

export type V4VSetupState = 'unknown' | 'loading' | 'never-configured' | 'configured-zero' | 'configured-nonzero'

export type ProductWorkflowResolverInput = {
	mode: ProductWorkflowMode
	editingProductId?: string | null
	v4vConfigurationState: V4VSetupState
	requestedTab?: ProductFormTab | null
}

export type ProductWorkflowResolution = {
	mode: ProductWorkflowMode
	initialTab: ProductFormTab
	requiresV4VSetup: boolean
}

export function resolveProductWorkflow(input: ProductWorkflowResolverInput): ProductWorkflowResolution {
	const mode = input.mode === 'edit' || input.editingProductId ? 'edit' : 'create'

	if (mode === 'edit') {
		return {
			mode,
			initialTab: input.requestedTab ?? 'name',
			requiresV4VSetup: false,
		}
	}

	return {
		mode,
		initialTab: input.requestedTab ?? 'name',
		requiresV4VSetup: input.v4vConfigurationState === 'never-configured',
	}
}
