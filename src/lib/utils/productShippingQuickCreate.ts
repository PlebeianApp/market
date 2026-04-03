import type { ProductShippingForm } from '@/lib/stores/product'

export const attachShippingOptionByRef = (
	shippings: ProductShippingForm[],
	shippingRef: string,
): ProductShippingForm[] => {
	if (!shippingRef.trim()) return shippings

	if (shippings.some((shipping) => shipping.shippingRef === shippingRef)) {
		return shippings
	}

	return [
		...shippings,
		{
			shippingRef,
			extraCost: '',
		},
	]
}
