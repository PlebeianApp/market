/**
 * Open Graph / Twitter Card tag building for server-rendered product previews.
 *
 * These helpers are pure (no DOM, no network) so the server entry can inject
 * product preview tags into the initial HTML response for /products/:id, and
 * unit tests can assert on rendered output without a relay.
 *
 * Tag derivations mirror the client-side `useDocumentMeta` hook in
 * `src/routes/products.$productId.tsx` (kind 30402 tag conventions):
 * title from the `title` tag, description from event content, first `image`
 * tag (sorted by optional order), price/currency from the `price` tag, and
 * NSFW detection from the `content-warning` tag (NIP-15 hyphenated form).
 */

export interface OgProductMeta {
	title: string
	description: string
	imageUrl?: string
	price?: number
	currency?: string
}

/**
 * Static, never-a-product title restored to `document.title` when a product
 * route unmounts or its meta config changes. Deliberately not a snapshot of
 * the previous product's title (see removeOwnedOgMetaTags / useDocumentMeta).
 */
export const DEFAULT_DOCUMENT_TITLE = 'Plebeian Market'

/**
 * Complete list of og:/twitter:/product:/description selectors that the
 * product route owns while mounted. Cleanup removes ALL of these via
 * {@link removeOwnedOgMetaTags} rather than restoring remembered content, so
 * no tag from a previously-viewed product can leak onto the next route
 * (see Blocker 2 — stale-restore fix).
 */
export const OG_OWNED_META_SELECTORS = [
	'meta[property="og:type"]',
	'meta[property="og:title"]',
	'meta[property="og:description"]',
	'meta[property="og:url"]',
	'meta[property="og:site_name"]',
	'meta[property="og:image"]',
	'meta[property="product:price:amount"]',
	'meta[property="product:price:currency"]',
	'meta[name="twitter:card"]',
	'meta[name="twitter:title"]',
	'meta[name="twitter:description"]',
	'meta[name="twitter:image"]',
	'meta[name="description"]',
] as const

/** The tag descriptors emitted by the product route's meta hook. Mirrors the
 * attribute keys the route can write, so OG_OWNED_META_SELECTORS stays
 * exactly in sync (drift guard). */
export const OG_OWNED_META_TAGS = OG_OWNED_META_SELECTORS.map((sel) => {
	const m = sel.match(/^meta\[(property|name)="(.+)"\]$/)
	if (!m) throw new Error(`Unexpected owned selector: ${sel}`)
	return { attr: m[1] as 'property' | 'name', key: m[2] }
})

/**
 * The branded meta attributes the product page may write for a given source
 * (title/description/image/price/currency). `useDocumentMeta` iterates this
 * list to emit tags, so the drift-guard unit test can assert the owned
 * selector list covers exactly these.
 */
export interface OwnedMetaSource {
	title: string
	description: string
	image?: string
	url: string
	price?: number
	currency?: string
}

export function buildOwnedMetaEmissions(source: OwnedMetaSource): Array<{ attr: 'property' | 'name'; key: string }> {
	const emissions: Array<{ attr: 'property' | 'name'; key: string }> = [
		{ attr: 'property', key: 'og:type' },
		{ attr: 'property', key: 'og:title' },
		{ attr: 'property', key: 'og:description' },
		{ attr: 'property', key: 'og:url' },
		{ attr: 'property', key: 'og:site_name' },
	]
	if (source.image) emissions.push({ attr: 'property', key: 'og:image' })
	if (source.price !== undefined && source.currency) {
		emissions.push({ attr: 'property', key: 'product:price:amount' }, { attr: 'property', key: 'product:price:currency' })
	}
	emissions.push(
		{ attr: 'name', key: 'twitter:card' },
		{ attr: 'name', key: 'twitter:title' },
		{ attr: 'name', key: 'twitter:description' },
	)
	if (source.image) emissions.push({ attr: 'name', key: 'twitter:image' })
	emissions.push({ attr: 'name', key: 'description' })
	return emissions
}

/**
 * Minimal structural interface so `removeOwnedOgMetaTags` is unit-testable
 * with a fake head in bun without a DOM. `ArrayLike` matches both a real DOM
 * `NodeListOf` (from `document.head.querySelectorAll`) and a plain test
 * `Array`, and indexes cleanly without a downlevel-iteration flag.
 */
export interface HeadLike {
	querySelectorAll(sel: string): ArrayLike<{ remove(): void }>
}

/**
 * Remove every element matching {@link OG_OWNED_META_SELECTORS} from `head`,
 * returning how many were removed. Selector-based and complete, so duplicates
 * can never survive cleanup (the A→B→A duplicate guard).
 */
export function removeOwnedOgMetaTags(head: HeadLike): number {
	let removed = 0
	for (const sel of OG_OWNED_META_SELECTORS) {
		const els = head.querySelectorAll(sel)
		for (let i = 0; i < els.length; i++) {
			els[i].remove()
			removed++
		}
	}
	return removed
}

