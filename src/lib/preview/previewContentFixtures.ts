/**
 * Deterministic CONTENT fixture for a per-PR PREVIEW relay.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/seed-preview-settings.ts` (PR #1356) takes a fresh preview OUT of
 * `setup` mode, but the relay it writes to is still empty of *content*: the
 * home feed renders with no listings. This module defines the minimum set of
 * events that makes the preview's feed meaningful, with every kind and tag
 * justified against the app's own READ paths (file:line, verified in source —
 * nothing here is guessed):
 *
 *  - kind 30402 (product listing) — THE FEED. `fetchProducts` queries
 *    `kinds: [30402]` (`src/queries/products.tsx:141-145`) and
 *    `fetchProductsPaginated` does the same (`src/queries/products.tsx:185-190`).
 *    The home route renders them: `src/routes/index.tsx:43` ->
 *    `src/routes/index.tsx:148` (`<InfiniteProductList … />`) ->
 *    `src/components/InfiniteProductList.tsx:3` -> `ProductCard`
 *    (`src/components/ProductCard.tsx:98` `data-testid="product-card"`, title in
 *    the `<h2>` at `src/components/ProductCard.tsx:121-123`).
 *
 *    Two read-path predicates decide whether a seeded product is VISIBLE, and
 *    both are satisfied explicitly by `productTags()` below:
 *      * required tags `d` + `title` + `price`
 *        (`src/lib/schemas/productListing.ts:120-128`);
 *      * in stock — a `visibility` other than `hidden` plus a `stock` tag
 *        holding an integer > 0 (`src/queries/products.tsx:109-123`), because
 *        `fetchProducts` drops out-of-stock rows from card views
 *        (`src/queries/products.tsx:161-167`).
 *
 *  - kind 0 (profile metadata) — the sellers behind those listings.
 *    `src/queries/authors.tsx:29-32` fetches `kinds: [0]` filtered by
 *    `authors: [pubkey]`; consumed by `src/components/PostView.tsx:12` and by
 *    the profile/seller reads (`src/queries/products.tsx:1085`, "Profile
 *    events"). Without it every seeded listing renders as an anonymous key.
 *
 *  - kind 30405 (app-owned featured-products list, `d = featured_products`) —
 *    the ONLY legitimately APP-OWNED content in the fixture, signed with
 *    `APP_PRIVATE_KEY`. The home page renders a "Featured Products" section
 *    (`src/routes/index.tsx:144` -> `src/components/FeaturedSections.tsx:100`
 *    heading, `:42` product cards) fed by `fetchFeaturedProducts`, which reads
 *    kind `FEATURED_ITEMS_CONFIG.PRODUCTS.kind` == 30405, `d` ==
 *    `featured_products`, authored by the app pubkey, and takes the `a` tags
 *    starting `30402:` as the list contents (`src/queries/featured.tsx:16-33`,
 *    config at `src/lib/schemas/featured.ts:75-78`).
 *    It does NOT pollute the collections view: `fetchCollections` explicitly
 *    drops `d === featured_products` ("Filter out system collections")
 *    (`src/queries/collections.tsx:114-118`).
 *
 * DELIBERATELY NOT SEEDED
 * -----------------------
 *  - No AUCTION (would be kind 30408): this branch has NO auction read path —
 *    there is no `src/lib/auction/` module and no query file mentions 30408;
 *    the only reference is a doc comment in `src/lib/constants/testLabels.ts`
 *    and a "no-op until the auctions compatibility layer lands" note in
 *    `src/components/ShowTestListingsToggle.tsx:11-12`. Seeding one would be
 *    guessing at an unsupported kind.
 *  - No order / payment / shipping (kinds 30406, 30117, …): the feed does not
 *    read them; they are checkout-time state, not feed content.
 *
 * DETERMINISM
 * -----------
 * Every key, `d` tag, title, price, stock value and category is a CONSTANT here
 * or derived by SHA-256 from ONE documented seed string
 * (`PREVIEW_CONTENT_SEED_STRING`, default `plebeian-preview-content-v1`), so
 * two runs produce byte-identical event templates (and therefore identical
 * coordinates) modulo `created_at`. `created_at` deliberately defaults to "now"
 * so the preview listings sort newest-first — the app sorts descending
 * (`src/queries/products.tsx:148`) and, on the `production` stage the preview
 * runs, the relay pool also contains public relays; a stale timestamp would
 * push the preview content off the first chunk. A caller that needs fully
 * reproducible ids can pin `PREVIEW_CONTENT_CREATED_AT` (see
 * `scripts/seed-preview-content.ts`).
 *
 * Everything in this module is pure: no network, no relay, no side effects, so
 * `src/lib/__tests__/preview-content-fixtures.test.ts` can validate it against
 * the app's own schema and feed predicates.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey, type EventTemplate } from 'nostr-tools/pure'

/** One documented seed string; every preview key derives from it. */
export const PREVIEW_CONTENT_SEED_STRING = process.env.PREVIEW_CONTENT_SEED_STRING || 'plebeian-preview-content-v1'

