import { test, expect } from '../fixtures'
import { devUser2 } from '../../src/lib/fixtures'
import { resetRemoteCartForUser } from '../scenarios'
import { SELF_HOSTED_HANDLER_ID, SELF_HOSTED_INSTANCE_NAME, SELF_HOSTED_SITE_URL, TEST_APP_PUBLIC_KEY } from '../test-config'
import { filterByTag, getTagValue, queryRelayEvents } from '../utils/relay-query'

test.describe('self-hosted instance configuration', () => {
	test('discovers custom settings and renders configured branding', async ({ unauthenticatedPage, request }) => {
		const configResponse = await request.get('/api/config')
		expect(configResponse.ok()).toBeTruthy()
		const config = await configResponse.json()

		expect(config.handlerId).toBe(SELF_HOSTED_HANDLER_ID)
		expect(config.name).toBe(SELF_HOSTED_INSTANCE_NAME)
		expect(config.displayName).toBe(SELF_HOSTED_INSTANCE_NAME)
		expect(config.siteUrl).toBe(SELF_HOSTED_SITE_URL)
		expect(config.appRelay).toBe('ws://localhost:10547')
		expect(config.publicRelays).toEqual(['ws://localhost:10547'])
		expect(config.trustedMints).toEqual(['https://mint.example.invalid'])
		expect(config.supportContact).toBe('support@self-hosted.example.invalid')

		await unauthenticatedPage.goto('/')
		await expect(unauthenticatedPage).toHaveTitle(SELF_HOSTED_INSTANCE_NAME)
		await expect(unauthenticatedPage.locator('header img').first()).toHaveAttribute('alt', `${SELF_HOSTED_INSTANCE_NAME}`)
		await expect(unauthenticatedPage.locator('link[rel~="icon"]').first()).toHaveAttribute(
			'href',
			'https://example.invalid/self-hosted-logo.svg',
		)
		await expect(unauthenticatedPage.getByText(`${SELF_HOSTED_INSTANCE_NAME}: Powered by Nostr.`)).toBeVisible()
		await expect(unauthenticatedPage.getByRole('link', { name: 'Support' })).toHaveAttribute(
			'href',
			'mailto:support@self-hosted.example.invalid',
		)
		await expect(unauthenticatedPage.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', `${SELF_HOSTED_SITE_URL}/terms`)
	})

	test('keeps the legacy d-tag available as the fallback candidate', async () => {
		const events = await queryRelayEvents({
			authors: [TEST_APP_PUBLIC_KEY],
			kinds: [31990],
			'#d': [SELF_HOSTED_HANDLER_ID, 'plebeian-market-handler'],
		})
		const customEvents = filterByTag(events, 'd', SELF_HOSTED_HANDLER_ID)
		const legacyEvents = filterByTag(events, 'd', 'plebeian-market-handler')

		expect(customEvents.length).toBeGreaterThan(0)
		expect(legacyEvents.length).toBeGreaterThan(0)

		const customEvent = customEvents.sort((a, b) => b.created_at - a.created_at)[0]
		expect(customEvent.kind).toBe(31990)
		expect(customEvent.pubkey).toBe(TEST_APP_PUBLIC_KEY)
		expect(getTagValue(customEvent, 'd')).toBe(SELF_HOSTED_HANDLER_ID)
		expect(customEvent.tags).toContainEqual(['web', `${SELF_HOSTED_SITE_URL}/product/<bech32>`, 'naddr'])
		expect(customEvent.tags).toContainEqual(['web', `${SELF_HOSTED_SITE_URL}/collection/<bech32>`, 'naddr'])
		expect(getTagValue(customEvent, 'r')).toBe('ws://localhost:10547')

		const content = JSON.parse(customEvent.content) as Record<string, unknown>
		expect(content.name).toBe(SELF_HOSTED_INSTANCE_NAME)
		expect(content.handlerId).toBe(SELF_HOSTED_HANDLER_ID)
		expect(content.publicRelays).toEqual(['ws://localhost:10547'])
	})
})

// ADR-018's stated completion criterion: "A non-Plebeian instance (distinct
// namespace, relay, and app pubkey) must complete a browse, cart, and
// checkout path in the e2e suite." This dev server runs the whole suite
// self-hosted-configured (INSTANCE_HANDLER_ID, see playwright.config.ts),
// so this proves the configured instance is actually usable end to end —
// not just discoverable via /api/config, as the tests above only check.
test.describe('self-hosted instance — browse, cart, and checkout path', () => {
	test.use({ scenario: 'marketplace' })

	test.beforeEach(async () => {
		await resetRemoteCartForUser(devUser2.sk)
	})

	test('a buyer can browse, add to cart, and reach checkout', async ({ buyerPage }) => {
		await buyerPage.goto('/products')

		const wallet = buyerPage.locator('[data-testid="product-card"]').filter({ hasText: 'Bitcoin Hardware Wallet' })
		await expect(wallet).toBeVisible({ timeout: 15_000 })
		await wallet.getByRole('button', { name: /add to cart/i }).click()
		await expect(wallet.getByRole('button', { name: /add/i })).toBeVisible()

		await buyerPage
			.getByRole('button')
			.filter({ has: buyerPage.locator('.i-basket') })
			.click()
		await expect(buyerPage.getByRole('heading', { name: /your cart/i })).toBeVisible({ timeout: 10_000 })

		// The cart no longer selects shipping inline — it defers to the checkout
		// page (CartContent renders CartItem with hideShipping) and the
		// Checkout button is enabled purely on cart contents, so click straight
		// through.
		const checkoutButton = buyerPage.getByRole('button', { name: /^Checkout$/i })
		await expect(checkoutButton).toBeEnabled({ timeout: 5_000 })
		await checkoutButton.click()

		await expect(buyerPage.getByText('Shipping Address', { exact: true })).toBeVisible({ timeout: 10_000 })
	})
})
