import { ndkActions } from '@/lib/stores/ndk'
import {
	publishShareEventNoteWorkflow,
	publishShareNoteWorkflow,
	type ShareEventNoteInput,
	type ShareNoteInput,
} from '@sdk/commerce/messaging'
import type { EventPublishContext } from '@sdk/core/ports/eventPublish'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { createNdkPublishContext } from '@platform/web/ndkPublishContext'

const SIGN_TIMEOUT_MS = 30_000
const PUBLISH_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])
}

/** Share notes go out through remote signers that can hang, so signing and publishing are time-boxed. */
async function createShareNoteContext(): Promise<EventPublishContext<NDKEvent>> {
	const ndk = ndkActions.getNDK()
	if (!ndk) throw new Error('NDK not initialized')
	if (!ndk.signer) throw new Error('No signer available. Please log in with a signing method.')

	const context = await createNdkPublishContext(ndk, ndk.signer, (note) =>
		withTimeout(ndkActions.publishEvent(note), PUBLISH_TIMEOUT_MS, 'Publish timeout after 10 seconds').then(() => undefined),
	)
	const sign = context.signer.sign
	return {
		...context,
		signer: { sign: (template) => withTimeout(sign(template), SIGN_TIMEOUT_MS, 'Sign timeout - signer not responding') },
	}
}

export async function publishShareProductNote(input: ShareNoteInput): Promise<NDKEvent> {
	return publishShareNoteWorkflow(await createShareNoteContext(), input)
}

export async function publishShareEventNote(input: ShareEventNoteInput): Promise<NDKEvent> {
	return publishShareEventNoteWorkflow(await createShareNoteContext(), input)
}
