import { test, expect } from '../fixtures'
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
