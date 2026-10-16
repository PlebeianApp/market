import {
	summarizeCheckoutDelivery,
	validateCheckoutField,
	type CheckoutDeliveryRequirements,
	type CheckoutFieldRules,
	type CheckoutFormField,
} from '@sdk/commerce/checkout'
import { cartStore } from '@/lib/stores/cart'
import { useStore } from '@tanstack/react-store'
import { useField } from '@tanstack/react-form'
import { getShippingEvent, getShippingPickupAddressString, getShippingService, getShippingTitle } from '@/queries/shipping'
import { useEffect, useState } from 'react'
import { isValidCountry } from '@ui/components/CountryCombobox'
import { ShippingAddressFormView, type CheckoutFieldBinding } from '@ui/components/checkout/ShippingAddressFormView'

export type { CheckoutFormData } from '@sdk/commerce/checkout'

interface ShippingAddressFormProps {
	form: any
	hasAllShippingMethods: boolean
	deliveryRequirements: CheckoutDeliveryRequirements
	isDeliveryRequirementsLoading: boolean
	deliveryRequirementsError: string | null
}

function useCheckoutField(form: any, name: CheckoutFormField, rules: CheckoutFieldRules | null): CheckoutFieldBinding {
	// The checkout route owns the TanStack form; fields are typed loosely to avoid repeating its generics here.
	const field = useField({
		form,
		name,
		validators: rules ? { onChange: ({ value }: { value: string }) => validateCheckoutField(name, value, rules) } : undefined,
	} as any) as any
	const meta = field.state.meta
	return {
		value: field.state.value as string,
		error: meta.isTouched && meta.errors.length > 0 ? String(meta.errors[0]) : undefined,
		onChange: (value) => field.handleChange(value as never),
		onBlur: field.handleBlur,
	}
}

async function fetchPickupAddresses(shippingRefs: string[]): Promise<Array<{ title: string; address: string }>> {
	const serviceData = await Promise.all(
		shippingRefs.map(async (shippingRef) => {
			try {
				const shippingEvent = await getShippingEvent(shippingRef)
				if (!shippingEvent || getShippingService(shippingEvent)?.[1] !== 'pickup') return null
				return { title: getShippingTitle(shippingEvent), address: getShippingPickupAddressString(shippingEvent) || 'Address not specified' }
			} catch (error) {
				console.error('Error checking shipping service:', error)
				return null
			}
		}),
	)

	const unique: Array<{ title: string; address: string }> = []
	for (const data of serviceData) {
		if (data && !unique.some((item) => item.title === data.title && item.address === data.address)) unique.push(data)
	}
	return unique
}

export function ShippingAddressForm({
	form,
	hasAllShippingMethods,
	deliveryRequirements,
	isDeliveryRequirementsLoading,
	deliveryRequirementsError,
}: ShippingAddressFormProps) {
	const { cart } = useStore(cartStore)
	const [pickupAddresses, setPickupAddresses] = useState<Array<{ title: string; address: string }>>([])
	const isSubmitting = useStore(form.store, (state: any) => state.isSubmitting as boolean)

	const { needsPhysicalAddress, needsDigitalDeliveryContact } = summarizeCheckoutDelivery(deliveryRequirements)
	const rules: CheckoutFieldRules = { needsPhysicalAddress, needsDigitalDeliveryContact, isValidCountry }

	const fields: Record<CheckoutFormField, CheckoutFieldBinding> = {
		name: useCheckoutField(form, 'name', rules),
		email: useCheckoutField(form, 'email', rules),
		phone: useCheckoutField(form, 'phone', null),
		firstLineOfAddress: useCheckoutField(form, 'firstLineOfAddress', rules),
		zipPostcode: useCheckoutField(form, 'zipPostcode', rules),
		city: useCheckoutField(form, 'city', rules),
		country: useCheckoutField(form, 'country', rules),
		additionalInformation: useCheckoutField(form, 'additionalInformation', null),
	}

	useEffect(() => {
		const shippingRefs = Object.values(cart.products)
			.map((product) => product.shippingMethodId)
			.filter((ref): ref is string => !!ref)
		if (shippingRefs.length === 0 || !deliveryRequirements.isResolved || !deliveryRequirements.hasPickupDelivery) {
			setPickupAddresses([])
			return
		}
		void fetchPickupAddresses(shippingRefs).then(setPickupAddresses)
	}, [cart.products, deliveryRequirements.hasPickupDelivery, deliveryRequirements.isResolved])

	return (
		<ShippingAddressFormView
			fields={fields}
			hasAllShippingMethods={hasAllShippingMethods}
			deliveryRequirements={deliveryRequirements}
			isDeliveryRequirementsLoading={isDeliveryRequirementsLoading}
			deliveryRequirementsError={deliveryRequirementsError}
			pickupAddresses={pickupAddresses}
			isSubmitting={isSubmitting}
			onSubmit={() => form.handleSubmit()}
		/>
	)
}
