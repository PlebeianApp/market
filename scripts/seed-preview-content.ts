/**
 * Seed a PREVIEW relay with CONTENT — the listings a preview feed needs to stop
 * being empty.
 *
 * Companion to `scripts/seed-preview-settings.ts` (PR #1356): that script takes
 * a fresh preview OUT of `setup` mode; this one gives the relay something to
 * RENDER. It is the same shape on purpose — same env contract (`APP_RELAY_URL`,
 * `APP_PRIVATE_KEY`), same idempotency contract, same terminal-state printing —
 * so both can sit in the preview deploy job and behave identically on redeploy.
 *
 * KINDS WRITTEN (each justified against the app's read paths in
 * `src/lib/preview/previewContentFixtures.ts`, with file:line):
 *   - kind 30402 product listings, authored by two DETERMINISTIC preview seller
 *     keys derived from a documented seed string (NOT the app key) — the home
 *     feed's own filter (`src/queries/products.tsx:141-145`);
 *   - kind 0 profile metadata for those sellers (plus a buyer counterparty) —
 *     `src/queries/authors.tsx:29-32`;
 *   - kind 30405 `d=featured_products`, authored by the APP key, listing the
 *     seeded products — the app-owned featured list rendered on `/`
 *     (`src/routes/index.tsx:144`, `src/queries/featured.tsx:16-33`).
 * No auction: this branch has no auction read path (see the fixtures header).
 *
 * IDEMPOTENT: before publishing anything it REQs the relay for the exact
 * coordinates it owns. If every one is already present it publishes NOTHING and
 * prints the single line `already-seeded`. Otherwise it publishes only the
 * missing events and prints `seeded`. Redeploys therefore never duplicate state
 * and never overwrite what an earlier run wrote.
 *
 * MACHINE-READABLE OUTPUT: one JSON line per event
 * (`{"event":"published|present","kind":…,"id":…,"pubkey":…,"d":…}`) followed by
 * one `SUMMARY {…}` JSON line. The bare `seeded` / `already-seeded` token stays
 * on its own line so a workflow can grep it exactly like the settings seeder's.
 *
 * SIDE EFFECTS: opens ONE WebSocket to `APP_RELAY_URL` and publishes the fixture
 * above. Nothing else — no file writes, no other relay, no network beyond that
 * socket. It REFUSES to run against a relay whose host is not a preview host
 * (see `PREVIEW_SEED_ALLOWED_HOST_SUFFIX`) so it can never be pointed at
 * production/staging/auctionsdev by accident.
 *
 * ENV
 *   APP_RELAY_URL                    (required) e.g. wss://pr1363.test-market.orangesync.tech/relay
 *   APP_PRIVATE_KEY                  (required) preview app key — signs the featured list only
 *   PREVIEW_CONTENT_SEED_STRING      (optional) default 'plebeian-preview-content-v1'
 *   PREVIEW_CONTENT_CREATED_AT       (optional) unix seconds to stamp on published events; default now
 *   PREVIEW_CONTENT_DRY_RUN          (optional) '1' prints the plan and publishes nothing
 *   PREVIEW_SEED_ALLOWED_HOST_SUFFIX (optional) default '.test-market.orangesync.tech'
 */
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import {
	FEATURED_PRODUCTS_D_TAG,
	KIND_FEATURED_PRODUCTS,
	KIND_PRODUCT,
	KIND_PROFILE,
	PREVIEW_CONTENT_LABEL,
	PREVIEW_CONTENT_SEED_STRING,
	describeFixture,
	expectedPreviewEvents,
	featuredProductsTemplate,
	previewActor,
	previewProducts,
	productCoordinate,
	productTemplate,
	profileTemplate,
	type PreviewActor,
	type PreviewActorId,
	type PreviewExpectedEvent,
} from '@/lib/preview/previewContentFixtures'

/** Minimal structural type for a relay subscription (nostr-tools' `Subscription`). */
type ClosableSubscription = { close: () => void }