/**
 * Marker every fixture event carries in `content` (and every product in its
 * `title`), so nobody mistakes preview data for real data. Also used as a `t`
 * tag — NOT as a NIP-32 label: ADR-0009 test-label filtering only removes
 * events that an authorized admin has labelled with a kind-1985 event
 * (`src/queries/products.tsx:153-154` -> `excludeTestLabeledEvents`), which
 * this fixture never publishes, so the preview listings stay visible.
 */
export const PREVIEW_CONTENT_LABEL = 'PREVIEW SEED'

export const KIND_PROFILE = 0
export const KIND_PRODUCT = 30402
export const KIND_FEATURED_PRODUCTS = 30405
export const FEATURED_PRODUCTS_D_TAG = 'featured_products'

/** Every preview fixture is on-sale at a non-zero stock level (see header). */
export const PREVIEW_VISIBILITY = 'on-sale'

export type PreviewActorId = 'seller-1' | 'seller-2' | 'buyer-1'

export interface PreviewActor {
	/** Stable id — part of the key-derivation string. */
	id: PreviewActorId
	/** `seller` owns listings; `buyer` exists so order/dashboard paths have a counterparty. */
	role: 'seller' | 'buyer'
	/** Rendered profile name (`kind 0`). */
	name: string
	about: string
	picture: string
	secretKey: Uint8Array
	pubkey: string
}

/**
 * Derive an actor's secret key from the documented seed string.
 *
 * `sha256("<seed>:actor:<id>")` — deterministic, documented, and never a real
 * user's key. The actor id is the only input besides the seed, so a fresh
 * preview relay gets the same three authors every time.
 */
export function derivePreviewSecretKey(actorId: string): Uint8Array {
	return sha256(new TextEncoder().encode(`${PREVIEW_CONTENT_SEED_STRING}:actor:${actorId}`))
}

const ACTOR_DEFINITIONS: Array<Omit<PreviewActor, 'secretKey' | 'pubkey'>> = [
	{
		id: 'seller-1',
		role: 'seller',
		name: 'Preview Seller One',
		about: `${PREVIEW_CONTENT_LABEL} fixture seller — a deterministic preview key, not a real person.`,
		picture: 'https://placehold.co/256x256/png?text=PREVIEW+SELLER+1',
	},
	{
		id: 'seller-2',
		role: 'seller',
		name: 'Preview Seller Two',
		about: `${PREVIEW_CONTENT_LABEL} fixture seller — a deterministic preview key, not a real person.`,
		picture: 'https://placehold.co/256x256/png?text=PREVIEW+SELLER+2',
	},
	{
		id: 'buyer-1',
		role: 'buyer',
		name: 'Preview Buyer',
		about: `${PREVIEW_CONTENT_LABEL} fixture buyer — a deterministic preview key, not a real person.`,
		picture: 'https://placehold.co/256x256/png?text=PREVIEW+BUYER',
	},
]

export const previewActors: PreviewActor[] = ACTOR_DEFINITIONS.map((actor) => {
	const secretKey = derivePreviewSecretKey(actor.id)
	return { ...actor, secretKey, pubkey: getPublicKey(secretKey) }
})

export function previewActor(id: PreviewActorId): PreviewActor {
	const actor = previewActors.find((candidate) => candidate.id === id)
	if (!actor) throw new Error(`Unknown preview actor: ${id}`)
	return actor
}

export interface PreviewProductFixture {
	authorId: PreviewActorId
	/** Addressable identifier — stable forever, this is the idempotency key. */
	dTag: string
	title: string
	summary: string
	description: string
	/** Decimal string, validated by the app's price schema. */
	priceAmount: string
	/** ISO 4217 (3 uppercase letters) — `src/lib/schemas/common.ts:5`. */
	priceCurrency: string
	stock: number
	type: 'physical' | 'digital'
	category: string
	imageUrl: string
}

/**
 * Five products across two preview sellers: enough for a feed grid, few enough
 * to eyeball. Prices/stock are constants; `type` covers both physical and
 * digital so both card variants render.
 */
