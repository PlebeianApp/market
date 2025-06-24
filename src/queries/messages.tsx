import { useQuery } from '@tanstack/react-query'
import { ndkActions } from '@/lib/stores/ndk'
import { authStore } from '@/lib/stores/auth'
import { useStore } from '@tanstack/react-store'
import { NDKEvent, type NDKUser, type NDKFilter } from '@nostr-dev-kit/ndk'
import { messageKeys } from './queryKeyFactory'

const MESSAGE_KINDS = [14, 16, 17]

// Helper to get a snippet from content
const getSnippet = (content: string, length = 50) => {
	return content.length > length ? `${content.substring(0, length)}...` : content
}

/**
 * Hook to fetch a list of conversations for the current user.
 * A conversation is defined by unique pubkeys the user has interacted with via message kinds.
 */
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
					lastMessageSnippet: getSnippet(lastEvent.content || (lastEvent.kind === 14 ? 'No content' : 'Event')),
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
		await event.publish()
		return event
	} catch (error) {
		console.error('Error sending chat message:', error)
		alert(`Error sending message: ${error instanceof Error ? error.message : String(error)}`)
		return undefined
	}
}