const RELAY_URL = process.env.APP_RELAY_URL
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY
const DRY_RUN = process.env.PREVIEW_CONTENT_DRY_RUN === '1'
const CREATED_AT = process.env.PREVIEW_CONTENT_CREATED_AT ? Number(process.env.PREVIEW_CONTENT_CREATED_AT) : Math.floor(Date.now() / 1000)

/** Preview hosts only. A real relay can only be seeded by opting in explicitly. */
const ALLOWED_HOST_SUFFIX = process.env.PREVIEW_SEED_ALLOWED_HOST_SUFFIX || '.test-market.orangesync.tech'

/** Relay answers that mean "this event is already on the relay". */
const ALREADY_PRESENT_REASONS = ['duplicate', 'already have this event']

function fail(message: string): never {
	console.error(`seed-preview-content: ${message}`)
	process.exit(1)
}

/**
 * Preview-only interlock: refuse any relay host that is not a preview host.
 * Content written to a real market would be real-looking junk, so the script
 * fails closed instead of trusting the caller.
 */
function assertPreviewRelay(url: string): string {
	let host: string
	try {
		host = new URL(url).host
	} catch {
		fail(`APP_RELAY_URL is not a valid URL: ${url}`)
	}
	if (host === ALLOWED_HOST_SUFFIX.replace(/^\./, '') || host.endsWith(ALLOWED_HOST_SUFFIX)) return host
	fail(
		`refusing to seed ${host}: this script only writes to preview relays ` +
			`(host must end with '${ALLOWED_HOST_SUFFIX}'). ` +
			'Override PREVIEW_SEED_ALLOWED_HOST_SUFFIX only for a deliberately chosen non-production relay.',
	)
}

/** True when at least one event matching `filter` is already on the relay. */
async function queryExists(relay: Relay, filter: PreviewExpectedEvent['filter'], timeoutMs = 5000): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false
		let sub: ClosableSubscription | undefined
		const finish = (exists: boolean) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			sub?.close()
			resolve(exists)
		}
		const timer = setTimeout(() => finish(false), timeoutMs)
		sub = relay.subscribe([filter], {
			onevent: () => finish(true),
			oneose: () => finish(false),
		})
	})
}

/**
 * Template + signing key for one expected event. Products and profiles are
 * signed with the DERIVED preview actor keys (user-owned events); the featured
 * list is the one app-owned event, signed with APP_PRIVATE_KEY.
 */
function signedFixture(event: PreviewExpectedEvent, appSecretKey: Uint8Array, appPubkey: string) {
	if (event.kind === KIND_PROFILE) {
		const actor = previewActor(event.label.replace('profile ', '') as PreviewActorId)
		return { template: profileTemplate(actor, CREATED_AT), secretKey: actor.secretKey, owner: actor.id }
	}
	if (event.kind === KIND_PRODUCT) {
		const product = previewProducts.find((candidate) => candidate.dTag === event.dTag)
		if (!product) fail(`unknown product fixture: ${event.dTag}`)
		const actor: PreviewActor = previewActor(product.authorId)
		return { template: productTemplate(product, actor.pubkey, CREATED_AT), secretKey: actor.secretKey, owner: actor.id }
	}
	if (event.kind === KIND_FEATURED_PRODUCTS) {
		const coords = previewProducts.map((product) => productCoordinate(product, previewActor(product.authorId).pubkey))
		return { template: featuredProductsTemplate(appPubkey, coords, CREATED_AT), secretKey: appSecretKey, owner: 'app' }
	}
	fail(`unknown fixture kind: ${event.kind}`)
}