export const previewProducts: PreviewProductFixture[] = [
	{
		authorId: 'seller-1',
		dTag: 'preview-seed-lamp',
		title: `${PREVIEW_CONTENT_LABEL} — Desk Lamp (fixture)`,
		summary: `${PREVIEW_CONTENT_LABEL} fixture listing; not a real product.`,
		description: `${PREVIEW_CONTENT_LABEL} fixture listing seeded by scripts/seed-preview-content.ts. It exists only so the preview feed has listings to render. Do not buy it; there is nothing to ship.`,
		priceAmount: '12.50',
		priceCurrency: 'USD',
		stock: 7,
		type: 'physical',
		category: 'home',
		imageUrl: 'https://placehold.co/600x600/png?text=PREVIEW+SEED+LAMP',
	},
	{
		authorId: 'seller-1',
		dTag: 'preview-seed-mug',
		title: `${PREVIEW_CONTENT_LABEL} — Ceramic Mug (fixture)`,
		summary: `${PREVIEW_CONTENT_LABEL} fixture listing; not a real product.`,
		description: `${PREVIEW_CONTENT_LABEL} fixture listing seeded by scripts/seed-preview-content.ts for the per-PR preview relay.`,
		priceAmount: '6.00',
		priceCurrency: 'USD',
		stock: 12,
		type: 'physical',
		category: 'kitchen',
		imageUrl: 'https://placehold.co/600x600/png?text=PREVIEW+SEED+MUG',
	},
	{
		authorId: 'seller-1',
		dTag: 'preview-seed-notebook',
		title: `${PREVIEW_CONTENT_LABEL} — Pocket Notebook (fixture)`,
		summary: `${PREVIEW_CONTENT_LABEL} fixture listing; not a real product.`,
		description: `${PREVIEW_CONTENT_LABEL} fixture listing seeded by scripts/seed-preview-content.ts for the per-PR preview relay.`,
		priceAmount: '4.25',
		priceCurrency: 'USD',
		stock: 20,
		type: 'physical',
		category: 'stationery',
		imageUrl: 'https://placehold.co/600x600/png?text=PREVIEW+SEED+NOTEBOOK',
	},
	{
		authorId: 'seller-2',
		dTag: 'preview-seed-sticker-pack',
		title: `${PREVIEW_CONTENT_LABEL} — Sticker Pack (fixture)`,
		summary: `${PREVIEW_CONTENT_LABEL} fixture listing; not a real product.`,
		description: `${PREVIEW_CONTENT_LABEL} fixture listing seeded by scripts/seed-preview-content.ts for the per-PR preview relay.`,
		priceAmount: '3.00',
		priceCurrency: 'USD',
		stock: 50,
		type: 'physical',
		category: 'accessories',
		imageUrl: 'https://placehold.co/600x600/png?text=PREVIEW+SEED+STICKERS',
	},
	{
		authorId: 'seller-2',
		dTag: 'preview-seed-ebook',
		title: `${PREVIEW_CONTENT_LABEL} — Test E-book (fixture)`,
		summary: `${PREVIEW_CONTENT_LABEL} fixture listing; not a real product.`,
		description: `${PREVIEW_CONTENT_LABEL} fixture listing seeded by scripts/seed-preview-content.ts for the per-PR preview relay. Digital variant.`,
		priceAmount: '9.99',
		priceCurrency: 'USD',
		stock: 999,
		type: 'digital',
		category: 'books',
		imageUrl: 'https://placehold.co/600x600/png?text=PREVIEW+SEED+EBOOK',
	},
]

/** The titles the browser must render — the e2e assertion reads this list. */
export const previewProductTitles: string[] = previewProducts.map((product) => product.title)

/**
 * Deterministic tag list for one product. Order is fixed so two runs produce
 * byte-identical templates.
 */
export function productTags(product: PreviewProductFixture): string[][] {
	return [
		['d', product.dTag],
		['title', product.title],
		['summary', product.summary],
		['price', product.priceAmount, product.priceCurrency],
		['type', 'simple', product.type],
		['visibility', PREVIEW_VISIBILITY],
		['stock', String(product.stock)],
		// Category tag read by the category filter (`src/lib/schemas/productListing.ts:67`).
		['t', product.category],
		// Greppable marker so preview rows are obvious in relay dumps.
		['t', 'preview-seed'],
		['image', product.imageUrl],
		['location', 'Preview Relay (fixture)'],
	]
}

export function productTemplate(
	product: PreviewProductFixture,
	authorPubkey: string,
	createdAt: number,
): EventTemplate & { pubkey: string } {
	return {
		kind: KIND_PRODUCT,
		created_at: createdAt,
		pubkey: authorPubkey,
		content: product.description,
		tags: productTags(product),
	}
}

