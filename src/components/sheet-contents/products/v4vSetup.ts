import type { V4VConfigurationState } from '@/queries/v4v'

export function shouldRequireV4VSetup({
	editingProductId,
	isLoadingV4V,
	v4vConfigurationState,
}: {
	editingProductId?: string | null
	isLoadingV4V: boolean
	v4vConfigurationState: V4VConfigurationState
}): boolean {
	if (editingProductId) return false
	if (isLoadingV4V) return false

	return v4vConfigurationState === 'never-configured'
}
