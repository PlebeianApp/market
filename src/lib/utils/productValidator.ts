import type { ProductFormState } from '@/lib/stores/product'

export interface ProductValidationResult {
	isValid: boolean
	issues: string[]
}

/**
 * Validate product form fields and return any issues.
 * Pure function — no React dependencies.
 */
export function validateProduct(state: Pick<ProductFormState, 'name' | 'description' | 'images' | 'shippings'>): ProductValidationResult {
	const issues: string[] = []

	if (!state.name.trim()) {
		issues.push('Product name is required')
	}
	if (!state.description.trim()) {
		issues.push('Description is required')
	}
	if (state.images.length === 0) {
		issues.push('At least one image is required')
	}
	if (!state.shippings.some((ship) => ship.shipping && ship.shipping.id)) {
		issues.push('At least one shipping option is required')
	}

	return {
		isValid: issues.length === 0,
		issues,
	}
}

/**
 * Check individual field validity.
 */
export function hasValidName(name: string): boolean {
	return name.trim().length > 0
}

export function hasValidDescription(description: string): boolean {
	return description.trim().length > 0
}

export function hasValidImages(images: unknown[]): boolean {
	return images.length > 0
}

export function hasValidShipping(shippings: Array<{ shipping?: { id?: string } | null }>): boolean {
	return shippings.some((ship) => ship.shipping && ship.shipping.id)
}
