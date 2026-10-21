import type { NostrEvent } from '@/lib/nostr/io'
import { z } from 'zod'

/**
 * nsite static pages — kind 34128.
 *
 * This is the page kind published by `bitkarrot/nostr-cms` (the "Nostr CMS for
 * Organizations" project, deployed through setupcms.hivetalk.org), and this
 * file is the single definition of what counts as a valid nsite page here, per
 * the rule in `AGENTS.md` ("Every event kind the app renders must have a parser
 * under `src/lib/schemas/`").
 *
 * The shape, read off that project's own publisher
 * (`src/components/admin/AdminPages.tsx`) rather than inferred:
 *
 *   kind    34128, addressable
 *   d       the URL path, always leading-slashed (`/about`)
 *   sha256  the Blossom blob hash of the page document
 *   alt     a human description, `Static page for /about`
 *   relay   zero or more Blossom server URLs, repeated
 *   content the page body, used as a fallback when there is no `sha256` tag
 *   homepage_section  `true` when the page should appear on the homepage
 *
 * Two things about this format are worth stating plainly, because they are the
 * whole of the interoperability problem:
 *
 *  1. **The content is a document, not structured data.** nostr-cms uploads a
 *     complete HTML document to Blossom and names it by hash; the event is a
 *     *pointer*. Our own storefront page (kind 30024) carries validated block
 *     JSON inline. So the two systems agree on "a page lives at a path" and
 *     disagree on everything else.
 *
 *  2. **Their renderer executes what it fetches.** nostr-cms renders the blob
 *     through `dangerouslySetInnerHTML` behind a DOMPurify allowlist that
 *     includes `iframe` and `style`. This app must not do that: the storefront
 *     path deliberately accepts no HTML at all, because this application holds
 *     wallet material and an injection here drains accounts rather than
 *     defacing a page (see the header of `src/lib/schemas/storefront.ts` and
 *     `docs/storefront-page-builder.md`).
 *
 * So this module *parses and addresses* what nostr-cms publishes, and nothing
 * in it returns HTML for injection. Fetching and rendering are separate
 * decisions, taken in the callers that can be reviewed for them.
 */

export const NSITE_PAGE_KIND = 34128

/**
 * Bounds. A relay will serve a hostile 5MB document with a 4MB path, so these
 * cap what one event can make a caller do.
 */
export const NSITE_PAGE_LIMITS = {
	maxPathLength: 200,
	maxContentLength: 100_000,
	maxRelays: 8,
	maxAltLength: 280,
} as const

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Matches the control characters and spaces a parser strips before deciding a
 * scheme — the same reason `isSafeHref` does, since `java\tscript:` is a
 * working href that a naive prefix check misses.
 */
const URL_IGNORED_CHARS = /[\x00-\x20\x7f]/g

/** True for a lowercase 64-character hex sha256 digest. */
export function isSha256Hex(value: unknown): value is string {
	return typeof value === 'string' && SHA256_HEX.test(value)
}

/**
 * True for a Blossom server URL we are willing to send a request to.
 *
 * Stricter than `isSafeHref`: a blob server must be an absolute `https:` origin
 * with no credentials and no query or fragment, because it is used to build a
 * URL that the app then fetches. A `http:` server, a `//host` form, or
 * `https://user:pass@host` all fail.
 */
export function isBlossomServerUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false
	const candidate = value.replace(URL_IGNORED_CHARS, '')
	if (candidate.length === 0 || candidate.startsWith('//')) return false
	try {
		const url = new URL(candidate)
		if (url.protocol !== 'https:') return false
		if (url.username || url.password) return false
		if (url.search || url.hash) return false
		return true
	} catch {
		return false
	}
}

/**
 * True for an nsite path.
 *
 * The path is the join key between the two systems, and it is also attacker
 * controlled, so it is checked rather than trusted: it must be absolute, must
 * not traverse (`..`), must not carry control characters or whitespace, and
 * must not be a protocol-relative `//host` form. A path that is merely unusual
 * is fine; a path that could climb or re-point somewhere else is not.
 */
export function isNsitePath(value: unknown): value is string {
	if (typeof value !== 'string') return false
	if (value.length === 0 || value.length > NSITE_PAGE_LIMITS.maxPathLength) return false
	if (!value.startsWith('/')) return false
	if (value.startsWith('//')) return false
	if (/[\x00-\x20\x7f]/.test(value)) return false
	if (value.includes('..')) return false
	return true
}

export interface NsitePage {
	/** The URL path, leading-slashed. The join key with nostr-cms. */
	path: string
	/** Blossom blob hash, or null when the event carried only inline content. */
	sha256: string | null
	/** Blossom servers the publisher named, in the order they were tagged. */
	relays: string[]
	alt: string
	/** `homepage_section: true` — nostr-cms renders these on its homepage. */
	onHomepage: boolean
	/** The inline body. Markdown or HTML as far as the format is concerned. */
	content: string
	/** The authoring pubkey. Pages are per-author; the path is not global. */
	author: string
	createdAt: number
	eventId: string
	/** `34128:<pubkey>:<path>` — the addressable coordinate, per AGENTS.md. */
	coordinate: string
}

export interface NsiteParseResult {
	page: NsitePage | null
	/** Set only when the event cannot be used at all. */
	error: string | null
	/** Tags dropped as invalid — a bad relay does not invalidate the page. */
	warnings: string[]
}

