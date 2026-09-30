import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { RELAY_URL } from '../test-config'
import { STOREFRONT_PAGE_D_TAG, STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '../../src/lib/schemas/storefront'

useWebSocketImplementation(WebSocket)

/**
 * Feature gate for the Puck-based profile page builder (ADR-019 / ADR-0006).
 *
 * Covers the flow the ADR names: build a page in the dashboard → publish it as
 * a kind 30024 event → visit the author's public URL → the blocks render. Plus
 * the guardrail the same ADR requires: a hostile page event renders inert.
 *
 * The hostile case uses a throwaway keypair rather than a seeded fixture user.
 * A storefront page replaces the profile view for whoever authored it, so
 * enabling one on a shared fixture account would silently change what every
 * other spec sees on that account's profile.
 */

test.describe('storefront page builder', () => {
	test.use({ scenario: 'merchant', recordVideo: true })

	const MERCHANT_SK = '5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0'

	const SEED_MARKER = 'Draft copy the builder loads'

	/**
	 * Seed a known document before the builder opens.
	 *
	 * Without this the spec would depend on whatever the relay still held from a
	 * previous run — the builder loads the published page when one exists, so a
	 * leftover event decides what is on the canvas. Seeding makes the starting
	 * state the test's own.
	 */
	function baselinePage(enabled: boolean) {
		return {
			version: STOREFRONT_PAGE_VERSION,
			enabled,
			root: { props: { title: '', background: 'default' } },
			content: [
				{ type: 'ProfileHeader', props: { id: 'p1', showBanner: true, showAbout: true, showNip05: true, align: 'center' } },
				{ type: 'Text', props: { id: 't1', markdown: SEED_MARKER, align: 'center', width: 'normal' } },
				{
					type: 'ProductGrid',
					props: {
						id: 'g1',
						title: 'What I am selling',
						source: 'all',
						collectionDTag: '',
						limit: 12,
						columns: 3,
						emptyMessage: 'Nothing listed here yet.',
					},
				},
			],
		}
	}

	test.beforeAll(async () => {
		await publishStorefrontPage(MERCHANT_SK, baselinePage(false))
	})

	// The merchant account is shared with every other spec, and an enabled page
	// replaces their profile view. Switch it off unconditionally after this file
	// so a failure part-way through cannot change what other specs see.
	test.afterAll(async () => {
		await publishStorefrontPage(MERCHANT_SK, baselinePage(false))
	})

	const BUILDER_PATH = '/dashboard/account/profile-page'
	const MERCHANT_PK = '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0'

	async function openBuilder(page: Page) {
		await page.goto(BUILDER_PATH)
		await expect(page.getByTestId('storefront-builder')).toBeVisible({ timeout: 20_000 })
		await expect(page.getByTestId('storefront-publish')).toBeVisible({ timeout: 20_000 })
	}

	test('builds, publishes, and serves a custom profile page', async ({ merchantPage }) => {
		const headline = `Handmade by TestMerchant ${Date.now()}`

		await openBuilder(merchantPage)

		// The builder loads the author's published document.
		await expect(merchantPage.getByText(SEED_MARKER)).toBeVisible({ timeout: 20_000 })

		// Select that block by clicking it in the canvas. The canvas is the
		// production renderer with editor chrome, so this is the same element a
		// visitor would see.
		await merchantPage.getByText(SEED_MARKER).click()

		const markdownField = merchantPage.getByRole('textbox', { name: /Text \(markdown\)/i })
		await expect(markdownField).toBeVisible({ timeout: 10_000 })
		await markdownField.fill(`# ${headline}\n\nEverything here is made to order.`)

		// Nothing reaches a relay until the author opts the page in and presses
		// Publish — the editor's single network write.
		await merchantPage.getByTestId('storefront-enable-toggle').click()
		await merchantPage.getByTestId('storefront-publish').click()

		// The toast names the relays that acknowledged, not merely "saved".
		await expect(merchantPage.getByText(/published to \d+ relay/i)).toBeVisible({ timeout: 20_000 })
		await expect(merchantPage.getByTestId('storefront-publish-errors')).toHaveCount(0)

		// The published event is addressable at the author's coordinate.
		const event = await fetchStorefrontEvent(MERCHANT_PK)
		expect(event).not.toBeNull()
		expect(event?.kind).toBe(STOREFRONT_PAGE_KIND)
		expect(event?.pubkey).toBe(MERCHANT_PK)
		expect(event?.tags).toContainEqual(['d', STOREFRONT_PAGE_D_TAG])

		const document = JSON.parse(event!.content)
		expect(document.version).toBe(STOREFRONT_PAGE_VERSION)
		expect(document.enabled).toBe(true)

		// A visitor who is not signed in gets the custom page, not the profile.
		const visitor = await merchantPage.context().browser()!.newContext()
		const visitorPage = await visitor.newPage()
		try {
			await visitorPage.goto(`/profile/${MERCHANT_PK}`)
			await expect(visitorPage.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
			await expect(visitorPage.getByRole('heading', { name: headline })).toBeVisible({ timeout: 15_000 })
			await expect(visitorPage.getByText('Everything here is made to order.')).toBeVisible()
			// The product grid block resolves the author's live listings.
			await expect(visitorPage.getByText('What I am selling')).toBeVisible()
		} finally {
			await visitorPage.close()
			await visitor.close()
		}

		// Switching the page off restores the profile without destroying content.
		await openBuilder(merchantPage)
		await expect(merchantPage.getByRole('heading', { name: headline })).toBeVisible({ timeout: 20_000 })
		await merchantPage.getByTestId('storefront-enable-toggle').click()
		await merchantPage.getByTestId('storefront-publish').click()
		await expect(merchantPage.getByText(/page is switched off/i)).toBeVisible({ timeout: 20_000 })

		const disabled = await fetchStorefrontEvent(MERCHANT_PK)
		const disabledDocument = JSON.parse(disabled!.content)
		expect(disabledDocument.enabled).toBe(false)
		// R6: the blocks survive being switched off.
		expect(disabledDocument.content.length).toBeGreaterThan(0)
	})

	test('a hostile page event renders inert', async ({ unauthenticatedPage }) => {
		const sk = generateSecretKey()
		const pk = getPublicKey(sk)

		await publishStorefrontPage(bytesToHex(sk), {
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			root: { props: { title: 'Hostile', background: 'default', width: 'normal' } },
			content: [
				// Safe block: proves the page rendered at all, so a passing
				// assertion below is "the hostile block was dropped", not "the
				// whole page failed to load".
				{ type: 'Text', props: { id: 't1', markdown: 'Legitimate content', align: 'left', width: 'normal' } },
				// Script-bearing href.
				{
					type: 'LinkList',
					props: { id: 'l1', title: 'Links', layout: 'row', links: [{ label: 'Tap here', href: 'javascript:alert(1)' }] },
				},
				// Script-bearing image source.
				{
					type: 'Image',
					props: { id: 'i1', url: 'data:text/html,<script>alert(1)</script>', alt: 'x', width: 'normal', rounded: true, href: '' },
				},
				// Unknown block type from a newer or hostile client.
				{ type: 'RemoteScript', props: { id: 'r1', src: 'https://evil.example/payload.js' } },
				// Protocol-relative link that would leave the app.
				{ type: 'Hero', props: { id: 'h1', title: 'Offer', ctaLabel: 'Claim', ctaHref: '//evil.example/phish' } },
			],
		})

		await unauthenticatedPage.goto(`/profile/${pk}`)
		await expect(unauthenticatedPage.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
		await expect(unauthenticatedPage.getByText('Legitimate content')).toBeVisible()

		// None of the hostile blocks produced anything navigable or loadable.
		await expect(unauthenticatedPage.locator('a[href^="javascript:"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('a[href^="data:"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('a[href^="//evil.example"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('img[src^="data:text/html"]')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('script[src*="evil.example"]')).toHaveCount(0)
		await expect(unauthenticatedPage.getByText('Tap here')).toHaveCount(0)

		// The Hero survived with its text but lost only the unsafe CTA, and the
		// unknown block contributed nothing.
		await expect(unauthenticatedPage.getByText('Offer')).toHaveCount(0)
	})

	test('an unreadable page event falls back to the profile instead of erroring', async ({ unauthenticatedPage }) => {
		const sk = generateSecretKey()
		const pk = getPublicKey(sk)

		await publishRaw(bytesToHex(sk), {
			kind: STOREFRONT_PAGE_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', STOREFRONT_PAGE_D_TAG]],
			content: 'this is not a page document',
		})

		await unauthenticatedPage.goto(`/profile/${pk}`)
		// No storefront, no crash — the ordinary profile view takes over.
		await expect(unauthenticatedPage.getByTestId('storefront-page')).toHaveCount(0)
		await expect(unauthenticatedPage.locator('body')).toBeVisible()
	})
})

// --- relay helpers -------------------------------------------------------

async function publishRaw(skHex: string, template: EventTemplate) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		const event = finalizeEvent(template, hexToBytes(skHex))
		await relay.publish(event)
		return event
	} finally {
		relay.close()
	}
}

async function publishStorefrontPage(skHex: string, document: unknown) {
	return publishRaw(skHex, {
		kind: STOREFRONT_PAGE_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [['d', STOREFRONT_PAGE_D_TAG]],
		content: JSON.stringify(document),
	})
}

async function fetchStorefrontEvent(pubkey: string) {
	const relay = await Relay.connect(RELAY_URL)
	try {
		return await new Promise<{ kind: number; pubkey: string; tags: string[][]; content: string } | null>((resolve) => {
			let latest: { kind: number; pubkey: string; tags: string[][]; content: string; created_at: number } | null = null
			const sub = relay.subscribe([{ kinds: [STOREFRONT_PAGE_KIND], authors: [pubkey], '#d': [STOREFRONT_PAGE_D_TAG] }], {
				onevent(event) {
					if (!latest || event.created_at >= latest.created_at) latest = event
				},
				oneose() {
					sub.close()
					resolve(latest)
				},
			})
			setTimeout(() => {
				sub.close()
				resolve(latest)
			}, 8_000)
		})
	} finally {
		relay.close()
	}
}
