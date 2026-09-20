/**
 * Guards the preview CONTENT fixture — `src/lib/preview/previewContentFixtures.ts`
 * plus `scripts/seed-preview-content.ts` — against the app's OWN read-path
 * contract, so the preview feed assertion cannot rot silently.
 *
 * The fixture's whole reason to exist is that a preview relay seeded with it
 * renders listings. That only holds while three things stay true, and each is
 * checked here rather than asserted in prose:
 *
 *  1. every seeded product still validates against the app's product-listing
 *     schema (`src/lib/schemas/productListing.ts`) — `d` + `title` + `price`
 *     are required (`:120-128`);
 *  2. every seeded product still passes the feed's own visibility filter: not
 *     `hidden`, and in stock per `isProductInStock`
 *     (`src/queries/products.tsx:109-123`, applied at `:161-167`), because
 *     `fetchProducts` drops the rows that fail it;
 *  3. the app-owned featured list still points at those exact product
 *     coordinates, in the shape `fetchFeaturedProducts` reads
 *     (`src/queries/featured.tsx:16-33`).
 *
 * It also freezes DETERMINISM: actor keys come from a documented seed string,
 * and with a pinned `created_at` every fixture event id is a constant. Change
 * the seed string, a `d` tag, a title, a price or a stock value and this file
 * fails — which is the point: preview content must be reproducible.
 *
 * Finally it pins the WIRING: the seeder may be invoked by EXACTLY ONE workflow,
 * the per-PR preview deploy, and that step must be gated on preview readiness
 * (the rule `preview-deploy-workflow-guard.test.ts:152` enforces for secret
 * consumers). Nothing may seed content on the way to a real environment.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'

import { ProductListingSchema } from '@/lib/schemas/productListing'
import type { NDKEvent } from '@/lib/nostr/ndk-events'
import { isProductInStock } from '@/queries/products'
import {
	FEATURED_PRODUCTS_D_TAG,
	KIND_FEATURED_PRODUCTS,
	KIND_PRODUCT,
	KIND_PROFILE,
	PREVIEW_CONTENT_LABEL,
	PREVIEW_CONTENT_SEED_STRING,
	derivePreviewSecretKey,
	expectedPreviewEvents,
	featuredProductsTemplate,
	previewActor,
	previewActors,
	previewProductTitles,
	previewProducts,
	productCoordinate,
	productTemplate,
	profileContent,
	profileTemplate,
} from '@/lib/preview/previewContentFixtures'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const SEEDER = 'scripts/seed-preview-content.ts'
const PREVIEW_WORKFLOW = '.github/workflows/preview-deploy.yml'

/** The preview app key used by the deploy workflow (`APP_PRIVATE_KEY` in the compose block). */
const PREVIEW_APP_PRIVATE_KEY = 'e2e0000000000000000000000000000000000000000000000000000000000001'
const APP_PUBKEY = getPublicKey(hexToBytes(PREVIEW_APP_PRIVATE_KEY))

/** Pinned timestamp: makes every fixture event id a constant (see the KAT below). */
const PINNED_CREATED_AT = 1_789_000_000

/** Documented actor keys — `sha256("<seed>:actor:<id>")`. */
const EXPECTED_ACTOR_PUBKEYS: Record<string, string> = {
	'seller-1': 'fe092d3973c443632ea9ee00fc8da90be7a3a87b25c0e06d8c98bcd9a5027a3a',
	'seller-2': 'dfa7c469a681c9af0bdedf03b5b4aec5115533a135d10793fcbc4e2789cd55f1',
	'buyer-1': '3e34f0a9d33d12c0588f8bb8a123fb392b4f0806252b7b1dc067074d55a0cc81',
}

/** Documented event ids at `PINNED_CREATED_AT`, keyed by `kind:d`. */
const EXPECTED_EVENT_IDS: Record<string, string> = {
	'0:seller-1': 'e4502d57def900be5e842204c7998c1c17f75792473579a268af35f165a98e3d',
	'0:seller-2': '7083c1b32237bc4a80ddcd3e2016f5cb7118a507c105bf4b0f376b98abf78b18',
	'0:buyer-1': '9114c8982f4926a174619bc5310d5bd4dfbf5abc3229acd5ccf9b46f5cf967d3',
	'30402:preview-seed-lamp': '7405f0510cc8c3e66571b49ed9564ae0a30bc47abd989af62ca5f9a2631da6ba',
	'30402:preview-seed-mug': '9de01de902f283ddbb5619e0fb6372bd08c58fee881e62cd292638f008cc6fa1',
	'30402:preview-seed-notebook': '94b903fb49a889c068ae4c2291d767f088a21efb4d4c78f4be14c23ad439e60d',
	'30402:preview-seed-sticker-pack': '86f9a525271c646df5096133df385e4a51f11e7b41a2c5ca6e0ad06ab717e3da',
	'30402:preview-seed-ebook': '8138e88619730e113c74cd14a26f459e25fda808cd6077d1489ca20f18fb35b0',
	'30405:featured_products': '606f3359b17294b672e3248e74f867d0f0ba4a9833eefa6465b5abf66f7d0ba5',
}

