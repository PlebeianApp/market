import { getUser, publish as publishNostrEvent, sign as signNostrEvent } from '@/lib/nostr/io'
import type { EventTemplate, NostrEvent } from '@/lib/nostr/io'
import {
	STOREFRONT_PAGE_D_TAG,
	STOREFRONT_PAGE_KIND,
	validateStorefrontPageForPublish,
	type StorefrontPage,
} from '@/lib/schemas/storefront'

/**
 * Publishing a user's storefront page (ADR-019).
 *
 * Event shape, stated explicitly per `src/publish/AGENTS.md`:
 *
 *   kind    30024 — addressable, one page per pubkey
 *   d       `storefront-page` — the addressable identifier
 *   author  the logged-in user's own pubkey. The app key is NOT involved: page
 *           content is user speech, and the app must not be its author.
 *   content JSON `{ version, enabled, root, content }`, validated by
 *           `validateStorefrontPageForPublish` BEFORE signing
 *   relays  the adapter's configured write relays
 *
 * There is no payment, server round trip, or app-side gate on this write. That
 * is deliberate (ADR-019 R4/R6): the *name* at which a page is reachable is
 * rented and arbitrated, but the page itself is the author's and stays
 * reachable by pubkey whether or not a name is held.
 *
 * This is not a high-sensitivity publish in the `AGENTS.md` sense — it moves no
 * funds and carries no payment lifecycle. It is, however, the input to a
 * renderer that runs in a wallet-bearing app, which is why validation happens
 * here and again on read (`parseStorefrontPage`): the relay round trip means the
 * bytes we render are never provably the bytes we signed.
 */

/** Human-readable title tag, so other clients can list the page without parsing content. */
const TITLE_TAG = 'title'

export interface PublishStorefrontPageResult {
	eventId: string
	pubkey: string
	/** Relays that acknowledged the event. Never empty — a zero-ACK publish throws. */
	publishedRelays: string[]
}

/**
 * Builds the unsigned event for a page. Exported for tests and for callers that
 * want to inspect what would be signed without signing it.
 *
 * @throws if the page fails strict validation. Refusing here rather than
 * dropping bad blocks is the point: the author gets told, instead of publishing
 * a page that silently renders with holes in it.
 */
export function buildStorefrontPageEvent(page: StorefrontPage): EventTemplate {
	const validation = validateStorefrontPageForPublish(page)
	if (!validation.ok) {
		throw new Error(`Storefront page is not valid: ${validation.errors.join(', ')}`)
	}

	const validated = validation.page
	const tags: string[][] = [['d', STOREFRONT_PAGE_D_TAG]]

	const title = validated.root.props.title.trim()
	if (title.length > 0) tags.push([TITLE_TAG, title])

	return {
		kind: STOREFRONT_PAGE_KIND,
		created_at: Math.floor(Date.now() / 1000),
		content: JSON.stringify(validated),
		tags,
	}
}

/**
 * Signs and publishes the page as the logged-in user.
 *
 * Fails closed on zero relay ACKs: `io.ts` documents an empty `publishedRelays`
 * as a publish failure, and the applesauce adapter resolves rather than throws
 * in that case, so the check has to live here to be adapter-independent.
 */
export async function publishStorefrontPage(page: StorefrontPage): Promise<PublishStorefrontPageResult> {
	const user = await getUser()
	if (!user?.pubkey) throw new Error('You must be logged in to publish a page')

	const template = buildStorefrontPageEvent(page)
	const signed: NostrEvent = await signNostrEvent(template)

	// The signer decides the author. If it signed as somebody else (a signer
	// swapped between login and publish), the event would land on a different
	// pubkey's page address — refuse rather than write to a stranger's address.
	if (signed.pubkey !== user.pubkey) {
		throw new Error('Refusing to publish: the signer produced an event for a different account. Nothing was published.')
	}

	const result = await publishNostrEvent(signed)
	if (result.publishedRelays.size === 0) {
		throw new Error('No relay accepted the page. Your changes were not published — check your relay connections and try again.')
	}

	return {
		eventId: signed.id,
		pubkey: signed.pubkey,
		publishedRelays: Array.from(result.publishedRelays),
	}
}

/**
 * Turns the page off without discarding it.
 *
 * Republishes the same document with `enabled: false`, so visitors get the
 * default profile view again while the author keeps every block. This is not a
 * NIP-09 deletion: deleting would destroy content the author may want back, and
 * relays honour deletions inconsistently anyway.
 */
export async function unpublishStorefrontPage(page: StorefrontPage): Promise<PublishStorefrontPageResult> {
	return publishStorefrontPage({ ...page, enabled: false })
}
