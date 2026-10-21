import { z } from 'zod'

/**
 * Storefront page documents (ADR-019, ADR-0006).
 *
 * A storefront page is an addressable event authored by the *user*, not by the
 * app: kind 30024, `d=storefront-page`, one per pubkey. The app renders it at
 * `/{vanityName}` and `/profile/{id}`; it never owns, stores, or gates it.
 *
 * Security model — the reason this file exists:
 *
 * Page content arrives from a relay and is therefore untrusted (repo AGENTS.md,
 * "Treat relay data as untrusted until validated"). Rather than sanitising
 * attacker-controlled markup, the document is *structured data*: an ordered
 * list of blocks drawn from a closed union, each with typed props. The renderer
 * switches on that union and can only emit components it already ships. There
 * is no raw-HTML path, no remote script or stylesheet, and no `src`/`href` that
 * is not either `https:` or an in-app absolute path.
 *
 * That constraint is load-bearing and must not be relaxed for convenience: this
 * app holds wallet material, so a single `dangerouslySetInnerHTML` here would be
 * an account-draining XSS rather than a defacement.
 *
 * Forward compatibility falls out of the same design. A block whose `type` this
 * version does not know, or whose props fail validation, is dropped by
 * `parseStorefrontPage` and the rest of the page still renders — so an older
 * client meets a newer page without erroring.
 */

/** Addressable kind carrying a storefront page document. See ADR-019. */
export const STOREFRONT_PAGE_KIND = 30024

/** `d` tag identifying the single storefront page belonging to a pubkey. */
export const STOREFRONT_PAGE_D_TAG = 'storefront-page'

/** Document schema version. Bumped only on a breaking shape change. */
export const STOREFRONT_PAGE_VERSION = 1

/**
 * Bounds. These cap what one event can force a renderer to do; they are not
 * style guidance. A relay will happily serve a 5MB document with 50k blocks.
 */
export const STOREFRONT_LIMITS = {
	maxBlocks: 100,
	maxTextLength: 20_000,
	maxUrlLength: 2048,
	maxLinksPerList: 25,
	maxShortTextLength: 280,
	maxProductsPerGrid: 60,
} as const

/**
 * Matches the ASCII control characters and spaces a URL parser strips before
 * deciding a scheme. Browsers accept `java\tscript:alert(1)` in an href, so a
 * naive `startsWith('javascript:')` check would miss it.
 */
const URL_IGNORED_CHARS = /[\x00-\x20\x7f]/g

/**
 * True for values safe to place in an `href`.
 *
 * Two forms are allowed and nothing else:
 *   - an in-app absolute path (`/products/abc`) — note the explicit rejection of
 *     `//evil.example`, which is protocol-relative and would leave the app;
 *   - an absolute `https:` URL.
 *
 * `javascript:`, `data:`, `blob:`, `vbscript:`, `file:` and bare `http:` all
 * fail.
 */
export function isSafeHref(value: unknown): value is string {
	if (typeof value !== 'string') return false
	if (value.length > STOREFRONT_LIMITS.maxUrlLength) return false

	const candidate = value.replace(URL_IGNORED_CHARS, '')
	if (candidate.length === 0) return false

	if (candidate.startsWith('//')) return false
	if (candidate.startsWith('/')) return true

	try {
		return new URL(candidate).protocol === 'https:'
	} catch {
		return false
	}
}

/**
 * True for values safe to place in an image/video `src`.
 *
 * Same gate as `isSafeHref`: absolute `https:` or an in-app path. A relative
 * path is allowed so a page can reference the instance's own bundled art;
 * anything cross-origin must be `https:`.
 *
 * Note: ADR-019 calls for images to resolve through "the existing Blossom/NIP-96
 * host allowlist". No such allowlist exists in this repository yet, so the
 * scheme gate is the whole boundary today. Adding a host allowlist later is a
 * tightening of this function and needs no schema change.
 */
export function isSafeMediaSrc(value: unknown): value is string {
	return isSafeHref(value)
}

const safeHref = z.string().refine(isSafeHref, { message: 'Link must be an https:// URL or an in-app path starting with /' })

const safeMediaSrc = z.string().refine(isSafeMediaSrc, { message: 'Image must be an https:// URL or an in-app path starting with /' })

const shortText = z.string().max(STOREFRONT_LIMITS.maxShortTextLength)
const longText = z.string().max(STOREFRONT_LIMITS.maxTextLength)