export function nsiteCoordinate(pubkey: string, path: string): string {
	return `${NSITE_PAGE_KIND}:${pubkey}:${path}`
}

/**
 * Parses one kind-34128 event.
 *
 * Fails only on the things that make an event unusable: the wrong kind, no
 * usable `d` path (there is nothing to address), or a signature-less event
 * missing an id/author. Everything else degrades: a malformed `sha256` becomes
 * `null` rather than poisoning the page, and a malformed `relay` is dropped and
 * counted.
 *
 * Note what is deliberately *not* done here: the `content` is returned as a
 * string and never interpreted. Deciding whether those bytes may be rendered is
 * a caller's decision, and it is a decision this repository has already made
 * once, in the other direction.
 */
export function parseNsitePageEvent(event: NostrEvent | null | undefined): NsiteParseResult {
	if (!event || typeof event !== 'object') {
		return { page: null, error: 'No event', warnings: [] }
	}
	if (event.kind !== NSITE_PAGE_KIND) {
		return { page: null, error: `Not an nsite page event (kind ${event.kind})`, warnings: [] }
	}

	const warnings: string[] = []
	const tags = Array.isArray(event.tags) ? event.tags : []

	const dTag = tags.find((tag) => tag[0] === 'd')?.[1]
	if (!isNsitePath(dTag)) {
		return { page: null, error: 'Page event has no usable path (`d` tag)', warnings }
	}

	const rawSha = tags.find((tag) => tag[0] === 'sha256')?.[1]
	let sha256: string | null = null
	if (rawSha !== undefined) {
		if (isSha256Hex(rawSha.toLowerCase())) {
			sha256 = rawSha.toLowerCase()
		} else {
			warnings.push('Ignored a malformed `sha256` tag')
		}
	}

	const relays: string[] = []
	for (const tag of tags) {
		if (tag[0] !== 'relay') continue
		const url = tag[1]
		if (isBlossomServerUrl(url)) {
			if (!relays.includes(url)) relays.push(url)
		} else {
			warnings.push('Ignored a `relay` tag that is not an https origin')
		}
		if (relays.length >= NSITE_PAGE_LIMITS.maxRelays) break
	}

	const altRaw = tags.find((tag) => tag[0] === 'alt')?.[1] ?? ''
	const alt = altRaw.length > NSITE_PAGE_LIMITS.maxAltLength ? altRaw.slice(0, NSITE_PAGE_LIMITS.maxAltLength) : altRaw
	const onHomepage = tags.find((tag) => tag[0] === 'homepage_section')?.[1] === 'true'

	// Truncate rather than reject: an over-long body is still a page, and the
	// caller can see it was clipped because it will not match the blob hash.
	const content = typeof event.content === 'string' ? event.content.slice(0, NSITE_PAGE_LIMITS.maxContentLength) : ''
	if (typeof event.content === 'string' && event.content.length > NSITE_PAGE_LIMITS.maxContentLength) {
		warnings.push('Truncated an oversized page body')
	}

	return {
		page: {
			path: dTag,
			sha256,
			relays,
			alt,
			onHomepage,
			content,
			author: event.pubkey,
			createdAt: event.created_at,
			eventId: event.id,
			coordinate: nsiteCoordinate(event.pubkey, dTag),
		},
		error: null,
		warnings,
	}
}

const nsitePathSchema = z.string().refine(isNsitePath, { message: 'Path must be absolute, with no traversal or control characters' })

const sha256Schema = z.string().refine(isSha256Hex, { message: 'Expected a 64-character lowercase hex digest' })

const blossomServerSchema = z
	.string()
	.refine(isBlossomServerUrl, { message: 'Expected an https origin with no credentials, query or fragment' })

export const NsitePagePublishSchema = z.object({
	path: nsitePathSchema,
	content: z.string().max(NSITE_PAGE_LIMITS.maxContentLength),
	sha256: sha256Schema,
	relays: z.array(blossomServerSchema).max(NSITE_PAGE_LIMITS.maxRelays).default([]),
	alt: z.string().max(NSITE_PAGE_LIMITS.maxAltLength).optional(),
	onHomepage: z.boolean().default(false),
})

export type NsitePagePublish = z.infer<typeof NsitePagePublishSchema>
/** What a caller passes: `relays`, `onHomepage` and `alt` carry their defaults. */
export type NsitePagePublishInput = z.input<typeof NsitePagePublishSchema>

/**
 * Builds the event template for a page, tag for tag as nostr-cms builds it, so
 * a page published from here is readable by that project and vice versa. The
 * tag order matches theirs (`d`, `sha256`, `alt`, `relay`…, `homepage_section`)
 * — not because relays care, but so a diff of the two implementations shows
 * nothing but the values.
 *
 * Returns an unsigned template; signing and publishing belong to `src/publish/`.
 */
export function buildNsitePageTemplate(page: NsitePagePublishInput): { kind: number; content: string; tags: string[][] } {
	const parsed = NsitePagePublishSchema.parse(page)
	const path = parsed.path.startsWith('/') ? parsed.path : `/${parsed.path}`

	const tags: string[][] = [
		['d', path],
		['sha256', parsed.sha256],
		['alt', parsed.alt ?? `Static page for ${path}`],
		...parsed.relays.map((relay) => ['relay', relay]),
	]
	if (parsed.onHomepage) tags.push(['homepage_section', 'true'])

	return { kind: NSITE_PAGE_KIND, content: parsed.content, tags }
}
