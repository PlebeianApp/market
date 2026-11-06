import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
	findExtensionAction,
	invokeExtensionAction,
	parsePublicExtensionDescriptors,
	addSideloadedServer,
	createRemoteBinding,
	deleteRemoteBinding,
	RemoteActionOutputSchema,
	updateRemoteBinding,
	type RemoteActionOutput,
	type RemoteBindingRequest,
	ExtensionActionError,
	fetchExtensionCatalog,
	removeSideloadedServer,
	type ExtensionCatalog,
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
import { configKeys, extensionKeys } from './queryKeyFactory'

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
	return useQuery<ExtensionCatalog, ExtensionActionError>({
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

/**
 * Admin sideload add/remove. On success the catalog is refetched (the server has already invalidated its cache).
 * Validation errors carry our own server's message, so it is shown as-is.
 */
export function useSideloadMutations(pubkey: string | undefined) {
	const queryClient = useQueryClient()
	const refresh = () => queryClient.invalidateQueries({ queryKey: extensionKeys.catalog(pubkey ?? '') })
	const run = async (call: () => ReturnType<typeof addSideloadedServer>) => {
		const result = await call()
		if (!result.ok) throw result.error
		return result.value
	}

	const add = useMutation<{ pubkey: string }, ExtensionActionError, string>({
		mutationFn: (server) => run(() => addSideloadedServer({ sign }, server)),
		onSuccess: refresh,
	})
	const remove = useMutation<{ pubkey: string }, ExtensionActionError, string>({
		mutationFn: (server) => run(() => removeSideloadedServer({ sign }, server)),
		onSuccess: refresh,
	})

	const error = add.error ?? remove.error
	return {
		onAdd: (server: string) => {
			remove.reset()
			add.mutate(server)
		},
		onRemove: (server: string) => {
			add.reset()
			remove.mutate(server)
		},
		pending: add.isPending || remove.isPending,
		errorMessage: error ? (error.reason === 'invalid_input' ? error.message : extensionErrorMessage(error)) : undefined,
	}
}

/** Admin bind/update/remove for remote tools. On success the store and public config are refetched. */
export function useBindingMutations(pubkey: string | undefined) {
	const queryClient = useQueryClient()
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: extensionKeys.catalog(pubkey ?? '') })
		void queryClient.invalidateQueries({ queryKey: configKeys.all })
	}
	const unwrap = async <Value,>(promise: Promise<{ ok: true; value: Value } | { ok: false; error: ExtensionActionError }>) => {
		const result = await promise
		if (!result.ok) throw result.error
		return result.value
	}

	const bind = useMutation<unknown, ExtensionActionError, RemoteBindingRequest>({
		mutationFn: (request) => unwrap(createRemoteBinding({ sign }, request)),
		onSuccess: refresh,
	})
	const update = useMutation<
		unknown,
		ExtensionActionError,
		{ serverPubkey: string; actionName: string; change: { enabled?: boolean; approveCurrentDefinition?: true } }
	>({
		mutationFn: ({ serverPubkey, actionName, change }) => unwrap(updateRemoteBinding({ sign }, serverPubkey, actionName, change)),
		onSuccess: refresh,
	})
	const remove = useMutation<unknown, ExtensionActionError, { serverPubkey: string; actionName: string }>({
		mutationFn: ({ serverPubkey, actionName }) => unwrap(deleteRemoteBinding({ sign }, serverPubkey, actionName)),
		onSuccess: refresh,
	})

	const reset = () => [bind, update, remove].forEach((mutation) => mutation.reset())
	const error = bind.error ?? update.error ?? remove.error
	return {
		onBind: (request: RemoteBindingRequest) => {
			reset()
			bind.mutate(request)
		},
		onUpdate: (serverPubkey: string, actionName: string, change: { enabled?: boolean; approveCurrentDefinition?: true }) => {
			reset()
			update.mutate({ serverPubkey, actionName, change })
		},
		onRemove: (serverPubkey: string, actionName: string) => {
			reset()
			remove.mutate({ serverPubkey, actionName })
		},
		pending: bind.isPending || update.isPending || remove.isPending,
		errorMessage: error ? (error.reason === 'invalid_input' ? error.message : extensionErrorMessage(error)) : undefined,
	}
}

/** Calls any action and returns the remote output envelope (text plus optional data). */
export function useRemoteActionInvoke() {
	return useMutation<RemoteActionOutput, ExtensionActionError, { extensionId: string; actionName: string; input: Record<string, unknown> }>(
		{
			mutationFn: async ({ extensionId, actionName, input }) => {
				const result = await invokeExtensionAction(extensionId, actionName, input, { sign }, { output: RemoteActionOutputSchema })
				if (!result.ok) throw result.error
				return result.value
			},
		},
	)
}