/** Loose `d`-tag reference to one of the author's own addressable items. */
const dTagRef = z.string().min(1).max(200)

const alignment = z.enum(['left', 'center', 'right'])

/**
 * Every block carries the `id` Puck assigns it. Keeping Puck's own shape
 * (`{ type, props: { id, ... } }`) as the *persisted* shape means there is no
 * translation layer between editor state and the published document — the
 * thing validated here is exactly the thing the editor produced and exactly the
 * thing the renderer consumes.
 */
const blockBase = { id: z.string().min(1).max(200) }

export const ProfileHeaderBlockSchema = z.object({
	type: z.literal('ProfileHeader'),
	props: z.object({
		...blockBase,
		showBanner: z.boolean().default(true),
		fullScreen: z.boolean().default(false),
		showAbout: z.boolean().default(true),
		showNip05: z.boolean().default(true),
		align: alignment.default('center'),
	}),
})

export const HeroBlockSchema = z.object({
	type: z.literal('Hero'),
	props: z.object({
		...blockBase,
		title: shortText.default(''),
		subtitle: shortText.default(''),
		imageUrl: safeMediaSrc.or(z.literal('')).default(''),
		ctaLabel: shortText.default(''),
		ctaHref: safeHref.or(z.literal('')).default(''),
		align: alignment.default('center'),
		minHeight: z.number().int().min(120).max(1200).default(360),
	}),
})

export const TextBlockSchema = z.object({
	type: z.literal('Text'),
	props: z.object({
		...blockBase,
		/** Restricted markdown. Parsed by `parseMiniMarkdown`; never HTML. */
		markdown: longText.default(''),
		align: alignment.default('left'),
		width: z.enum(['narrow', 'normal', 'wide']).default('normal'),
	}),
})

export const ProductGridBlockSchema = z.object({
	type: z.literal('ProductGrid'),
	props: z.object({
		...blockBase,
		title: shortText.default(''),
		/** `all` = every listing by the page author; `collection` = one collection. */
		source: z.enum(['all', 'collection']).default('all'),
		collectionDTag: dTagRef.or(z.literal('')).default(''),
		limit: z.number().int().min(1).max(STOREFRONT_LIMITS.maxProductsPerGrid).default(12),
		columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
		emptyMessage: shortText.default('No products yet.'),
	}),
})

export const FeaturedProductBlockSchema = z.object({
	type: z.literal('FeaturedProduct'),
	props: z.object({
		...blockBase,
		productDTag: dTagRef.or(z.literal('')).default(''),
	}),
})

export const LinkListBlockSchema = z.object({
	type: z.literal('LinkList'),
	props: z.object({
		...blockBase,
		title: shortText.default(''),
		links: z
			.array(
				z.object({
					label: shortText,
					href: safeHref,
				}),
			)
			.max(STOREFRONT_LIMITS.maxLinksPerList)
			.default([]),
		layout: z.enum(['row', 'column']).default('row'),
	}),
})

export const ImageBlockSchema = z.object({
	type: z.literal('Image'),
	props: z.object({
		...blockBase,
		url: safeMediaSrc.or(z.literal('')).default(''),
		alt: shortText.default(''),
		width: z.enum(['narrow', 'normal', 'wide', 'full']).default('normal'),
		rounded: z.boolean().default(true),
		href: safeHref.or(z.literal('')).default(''),
	}),
})

export const DividerBlockSchema = z.object({
	type: z.literal('Divider'),
	props: z.object({ ...blockBase }),
})

export const SpacerBlockSchema = z.object({
	type: z.literal('Spacer'),
	props: z.object({
		...blockBase,
		size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
	}),
})

/**
 * The closed set. Adding a member here is the *only* way to make a new block
 * renderable, which is what keeps the renderer's switch exhaustive.
 */
export const StorefrontBlockSchema = z.discriminatedUnion('type', [
	ProfileHeaderBlockSchema,
	HeroBlockSchema,
	TextBlockSchema,
	ProductGridBlockSchema,
	FeaturedProductBlockSchema,
	LinkListBlockSchema,
	ImageBlockSchema,
	DividerBlockSchema,
	SpacerBlockSchema,
])

export type StorefrontBlock = z.infer<typeof StorefrontBlockSchema>
export type StorefrontBlockType = StorefrontBlock['type']