/**
 * Resolve the server-controlled shell origin and the canonical public origin.
 * Neither is ever derived from an incoming request (Blocker 1): shellOrigin
 * is `APP_SHELL_ORIGIN` or a fixed loopback; publicOrigin is
 * `APP_PUBLIC_ORIGIN` or falls back to shellOrigin.
 */
export interface ServerOriginsEnv {
	APP_SHELL_ORIGIN?: string
	APP_PUBLIC_ORIGIN?: string
}

export interface ServerOrigins {
	shellOrigin: string
	publicOrigin: string
}

export function resolveServerOrigins(env: ServerOriginsEnv, port: number): ServerOrigins {
	const shell = env.APP_SHELL_ORIGIN?.trim()
	const publicOrigin = env.APP_PUBLIC_ORIGIN?.trim()
	const shellOrigin = shell || `http://localhost:${port}`
	return {
		shellOrigin,
		publicOrigin: publicOrigin || shellOrigin,
	}
}

/**
 * The shell URL the server fetches itself to obtain the SPA shell. Takes no
 * request argument — the fetch destination cannot be influenced by a hostile
 * `Host` header.
 */
export function resolveShellUrl(env: ServerOriginsEnv, port: number): string {
	return new URL('/', resolveServerOrigins(env, port).shellOrigin).toString()
}

/** Context passed to {@link serveProductPageWithOg}, all server-controlled. */
export interface ServeProductOgContext<Shell extends Response | object> {
	shellOrigin: string
	publicOrigin: string
	relayUrl: string | undefined
	/** The fallback shell served on shell-fetch failure. In practice Bun's
	 * `./index.html` HTML bundle (the same value used by the `/*` catch-all
	 * route); typed generic so any fetchable Response also works. */
	indexShell: Shell
	getProductOgMeta: (relayUrl: string | undefined, productId: string) => Promise<OgProductMeta | null>
}

/**
 * Serve `/products/:productId` HTML: fetch the module shell from the
 * server-controlled origin, inject og:/twitter:/product: meta, and degrade
 * gracefully — on ANY shell-fetch failure, and on ANY enrichment failure
 * (lookup rejection or render throw, not just a null miss), the untouched
 * module shell is served with HTTP 200, so an SEO-only enrichment failure can
 * never 5xx the product page. `fetcher` is injectable (default global fetch)
 * for unit testing the shell-failure path without a server.
 */
export async function serveProductPageWithOg<Shell extends Response | object>(
	productId: string,
	ctx: ServeProductOgContext<Shell>,
	fetcher: (url: URL | string, init?: RequestInit) => Promise<{ ok: boolean; text(): Promise<string> }> = fetch,
): Promise<Response | Shell> {
	let baseHtml: string | null = null
	try {
		const res = await fetcher(new URL('/', ctx.shellOrigin), { signal: AbortSignal.timeout(2_500) })
		if (res.ok) baseHtml = await res.text()
	} catch (e) {
		// SEO-only enrichment: never let shell acquisition take down the page.
		console.warn('og: shell fetch failed, serving module shell:', e)
	}
	if (baseHtml === null) return ctx.indexShell

	try {
		const meta = await ctx.getProductOgMeta(ctx.relayUrl, productId)
		return new Response(renderProductPageHtml(baseHtml, meta, `${ctx.publicOrigin}/products/${productId}`, ctx.publicOrigin), {
			headers: {
				'Content-Type': 'text/html;charset=utf-8',
				'Cache-Control': 'no-cache',
			},
		})
	} catch (e) {
		// A rejected lookup or a render throw is an enrichment failure like any
		// other: serve the plain product page rather than propagating a 5xx.
		console.warn('og: enrichment failed, serving module shell:', e)
		return ctx.indexShell
	}
}

/** Minimal shape of a kind 30402 product event needed to derive preview meta. */
export interface OgTagSourceEvent {
	content: string
	tags: string[][]
}

const NSFW_CONTENT_WARNING = 'nsfw'

/**
 * Truncate a string to at most `maxCodePoints` Unicode code points,
 * appending an ellipsis when truncation occurs. Code-point-safe so emoji
 * and other astral characters are never split into invalid halves.
 */
export function truncateForMeta(value: string, maxCodePoints: number): string {
	const codePoints = Array.from(value)
	if (codePoints.length <= maxCodePoints) return value
	return `${codePoints.slice(0, maxCodePoints).join('')}...`
}

/** Escape a string for safe embedding in a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Resolve a product image URL against the serving origin. Returns undefined
 * for values that cannot form a valid absolute og:image URL.
 */
