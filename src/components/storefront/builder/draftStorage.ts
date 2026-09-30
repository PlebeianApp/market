import { StorefrontPageEnvelopeSchema, parseStorefrontPage, type StorefrontPage } from '@/lib/schemas/storefront'

/**
 * Unpublished editor state, kept in localStorage.
 *
 * This is browser storage in the sense the repo README allows: temporary local
 * state, never the source of truth. The published page lives on relays; this
 * only stops a refresh or an accidental navigation from costing the author
 * their afternoon.
 *
 * Drafts are keyed per pubkey so two accounts on one browser cannot inherit
 * each other's work.
 */

const DRAFT_KEY_PREFIX = 'plebeian-storefront-draft'

function draftKey(pubkey: string): string {
	return `${DRAFT_KEY_PREFIX}:${pubkey}`
}

/**
 * Every localStorage access is guarded: the API throws outright in a Safari
 * private window and when site data is blocked, and losing a draft must never
 * take the editor down with it.
 */
export function saveStorefrontDraft(pubkey: string, page: StorefrontPage): void {
	if (!pubkey) return
	try {
		localStorage.setItem(draftKey(pubkey), JSON.stringify(page))
	} catch {
		// Quota exceeded or storage unavailable. The editor keeps working from
		// memory; only crash recovery is lost.
	}
}

/**
 * Reads a draft back.
 *
 * Validated on the way in exactly like a relay document would be: localStorage
 * is writable by anything running on this origin, and a draft that skipped
 * validation would be a way to get an unvalidated block into the editor and
 * from there into a signed event.
 */
export function loadStorefrontDraft(pubkey: string): StorefrontPage | null {
	if (!pubkey) return null
	let raw: string | null = null
	try {
		raw = localStorage.getItem(draftKey(pubkey))
	} catch {
		return null
	}
	if (!raw) return null

	const parsed = parseStorefrontPage(raw)
	if (!parsed.page) {
		clearStorefrontDraft(pubkey)
		return null
	}
	return parsed.page
}

export function clearStorefrontDraft(pubkey: string): void {
	if (!pubkey) return
	try {
		localStorage.removeItem(draftKey(pubkey))
	} catch {
		// Nothing to do — a stale draft is re-validated on next load anyway.
	}
}

/** True when a stored draft exists and parses. Used to show the unsaved marker. */
export function hasStorefrontDraft(pubkey: string): boolean {
	return loadStorefrontDraft(pubkey) !== null
}

/** Exported for tests: the envelope a draft must satisfy. */
export { StorefrontPageEnvelopeSchema }
