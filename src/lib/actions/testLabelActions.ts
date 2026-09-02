import {
	A_TAG,
	E_TAG,
	K_TAG,
	L_TAG,
	LABEL_DELETION_KIND,
	LABEL_EVENT_KIND,
	LABEL_NAMESPACE,
	LABEL_VALUE_TEST,
	l_TAG,
} from '@/lib/constants/testLabels'
import { ndkActions } from '@/lib/stores/ndk'
import { testLabelActions } from '@/lib/stores/testLabels'
import { invalidateTestLabelCache, setCachedTestLabel } from '@/queries/testLabels'
import { NDKEvent } from '@nostr-dev-kit/ndk'

/**
 * ADR-0009 — Publish test-label and un-label events.
 *
 * Label event: NIP-32 kind 1985 with `L`/`l` tags in our namespace and an `a`
 * tag holding the item coordinate. No `p` tag — a `p` tag would label the
 * user, and this mechanism explicitly scopes to items, never users.
 *
 * Un-label event: NIP-09 kind 5 referencing the label event's id in an `e`
 * tag with a `k` tag of 1985. No `a` tag — NIP-09 `a` tags target
 * replaceable/addressable events and kind 1985 is not replaceable.
 *
 * Both actions update the store optimistically and reconcile with the relay
 * round-trip (reverting the optimistic state if publishing fails).
 */

/** Marker used for optimistic store entries before the event id exists */
const PENDING_LABEL_EVENT_ID = 'pending-test-label'

const buildTestLabelContent = (reason: string | undefined, contactRef: string): string => {
	const reasonPrefix = reason?.trim() ? `${reason.trim()} ` : ''
	return `${reasonPrefix}Marked as test listing. If this is a real listing, contact ${contactRef} to request removal.`
}

export interface PublishTestLabelParams {
	/** Item coordinate, "kind:pubkey:identifier" (e.g. 30402:<pubkey>:<d-tag>) */
	coordinate: string
	/** Contact reference (npub or nip05) the item author can reach to appeal */
	contactRef: string
	/** Optional reason, prepended to the pre-filled label content */
	reason?: string
	/** Full content override (used when the labeler edits the pre-filled text in the UI) */
	content?: string
}

/**
 * Publish a NIP-32 test label event (kind 1985) for an item coordinate.
 * The `.content` is pre-filled with the labeler's contact reference.
 * Updates the label store optimistically; reverts on failure.
 */
export async function publishTestLabel({ coordinate, contactRef, reason, content }: PublishTestLabelParams): Promise<NDKEvent> {
	if (!coordinate) throw new Error('A coordinate is required to publish a test label')

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')

	const labeler = await signer.user()
	if (!labeler?.pubkey) throw new Error('Unable to determine the current labeler pubkey')

	// Optimistic update — the item disappears from feeds immediately
	testLabelActions.setLabel(coordinate, PENDING_LABEL_EVENT_ID, labeler.pubkey)

	try {
		const event = new NDKEvent(ndk)
		event.kind = LABEL_EVENT_KIND
		event.created_at = Math.floor(Date.now() / 1000)
		event.tags = [
			[L_TAG, LABEL_NAMESPACE],
			[l_TAG, LABEL_VALUE_TEST, LABEL_NAMESPACE],
			[A_TAG, coordinate],
		]
		event.content = content?.trim() ? content : buildTestLabelContent(reason, contactRef)

		await event.sign(signer)
		const publishedRelays = await ndkActions.publishEvent(event)
		if (publishedRelays.size === 0) {
			throw new Error('Test label was not published to any relays')
		}

		// Reconcile the optimistic entry with the real label event id and
		// keep the cache consistent during relay propagation
		testLabelActions.setLabel(coordinate, event.id, labeler.pubkey)
		setCachedTestLabel(coordinate, { eventId: event.id, labelerPubkey: labeler.pubkey })

		return event
	} catch (error) {
		// Revert the optimistic update if publishing failed
		testLabelActions.removeLabel(coordinate)
		invalidateTestLabelCache(coordinate)
		throw error
	}
}

export interface PublishTestLabelDeletionParams {
	/** Item coordinate the label was applied to (for store reconciliation) */
	coordinate: string
	/** id of the active kind-1985 label event being deleted */
	labelEventId: string
	/** Optional reason for the deletion (NIP-09 content field) */
	reason?: string
}

/**
 * Publish a NIP-09 deletion event (kind 5) for an existing test label.
 * The deletion references the label event's id in an `e` tag with a `k` tag
 * of 1985. Updates the store optimistically; reverts on failure.
 */
export async function publishTestLabelDeletion({ coordinate, labelEventId, reason }: PublishTestLabelDeletionParams): Promise<NDKEvent> {
	if (!coordinate || !labelEventId) throw new Error('A coordinate and label event id are required to un-label')
	if (labelEventId === PENDING_LABEL_EVENT_ID) throw new Error('Label is still being published — try again shortly')

	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	const signer = ndkActions.getSigner()
	if (!signer) throw new Error('No signer available')

	const labeler = await signer.user()
	if (!labeler?.pubkey) throw new Error('Unable to determine the current labeler pubkey')

	// NIP-09: only the label event's author may delete it. Validate the
	// pubkey match before publishing — a mismatch cannot un-label the item.
	const labelerPubkey = testLabelActions.getLabelerPubkey(coordinate)
	if (labelerPubkey && labelerPubkey !== labeler.pubkey) {
		throw new Error('Only the labeler who applied a test label can remove it')
	}

	// Optimistic update — the item reappears in feeds immediately
	const previousLabelerPubkey = labelerPubkey
	testLabelActions.removeLabel(coordinate)

	try {
		const event = new NDKEvent(ndk)
		event.kind = LABEL_DELETION_KIND
		event.created_at = Math.floor(Date.now() / 1000)
		event.tags = [
			[E_TAG, labelEventId],
			[K_TAG, String(LABEL_EVENT_KIND)],
		]
		event.content = reason?.trim() || 'Unmarking test label.'

		await event.sign(signer)
		const publishedRelays = await ndkActions.publishEvent(event)
		if (publishedRelays.size === 0) {
			throw new Error('Test label deletion was not published to any relays')
		}

		// Keep the cache consistent during relay propagation
		setCachedTestLabel(coordinate, null)

		return event
	} catch (error) {
		// Revert the optimistic update if publishing failed
		testLabelActions.setLabel(coordinate, labelEventId, previousLabelerPubkey)
		invalidateTestLabelCache(coordinate)
		throw error
	}
}