export const STOREFRONT_BLOCK_TYPES = [
	'ProfileHeader',
	'Hero',
	'Text',
	'ProductGrid',
	'FeaturedProduct',
	'LinkList',
	'Image',
	'Divider',
	'Spacer',
] as const satisfies readonly StorefrontBlockType[]

/**
 * Closed set of page layouts. Each id maps to a fixed CSS-custom-property token
 * set in `src/config/storefrontThemes.ts` — the registry the author's CMS
 * sidebar and the setup wizard both read from. Closed for the same reason the
 * block union is closed: a free-form color picker is an open-ended surface
 * (arbitrary CSS injected into every page on the app), and an id drawn from a
 * fixed list is not.
 *
 * The first five ids are the original fixed themes; they are kept in the enum
 * so a page published against one keeps validating and keeps rendering
 * identically. The remaining ids are the Theme Studio layouts, which add
 * per-layout palettes and a tune below.
 */
export const STOREFRONT_THEME_IDS = [
	'default',
	'midnight',
	'sunset',
	'forest',
	'mono',
	'farm',
	'art',
	'cards',
	'elec',
	'law',
	'acct',
	'pleb',
	'brut',
] as const
export type StorefrontThemeId = (typeof STOREFRONT_THEME_IDS)[number]

/**
 * Closed set of palettes. Every palette is a curated colourway from the Theme
 * Studio; there is deliberately no way to name a colour, only to choose one of
 * these. `getStorefrontPalette` still resolves the key *inside* the chosen
 * layout, so a key that belongs to another layout falls back to that layout's
 * default rather than throwing.
 *
 * An empty string is also accepted for `palette` and means "this layout's
 * default", which is what a page published before palettes existed carries.
 */
export const STOREFRONT_PALETTE_KEYS = [
	'acid',
	'arcade',
	'beetroot',
	'blueprint',
	'brutal',
	'charcoal-room',
	'concrete',
	'earth-green-yellow',
	'harvest-gold',
	'hi-vis',
	'holo-night',
	'ink-blue',
	'ink-paper',
	'inns-navy',
	'ledger-green',
	'live-red',
	'mint-condition',
	'neon',
	'night-loam',
	'night-market',
	'orange-pill',
	'oxblood',
	'parchment',
	'plaster-pink',
	'plebeian',
	'robing-room',
	'sage-cream',
	'sats-orange',
	'soft-pink',
	'spreadsheet',
	'white-cube',
	'year-end',
	// The five original fixed themes each carry exactly one palette, keyed by the
	// theme's own id. They are listed here so a page published against one still
	// validates after layouts gained palettes.
	'default',
	'midnight',
	'sunset',
	'forest',
	'mono',
] as const
export type StorefrontPaletteKey = (typeof STOREFRONT_PALETTE_KEYS)[number]

/**
 * The six tune axes, with the bounds the registry's sliders also render from.
 * These numbers are the *only* author-supplied styling input the format has,
 * so they are bounded here as a security property, not as validation polish:
 * every value that reaches the page is a number the app clamped.
 */
export const STOREFRONT_TUNE_BOUNDS = {
	radiusPx: { min: 0, max: 32, fallback: 12 },
	shadow: { min: 0, max: 1, fallback: 0.3 },
	glass: { min: 0, max: 1, fallback: 0.6 },
	spacing: { min: 0.75, max: 1.45, fallback: 1 },
	texture: { min: 0, max: 1, fallback: 0 },
	handmade: { min: 0, max: 1, fallback: 0 },
} as const

type TuneAxisKey = keyof typeof STOREFRONT_TUNE_BOUNDS

/**
 * One axis. Deliberately *cannot* fail: a missing value, a non-number, or an
 * out-of-range number all resolve to a usable value (fallback or clamped)
 * rather than rejecting the document. A page must not lose its theme — or its
 * title — because one slider value arrived garbled or from a newer client with
 * a wider range.
 */
function tuneAxis(key: TuneAxisKey) {
	const { min, max, fallback } = STOREFRONT_TUNE_BOUNDS[key]
	return z.preprocess(
		(value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback),
		z.number(),
	)
}

export const StorefrontThemeTuneSchema = z.object({
	radiusPx: tuneAxis('radiusPx'),
	shadow: tuneAxis('shadow'),
	glass: tuneAxis('glass'),
	spacing: tuneAxis('spacing'),
	texture: tuneAxis('texture'),
	handmade: tuneAxis('handmade'),
})