const productCoord = (product: (typeof previewProducts)[number]): string =>
	productCoordinate(product, previewActor(product.authorId).pubkey)

/** Product event as a plain signed event object (what the relay stores). */
const signedProduct = (product: (typeof previewProducts)[number]) => {
	const author = previewActor(product.authorId)
	return finalizeEvent(productTemplate(product, author.pubkey, PINNED_CREATED_AT), author.secretKey)
}

const featuredCoords = (): string[] => previewProducts.map((product) => productCoord(product))

const seededFeaturedEvent = () =>
	finalizeEvent(featuredProductsTemplate(APP_PUBKEY, featuredCoords(), PINNED_CREATED_AT), hexToBytes(PREVIEW_APP_PRIVATE_KEY))

/** Run the seeder in a subprocess with a clean env; returns exit code + output. */
const runSeeder = (env: Record<string, string>) => {
	const result = Bun.spawnSync(['bun', 'run', SEEDER], {
		cwd: REPO_ROOT,
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe',
	})
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	}
}

describe('preview content fixture — read-path contract', () => {
	test('every seeded product validates against the app product-listing schema', () => {
		expect(previewProducts.length).toBeGreaterThanOrEqual(3)
		expect(previewProducts.length).toBeLessThanOrEqual(6)

		for (const product of previewProducts) {
			const event = signedProduct(product)
			const parsed = ProductListingSchema.safeParse({
				kind: event.kind,
				created_at: event.created_at,
				content: event.content,
				tags: event.tags,
			})
			expect(parsed.success, `${product.dTag}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
		}
	})

	test('every seeded product survives the feed visibility filter (not hidden, in stock)', () => {
		for (const product of previewProducts) {
			const event = signedProduct(product)
			const visibility = event.tags.find((tag) => tag[0] === 'visibility')?.[1] ?? 'on-sale'
			expect(visibility, `${product.dTag} would be dropped by fetchProducts`).not.toBe('hidden')
			// The app's own predicate, not a re-implementation of it.
			expect(isProductInStock({ tags: event.tags } as unknown as NDKEvent), `${product.dTag} is out of stock`).toBe(true)
		}
	})

	test('every seeded product is preview-labelled in content, so it cannot be mistaken for real data', () => {
		for (const product of previewProducts) {
			const event = signedProduct(product)
			expect(product.title).toContain(PREVIEW_CONTENT_LABEL)
			expect(event.content).toContain(PREVIEW_CONTENT_LABEL)
			expect(event.tags.some((tag) => tag[0] === 't' && tag[1] === 'preview-seed')).toBe(true)
		}
		// And the browser assertion reads the same titles the fixture defines.
		expect(previewProductTitles).toEqual(previewProducts.map((product) => product.title))
	})

	test('the app-owned featured list points at exactly the seeded product coordinates', () => {
		const event = seededFeaturedEvent()
		expect(event.kind).toBe(KIND_FEATURED_PRODUCTS)
		expect(event.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(FEATURED_PRODUCTS_D_TAG)
		const refs = event.tags.filter((tag) => tag[0] === 'a').map((tag) => tag[1])
		expect(refs).toEqual(featuredCoords())
		expect(refs.every((ref) => ref.startsWith(`${KIND_PRODUCT}:`))).toBe(true)
	})

	test('profiles carry only local fields — no nip05/lud16 that would make a preview resolve third parties', () => {
		for (const actor of previewActors) {
			const profile = JSON.parse(profileContent(actor)) as Record<string, unknown>
			expect(profile.name).toBe(actor.name)
			expect(profile.nip05).toBeUndefined()
			expect(profile.lud16).toBeUndefined()
			expect(profile.lud06).toBeUndefined()
		}
	})
})

describe('preview content fixture — determinism', () => {
	test('actor keys derive from the documented seed string', () => {
		expect(PREVIEW_CONTENT_SEED_STRING).toBe('plebeian-preview-content-v1')
		for (const actor of previewActors) {
			const first = derivePreviewSecretKey(actor.id)
			const second = derivePreviewSecretKey(actor.id)
			expect(Array.from(first)).toEqual(Array.from(second))
			expect(actor.pubkey).toBe(EXPECTED_ACTOR_PUBKEYS[actor.id])
		}
	})

	test('a pinned created_at yields byte-identical, documented event ids', () => {
		const observed: Record<string, string> = {}
		for (const actor of previewActors) {
			observed[`${KIND_PROFILE}:${actor.id}`] = finalizeEvent(profileTemplate(actor, PINNED_CREATED_AT), actor.secretKey).id
		}
		for (const product of previewProducts) {
			observed[`${KIND_PRODUCT}:${product.dTag}`] = signedProduct(product).id
		}
		observed[`${KIND_FEATURED_PRODUCTS}:${FEATURED_PRODUCTS_D_TAG}`] = seededFeaturedEvent().id

		expect(observed).toEqual(EXPECTED_EVENT_IDS)
	})

	test('the idempotency probe covers every event the seeder can publish', () => {
		const expected = expectedPreviewEvents(APP_PUBKEY)
		// 3 profiles + 5 products + 1 app-owned featured list
		expect(expected.length).toBe(previewActors.length + previewProducts.length + 1)
		for (const event of expected) {
			expect(event.filter.kinds).toEqual([event.kind])
			expect(event.filter.authors).toEqual([event.pubkey])
			if (event.kind !== KIND_PROFILE) expect(event.dTag).toBeTruthy()
		}
	})
})

describe('preview content seeder — preview-only interlock', () => {
	test('refuses a public relay host', () => {
		const { exitCode, stderr } = runSeeder({
			APP_RELAY_URL: 'wss://relay.damus.io',
			APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY,
			PREVIEW_CONTENT_DRY_RUN: '1',
		})
		expect(exitCode).toBe(1)
		expect(stderr).toContain('refusing to seed relay.damus.io')
	})

	test('refuses a production-looking market host', () => {
		const { exitCode, stderr } = runSeeder({
			APP_RELAY_URL: 'wss://market.plebeian.market/relay',
			APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY,
		})
		expect(exitCode).toBe(1)
		expect(stderr).toContain('refusing to seed market.plebeian.market')
	})

	test('a dry run against a preview host publishes nothing and lists the plan', () => {
		const { exitCode, stdout } = runSeeder({
			APP_RELAY_URL: 'wss://pr9999.test-market.orangesync.tech/relay',
			APP_PRIVATE_KEY: PREVIEW_APP_PRIVATE_KEY,
			PREVIEW_CONTENT_DRY_RUN: '1',
		})
		expect(exitCode).toBe(0)
		expect(stdout).toContain('"state":"dry-run"')
		expect(stdout).not.toContain('"event":"published"')
		const planned = stdout.split('\n').filter((line) => line.includes('"event":"dry-run"'))
		expect(planned.length).toBe(previewActors.length + previewProducts.length + 1)
	})
})

describe('preview content seeding — wiring', () => {
	const workflowsDir = '.github/workflows'
	const workflowPaths = readdirSync(join(REPO_ROOT, workflowsDir)).map((file) => `${workflowsDir}/${file}`)
	const invoking = workflowPaths.filter((path) => readFileSync(join(REPO_ROOT, path), 'utf8').includes(SEEDER))

	test('exactly one workflow invokes the seeder, and it is the per-PR preview deploy', () => {
		expect(invoking).toEqual([PREVIEW_WORKFLOW])
	})

	test('the seeding step is gated on preview readiness', () => {
		const workflow = readFileSync(join(REPO_ROOT, PREVIEW_WORKFLOW), 'utf8')
		const steps = workflow.split(/\n {6}- /).slice(1)
		const seedStep = steps.find((step) => step.includes(SEEDER))
		expect(seedStep, `${SEEDER} is not in a deploy step of ${PREVIEW_WORKFLOW}`).toBeTruthy()
		expect(seedStep!).toContain("steps.secrets.outputs.previews_ready == 'true'")
	})

	test('the preview workflow is the only one that writes content to a relay', () => {
		// A production/staging/auctionsdev deploy must never carry this fixture.
		const nonPreview = workflowPaths.filter((path) => path !== PREVIEW_WORKFLOW)
		for (const path of nonPreview) {
			const body = readFileSync(join(REPO_ROOT, path), 'utf8')
			expect(body.includes('seed-preview-content'), `${path} references the preview content seeder`).toBe(false)
		}
	})
})
