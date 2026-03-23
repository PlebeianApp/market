import { COMMENT_KIND, PRODUCT_KIND } from '@/lib/schemas/productComment'
import { ndkActions } from '@/lib/stores/ndk'
import { commentKeys } from '@/queries/queryKeyFactory'
import NDK, { NDKEvent, type NDKSigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export const createCommentEvent = (
	productAddress: string,
	content: string,
	signer: NDKSigner,
	ndk: NDK,
	parentCommentId?: string,
): NDKEvent => {
	const event = new NDKEvent(ndk)
	event.kind = COMMENT_KIND
	event.content = content

	const tags: NDKTag[] = []

	tags.push(['A', productAddress])

	const productKind = PRODUCT_KIND.toString()
	tags.push(['K', productKind])

	if (parentCommentId) {
		tags.push(['e', parentCommentId])
		tags.push(['k', COMMENT_KIND.toString()])
	}

	event.tags = tags

	return event
}

export const publishComment = async (
	productAddress: string,
	content: string,
	signer: NDKSigner,
	ndk: NDK,
	parentCommentId?: string,
): Promise<string> => {
	if (!content.trim()) {
		throw new Error('Comment content is required')
	}

	if (content.length > 10000) {
		throw new Error('Comment is too long (max 10000 characters)')
	}

	const event = createCommentEvent(productAddress, content.trim(), signer, ndk, parentCommentId)

	await event.sign(signer)
	await ndkActions.publishEvent(event)

	return event.id
}

export const deleteComment = async (commentId: string, signer: NDKSigner, ndk: NDK): Promise<void> => {
	const deleteEvent = new NDKEvent(ndk)
	deleteEvent.kind = 5 // NIP-09 deletion
	deleteEvent.content = 'Comment deleted'
	deleteEvent.tags = [['e', commentId]]

	await deleteEvent.sign(signer)
	await ndkActions.publishEvent(deleteEvent)
}

export const usePublishComment = (productAddress: string, onSuccess?: () => void) => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ content, parentCommentId }: { content: string; parentCommentId?: string }) => {
			const ndk = ndkActions.getNDK()
			const signer = ndkActions.getSigner()
			if (!ndk || !signer) {
				throw new Error('Not logged in')
			}
			return publishComment(productAddress, content, signer, ndk, parentCommentId)
		},
		onSuccess: () => {
			const pubkey = productAddress.split(':')[1]
			const dTag = productAddress.split(':')[2]
			queryClient.invalidateQueries({ queryKey: commentKeys.byProduct(pubkey, dTag) })
			toast.success('Comment posted')
			onSuccess?.()
		},
		onError: (error: Error) => {
			toast.error(error.message || 'Failed to post comment')
			throw error
		},
	})
}

export const useDeleteComment = (productAddress: string, onSuccess?: () => void) => {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (commentId: string) => {
			const ndk = ndkActions.getNDK()
			const signer = ndkActions.getSigner()
			if (!ndk || !signer) {
				throw new Error('Not logged in')
			}
			return deleteComment(commentId, signer, ndk)
		},
		onSuccess: () => {
			const pubkey = productAddress.split(':')[1]
			const dTag = productAddress.split(':')[2]
			queryClient.invalidateQueries({ queryKey: commentKeys.byProduct(pubkey, dTag) })
			toast.success('Comment deleted')
			onSuccess?.()
		},
		onError: (error: Error) => {
			toast.error(error.message || 'Failed to delete comment')
			throw error
		},
	})
}