export type StorefrontThemeTune = z.infer<typeof StorefrontThemeTuneSchema>

/** The tune a page carries when it names none — mirrors `STOREFRONT_DEFAULT_TUNE`. */
export const STOREFRONT_TUNE_DEFAULTS: StorefrontThemeTune = {
	radiusPx: STOREFRONT_TUNE_BOUNDS.radiusPx.fallback,
	shadow: STOREFRONT_TUNE_BOUNDS.shadow.fallback,
	glass: STOREFRONT_TUNE_BOUNDS.glass.fallback,
	spacing: STOREFRONT_TUNE_BOUNDS.spacing.fallback,
	texture: STOREFRONT_TUNE_BOUNDS.texture.fallback,
	handmade: STOREFRONT_TUNE_BOUNDS.handmade.fallback,
}

/**
 * A palette key. Empty means "the chosen layout's default palette" and is what
 * a page published before palettes existed carries; any other value must be one
 * of the closed set. Written as a refined string rather than a literal union so
 * the picker can hold it as a plain string without losing the closed-set check.
 */
export const storefrontPaletteKeySchema = z
	.string()
	.max(64)
	.refine((value) => value === '' || (STOREFRONT_PALETTE_KEYS as readonly string[]).includes(value), {
		message: 'Unknown palette',
	})
	.default('')

/**
 * Page-level settings. Deliberately minimal: per-block width already exists, so
 * a page-level width control would be a second, conflicting answer to the same
 * question.
 *
 * `theme` picks a layout, `palette` picks one of that layout's curated
 * colourways, and `tune` refines it along six bounded axes. All three are
 * closed or bounded — see the notes on each closed list above.
 */
export const StorefrontRootPropsSchema = z.object({
	title: shortText.default(''),
	theme: z.enum(STOREFRONT_THEME_IDS).default('default'),
	palette: storefrontPaletteKeySchema,
	tune: StorefrontThemeTuneSchema.default(STOREFRONT_TUNE_DEFAULTS),
})

export type StorefrontRootProps = z.infer<typeof StorefrontRootPropsSchema>

/**
 * The document envelope.
 *
 * `content` is deliberately `unknown[]` here: the envelope must survive a
 * single bad block, so blocks are validated one at a time in
 * `parseStorefrontPage` rather than as an all-or-nothing array.
 */
export const StorefrontPageEnvelopeSchema = z.object({
	version: z.literal(STOREFRONT_PAGE_VERSION),
	/**
	 * Whether the page replaces the default profile view. Disabling keeps the
	 * document intact — R6 of ADR-019: the author never loses content by
	 * turning the page off, and never by losing a rented name either.
	 */
	enabled: z.boolean().default(false),
	root: z.object({ props: StorefrontRootPropsSchema.prefault({}) }).prefault({}),
	content: z.array(z.unknown()).default([]),
})

export interface StorefrontPage {
	version: typeof STOREFRONT_PAGE_VERSION
	enabled: boolean
	root: { props: StorefrontRootProps }
	content: StorefrontBlock[]
}

export interface StorefrontParseResult {
	page: StorefrontPage | null
	/** Blocks dropped because their type is unknown or their props failed validation. */
	droppedBlocks: number
	/** Set when the whole document was unusable; callers fall back to the profile view. */
	error: string | null
}

/** An empty, unpublished page — the starting point for a new author. */
export function createEmptyStorefrontPage(): StorefrontPage {
	return {
		version: STOREFRONT_PAGE_VERSION,
		enabled: false,
		root: { props: StorefrontRootPropsSchema.parse({}) },
		content: [],
	}
}

/**
 * Parses the root props one field at a time.
 *
 * This is what makes the fallback below a *per-field* fallback rather than an
 * all-or-nothing one: a `palette` key written by a newer client costs the
 * palette and nothing else. The page keeps its title and its layout. Parsing
 * the object as a whole would throw all three away over one unrecognised
 * string.
 */
export function parseStorefrontRootProps(candidate: unknown): StorefrontRootProps {
	const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : {}
	const shape = StorefrontRootPropsSchema.shape
	const props: Record<string, unknown> = {}
	for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
		const field = shape[key]
		const parsed = field.safeParse(record[key])
		props[key] = parsed.success ? parsed.data : field.parse(undefined)
	}
	return props as StorefrontRootProps
}