/** `30402:<author pubkey>:<d tag>` — the addressable coordinate. */
export function productCoordinate(product: PreviewProductFixture, authorPubkey: string): string {
	return `${KIND_PRODUCT}:${authorPubkey}:${product.dTag}`
}

/** `kind 0` content: the fields the app's author transform reads (`src/queries/authors.tsx:16-22`). */
export function profileContent(actor: PreviewActor): string {
	return JSON.stringify({
		name: actor.name,
		displayName: actor.name,
		about: actor.about,
		picture: actor.picture,
		// No nip05/lud16 on purpose: those fields make clients resolve external
		// endpoints, and a preview fixture must not depend on third parties.
	})
}

export function profileTags(actor: PreviewActor): string[][] {
	return [
		['name', actor.name],
		['about', actor.about],
		['picture', actor.picture],
	]
}

export function profileTemplate(actor: PreviewActor, createdAt: number): EventTemplate {
	return {
		kind: KIND_PROFILE,
		created_at: createdAt,
		content: profileContent(actor),
		tags: profileTags(actor),
	}
}

/**
 * App-owned featured-products list (`kind 30405`, `d = featured_products`),
 * signed with `APP_PRIVATE_KEY`. Contents are `a` tags pointing at the seeded
 * product coordinates (`src/queries/featured.tsx:26`).
 */
export function featuredProductsTemplate(appPubkey: string, productCoords: string[], createdAt: number): EventTemplate {
	return {
		kind: KIND_FEATURED_PRODUCTS,
		created_at: createdAt,
		content: '',
		tags: [
			['d', FEATURED_PRODUCTS_D_TAG],
			['title', `${PREVIEW_CONTENT_LABEL} — Featured Products (fixture)`],
			['t', 'preview-seed'],
			...productCoords.map((coords) => ['a', coords]),
		],
	}
}

/** Identity of every event the seeder is responsible for. */
export interface PreviewExpectedEvent {
	/** Human label used in logs. */
	label: string
	kind: number
	/** Author pubkey, already derived. */
	pubkey: string
	/** Addressable id (`d` tag) when the kind is addressable. */
	dTag?: string
	/** Filter the idempotency probe sends to the relay. */
	filter: { kinds: number[]; authors?: string[]; '#d'?: string[]; limit: number }
}

/**
 * The full fixture as relay-level expectations. `appPubkey` is the preview app
 * key (from `APP_PRIVATE_KEY`), needed for the app-owned featured list.
 */
export function expectedPreviewEvents(appPubkey: string): PreviewExpectedEvent[] {
	const events: PreviewExpectedEvent[] = []

	for (const actor of previewActors) {
		events.push({
			label: `profile ${actor.id}`,
			kind: KIND_PROFILE,
			pubkey: actor.pubkey,
			filter: { kinds: [KIND_PROFILE], authors: [actor.pubkey], limit: 1 },
		})
	}

	for (const product of previewProducts) {
		const author = previewActor(product.authorId)
		events.push({
			label: `product ${product.dTag}`,
			kind: KIND_PRODUCT,
			pubkey: author.pubkey,
			dTag: product.dTag,
			filter: { kinds: [KIND_PRODUCT], authors: [author.pubkey], '#d': [product.dTag], limit: 1 },
		})
	}

	events.push({
		label: 'featured products list',
		kind: KIND_FEATURED_PRODUCTS,
		pubkey: appPubkey,
		dTag: FEATURED_PRODUCTS_D_TAG,
		filter: { kinds: [KIND_FEATURED_PRODUCTS], authors: [appPubkey], '#d': [FEATURED_PRODUCTS_D_TAG], limit: 1 },
	})

	return events
}

/** Log line printed for run 1 and for the dry run. */
export function describeFixture(appPubkey: string): string {
	const lines = [
		`${PREVIEW_CONTENT_LABEL} fixture`,
		`  seed string   : ${PREVIEW_CONTENT_SEED_STRING}`,
		`  app pubkey    : ${appPubkey}`,
		...previewActors.map((actor) => `  ${actor.role.padEnd(6)} ${actor.id.padEnd(9)} ${actor.pubkey}`),
		...previewProducts.map(
			(product) =>
				`  30402  ${previewActor(product.authorId).id.padEnd(9)} ${product.dTag.padEnd(22)} ${product.priceAmount} ${product.priceCurrency}`,
		),
		`  30405  app        ${FEATURED_PRODUCTS_D_TAG} (${previewProducts.length} featured products)`,
	]
	return lines.join('\n')
}
