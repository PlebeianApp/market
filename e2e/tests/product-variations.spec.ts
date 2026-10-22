import { expect, test } from '../fixtures'
import { RELAY_URL } from '../test-config'
import { devUser2 } from '@/lib/fixtures'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import type { VerifiedEvent } from 'nostr-tools'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const LOCAL_IMAGE_PATH = path.join(path.dirname(__filename), '..', 'fixtures', 'test-product-image.png')

const PARENT_IMAGE_URL = 'https://fixtures.invalid/variable-parent.png'
const CHILD_IMAGE_URL = 'https://fixtures.invalid/variation-blue.png'
const SENSITIVE_IMAGE_URL = 'https://fixtures.invalid/variation-sensitive.png'
const RESTRICTED_PARENT_IMAGE_URL = 'https://fixtures.invalid/restricted-parent.png'
const ORPHAN_IMAGE_URL = 'https://fixtures.invalid/orphan-child.png'
const SIMPLE_IMAGE_URL = 'https://fixtures.invalid/simple.png'

type CartEnvelope = {
	cart: {
		products: Record<string, { id: string; amount: number; sellerPubkey: string; shippingMethodId?: string | null }>
	}
}

const publishEvent = async (
	relay: Relay,
	privateKey: string,
	kind: number,
	createdAt: number,
	content: string,
	tags: string[][],
): Promise<VerifiedEvent> => {
	const event = finalizeEvent(
		{
			kind,
			created_at: createdAt,
			content,
			tags,
		},
		hexToBytes(privateKey),
	)
	await relay.publish(event)
	return event as VerifiedEvent
}

const publishProduct = (relay: Relay, privateKey: string, createdAt: number, content: string, tags: string[][]) =>
	publishEvent(relay, privateKey, 30_402, createdAt, content, tags)

/**
 * Keep the browser side of this regression hermetic. Fixture image URLs and
 * the currency fallback are fulfilled locally; every other non-local HTTP or
 * WebSocket endpoint is blocked before the first navigation.
 */
async function installLocalOnlyRoutes(page: Page) {
	const blockedHttp: string[] = []
	const blockedWebSockets: string[] = []
	let localRelayResponseDelayMs = 0

	await page.route('**/*', async (route) => {
		const url = new URL(route.request().url())
		if (url.hostname === 'fixtures.invalid' || url.hostname === 'placehold.co') {
			await route.fulfill({ status: 200, contentType: 'image/png', path: LOCAL_IMAGE_PATH })
			return
		}
		if (url.hostname === 'api.yadio.io') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ BTC: { USD: 100_000, EUR: 90_000, GBP: 80_000 } }),
			})
			return
		}
		if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
			await route.continue()
			return
		}
		blockedHttp.push(url.href)
		await route.abort('blockedbyclient')
	})

	await page.routeWebSocket(/.*/, async (webSocket) => {
		const url = new URL(webSocket.url())
		if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
			const server = webSocket.connectToServer()
			server.onMessage((message) => {
				const delayMs = localRelayResponseDelayMs
				if (delayMs > 0) setTimeout(() => webSocket.send(message), delayMs)
				else webSocket.send(message)
			})
			return
		}
		blockedWebSockets.push(url.href)
		await webSocket.close({ code: 1008, reason: 'Local fixture test' })
	})

	return {
		blockedHttp,
		blockedWebSockets,
		setLocalRelayResponseDelay: (delayMs: number) => {
			localRelayResponseDelayMs = delayMs
		},
	}
}

test.use({ scenario: 'none', video: 'on' })

