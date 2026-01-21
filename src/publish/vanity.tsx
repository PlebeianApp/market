import { VANITY_REQUEST_KIND, generateVanityDTag, isValidVanityName, VANITY_RESERVED_NAMES } from '@/lib/schemas/vanity'
import { ndkActions } from '@/lib/stores/ndk'
import { vanityKeys, markVanityAsDeleted, getVanityDomain } from '@/queries/vanity'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// --- VALIDATION ---

export interface VanityNameValidation {
	valid: boolean
	error?: string
}

/**
 * Validates a vanity name
 */
export const validateVanityName = (name: string): VanityNameValidation => {
	if (!name) {
		return { valid: false, error: 'Name is required' }
	}

	if (name.length > 64) {
		return { valid: false, error: 'Name must be 64 characters or less' }
	}

	if (name.length < 2) {
		return { valid: false, error: 'Name must be at least 2 characters' }
	}

	const lowercaseName = name.toLowerCase()

	if (VANITY_RESERVED_NAMES.has(lowercaseName)) {
		return { valid: false, error: 'This name is reserved' }
	}

	if (!/^[a-z0-9][a-z0-9_-]*$/.test(lowercaseName)) {
		return {
			valid: false,
			error: 'Name must start with a letter or number and contain only lowercase letters, numbers, hyphens, and underscores',
		}
	}

	return { valid: true }
}

// --- EVENT CREATION ---

/**
 * Creates a vanity request event (Kind 30409)
 */
export const createVanityRequestEvent = (name: string, domain: string, signer: NDKSigner, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = VANITY_REQUEST_KIND
	event.content = ''

	const lowercaseName = name.toLowerCase()
	const dTag = generateVanityDTag(lowercaseName, domain)

	const tags: NDKTag[] = [
		['d', dTag],
		['name', lowercaseName],
		['domain', domain],
	]

	event.tags = tags
	return event
}

/**
 * Creates a Kind 5 deletion event for a vanity request
 */
export const createVanityDeletionEvent = (dTag: string, pubkey: string, ndk: NDK): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = 5
	event.content = ''

	// Reference the vanity request by its coordinates (a-tag)
	const aTag = `${VANITY_REQUEST_KIND}:${pubkey}:${dTag}`

	event.tags = [['a', aTag]]
	return event
}

// --- PUBLISH FUNCTIONS ---

/**
 * Publishes a vanity request event
 */
export const publishVanityRequest = async (name: string, domain: string, signer: NDKSigner, ndk: NDK): Promise<string> => {
	// Validate name
	const validation = validateVanityName(name)
	if (!validation.valid) {
		throw new Error(validation.error)
	}

	const event = createVanityRequestEvent(name, domain, signer, ndk)
	await event.sign(signer)
	await event.publish()

	console.log('Published vanity request:', event.id, 'for', name)
	return event.id
}

/**
 * Publishes a deletion event for a vanity request
 */
export const deleteVanityRequest = async (dTag: string, signer: NDKSigner, ndk: NDK): Promise<boolean> => {
	const user = await signer.user()
	const pubkey = user.pubkey

	const event = createVanityDeletionEvent(dTag, pubkey, ndk)
	await event.sign(signer)
	await event.publish()

	// Mark as deleted locally for immediate UI feedback
	markVanityAsDeleted(dTag)

	console.log('Published vanity deletion for:', dTag)
	return true
}

// --- REACT QUERY MUTATIONS ---

/**
 * Mutation hook for publishing a vanity request
 */
export const usePublishVanityRequestMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({ name, domain }: { name: string; domain?: string }) => {
			const ndk = ndkActions.getNDK()
			const signer = ndkActions.getSigner()

			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available - please sign in')

			const effectiveDomain = domain || getVanityDomain()
			if (!effectiveDomain) throw new Error('Vanity domain not configured')

			return publishVanityRequest(name, effectiveDomain, signer, ndk)
		},
		onSuccess: async (eventId, variables) => {
			const user = await ndkActions.getUser()
			if (user?.pubkey) {
				// Invalidate user's vanity addresses to refresh the list
				await queryClient.invalidateQueries({
					queryKey: vanityKeys.userAddresses(user.pubkey),
				})
			}
			toast.success('Vanity address request submitted')
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : 'Failed to submit request'
			toast.error(message)
			console.error('Vanity request error:', error)
		},
	})
}

/**
 * Mutation hook for deleting a vanity request
 */
export const useDeleteVanityRequestMutation = () => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({ dTag }: { dTag: string }) => {
			const ndk = ndkActions.getNDK()
			const signer = ndkActions.getSigner()

			if (!ndk) throw new Error('NDK not initialized')
			if (!signer) throw new Error('No signer available - please sign in')

			return deleteVanityRequest(dTag, signer, ndk)
		},
		onSuccess: async () => {
			const user = await ndkActions.getUser()
			if (user?.pubkey) {
				// Invalidate user's vanity addresses to refresh the list
				await queryClient.invalidateQueries({
					queryKey: vanityKeys.userAddresses(user.pubkey),
				})
			}
			toast.success('Vanity address deleted')
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : 'Failed to delete vanity address'
			toast.error(message)
			console.error('Vanity deletion error:', error)
		},
	})
}

/**
 * Generate the payment memo for a vanity request
 * Format: vanity:<name>:<domain>:<request-event-id>
 */
export const generateVanityPaymentMemo = (name: string, domain: string, requestEventId: string): string => {
	return `vanity:${name.toLowerCase()}:${domain}:${requestEventId}`
}
