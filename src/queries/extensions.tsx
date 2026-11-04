import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
	findExtensionAction,
	invokeExtensionAction,
	parsePublicExtensionDescriptors,
	ExtensionActionError,
	fetchExtensionCatalog,
	type ExtensionCatalogEntry,
	type PublicExtensionDescriptor,
} from '@sdk/core/extensions'
import {
	DescribeImageOutputSchema,
	PRODUCT_IMAGE_DESCRIBE_CAPABILITY,
	type DescribeImageInput,
	type DescribeImageOutput,
} from '@sdk/extensions/product-image-describer'
import { sign } from '@/lib/nostr/io'
import type { PublicAppConfig } from '@/lib/instance-config'
import { useConfigQuery } from './config'
import { extensionKeys } from './queryKeyFactory'

/** `/api/config` is untrusted: descriptors are parsed, and malformed entries are dropped. */
export function selectExtensionDescriptors(config: Pick<PublicAppConfig, 'extensions'> | undefined): PublicExtensionDescriptor[] {
	const parsed = parsePublicExtensionDescriptors(config?.extensions)
	return parsed.ok ? parsed.value : []
}

export function useExtensionDescriptors() {
	const { data: config, isLoading, error } = useConfigQuery()
	const descriptors = useMemo(() => selectExtensionDescriptors(config), [config])
	return { descriptors, isLoading, error }
}

/** UI renders affordances by capability; the extension id is resolved from descriptors, never hard-coded. */
export function useExtensionCapability(capability: string) {
	const { descriptors, isLoading } = useExtensionDescriptors()
	const target = useMemo(() => findExtensionAction(descriptors, capability), [descriptors, capability])
	return { target, isLoading }
}

/** User-facing copy for action failures. Never includes provider detail. */
export function extensionErrorMessage(error: ExtensionActionError): string {
	switch (error.reason) {
		case 'unauthorized':
			return 'Could not sign the request. Make sure you are logged in with a signer that is unlocked.'
		case 'forbidden':
			return 'Your account is not allowed to use this extension action.'
		case 'rate_limited':
			return 'Too many requests. Please wait a bit and try again.'
		case 'invalid_input':
			return 'Some fields are invalid. Check the image URL and field lengths.'
		case 'not_found':
			return 'This extension is not available on this marketplace any more.'
		case 'extension_unavailable':
		case 'extension_misconfigured':
			return 'The extension is temporarily unavailable.'
		case 'upstream_timeout':
			return 'The extension took too long to respond. Please try again.'
		case 'network_error':
			return 'Could not reach the marketplace server.'
		default:
			return 'The extension could not complete the request.'
	}
}

/** Calls `product.image.describe` with a NIP-98 header signed by the active user's signer. */
export function useDescribeProductImage() {
	const { target } = useExtensionCapability(PRODUCT_IMAGE_DESCRIBE_CAPABILITY)

	const mutation = useMutation<DescribeImageOutput, ExtensionActionError, DescribeImageInput>({
		mutationFn: async (input) => {
			if (!target) throw new ExtensionActionError('not_found')
			const result = await invokeExtensionAction(
				target.extensionId,
				target.action.name,
				input,
				{ sign },
				{ output: DescribeImageOutputSchema },
			)
			if (!result.ok) throw result.error
			return result.value
		},
	})

	return { available: Boolean(target), target, ...mutation }
}

/**
 * Admin-only store catalog. Each fetch signs a NIP-98 header, so it runs only when `enabled` (the store is
 * open) and is not retried automatically, to avoid repeated signer prompts.
 */
export function useExtensionCatalog(pubkey: string | undefined, enabled: boolean) {
	return useQuery<ExtensionCatalogEntry[], ExtensionActionError>({
		queryKey: extensionKeys.catalog(pubkey ?? ''),
		enabled: enabled && Boolean(pubkey),
		staleTime: 60_000,
		retry: false,
		refetchOnWindowFocus: false,
		queryFn: async ({ signal }) => {
			const result = await fetchExtensionCatalog({ sign }, { signal })
			if (!result.ok) throw result.error
			return result.value
		},
	})
}
