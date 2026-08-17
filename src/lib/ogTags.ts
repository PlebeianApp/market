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
 * NSFW detection from the `content_warning` tag.
 */

export interface OgProductMeta {
	title: string
	description: string
	imageUrl?: string
	price?: number
	currency?: string
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

/** True when the product carries the `content_warning` NSFW marker. */
export function isNsfwProductEvent(event: OgTagSourceEvent): boolean {
	return findTag(event, 'content_warning')?.[1] === NSFW_CONTENT_WARNING
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
