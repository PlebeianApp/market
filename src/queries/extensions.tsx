import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
	findExtensionAction,
	invokeExtensionAction,
	parsePublicExtensionDescriptors,
	addExtensionServer,
	createRemoteBinding,
	createRemoteBindings,
	deleteRemoteBinding,
	RemoteActionOutputSchema,
	updateRemoteBinding,
	type RemoteActionOutput,
	type RemoteBindingRequest,
	ExtensionActionError,
	fetchExtensionCatalog,
	removeExtensionServer,
	setBuiltinExtensionEnabled,
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
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { PRODUCT_LISTING_DRAFT_CAPABILITY, parseProductListingDraft, type ProductListingDraft } from '@sdk/commerce/products'
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
export function useExtensionCapability(capability: string, preferredActionName?: string) {
	const { descriptors, isLoading } = useExtensionDescriptors()
	const target = useMemo(
		() =>
			(preferredActionName ? findExtensionAction(descriptors, capability, { actionName: preferredActionName }) : undefined) ??
			findExtensionAction(descriptors, capability),
		[descriptors, capability, preferredActionName],
	)
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
	const { target } = useExtensionCapability(PRODUCT_IMAGE_DESCRIBE_CAPABILITY, 'describe-image')

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
 * Admin add/remove of extension servers (adding is required before binding). On success the catalog is refetched (the server has already invalidated its cache).
 * Validation errors carry our own server's message, so it is shown as-is.
 */
export function useServerMutations(pubkey: string | undefined) {
	const queryClient = useQueryClient()
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: extensionKeys.catalog(pubkey ?? '') })
		void queryClient.invalidateQueries({ queryKey: configKeys.all })
	}
	const run = async (call: () => ReturnType<typeof addExtensionServer>) => {
		const result = await call()
		if (!result.ok) throw result.error
		return result.value
	}

	const add = useMutation<{ pubkey: string }, ExtensionActionError, { server: string; bindings?: RemoteBindingRequest[] }>({
		mutationFn: ({ server, bindings }) => run(() => addExtensionServer({ sign }, server, {}, bindings)),
		onSuccess: refresh,
	})
	const remove = useMutation<{ pubkey: string }, ExtensionActionError, string>({
		mutationFn: (server) => run(() => removeExtensionServer({ sign }, server)),
		onSuccess: refresh,
	})

	const messageFor = (error: ExtensionActionError) => (error.reason === 'invalid_input' ? error.message : extensionErrorMessage(error))
	const error = add.error ?? remove.error
	return {
		/** Adds a server, optionally accepting bindings in the same request; resolves to whether it succeeded. */
		onAdd: async (server: string, bindings?: RemoteBindingRequest[]) => {
			remove.reset()
			add.reset()
			try {
				await add.mutateAsync({ server, bindings })
				return true
			} catch {
				return false
			}
		},
		onRemove: (server: string) => {
			add.reset()
			remove.mutate(server)
		},
		/** The last add failure, keyed by the server it was for, so the add dialog can show it. */
		addError: add.error && add.variables ? { serverPubkey: add.variables.server, message: messageFor(add.error) } : undefined,
		pending: add.isPending || remove.isPending,
		errorMessage: error ? messageFor(error) : undefined,
	}
}