export function absolutizeImageUrl(raw: string | undefined, origin: string): string | undefined {
	if (!raw) return undefined
	if (/^https?:\/\//i.test(raw)) return raw
	if (raw.startsWith('/')) return `${origin}${raw}`
	return undefined
}

function findTag(event: OgTagSourceEvent, name: string): string[] | undefined {
	return event.tags.find((tag) => tag[0] === name)
}

function findFirstImageUrl(event: OgTagSourceEvent): string | undefined {
	const imageTags = event.tags.filter((tag) => tag[0] === 'image')
	if (imageTags.length === 0) return undefined

	// Mirror getProductImages: order by the optional 4th element when present.
	imageTags.sort((a, b) => {
		if (a[3] && b[3]) {
			const aOrder = Number.parseInt(a[3], 10)
			const bOrder = Number.parseInt(b[3], 10)
			if (Number.isFinite(aOrder) && Number.isFinite(bOrder)) return aOrder - bOrder
		}
		return 0
	})

	return imageTags[0]?.[1] || undefined
}

/** True when the product carries the `content-warning` NSFW marker. */
export function isNsfwProductEvent(event: OgTagSourceEvent): boolean {
	return findTag(event, 'content-warning')?.[1] === NSFW_CONTENT_WARNING
}

/**
 * Derive preview meta from a product event. Returns null for NSFW products
 * so gated titles/descriptions/images never reach <head> — mirroring the
 * client-side NSFW content gate.
 */
export function buildOgProductMeta(event: OgTagSourceEvent): OgProductMeta | null {
	if (isNsfwProductEvent(event)) return null

	const title = findTag(event, 'title')?.[1] || 'Untitled Product'
	const description = event.content || ''
	const imageUrl = findFirstImageUrl(event)

	const priceTag = findTag(event, 'price')
	const parsedPrice = priceTag ? Number.parseFloat(priceTag[1] ?? '') : NaN
	const price = Number.isFinite(parsedPrice) ? parsedPrice : undefined
	const currency = priceTag?.[2] || undefined

	return {
		title,
		description,
		imageUrl,
		...(price !== undefined ? { price } : {}),
		...(currency ? { currency } : {}),
	}
}

/**
 * Build the og:, twitter:, and description <meta> block for a product preview.
 * `url` must already be absolute; `imageUrl`, when provided, must be absolute
 * (see absolutizeImageUrl).
 */
export function buildOgMetaTagsHtml(meta: OgProductMeta, url: string, origin: string): string {
	const title = escapeHtmlAttribute(meta.title)
	const description = escapeHtmlAttribute(truncateForMeta(meta.description, 160))
	const imageUrl = absolutizeImageUrl(meta.imageUrl, origin)
	const encodedUrl = escapeHtmlAttribute(url)

	const lines: string[] = [
		'\t\t<!-- Product social preview (server-injected) -->',
		`\t\t<meta property="og:type" content="product" />`,
		`\t\t<meta property="og:title" content="${title}" />`,
		`\t\t<meta property="og:description" content="${description}" />`,
		`\t\t<meta property="og:url" content="${encodedUrl}" />`,
		`\t\t<meta property="og:site_name" content="Plebeian Market" />`,
	]

	if (imageUrl) {
		const encodedImage = escapeHtmlAttribute(imageUrl)
		lines.push(`\t\t<meta property="og:image" content="${encodedImage}" />`)
	}

	if (meta.price !== undefined && meta.currency) {
		lines.push(`\t\t<meta property="product:price:amount" content="${meta.price}" />`)
		lines.push(`\t\t<meta property="product:price:currency" content="${escapeHtmlAttribute(meta.currency)}" />`)
	}

	const twitterDescription =
		meta.price !== undefined && meta.currency
			? `${truncateForMeta(meta.description, 160)} - ${meta.price} ${meta.currency}`
			: truncateForMeta(meta.description, 160)

	lines.push(`\t\t<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}" />`)
	lines.push(`\t\t<meta name="twitter:title" content="${title}" />`)
	lines.push(`\t\t<meta name="twitter:description" content="${escapeHtmlAttribute(twitterDescription)}" />`)

	if (imageUrl) {
		lines.push(`\t\t<meta name="twitter:image" content="${escapeHtmlAttribute(imageUrl)}" />`)
	}

	lines.push(`\t\t<meta name="description" content="${description}" />`)

	return lines.join('\n')
}

/**
 * Insert a block of HTML immediately before the first `</head>` occurrence.
 * Returns the input unchanged when no `</head>` is present (nothing to
 * anchor the injection to — the page is served as-is).
 */
export function injectIntoHead(html: string, block: string): string {
	const headEnd = html.indexOf('</head>')
	if (headEnd === -1) return html
	return `${html.slice(0, headEnd)}${block}${html.slice(headEnd)}`
}

/**
 * Render the final product-page HTML: baseHtml plus og: meta tags when meta
 * is available (null meta — fetch miss, timeout, or NSFW gating — serves the
 * untouched base HTML, so the SPA always loads).
 */
export function renderProductPageHtml(baseHtml: string, meta: OgProductMeta | null, productUrl: string, origin: string): string {
	if (!meta) return baseHtml
	return injectIntoHead(baseHtml, buildOgMetaTagsHtml(meta, productUrl, origin))
}