async function main(): Promise<void> {
	if (!RELAY_URL || !APP_PRIVATE_KEY) {
		fail('missing required environment variables: APP_RELAY_URL and APP_PRIVATE_KEY')
	}
	if (!Number.isFinite(CREATED_AT) || CREATED_AT <= 0) {
		fail(`PREVIEW_CONTENT_CREATED_AT must be unix seconds, got '${process.env.PREVIEW_CONTENT_CREATED_AT}'`)
	}

	const relayHost = assertPreviewRelay(RELAY_URL)
	const appSecretKey = hexToBytes(APP_PRIVATE_KEY)
	const appPubkey = getPublicKey(appSecretKey)

	console.log(`Seeding preview relay ${RELAY_URL} (host ${relayHost}) with '${PREVIEW_CONTENT_LABEL}' content`)
	console.log(describeFixture(appPubkey))

	const expected = expectedPreviewEvents(appPubkey)

	if (DRY_RUN) {
		for (const event of expected) {
			console.log(JSON.stringify({ event: 'dry-run', kind: event.kind, pubkey: event.pubkey, d: event.dTag ?? null, label: event.label }))
		}
		console.log(
			'SUMMARY ' +
				JSON.stringify({ state: 'dry-run', relay: RELAY_URL, app_pubkey: appPubkey, planned: expected.length, published: 0, present: 0 }),
		)
		return
	}

	const relay = await Relay.connect(RELAY_URL)

	try {
		// ── Idempotency probe ────────────────────────────────────────────────
		// Ask about every coordinate we own BEFORE writing anything, so a second
		// run against an already-seeded relay is a pure read.
		const present: PreviewExpectedEvent[] = []
		const missing: PreviewExpectedEvent[] = []
		for (const event of expected) {
			if (await queryExists(relay, event.filter)) present.push(event)
			else missing.push(event)
		}

		const published: Array<{ kind: number; d: string | null; id: string; pubkey: string }> = []

		for (const event of present) {
			console.log(JSON.stringify({ event: 'present', kind: event.kind, pubkey: event.pubkey, d: event.dTag ?? null, label: event.label }))
		}

		if (missing.length > 0) {
			console.log(`Publishing ${missing.length} of ${expected.length} fixture events (${present.length} already present)`)
			for (const event of missing) {
				const { template, secretKey, owner } = signedFixture(event, appSecretKey, appPubkey)
				const signed = finalizeEvent(template, secretKey)
				const dTag = signed.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
				try {
					await relay.publish(signed)
					published.push({ kind: signed.kind, d: dTag, id: signed.id, pubkey: signed.pubkey })
					console.log(
						JSON.stringify({
							event: 'published',
							kind: signed.kind,
							id: signed.id,
							pubkey: signed.pubkey,
							d: dTag,
							owner,
							label: event.label,
						}),
					)
				} catch (err) {
					const reason = err instanceof Error ? err.message : String(err)
					if (ALREADY_PRESENT_REASONS.some((needle) => reason.toLowerCase().includes(needle))) {
						// The relay already had it (e.g. a race with another deploy).
						// Not a failure — report it as present.
						console.log(
							JSON.stringify({
								event: 'present',
								kind: signed.kind,
								id: signed.id,
								pubkey: signed.pubkey,
								d: dTag,
								owner,
								label: event.label,
								reason,
							}),
						)
						continue
					}
					fail(`publish failed for ${event.label}: ${reason}`)
				}
			}
		}

		const state = published.length > 0 ? 'seeded' : 'already-seeded'
		// Bare token on its own line: the deploy step greps this exactly, the same
		// way it greps the settings seeder's output.
		console.log(state)
		console.log(
			'SUMMARY ' +
				JSON.stringify({
					state,
					relay: RELAY_URL,
					app_pubkey: appPubkey,
					fixture: PREVIEW_CONTENT_LABEL,
					seed_string: PREVIEW_CONTENT_SEED_STRING,
					created_at: CREATED_AT,
					expected: expected.length,
					published: published.length,
					present: present.length,
					published_events: published,
					actors: previewProducts
						.map((product) => product.authorId)
						.filter((id, index, all) => all.indexOf(id) === index)
						.map((id) => ({ id, role: previewActor(id).role, pubkey: previewActor(id).pubkey })),
					products: previewProducts.map((product) => ({
						d: product.dTag,
						pubkey: previewActor(product.authorId).pubkey,
						title: product.title,
					})),
					featured_list: { kind: KIND_FEATURED_PRODUCTS, d: FEATURED_PRODUCTS_D_TAG, pubkey: appPubkey, products: previewProducts.length },
				}),
		)
	} finally {
		relay.close()
	}
}

main().catch((err) => {
	fail(err instanceof Error ? err.stack || err.message : String(err))
})
