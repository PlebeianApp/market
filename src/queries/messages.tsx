import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { NDKEvent, type NDKUser, type NDKFilter } from '@nostr-dev-kit/ndk'
import { messageKeys } from './queryKeyFactory'

const MESSAGE_KINDS = [14, 16, 17]

/** Check if content looks like JSON (potentially unsupported data) */
const looksLikeJSON = (content: string): boolean => {
	if (!content) return false
	const trimmed = content.trim()
	return (trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))
}



const extractMetadataFromNestedEvent = (content: string): { title?: string; description?: string; preview?: string; altTag?: string; kind?: number } => {
	if (!content || !looksLikeJSON(content)) {
		return {}
	}

	try {
		const parsed = JSON.parse(content)
		if (parsed && typeof parsed === 'object') {

			const tags = parsed.tags || []
			const title = tags.find((t: string[]) => t[0] === 'title')?.[1]
			const description = tags.find((t: string[]) => t[0] === 'description')?.[1]
			const summary = tags.find((t: string[]) => t[0] === 'summary')?.[1]
			const altTag = tags.find((t: string[]) => t[0] === 'alt')?.[1]
			const innerContent = parsed.content
			const kind = parsed.kind

			return {
				title: title ? title.substring(0, 40) : undefined,
				description: description || summary ? (description || summary).substring(0, 50) : undefined,
				altTag: altTag ? altTag.substring(0, 60) : undefined,
				preview: innerContent && typeof innerContent === 'string' ? innerContent.substring(0, 50) : undefined,
				kind: kind
			}
		}
	} catch (error) {
		console.warn('Failed to parse nested event metadata:', error)
	}

	return {}
}


/** Generate a user-friendly preview snippet from a message event */
const getMessageSnippet = (event: NDKEvent, maxLength = 50): string => {
	const { kind, content } = event

	const truncate = (text: string, len: number) => {
		return text.length > len ? `${text.substring(0, len)}...` : text
	}


	if (kind === 14) {
		return content && content.trim() ? truncate(content.trim(), maxLength) : '(No content)'
	}


	if (kind === 16 || kind === 17) {
		// Check if this is an image repost
		const hasImeta = event.tags?.some((t) => t[0] === 'imeta')
		if (hasImeta) return '[image]'

		// Try to extract metadata from nested event in content
		const metadata = extractMetadataFromNestedEvent(content)
		if (metadata.altTag) return truncate(metadata.altTag, maxLength)
		if (metadata.title) return truncate(metadata.title, maxLength)
		if (metadata.description) return truncate(metadata.description, maxLength)
		if (metadata.preview) return truncate(metadata.preview, maxLength)

		// Check wrapper event tags for structured data
		const amount = event.tags?.find((t) => t[0] === 'amount')?.[1]
		const orderId = event.tags?.find((t) => t[0] === 'order')?.[1]
		if (amount) return `Amount: ${amount} sats`
		if (orderId) return `Order: ${orderId.substring(0, 12)}...`

		// Fallback to plain content if it's not JSON
		if (content && content.trim() && !looksLikeJSON(content)) {
			return truncate(content.trim(), maxLength)
		}

		return '(Message)'
	}

	// For unsupported kinds: try to extract metadata or alt tag
	const metadata = extractMetadataFromNestedEvent(content)
	if (metadata.title) return truncate(metadata.title, maxLength)
	if (metadata.description) return truncate(metadata.description, maxLength)

	const altTag = event.tags?.find((t) => t[0] === 'alt')?.[1]
	if (altTag && altTag.trim()) {
		return truncate(altTag.trim(), maxLength)
	}

	return `(Message)`
}



