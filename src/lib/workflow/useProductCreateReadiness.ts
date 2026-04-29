import type { RichShippingInfo } from '@/lib/stores/cart'
import type { ShippingSetupState, V4VSetupState } from '@/lib/workflow/productWorkflowResolver'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useV4VConfiguration } from '@/queries/v4v'
import { useMemo } from 'react'

export type QuickShippingTemplateService = 'digital' | 'standard' | 'pickup'

const QUICK_SHIPPING_TEMPLATE_SERVICES: QuickShippingTemplateService[] = ['digital', 'standard', 'pickup']

export type ProductCreateReadiness = {
	shippingState: ShippingSetupState
	v4vConfigurationState: V4VSetupState
	hasResolvedSellerReadiness: boolean
	isBootstrapReady: boolean
	savedShippingOptions: RichShippingInfo[]
	savedShippingRefs: string[]
	remainingQuickTemplateServices: QuickShippingTemplateService[]
}

export function normalizeQuickShippingTemplateService(service: string | null | undefined): QuickShippingTemplateService | null {
	const normalizedService = service?.trim().toLowerCase()

	if (normalizedService === 'digital' || normalizedService === 'standard' || normalizedService === 'pickup') {
		return normalizedService
	}

	return null
}

export function getRemainingQuickTemplateServices(savedServices: Array<string | null | undefined>): QuickShippingTemplateService[] {
	const savedQuickTemplateServices = new Set(
		savedServices
			.map((service) => normalizeQuickShippingTemplateService(service))
			.filter((service): service is QuickShippingTemplateService => !!service),
	)

	return QUICK_SHIPPING_TEMPLATE_SERVICES.filter((service) => !savedQuickTemplateServices.has(service))
}

export function useProductCreateReadiness(userPubkey: string): ProductCreateReadiness {
	const shippingQuery = useShippingOptionsByPubkey(userPubkey)
	const v4vQuery = useV4VConfiguration(userPubkey)

	const savedShippingOptions = useMemo<RichShippingInfo[]>(() => {
		if (!shippingQuery.data || !userPubkey) return []

		return shippingQuery.data
			.filter((event) => {
				const dTag = event.tags?.find((tag: string[]) => tag[0] === 'd')?.[1]
				return dTag ? !isShippingDeleted(dTag, event.created_at) : true
			})
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return null

				return {
					id: createShippingReference(event.pubkey, info.id),
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					countries: info.countries || [],
					service: info.service || '',
					carrier: info.carrier || '',
				}
			})
			.filter((option): option is RichShippingInfo => option !== null)
	}, [shippingQuery.data, userPubkey])

	const savedShippingRefs = useMemo(() => savedShippingOptions.map((option) => option.id), [savedShippingOptions])

	const shippingState = useMemo<ShippingSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (!shippingQuery.isFetched) return shippingQuery.isLoading ? 'loading' : 'unknown'

		return savedShippingRefs.length === 0 ? 'empty' : 'ready'
	}, [userPubkey, shippingQuery.isFetched, shippingQuery.isLoading, savedShippingRefs.length])

	const v4vConfigurationState = useMemo<V4VSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (v4vQuery.isLoading) return 'loading'

		return v4vQuery.data?.state ?? 'unknown'
	}, [userPubkey, v4vQuery.data?.state, v4vQuery.isLoading])

	const remainingQuickTemplateServices = useMemo(
		() => getRemainingQuickTemplateServices(savedShippingOptions.map((option) => option.service)),
		[savedShippingOptions],
	)

	return {
		shippingState,
		v4vConfigurationState,
		hasResolvedSellerReadiness: shippingState !== 'loading' && v4vConfigurationState !== 'loading',
		isBootstrapReady: shippingState !== 'loading',
		savedShippingOptions,
		savedShippingRefs,
		remainingQuickTemplateServices,
	}
}
