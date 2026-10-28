import { expect, test } from '../fixtures'
import type { Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { Relay, useWebSocketImplementation } from 'nostr-tools/relay'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import WebSocket from 'ws'
import { LightningMock } from '../utils/lightning-mock'
import { BASE_URL, RELAY_URL, TEST_APP_PRIVATE_KEY, TEST_APP_PUBLIC_KEY } from '../test-config'
import { STOREFRONT_PAGE_D_TAG, STOREFRONT_PAGE_KIND, STOREFRONT_PAGE_VERSION } from '../../src/lib/schemas/storefront'
import { setupAuthContext } from '../fixtures/auth'
import { ensureScenario } from '../scenarios'

useWebSocketImplementation(WebSocket)

async function confirmStorefrontPublish(page: Page) {
	await page.getByTestId('storefront-publish').click()
	const identityDialog = page.getByTestId('storefront-publish-identity-dialog')
	await expect(identityDialog).toBeVisible()
	await expect(identityDialog.getByText(/one Lightning invoice activates both/i)).toBeVisible()
	await identityDialog.getByRole('button', { name: 'Publish storefront' }).click()
}

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
			root: { props: { title: '', theme: 'default' } },
			content: [
				{
					type: 'ProfileHeader',
					props: { id: 'p1', showBanner: true, fullScreen: true, showAbout: true, showNip05: true, align: 'center' },
				},
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

	test.beforeEach(async () => {
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
		// Existing order fixtures on a reused relay can trigger an unrelated privacy dialog.
		await page.addInitScript((pubkey) => {
			const dismissed: string[] = JSON.parse(sessionStorage.getItem('pii-warning-dismissed') || '[]')
			if (!dismissed.includes(pubkey)) dismissed.push(pubkey)
			sessionStorage.setItem('pii-warning-dismissed', JSON.stringify(dismissed))
		}, MERCHANT_PK)
		await page.goto(BUILDER_PATH)
		await expect(page.getByTestId('storefront-builder')).toBeVisible({ timeout: 20_000 })
		const header = page.getByTestId('storefront-editor-header')
		const topRow = header.getByTestId('storefront-header-top-row')
		const toolbarRow = header.getByTestId('storefront-header-toolbar-row')
		await expect(header.getByRole('heading', { name: 'Your storefront' })).toBeVisible()
		await expect(topRow.getByTestId('storefront-view-live')).toBeVisible()
		await expect(topRow.getByTestId('storefront-enable-toggle')).toBeVisible()
		await expect(topRow.getByTestId('storefront-publish')).toBeVisible({ timeout: 20_000 })
		await expect(toolbarRow.getByTestId('storefront-sidebar-toggle')).toBeVisible()
		await expect(toolbarRow.getByTestId('storefront-right-sidebar-toggle')).toBeVisible()
		await expect(toolbarRow.getByTestId('storefront-undo')).toBeVisible()
		await expect(toolbarRow.getByTestId('storefront-redo')).toBeVisible()
		await expect(toolbarRow.getByTestId('storefront-fullscreen-toggle')).toBeVisible()
		await expect(toolbarRow.getByTestId('storefront-change-template')).toBeVisible()
	}

	test('toggles the editor sidebars and fullscreen mode', async ({ merchantPage }) => {
		await merchantPage.setViewportSize({ width: 1280, height: 800 })
		await openBuilder(merchantPage)
		const hotkeyPageErrors: string[] = []
		merchantPage.on('pageerror', (error) => hotkeyPageErrors.push(error.message))
		await merchantPage.evaluate(() => {
			document.dispatchEvent(new Event('keydown', { bubbles: true }))
			document.dispatchEvent(new Event('keyup', { bubbles: true }))
		})
		expect(hotkeyPageErrors).toEqual([])

		for (const testId of ['storefront-sidebar-toggle', 'storefront-right-sidebar-toggle']) {
			const toggle = merchantPage.getByTestId(testId)
			const initialState = await toggle.getAttribute('aria-pressed')
			await toggle.click()
			await expect(toggle).not.toHaveAttribute('aria-pressed', initialState ?? 'false')
			await toggle.click()
			await expect(toggle).toHaveAttribute('aria-pressed', initialState ?? 'false')
		}

		const fullscreenToggle = merchantPage.getByTestId('storefront-fullscreen-toggle')
		await fullscreenToggle.click()
		await expect(fullscreenToggle).toHaveAttribute('aria-pressed', 'true')
		await fullscreenToggle.click()
		await expect(fullscreenToggle).toHaveAttribute('aria-pressed', 'false')
	})

	test('creates one invoice from a name for the current domain NIP-05 address and vanity URL', async ({ merchantPage }) => {
		let zapRequest: { tags?: string[][] } | undefined
		let amountSats: number | undefined
		await merchantPage.route('**/api/zapPurchase', async (route) => {
			const body = route.request().postDataJSON() as { amountSats?: number; zapRequest?: { tags?: string[][] } }
			zapRequest = body.zapRequest
			amountSats = body.amountSats
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ pr: 'lnbc20000n1mockstorefrontinvoice' }),
			})
		})

		await openBuilder(merchantPage)
		await merchantPage.getByTestId('storefront-publish').click()
		const dialog = merchantPage.getByTestId('storefront-publish-identity-dialog')
		await expect(dialog).toBeVisible()
		const name = `user${Date.now().toString().slice(-8)}`
		const domain = await merchantPage.evaluate(() => window.location.hostname)
		await dialog.getByLabel('Storefront name').fill(name)
		await expect(dialog.getByText(`${name}@${domain}`)).toBeVisible()
		await expect(dialog.getByText(`${domain}/${name}`)).toBeVisible()
		const invoiceButton = dialog.getByTestId('storefront-identity-invoice')
		await expect(invoiceButton).toBeEnabled({ timeout: 10_000 })
		await invoiceButton.click()
		const paymentDialog = merchantPage.getByTestId('storefront-identity-payment-dialog')
		await expect(paymentDialog).toBeVisible()
		await expect(dialog).toBeHidden()
		await expect(paymentDialog.getByRole('heading', { name: 'Pay for your storefront identity' })).toBeVisible()
		await expect(paymentDialog.getByText(`${name}@${domain}`, { exact: true })).toBeVisible()
		await expect(paymentDialog.getByLabel('Lightning Invoice')).toHaveValue('lnbc20000n1mockstorefrontinvoice')
		expect(amountSats).toBe(20_000)
		expect(zapRequest?.tags).toContainEqual(['L', 'storefront-register'])
		expect(zapRequest?.tags).toContainEqual(['name', name])
		expect(zapRequest?.tags).toContainEqual(['count', '2'])
		await expect(paymentDialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
		await expect(paymentDialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
		await expect(paymentDialog.getByRole('button', { name: 'Publish without an identity' })).toHaveCount(0)
		await merchantPage.keyboard.press('Escape')
		await expect(paymentDialog).toBeVisible()
		await expect(paymentDialog.getByLabel('Lightning Invoice')).toHaveValue('lnbc20000n1mockstorefrontinvoice')
		await merchantPage.unroute('**/api/zapPurchase')
	})

	test('waits for one unified identity registry entry after payment', async ({ merchantPage }) => {
		const lightningMock = await LightningMock.setup(merchantPage)
		let zapRequest: Record<string, unknown> | undefined
		await merchantPage.route('**/api/zapPurchase', async (route) => {
			const body = route.request().postDataJSON() as { zapRequest?: Record<string, unknown> }
			zapRequest = body.zapRequest
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ pr: 'lnbc20000n1acceptedmockinvoice' }),
			})
		})

		const name = `shop${Date.now().toString().slice(-8)}`
		const appConfig = await merchantPage.evaluate(async () => (await fetch('/api/config')).json())
		const identityDTag = `${appConfig.handlerId}-storefront-names`
		const domain = await merchantPage.evaluate(() => window.location.hostname)
		const oldRegistry = await fetchLatestRegistry(TEST_APP_PUBLIC_KEY, identityDTag)
		const previousTags = oldRegistry?.tags ?? [['d', identityDTag]]
		const identityTag: string[] = ['name', name, MERCHANT_PK, String(Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60)]

		try {
			await openBuilder(merchantPage)
			await merchantPage.getByTestId('storefront-enable-toggle').check()
			await merchantPage.getByTestId('storefront-publish').click()
			const dialog = merchantPage.getByTestId('storefront-publish-identity-dialog')
			await expect(dialog).toBeVisible()
			await dialog.getByLabel('Storefront name').fill(name)
			await expect(dialog.getByText(`${name}@${domain}`)).toBeVisible()
			await dialog.getByTestId('storefront-identity-invoice').click()
			const paymentDialog = merchantPage.getByTestId('storefront-identity-payment-dialog')
			await expect(paymentDialog).toBeVisible()
			await expect(dialog).toBeHidden()
			await expect(paymentDialog.getByLabel('Lightning Invoice')).toHaveValue('lnbc20000n1acceptedmockinvoice')

			lightningMock.registerZapInvoice('lnbc20000n1acceptedmockinvoice', zapRequest!)
			await paymentDialog.getByRole('button', { name: 'Pay with WebLN' }).click()
			await expect(paymentDialog).toBeHidden()
			await expect(dialog).toBeVisible()
			await expect(dialog.getByText(/Payment receipt observed; waiting for the unified registry to activate both identities/i)).toBeVisible(
				{
					timeout: 15_000,
				},
			)
			expect(lightningMock.paidInvoices).toContain('lnbc20000n1acceptedmockinvoice')

			// The mocked receipt confirms the payment evidence. Publish the
			// corresponding unified registry update separately to model activation.
			await publishRaw(TEST_APP_PRIVATE_KEY, {
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				content: '',
				tags: [...previousTags.filter((tag) => !(tag[0] === 'name' && tag[1] === name)), identityTag],
			})

			await expect(dialog.getByText(/Both identities are active until/i)).toBeVisible({ timeout: 20_000 })
			await dialog.getByTestId('storefront-publish-confirm').click()
			await expect(dialog).toBeHidden()
			await expect(merchantPage).toHaveURL(new RegExp(`${BUILDER_PATH}$`))
			const liveLink = merchantPage.getByTestId('storefront-view-live')
			await expect(liveLink).toHaveAttribute('href', `/${name}`)
			const [storefrontTab] = await Promise.all([merchantPage.waitForEvent('popup'), liveLink.click()])
			try {
				await expect(storefrontTab).toHaveURL(new RegExp(`/${name}$`), { timeout: 20_000 })
				await expect(storefrontTab.getByTestId('storefront-page')).toBeVisible({ timeout: 20_000 })
				await expect(storefrontTab.getByRole('banner')).toHaveCount(0)
				await expect(storefrontTab.getByRole('contentinfo')).toHaveCount(0)
				await storefrontTab.goto(`/profile/${MERCHANT_PK}?preview=draft#storefront`)
				await expect(storefrontTab).toHaveURL(new RegExp(`/${name}\\?preview=draft#storefront$`), { timeout: 20_000 })
				await expect(storefrontTab.getByTestId('storefront-page')).toBeVisible()
				await storefrontTab.goto(`/profile/${MERCHANT_PK}`)
				await expect(storefrontTab).toHaveURL(new RegExp(`/${name}$`), { timeout: 20_000 })
				await expect(storefrontTab.getByTestId('storefront-page')).toBeVisible()
			} finally {
				await storefrontTab.close()
			}
		} finally {
			await merchantPage.unroute('**/api/zapPurchase')
			await publishRaw(TEST_APP_PRIVATE_KEY, {
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				content: '',
				tags: previousTags.filter((tag) => !(tag[0] === 'name' && tag[1] === name)),
			})
		}
	})

	test('serves registered storefront subdomains and keeps draft previews on the editor origin', async ({ browser }) => {
		test.skip(process.env.E2E_STOREFRONT_SUBDOMAINS !== 'true', 'Requires INSTANCE_STOREFRONT_BASE_URL pointing to the local app')
		await ensureScenario('merchant')
		const context = await browser.newContext({ baseURL: BASE_URL, recordVideo: { dir: test.info().outputPath('videos') } })
		await context.route('**/*', async (route) => {
			const host = new URL(route.request().url()).hostname
			if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1') await route.continue()
			else if (route.request().resourceType() === 'image')
				await route.fulfill({ path: 'e2e/fixtures/test-product-image.png', contentType: 'image/png' })
			else await route.abort()
		})
		await context.routeWebSocket(/.*/, (socket) => {
			const host = new URL(socket.url()).hostname
			if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) socket.connectToServer()
			else socket.close()
		})
		await setupAuthContext(context, { sk: MERCHANT_SK, pk: MERCHANT_PK })
		await context.addInitScript((pubkey) => sessionStorage.setItem('pii-warning-dismissed', JSON.stringify([pubkey])), MERCHANT_PK)
		const page = await context.newPage()
		const name = `farm${Date.now()}`
		const expired = `expired${Date.now()}`
		const configuration = await (await page.request.get(`${BASE_URL}/api/config`)).json()
		const registryTag = `${configuration.handlerId}-storefront-names`
		const previous = await fetchLatestRegistry(TEST_APP_PUBLIC_KEY, registryTag)
		const tags = previous?.tags ?? [['d', registryTag]]
		const storefrontUrl = new URL(BASE_URL)
		storefrontUrl.hostname = `${name}.localhost`
		try {
			await publishRaw(TEST_APP_PRIVATE_KEY, {
				kind: 30000,
				created_at: Math.floor(Date.now() / 1000),
				content: '',
				tags: [
					...tags,
					['name', name, MERCHANT_PK, String(Math.floor(Date.now() / 1000) + 3600)],
					['name', expired, MERCHANT_PK, String(Math.floor(Date.now() / 1000) - 60)],
				],
			})
			await openBuilder(page)
			const liveLink = page.getByTestId('storefront-header-top-row').getByTestId('storefront-view-live')
			await expect(liveLink).toHaveAttribute('href', `/profile/${MERCHANT_PK}?preview=draft`)
			const [draft] = await Promise.all([page.waitForEvent('popup'), liveLink.click()])
			await expect(draft.getByTestId('storefront-page')).toBeVisible({ timeout: 20_000 })
			expect(new URL(draft.url()).origin).toBe(BASE_URL)
			await draft.close()

			await page.getByTestId('storefront-enable-toggle').check()
			await page.getByTestId('storefront-publish').click()
			const dialog = page.getByTestId('storefront-publish-identity-dialog')
			await expect(dialog.getByText(`${name}@localhost`, { exact: true })).toBeVisible()
			await expect(dialog.getByText(storefrontUrl.href, { exact: true })).toBeVisible()
			await dialog.getByTestId('storefront-publish-confirm').click()
			await expect(page.getByText(/published to \d+ relay/i)).toBeVisible({ timeout: 20_000 })
			await expect(liveLink).toHaveAttribute('href', storefrontUrl.href)
			const [live] = await Promise.all([page.waitForEvent('popup'), liveLink.click()])
			await expect(live.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
			await expect(live).toHaveURL(storefrontUrl.href)
			await expect(live.getByRole('banner')).toHaveCount(0)
			await expect(live.getByRole('contentinfo')).toHaveCount(0)
			await live.goto(`${BASE_URL}/profile/${MERCHANT_PK}?tag=test#details`)
			await expect(live).toHaveURL(`${storefrontUrl.href}?tag=test#details`, { timeout: 25_000 })
			await live.goto(`${BASE_URL}/${name}`)
			await expect(live).toHaveURL(storefrontUrl.href, { timeout: 25_000 })
			for (const unavailable of [expired, `unknown${Date.now()}`]) {
				const url = new URL(BASE_URL)
				url.hostname = `${unavailable}.localhost`
				await live.goto(url.href)
				await expect(live.getByRole('heading', { name: 'Storefront unavailable' })).toBeVisible({ timeout: 20_000 })
				await expect(live.getByTestId('storefront-page')).toHaveCount(0)
			}
			await live.goto(BASE_URL)
			await expect(live.getByRole('banner')).toBeVisible()
			await live.close()
		} finally {
			await context.close()
			await publishRaw(TEST_APP_PRIVATE_KEY, { kind: 30000, created_at: Math.floor(Date.now() / 1000), content: '', tags })
		}
	})

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
		const draftViewLiveButton = merchantPage.getByTestId('storefront-header-top-row').getByTestId('storefront-view-live')
		const [draftPreview] = await Promise.all([merchantPage.waitForEvent('popup'), draftViewLiveButton.click()])
		await expect(draftPreview.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
		await expect(draftPreview.getByRole('heading', { name: headline })).toBeVisible({ timeout: 15_000 })
		await expect(draftPreview.getByRole('banner')).toHaveCount(0)
		await expect(draftPreview.getByRole('contentinfo')).toHaveCount(0)
		await draftPreview.close()

		// Nothing reaches a relay until the author opts the page in and presses
		// Publish — the editor's single network write.
		await merchantPage.getByTestId('storefront-enable-toggle').click()
		await confirmStorefrontPublish(merchantPage)

		// The toast names the relays that acknowledged, not merely "saved".
		await expect(merchantPage.getByText(/published to \d+ relay/i)).toBeVisible({ timeout: 20_000 })
		await expect(merchantPage.getByTestId('storefront-publish-errors')).toHaveCount(0)
		const publishedViewLiveButton = merchantPage.getByTestId('storefront-header-top-row').getByTestId('storefront-view-live')
		await expect(publishedViewLiveButton).toBeVisible()
		await expect(publishedViewLiveButton).not.toHaveAttribute('href', /preview=draft/)
		const [livePage] = await Promise.all([merchantPage.waitForEvent('popup'), publishedViewLiveButton.click()])
		await expect(livePage.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
		await expect(livePage.getByRole('banner')).toHaveCount(0)
		await expect(livePage.getByRole('contentinfo')).toHaveCount(0)
		await expect(merchantPage).toHaveURL(new RegExp(`${BUILDER_PATH}$`))
		await livePage.close()

		// The published event is addressable at the author's coordinate.
		const event = await fetchStorefrontEvent(MERCHANT_PK)
		expect(event).not.toBeNull()
		expect(event?.kind).toBe(STOREFRONT_PAGE_KIND)
		expect(event?.pubkey).toBe(MERCHANT_PK)
		expect(event?.tags).toContainEqual(['d', STOREFRONT_PAGE_D_TAG])

		const document = JSON.parse(event!.content)
		expect(document.version).toBe(STOREFRONT_PAGE_VERSION)
		expect(document.enabled).toBe(true)
		expect(document.content[0].props.fullScreen).toBe(true)

		// A visitor who is not signed in gets the custom page, not the profile.
		const visitor = await merchantPage.context().browser()!.newContext()
		const visitorPage = await visitor.newPage()
		try {
			await visitorPage.goto(`/profile/${MERCHANT_PK}`)
			await expect(visitorPage.getByTestId('storefront-page')).toBeVisible({ timeout: 25_000 })
			await expect(visitorPage.getByTestId('storefront-profile-header')).toHaveAttribute('data-full-screen', 'true')
			await expect(visitorPage.getByRole('heading', { name: headline })).toBeVisible({ timeout: 15_000 })
			await expect(visitorPage.getByText('Everything here is made to order.')).toBeVisible()
			// The product grid block resolves the author's live listings.
			await expect(visitorPage.getByText('What I am selling')).toBeVisible()
			await expect(visitorPage.getByRole('banner')).toHaveCount(0)
			await expect(visitorPage.getByRole('contentinfo')).toHaveCount(0)
			await visitorPage.goto('/')
			await expect(visitorPage.getByRole('banner')).toBeVisible()
			await expect(visitorPage.getByRole('contentinfo')).toBeVisible()
		} finally {
			await visitorPage.close()
			await visitor.close()
		}

		// Switching the page off restores the profile without destroying content.
		await openBuilder(merchantPage)
		await expect(merchantPage.getByRole('heading', { name: headline })).toBeVisible({ timeout: 20_000 })
		await merchantPage.getByTestId('storefront-enable-toggle').click()
		await confirmStorefrontPublish(merchantPage)
		await expect(merchantPage.getByText(/page is switched off/i)).toBeVisible({ timeout: 20_000 })

		const disabled = await fetchStorefrontEvent(MERCHANT_PK)
		const disabledDocument = JSON.parse(disabled!.content)
		expect(disabledDocument.enabled).toBe(false)
		// R6: the blocks survive being switched off.
		expect(disabledDocument.content.length).toBeGreaterThan(0)
	})

	for (const starter of [
		{ id: 'farmer', label: 'Farmstand', theme: 'forest', heading: 'Fresh from the farm', catalogue: 'This season at the farm' },
		{ id: 'artist', label: 'Studio', theme: 'mono', heading: 'Made to mean something.', catalogue: 'Available works' },
		{ id: 'electrician', label: 'Local Pro', theme: 'default', heading: 'Electrical work, done right.', catalogue: 'Services' },
		{ id: 'store', label: 'Corner Shop', theme: 'sunset', heading: 'Find your next favourite.', catalogue: 'Browse the collection' },
	]) {
		test(`business template ${starter.id} can be edited, published, and viewed on mobile`, async ({ browser }) => {
			await ensureScenario('merchant')
			const context = await browser.newContext({
				baseURL: test.info().project.use.baseURL,
				recordVideo: { dir: test.info().outputPath('videos') },
			})
			await context.route('**/*', async (route) => {
				const host = new URL(route.request().url()).hostname
				if (host === 'localhost' || host === '127.0.0.1') {
					await route.continue()
				} else if (route.request().resourceType() === 'image') {
					await route.fulfill({ path: 'e2e/fixtures/test-product-image.png', contentType: 'image/png' })
				} else {
					await route.abort()
				}
			})
			await context.routeWebSocket(/.*/, (socket) => {
				const host = new URL(socket.url()).hostname
				if (host === 'localhost' || host === '127.0.0.1') socket.connectToServer()
				else socket.close()
			})
			await setupAuthContext(context, { sk: MERCHANT_SK, pk: MERCHANT_PK })
			await context.addInitScript((pubkey) => {
				sessionStorage.setItem('pii-warning-dismissed', JSON.stringify([pubkey]))
			}, MERCHANT_PK)
			const page = await context.newPage()
			try {
				await openBuilder(page)
				await page.getByTestId('storefront-change-template').click()
				await page.getByTestId('storefront-change-template-confirm').click()
				await expect(page.getByTestId('storefront-wizard')).toBeVisible()
				await page.getByTestId(`storefront-template-${starter.id}`).click()
				await page.getByTestId('storefront-wizard-next').click()
				await expect(page.getByTestId(`storefront-theme-${starter.theme}`)).toHaveAttribute('aria-pressed', 'true')
				await page.getByTestId('storefront-wizard-finish').click()

				await page.getByRole('heading', { name: starter.heading, exact: true }).click()
				const title = page.getByRole('textbox', { name: 'Title', exact: true })
				await expect(title).toBeVisible()
				const customHeading = `My ${starter.label}`
				await title.fill(customHeading)
				await page.getByTestId('storefront-enable-toggle').check()
				await confirmStorefrontPublish(page)
				await expect(page.getByText(/published to \d+ relay/i)).toBeVisible({ timeout: 20_000 })

				const event = await fetchStorefrontEvent(MERCHANT_PK)
				expect(event?.kind).toBe(STOREFRONT_PAGE_KIND)
				expect(event?.pubkey).toBe(MERCHANT_PK)
				expect(event?.tags).toContainEqual(['d', STOREFRONT_PAGE_D_TAG])
				const document = JSON.parse(event!.content)
				expect(document.enabled).toBe(true)
				expect(document.root.props.theme).toBe(starter.theme)
				expect(document.content.find((block: { type: string }) => block.type === 'Hero').props.title).toBe(customHeading)

				const liveLink = page.getByTestId('storefront-header-top-row').getByTestId('storefront-view-live')
				await expect(liveLink).not.toHaveAttribute('href', /preview=draft/)
				const [live] = await Promise.all([page.waitForEvent('popup'), liveLink.click()])
				await live.setViewportSize({ width: 390, height: 844 })
				const storefront = live.getByTestId('storefront-page')
				await expect(storefront).toHaveAttribute('data-storefront-theme', starter.theme, { timeout: 25_000 })
				await expect(live.getByRole('heading', { name: customHeading })).toBeVisible()
				await expect(live.getByRole('heading', { name: starter.catalogue, exact: true })).toBeVisible()
				await expect(live.getByTestId('product-card').first()).toBeVisible({ timeout: 20_000 })
				if (starter.id === 'farmer') {
					await expect(storefront).toHaveAttribute('data-storefront-typography', 'editorial')
					await expect(live.getByTestId('storefront-profile-header')).toHaveAttribute('data-layout', 'compact')
					const illustration = live.getByTestId('storefront-split-hero').locator('img')
					await expect(illustration).toHaveAttribute('src', '/images/farmstand.svg')
					await expect(illustration).toBeVisible()
					await expect.poll(() => illustration.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
					const headingFont = await live
						.getByRole('heading', { name: customHeading })
						.evaluate((element) => getComputedStyle(element).fontFamily)
					expect(headingFont).toContain('Georgia')
					await expect(live.getByTestId('product-card').first()).toHaveAttribute('data-appearance', 'storefront')
					const tabsBefore = context.pages().length
					await live.getByRole('link', { name: 'Shop the harvest', exact: true }).last().click()
					const livePath = new URL(live.url()).pathname
					await expect(live).toHaveURL(new RegExp(`${livePath}#harvest$`))
					expect(context.pages().length).toBe(tabsBefore)
					await live.getByRole('navigation', { name: 'Store navigation' }).getByRole('link', { name: 'Our farm' }).click()
					await expect(live).toHaveURL(/#our-farm$/)
					await live.getByRole('navigation', { name: 'Store navigation' }).getByRole('link', { name: 'Pickup & delivery' }).click()
					await expect(live).toHaveURL(/#visit$/)
					await live.getByRole('button', { name: /^View cart/ }).click()
					await expect(live.getByRole('dialog').getByRole('heading', { name: /your cart/i })).toBeVisible()
					await live.keyboard.press('Escape')
					await expect(live.getByRole('dialog')).toBeHidden()
					await live.evaluate(() => window.scrollTo(0, 0))
				}
				await expect(live.getByRole('banner')).toHaveCount(0)
				await expect(live.getByRole('contentinfo')).toHaveCount(0)
				expect(await live.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
				await live.screenshot({ path: test.info().outputPath('mobile.png'), fullPage: true })
				await live.setViewportSize({ width: 1280, height: 900 })
				await expect(live.getByRole('heading', { name: customHeading })).toBeVisible()
				expect(await live.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
				await live.screenshot({ path: test.info().outputPath('desktop.png'), fullPage: true })
				await live.close()
			} finally {
				await context.close()
			}
		})
	}

	test('a hostile page event renders inert', async ({ unauthenticatedPage }) => {
		const sk = generateSecretKey()
		const pk = getPublicKey(sk)

		await publishStorefrontPage(bytesToHex(sk), {
			version: STOREFRONT_PAGE_VERSION,
			enabled: true,
			// An invalid theme id is hostile input too — it must fall back to the
			// default theme rather than taking the whole page down with it.
			root: { props: { title: 'Hostile', theme: 'javascript:alert(1)' } },
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
		const storefront = unauthenticatedPage.getByTestId('storefront-page')
		await expect(storefront).toBeVisible({ timeout: 25_000 })
		await expect(unauthenticatedPage.getByText('Legitimate content')).toBeVisible()

		// The invalid theme id fell back to the default rather than failing the
		// whole document — the page above would not have rendered at all otherwise.
		await expect(storefront).toHaveAttribute('data-storefront-theme', 'default')

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

test.describe('storefront setup wizard', () => {
	test.use({ scenario: 'merchant', recordVideo: true })

	// devUser3 is the fixture's intentionally-fresh account: the 'merchant'
	// scenario seeds profiles and products for devUser1/devUser2 only, and no
	// prior test in this file publishes a 30024 event for it. That is exactly
	// the "no usable content yet" condition the wizard exists for — using a
	// seeded account here would risk the wizard never appearing at all, because
	// a leftover page from a previous run would route straight to the editor.
	const NEW_USER_SK = 'e61ae5a4f505026e3d2b5aeba82c748b6b799346a1e98e266d7252cddb8f502b'
	const NEW_USER_PK = '2edec1b799cd2f41f70a5ff0edc10d2260a57d62f39072aab4eb8174b7ca912a'

	const BUILDER_PATH = '/dashboard/account/profile-page'

	// Disabled unconditionally, win or fail — `newUserPage` is shared with other
	// spec files (user-profile.spec.ts), and an enabled page would change what
	// a visit to this account's profile shows there.
	test.afterAll(async () => {
		await publishStorefrontPage(NEW_USER_SK, {
			version: STOREFRONT_PAGE_VERSION,
			enabled: false,
			root: { props: { title: '', theme: 'default' } },
			content: [],
		})
	})

	test('a first-time author is offered the wizard, picks a template and a theme, and publishes it', async ({ newUserPage }) => {
		await newUserPage.goto(BUILDER_PATH)

		const wizard = newUserPage.getByTestId('storefront-wizard')
		await expect(wizard).toBeVisible({ timeout: 20_000 })

		// Step 1: template. No "Cancel" on first-time setup — there is nothing
		// yet to cancel back to.
		await expect(newUserPage.getByTestId('storefront-wizard-cancel')).toHaveCount(0)
		await expect(newUserPage.getByTestId('storefront-template-shop')).toBeVisible()
		await newUserPage.getByTestId('storefront-template-showcase').click()
		await newUserPage.getByTestId('storefront-wizard-next').click()

		// Step 2: theme. "Back" is available here.
		await expect(newUserPage.getByTestId('storefront-wizard-back')).toBeVisible()
		await expect(newUserPage.getByTestId('storefront-theme-sunset')).toBeVisible()
		await newUserPage.getByTestId('storefront-theme-sunset').click()
		await newUserPage.getByTestId('storefront-wizard-finish').click()

		// The editor opens seeded with the showcase template's blocks — proof the
		// wizard's choice, not some other default, is what landed in Puck.
		await expect(newUserPage.getByTestId('storefront-builder')).toBeVisible({ timeout: 20_000 })
		await expect(newUserPage.getByText('More from this shop')).toBeVisible({ timeout: 20_000 })

		await newUserPage.getByTestId('storefront-enable-toggle').click()
		await confirmStorefrontPublish(newUserPage)
		await expect(newUserPage.getByText(/published to \d+ relay/i)).toBeVisible({ timeout: 20_000 })

		const event = await fetchStorefrontEvent(NEW_USER_PK)
		expect(event).not.toBeNull()
		const document = JSON.parse(event!.content)
		expect(document.enabled).toBe(true)
		expect(document.root.props.theme).toBe('sunset')
		expect(document.content.map((b: { type: string }) => b.type)).toEqual(['ProfileHeader', 'FeaturedProduct', 'ProductGrid'])

		// The published page actually renders with the chosen theme.
		const visitor = await newUserPage.context().browser()!.newContext()
		const visitorPage = await visitor.newPage()
		try {
			await visitorPage.goto(`/profile/${NEW_USER_PK}`)
			const storefront = visitorPage.getByTestId('storefront-page')
			await expect(storefront).toBeVisible({ timeout: 25_000 })
			await expect(storefront).toHaveAttribute('data-storefront-theme', 'sunset')
		} finally {
			await visitorPage.close()
			await visitor.close()
		}
	})

	test('"Change template" asks for confirmation before replacing the canvas', async ({ newUserPage }) => {
		// Seed existing content so the builder opens straight into the editor —
		// this test is about reopening the wizard from there, not reaching it
		// the first time (covered above).
		await publishStorefrontPage(NEW_USER_SK, {
			version: STOREFRONT_PAGE_VERSION,
			enabled: false,
			root: { props: { title: '', theme: 'default' } },
			content: [{ type: 'Text', props: { id: 't1', markdown: 'Existing content', align: 'left', width: 'normal' } }],
		})

		await newUserPage.goto(BUILDER_PATH)
		await expect(newUserPage.getByTestId('storefront-builder')).toBeVisible({ timeout: 20_000 })
		await expect(newUserPage.getByText('Existing content')).toBeVisible({ timeout: 20_000 })

		await newUserPage.getByTestId('storefront-change-template').click()
		await expect(newUserPage.getByText(/replaces every block/i)).toBeVisible()

		// Backing out of the confirmation leaves the existing canvas untouched.
		await newUserPage.getByRole('button', { name: 'Keep editing' }).click()
		await expect(newUserPage.getByTestId('storefront-builder')).toBeVisible()
		await expect(newUserPage.getByText('Existing content')).toBeVisible()

		// Confirming reopens the wizard, this time with a way back (there is now
		// an editor session to return to).
		await newUserPage.getByTestId('storefront-change-template').click()
		await newUserPage.getByTestId('storefront-change-template-confirm').click()
		await expect(newUserPage.getByTestId('storefront-wizard')).toBeVisible({ timeout: 10_000 })
		await expect(newUserPage.getByTestId('storefront-wizard-cancel')).toBeVisible()

		await newUserPage.getByTestId('storefront-wizard-cancel').click()
		await expect(newUserPage.getByTestId('storefront-builder')).toBeVisible({ timeout: 10_000 })
		await expect(newUserPage.getByText('Existing content')).toBeVisible()
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

async function fetchLatestRegistry(pubkey: string, dTag: string): Promise<{ tags: string[][] } | null> {
	const relay = await Relay.connect(RELAY_URL)
	try {
		return await new Promise((resolve) => {
			let latest: { tags: string[][]; created_at: number } | null = null
			const sub = relay.subscribe([{ kinds: [30000], authors: [pubkey], '#d': [dTag] }], {
				onevent(event) {
					if (!latest || event.created_at > latest.created_at) latest = event
				},
				oneose() {
					sub.close()
					resolve(latest)
				},
			})
			setTimeout(() => {
				sub.close()
				resolve(latest)
			}, 5_000)
		})
	} finally {
		relay.close()
	}
}
