export type SellerProductFormTab = 'name' | 'detail' | 'spec' | 'category' | 'images' | 'shipping'
export type ProductWorkflowMode = 'create' | 'edit'
export type V4VSetupState = 'unknown' | 'loading' | 'never-configured' | 'configured-zero' | 'configured-nonzero'

export type ProductWorkflowResolverInput = {
	mode: ProductWorkflowMode
	editingProductId?: string | null
	v4vConfigurationState: V4VSetupState
	requestedTab?: SellerProductFormTab | null
}

export type ProductWorkflowResolution = {
	mode: ProductWorkflowMode
	initialTab: SellerProductFormTab
	requiresV4VSetup: boolean
}

/** Resolve create/edit form entry and create-only V4V setup requirements. */
export function resolveProductWorkflow(input: ProductWorkflowResolverInput): ProductWorkflowResolution {
	const mode = input.mode === 'edit' || input.editingProductId ? 'edit' : 'create'
	return {
		mode,
		initialTab: input.requestedTab ?? 'name',
		requiresV4VSetup: mode === 'create' && input.v4vConfigurationState === 'never-configured',
	}
}