/**
 * Parses an event's `content` into a renderable page.
 *
 * Partial failure is normal and non-fatal, and it now applies at two levels:
 *
 *   - **Blocks** (as before): an unknown type or a prop that fails validation
 *     drops that one block and counts it; the rest of the page still renders.
 *   - **Root props** (`title`, `theme`): a value the schema rejects — e.g. a
 *     `theme` id outside the closed set — falls back to that field's default
 *     instead of invalidating the document. A page must not go dark because one
 *     enum value on the root object was garbled; only a bad *block* should ever
 *     cost the author that block, never the whole page.
 *
 * Only a structurally wrong document is total failure: unparseable JSON, a
 * non-object top level, or a `version` this build does not understand. Those
 * return `page: null` with a reason, which the route turns into the
 * profile-page fallback rather than an error screen.
 */
export function parseStorefrontPage(raw: string | null | undefined): StorefrontParseResult {
	if (typeof raw !== 'string' || raw.trim().length === 0) {
		return { page: null, droppedBlocks: 0, error: 'Empty page document' }
	}

	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch {
		return { page: null, droppedBlocks: 0, error: 'Page document is not valid JSON' }
	}

	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		return { page: null, droppedBlocks: 0, error: 'Page document does not match the expected format' }
	}
	const doc = json as Record<string, unknown>

	// The version gate stays strict and total: an incompatible document shape
	// cannot be salvaged field-by-field the way a bad block or a bad root prop
	// can, since the whole schema could have moved out from under it.
	if (doc.version !== STOREFRONT_PAGE_VERSION) {
		return { page: null, droppedBlocks: 0, error: 'Page document does not match the expected format' }
	}

	// A non-boolean `enabled` falls back to `false` (the safer reading) rather
	// than failing the document — an ambiguous "should this replace the
	// profile page" value must not resolve to "yes".
	const enabled = doc.enabled === true

	const rootCandidate =
		doc.root && typeof doc.root === 'object' && !Array.isArray(doc.root) ? (doc.root as Record<string, unknown>).props : undefined
	const root = { props: parseStorefrontRootProps(rootCandidate) }

	const rawContent = Array.isArray(doc.content) ? doc.content : []

	// Truncate before validating: a hostile document should not get to spend
	// validation time proportional to its own length.
	const candidates = rawContent.slice(0, STOREFRONT_LIMITS.maxBlocks)
	const overflow = Math.max(0, rawContent.length - candidates.length)

	const content: StorefrontBlock[] = []
	let droppedBlocks = overflow

	for (const candidate of candidates) {
		const block = StorefrontBlockSchema.safeParse(candidate)
		if (block.success) {
			content.push(block.data)
		} else {
			droppedBlocks += 1
		}
	}

	return {
		page: { version: STOREFRONT_PAGE_VERSION, enabled, root, content },
		droppedBlocks,
		error: null,
	}
}

/**
 * Validates a page the *author* is about to publish.
 *
 * Unlike `parseStorefrontPage`, this is strict: a block that would be silently
 * dropped at render time is reported as an error instead, so the author finds
 * out in the editor rather than by looking at a live page with a hole in it.
 */
export function validateStorefrontPageForPublish(page: unknown): { ok: true; page: StorefrontPage } | { ok: false; errors: string[] } {
	const envelope = StorefrontPageEnvelopeSchema.safeParse(page)
	if (!envelope.success) {
		return { ok: false, errors: envelope.error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`) }
	}

	if (envelope.data.content.length > STOREFRONT_LIMITS.maxBlocks) {
		return { ok: false, errors: [`A page may contain at most ${STOREFRONT_LIMITS.maxBlocks} blocks`] }
	}

	const errors: string[] = []
	const content: StorefrontBlock[] = []

	envelope.data.content.forEach((candidate, index) => {
		const block = StorefrontBlockSchema.safeParse(candidate)
		if (block.success) {
			content.push(block.data)
			return
		}
		const type =
			candidate && typeof candidate === 'object' && 'type' in candidate ? String((candidate as { type: unknown }).type) : 'unknown'
		const detail = block.error.issues.map((i) => `${i.path.join('.')} ${i.message}`.trim()).join('; ')
		errors.push(`Block ${index + 1} (${type}): ${detail}`)
	})

	if (errors.length > 0) return { ok: false, errors }

	return {
		ok: true,
		page: {
			version: STOREFRONT_PAGE_VERSION,
			enabled: envelope.data.enabled,
			root: envelope.data.root,
			content,
		},
	}
}