/** Admin enable/disable of built-in extensions. On success the store and public config are refetched. */
export function useBuiltinMutations(pubkey: string | undefined) {
	const queryClient = useQueryClient()
	const toggle = useMutation<unknown, ExtensionActionError, { id: string; enabled: boolean }>({
		mutationFn: async ({ id, enabled }) => {
			const result = await setBuiltinExtensionEnabled({ sign }, id, enabled)
			if (!result.ok) throw result.error
			return result.value
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: extensionKeys.catalog(pubkey ?? '') })
			void queryClient.invalidateQueries({ queryKey: configKeys.all })
		},
	})
	return {
		onToggle: (id: string, enabled: boolean) => toggle.mutate({ id, enabled }),
		pending: toggle.isPending,
		errorMessage: toggle.error
			? toggle.error.reason === 'invalid_input'
				? toggle.error.message
				: extensionErrorMessage(toggle.error)
			: undefined,
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
	const bindMany = useMutation<unknown, ExtensionActionError, RemoteBindingRequest[]>({
		mutationFn: (requests) => unwrap(createRemoteBindings({ sign }, requests)),
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

	const reset = () => [bind, bindMany, update, remove].forEach((mutation) => mutation.reset())
	const messageFor = (error: ExtensionActionError) => (error.reason === 'invalid_input' ? error.message : extensionErrorMessage(error))
	const error = update.error ?? remove.error
	return {
		/** Resolves to whether the binding was created, so the form can close itself on success. */
		onBind: async (request: RemoteBindingRequest) => {
			reset()
			try {
				await bind.mutateAsync(request)
				return true
			} catch {
				return false
			}
		},
		/** Accepts several bindings in one signed request; resolves to whether all were created. */
		onBindMany: async (requests: RemoteBindingRequest[]) => {
			reset()
			try {
				await bindMany.mutateAsync(requests)
				return true
			} catch {
				return false
			}
		},
		bindManyError:
			bindMany.error && bindMany.variables?.[0]
				? { serverPubkey: bindMany.variables[0].serverPubkey, message: messageFor(bindMany.error) }
				: undefined,
		/** Bind errors are shown inside the form of the tool they belong to. */
		bindError:
			bind.error && bind.variables
				? { serverPubkey: bind.variables.serverPubkey, toolName: bind.variables.toolName, message: messageFor(bind.error) }
				: undefined,
		onUpdate: (serverPubkey: string, actionName: string, change: { enabled?: boolean; approveCurrentDefinition?: true }) => {
			reset()
			update.mutate({ serverPubkey, actionName, change })
		},
		onRemove: (serverPubkey: string, actionName: string) => {
			reset()
			remove.mutate({ serverPubkey, actionName })
		},
		pending: bind.isPending || bindMany.isPending || update.isPending || remove.isPending,
		errorMessage: error ? messageFor(error) : undefined,
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

/**
 * Drafts a product listing from an image through whichever extension offers `product.listing.draft` (e.g. a bound
 * ContextVM tool). The reply is untrusted: it is parsed, capped, and shown for review; nothing is published here.
 */
/** Drafts a listing from a photo. With `extensionId`, only that extension is used (e.g. on its own page). */
export function useProductListingDraft(extensionId?: string) {
	const { descriptors } = useExtensionDescriptors()
	const scoped = useMemo(
		() => (extensionId ? descriptors.filter((descriptor) => descriptor.id === extensionId) : undefined),
		[descriptors, extensionId],
	)
	const anyTarget = useExtensionCapability(PRODUCT_LISTING_DRAFT_CAPABILITY, 'draft-listing').target
	const target = scoped
		? (findExtensionAction(scoped, PRODUCT_LISTING_DRAFT_CAPABILITY, { actionName: 'draft-listing' }) ??
			findExtensionAction(scoped, PRODUCT_LISTING_DRAFT_CAPABILITY))
		: anyTarget
	const mutation = useMutation<ProductListingDraft, ExtensionActionError, { imageUrl: string; notes?: string }>({
		mutationFn: async (input) => {
			if (!target) throw new ExtensionActionError('not_found')
			const result = await invokeExtensionAction(target.extensionId, target.action.name, input, { sign })
			if (!result.ok) throw result.error
			const draft = parseProductListingDraft(listingDraftPayload(result.value), PRODUCT_CATEGORIES)
			if (!draft.ok) throw new ExtensionActionError('invalid_output', draft.error.message)
			return draft.value
		},
	})
	return { available: Boolean(target), target, ...mutation }
}

/** Built-in actions return the draft itself; remote (ContextVM) actions wrap it as `{ text, data }`. */
function listingDraftPayload(value: unknown): unknown {
	if (typeof value === 'object' && value !== null && 'text' in value && 'data' in value) return (value as { data: unknown }).data
	return value
}
