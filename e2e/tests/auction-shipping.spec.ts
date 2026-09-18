import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { useWebSocketImplementation } from 'nostr-tools/relay'
import { RELAY_URL } from '../test-config'
import { devUser1 } from '@/lib/fixtures'
import { seedAuction } from '../scenarios'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

test.use({ scenario: 'merchant' })

test.describe('Auction Shipping Display', () => {
	test('shows resolved shipping option details', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		const auctionEvent = await seedAuction(relay, devUser1.sk, {
			title: 'Shipping Display Test',
			shippingOptions: [{ shippingRef: `30406:${devUser1.pk}:worldwide-standard` }],
		})
		relay.close()

		await merchantPage.goto(`/auctions/${auctionEvent.id}`)
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('tab', { name: 'Description' }).click()

		await expect(merchantPage.getByText('Worldwide Standard')).toBeVisible({ timeout: 15_000 })
		await expect(merchantPage.getByText('Base:')).toBeVisible()
	})

	test('deduplicates shipping refs by shippingRef, first occurrence wins', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const shippingRef = `30406:${devUser1.pk}:digital-delivery`
		const relay = await Relay.connect(RELAY_URL)
		const auctionEvent = await seedAuction(relay, devUser1.sk, {
			title: 'Dedup Test',
			shippingOptions: [
				{ shippingRef, extraCost: '0' },
				{ shippingRef, extraCost: '500' },
			],
		})
		relay.close()

		await merchantPage.goto(`/auctions/${auctionEvent.id}`)
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('tab', { name: 'Description' }).click()

		const shippingItems = merchantPage.locator('li').filter({ hasText: 'Digital Delivery' })
		await expect(shippingItems).toHaveCount(1, { timeout: 15_000 })
	})

	test('shows unavailable for unresolvable shipping ref', async ({ merchantPage }) => {
		test.setTimeout(60_000)

		const relay = await Relay.connect(RELAY_URL)
		const auctionEvent = await seedAuction(relay, devUser1.sk, {
			title: 'NotFound Test',
			shippingOptions: [{ shippingRef: '30406:deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678:nonexistent' }],
		})
		relay.close()

		await merchantPage.goto(`/auctions/${auctionEvent.id}`)
		await merchantPage.waitForLoadState('networkidle')

		await merchantPage.getByRole('tab', { name: 'Description' }).click()

		await expect(merchantPage.getByText('Shipping option unavailable')).toBeVisible({ timeout: 15_000 })
	})
})