export function useConversationsList() {
	const ndk = ndkActions.getNDK()
	const { user: currentUser } = useStore(authStore)
	const currentUserPubkey = currentUser?.pubkey

	return useQuery({
		queryKey: messageKeys.conversationsList(currentUserPubkey),
		enabled: !!ndk && !!currentUserPubkey,
		queryFn: async () => {
			if (!ndk || !currentUserPubkey) throw new Error('NDK or current user not available')

			const filters: NDKFilter[] = [
				{ kinds: MESSAGE_KINDS, authors: [currentUserPubkey] },
				{ kinds: MESSAGE_KINDS, '#p': [currentUserPubkey] },
			]

			const eventsSet = await ndk.fetchEvents(filters)
			const events = Array.from(eventsSet)

			const conversationsMap = new Map<string, { otherUser: NDKUser; lastEvent: NDKEvent }>()

			events.forEach((event) => {
				let otherPubkey: string | undefined
				if (event.pubkey === currentUserPubkey) {
					const pTag = event.tags.find((t) => t[0] === 'p')
					if (pTag && pTag[1]) otherPubkey = pTag[1]
				} else {
					otherPubkey = event.pubkey
				}

				if (otherPubkey && otherPubkey !== currentUserPubkey) {
					const existing = conversationsMap.get(otherPubkey)
					if (!existing || (event.created_at ?? 0) > (existing.lastEvent.created_at ?? 0)) {
						conversationsMap.set(otherPubkey, {
							otherUser: ndk.getUser({ pubkey: otherPubkey }),
							lastEvent: event,
						})
					}
				}
			})

			const conversationList = Array.from(conversationsMap.values())
				.map(({ otherUser, lastEvent }) => ({
					pubkey: otherUser.pubkey,
					// Profile might be fetched asynchronously by NDK, UI should handle potential undefined state initially
					profile: otherUser.profile,
					lastMessageAt: lastEvent.created_at,
					lastMessageSnippet: getMessageSnippet(lastEvent),
					lastMessageKind: lastEvent.kind,
				}))
				.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))

			// NDK's getUser should handle profile fetching. Explicit mass fetching can be added if performance dictates.

			return conversationList
		},
	})
}

/**
 * Hook to fetch messages between the current user and another user.
 */
export function useConversationMessages(otherUserPubkey: string | undefined) {
	const ndk = ndkActions.getNDK()
	const { user: currentUser } = useStore(authStore)
	const currentUserPubkey = currentUser?.pubkey

	return useQuery({
		queryKey: messageKeys.conversationMessages(currentUserPubkey, otherUserPubkey),
		enabled: !!ndk && !!currentUserPubkey && !!otherUserPubkey,
		queryFn: async () => {
			if (!ndk || !currentUserPubkey || !otherUserPubkey) throw new Error('Missing NDK, current user, or other user pubkey')

			const filters: NDKFilter[] = [
				{ kinds: MESSAGE_KINDS, authors: [currentUserPubkey], '#p': [otherUserPubkey] },
				{ kinds: MESSAGE_KINDS, authors: [otherUserPubkey], '#p': [currentUserPubkey] },
			]

			const eventsSet = await ndk.fetchEvents(filters)
			const events = Array.from(eventsSet)
			return events.sort((a: NDKEvent, b: NDKEvent) => (a.created_at ?? 0) - (b.created_at ?? 0)) // Ascending for chat display
		},
	})
}

/**
 * Sends a new message (Kind 14) to a recipient.
 */
export async function sendChatMessage(recipientPubkey: string, content: string, subject?: string): Promise<NDKEvent | undefined> {
	const ndk = ndkActions.getNDK()
	const currentUser = authStore.state?.user

	if (!ndk || !currentUser) {
		// Simplified check, main check is for ndk.signer below
		console.error('NDK or current user not available for sending message')
		alert('User not available. Please ensure you are logged in.')
		return undefined
	}

	if (!ndk.signer) {
		// Check for ndk.signer directly
		console.error('NDK signer not available for sending message')
		alert('Signer not available. Please ensure you are logged in correctly.')
		return undefined
	}

	const event = new NDKEvent(ndk)
	event.kind = 14
	event.content = content
	event.tags = [['p', recipientPubkey]]
	if (subject) {
		event.tags.push(['subject', subject])
	}

	try {
		await event.sign() // Attempt to use ndk.signer implicitly
		await ndkActions.publishEvent(event)
		return event
	} catch (error) {
		console.error('Error sending chat message:', error)
		alert(`Error sending message: ${error instanceof Error ? error.message : String(error)}`)
		return undefined
	}
}