test('Product Variations - variable family selection preserves images, availability, price, stock, and cart identity', async ({
	page,
}, testInfo) => {
	const network = await installLocalOnlyRoutes(page)
	const relay = await Relay.connect(RELAY_URL)
	const fixtureSellerSecretKey = generateSecretKey()
	const fixtureSellerPrivateKey = bytesToHex(fixtureSellerSecretKey)
	const fixtureSellerPubkey = getPublicKey(fixtureSellerSecretKey)
	const suffix = `${Date.now()}-${testInfo.workerIndex}`
	const createdAt = Math.floor(Date.now() / 1000)
	const parentDTag = `fixture-variable-parent-${suffix}`
	const redDTag = `fixture-variation-red-${suffix}`
	const blueDTag = `fixture-variation-blue-${suffix}`
	const soldOutDTag = `fixture-variation-sold-out-${suffix}`
	const preorderDTag = `fixture-variation-preorder-${suffix}`
	const invalidStockDTag = `fixture-variation-invalid-stock-${suffix}`
	const sensitiveDTag = `fixture-variation-sensitive-${suffix}`
	const malformedDTag = `fixture-variation-malformed-${suffix}`
	const foreignDTag = `fixture-variation-foreign-${suffix}`
	const simpleDTag = `fixture-simple-${suffix}`
	const restrictedParentDTag = `fixture-restricted-parent-${suffix}`
	const restrictedChildDTag = `fixture-restricted-child-${suffix}`
	const orphanDTag = `fixture-orphan-child-${suffix}`
	const parentCoordinate = `30402:${fixtureSellerPubkey}:${parentDTag}`
	const restrictedParentCoordinate = `30402:${fixtureSellerPubkey}:${restrictedParentDTag}`
	const shippingDTag = `fixture-standard-shipping-${suffix}`
	const shippingReference = `30406:${fixtureSellerPubkey}:${shippingDTag}`

	let parent: VerifiedEvent
	let simple: VerifiedEvent
	let restrictedChild: VerifiedEvent
	try {
		await publishEvent(relay, fixtureSellerPrivateKey, 30_406, createdAt, 'Synthetic parent-only shipping option.', [
			['d', shippingDTag],
			['title', 'Standard fixture shipping'],
			['price', '50', 'SATS'],
			['service', 'standard'],
			['country', 'US'],
		])
		parent = await publishProduct(relay, fixtureSellerPrivateKey, createdAt, 'Synthetic variable product parent.', [
			['d', parentDTag],
			['title', 'Variation Fixture Jacket'],
			['price', '999', 'SATS'],
			['type', 'variable', 'physical'],
			['visibility', 'on-sale'],
			['stock', '0'],
			['image', PARENT_IMAGE_URL],
			['shipping_option', shippingReference],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 1, 'Red variation with parent-only imagery.', [
			['d', redDTag],
			['title', 'Variation Fixture Jacket - Red'],
			['price', '1000', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '3'],
			['spec', 'Color', 'Red'],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 2, 'Blue variation with its own imagery.', [
			['d', blueDTag],
			['title', 'Variation Fixture Jacket - Blue'],
			['price', '2000', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '7'],
			['spec', 'Color', 'Blue'],
			['image', CHILD_IMAGE_URL],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 3, 'Sold-out variation.', [
			['d', soldOutDTag],
			['title', 'Variation Fixture Jacket - Sold out'],
			['price', '3000', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '0'],
			['spec', 'Color', 'Sold out'],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 4, 'Stockless preorder variation.', [
			['d', preorderDTag],
			['title', 'Variation Fixture Jacket - Preorder'],
			['price', '2500', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'pre-order'],
			['spec', 'Color', 'Preorder'],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 5, 'Variation with malformed stock.', [
			['d', invalidStockDTag],
			['title', 'Variation Fixture Jacket - Invalid stock'],
			['price', '3500', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '-1'],
			['spec', 'Color', 'Invalid stock'],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 6, 'Sensitive variation.', [
			['d', sensitiveDTag],
			['title', 'Variation Fixture Jacket - Sensitive'],
			['price', '4500', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '2'],
			['spec', 'Color', 'Sensitive'],
			['image', SENSITIVE_IMAGE_URL],
			['content-warning', 'nsfw'],
			['a', parentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 7, 'Malformed variation with two parents.', [
			['d', malformedDTag],
			['title', 'Malformed should not group'],
			['price', '4000', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '4'],
			['spec', 'Color', 'Malformed'],
			['a', parentCoordinate],
			['a', `30402:${fixtureSellerPubkey}:another-parent-${suffix}`],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 8, 'Variation with a foreign-author parent coordinate.', [
			['d', foreignDTag],
			['title', 'Foreign relation should not group'],
			['price', '5000', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '5'],
			['spec', 'Color', 'Foreign'],
			['a', `30402:${devUser2.pk}:foreign-parent-${suffix}`],
		])
		simple = await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 9, 'Synthetic simple product.', [
			['d', simpleDTag],
			['title', 'Simple Fixture Mug'],
			['price', '400', 'SATS'],
			['type', 'simple', 'physical'],
			['visibility', 'on-sale'],
			['stock', '4'],
			['image', SIMPLE_IMAGE_URL],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 10, 'Parent-only restricted family.', [
			['d', restrictedParentDTag],
			['title', 'Restricted Parent Fixture'],
			['price', '6000', 'SATS'],
			['type', 'variable', 'physical'],
			['visibility', 'on-sale'],
			['stock', '0'],
			['image', RESTRICTED_PARENT_IMAGE_URL],
			['content-warning', 'nsfw'],
		])
		restrictedChild = await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 11, 'Safe-looking child of a restricted parent.', [
			['d', restrictedChildDTag],
			['title', 'Restricted Parent Fixture - Child'],
			['price', '6100', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '2'],
			['spec', 'Option', 'Child'],
			['a', restrictedParentCoordinate],
		])
		await publishProduct(relay, fixtureSellerPrivateKey, createdAt + 12, 'Child whose declared parent is unavailable.', [
			['d', orphanDTag],
			['title', 'Unavailable Parent Fixture - Child'],
			['price', '7100', 'SATS'],
			['type', 'variation', 'physical'],
			['visibility', 'on-sale'],
			['stock', '2'],
			['image', ORPHAN_IMAGE_URL],
			['a', `30402:${fixtureSellerPubkey}:missing-parent-${suffix}`],
		])
	} finally {
		relay.close()
	}

	// Compile the SPA shell before the first dynamic product request. Use the
	// inert Nostr route instead of the marketplace home page: the per-PR relay is
	// cumulative, so warming `/` would render products seeded by earlier specs
	// and record their unrelated external image URLs in this test's isolation
	// assertion.
	await page.goto('/nostr/')
	await expect(page.getByText('Hello "/nostr/"!')).toBeVisible()
	expect(network.blockedHttp).toEqual([])
	await page.goto(`/products/${parent.id}`)
	const productHero = page.locator('.hero-content-product')
	await expect(productHero.getByRole('heading', { name: 'Variation Fixture Jacket' })).toBeVisible({ timeout: 30_000 })

	const selector = page.getByTestId('product-variation-selector')
	await expect(selector).toBeVisible({ timeout: 30_000 })
	await expect(selector.getByRole('button')).toHaveText(['Blue', 'Invalid stock', 'Preorder', 'Red', 'Sensitive', 'Sold out'])
	await expect(selector.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled()
	await expect(selector.getByRole('button', { name: 'Invalid stock', exact: true })).toBeDisabled()
	await expect(selector.getByRole('button', { name: 'Preorder', exact: true })).toBeEnabled()
	await expect(selector.getByRole('button', { name: 'Malformed', exact: true })).toHaveCount(0)
	await expect(selector.getByRole('button', { name: 'Foreign', exact: true })).toHaveCount(0)

	await selector.getByRole('button', { name: 'Red', exact: true }).click()
	await expect(productHero.getByText('1,000 sats', { exact: true })).toBeVisible({ timeout: 15_000 })
	await expect(productHero.getByText('3 in stock', { exact: true })).toBeVisible()
	const selectedImage = page.getByAltText('Variation Fixture Jacket - Image 1')
	await expect(selectedImage).toHaveAttribute('src', PARENT_IMAGE_URL)
	await expect(selectedImage).toBeVisible()
	const redScreenshot = testInfo.outputPath('variation-red-parent-image.png')
	await page.screenshot({ path: redScreenshot })
	await testInfo.attach('red variation uses parent image', { path: redScreenshot, contentType: 'image/png' })

	await selector.getByRole('button', { name: 'Blue', exact: true }).click()
	await expect(productHero.getByText('2,000 sats', { exact: true })).toBeVisible()
	await expect(productHero.getByText('7 in stock', { exact: true })).toBeVisible()
	await expect(selectedImage).toHaveAttribute('src', CHILD_IMAGE_URL)
	await expect(selectedImage).toBeVisible()
	const blueScreenshot = testInfo.outputPath('variation-blue-child-image.png')
	await page.screenshot({ path: blueScreenshot })
	await testInfo.attach('blue variation uses child image', { path: blueScreenshot, contentType: 'image/png' })

	await selector.getByRole('button', { name: 'Preorder', exact: true }).click()
	await expect(productHero.getByText('2,500 sats', { exact: true })).toBeVisible()
	await expect(productHero.getByText('Pre-order', { exact: true }).first()).toBeVisible()
	await expect(productHero.getByRole('button', { name: 'Pre-order', exact: true })).toBeEnabled()

	await selector.getByRole('button', { name: 'Red', exact: true }).click()
	await productHero.getByRole('button', { name: 'Add to cart', exact: true }).click()
	await expect
		.poll(
			async () => {
				const rawCart = await page.evaluate(() => sessionStorage.getItem('cart'))
				if (!rawCart) return null
				return Object.keys((JSON.parse(rawCart) as CartEnvelope).cart.products)
			},
			{ timeout: 30_000 },
		)
		.toEqual([redDTag])
	const cart = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cart')!) as CartEnvelope)
	expect(cart.cart.products[redDTag]).toMatchObject({
		id: redDTag,
		amount: 1,
		sellerPubkey: fixtureSellerPubkey,
	})
	expect(cart.cart.products[parentDTag]).toBeUndefined()
	expect(cart.cart.products[blueDTag]).toBeUndefined()

	await page.goto('/checkout')
	await expect(page.getByText(/Standard fixture shipping/).first()).toBeVisible({ timeout: 30_000 })
	await expect(page.getByAltText('Variation Fixture Jacket - Red')).toHaveAttribute('src', PARENT_IMAGE_URL)

	await page.evaluate(
		({ orphanDTag, redDTag, sellerPubkey, shippingReference }) => {
			const rawCart = sessionStorage.getItem('cart')
			if (!rawCart) throw new Error('Expected a persisted cart fixture')
			const envelope = JSON.parse(rawCart)
			const selected = envelope.cart.products[redDTag]
			envelope.cart.products = {
				[orphanDTag]: {
					...selected,
					id: orphanDTag,
					shippingMethodId: shippingReference,
					shippingMethodName: 'Stale fixture shipping',
				},
			}
			envelope.cart.sellers[sellerPubkey].productIds = [orphanDTag]
			sessionStorage.setItem('cart', JSON.stringify(envelope))
		},
		{ orphanDTag, redDTag, sellerPubkey: fixtureSellerPubkey, shippingReference },
	)
	network.setLocalRelayResponseDelay(2_000)
	await page.reload({ waitUntil: 'domcontentloaded' })
	const continueToReview = page.getByRole('button', { name: 'Continue to Review' })
	await expect(continueToReview).toBeDisabled()
	network.setLocalRelayResponseDelay(0)
	await expect(page.getByTestId('cart-product-parent-unavailable')).toBeVisible({ timeout: 30_000 })
	await expect(page.locator(`img[src="${ORPHAN_IMAGE_URL}"]`)).toHaveCount(0)
	await expect(continueToReview).toBeDisabled()
	await expect
		.poll(async () => {
			const rawCart = await page.evaluate(() => sessionStorage.getItem('cart'))
			return rawCart ? (JSON.parse(rawCart) as CartEnvelope).cart.products[orphanDTag]?.shippingMethodId : undefined
		})
		.toBeNull()

	await page.goto(`/products/${simple.id}`)
	const simpleHero = page.locator('.hero-content-product')
	await expect(simpleHero.getByRole('heading', { name: 'Simple Fixture Mug' })).toBeVisible({ timeout: 30_000 })
	await expect(simpleHero.getByText('400 sats', { exact: true })).toBeVisible({ timeout: 15_000 })
	await expect(simpleHero.getByText('4 in stock', { exact: true })).toBeVisible()
	await expect(page.getByTestId('product-variation-selector')).toHaveCount(0)
	const simpleImage = page.getByAltText('Simple Fixture Mug - Image 1')
	await expect(simpleImage).toHaveAttribute('src', SIMPLE_IMAGE_URL)
	await expect(simpleHero.getByRole('button', { name: 'Add to cart', exact: true })).toBeEnabled()
	const simpleScreenshot = testInfo.outputPath('simple-product-unchanged.png')
	await page.screenshot({ path: simpleScreenshot })
	await testInfo.attach('simple product unchanged', { path: simpleScreenshot, contentType: 'image/png' })

	await page.goto(`/products/${parent.id}`)
	const sensitiveSelector = page.getByTestId('product-variation-selector')
	await sensitiveSelector.getByRole('button', { name: 'Sensitive', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Adult Content' })).toBeVisible()
	await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
	await expect(page.locator(`img[src="${SENSITIVE_IMAGE_URL}"]`)).toHaveCount(0)
	await expect(page.locator('style').filter({ hasText: SENSITIVE_IMAGE_URL })).toHaveCount(0)

	const restrictedResponse = await page.goto(`/products/${restrictedChild.id}`)
	expect(await restrictedResponse?.text()).not.toContain(RESTRICTED_PARENT_IMAGE_URL)
	await expect(page.getByRole('heading', { name: 'Adult Content' })).toBeVisible({ timeout: 30_000 })
	await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
	await expect(page.locator(`img[src="${RESTRICTED_PARENT_IMAGE_URL}"]`)).toHaveCount(0)
	await expect(page.locator('style').filter({ hasText: RESTRICTED_PARENT_IMAGE_URL })).toHaveCount(0)

	// The ContextVM client is expected to try its configured public relay, but
	// routeWebSocket prevents any connection. No other external traffic is allowed.
	expect(network.blockedWebSockets.every((url) => url.startsWith('wss://relay.contextvm.org'))).toBe(true)
	expect(network.blockedHttp).toEqual([])
})
