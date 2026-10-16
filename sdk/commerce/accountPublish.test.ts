import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../core/testing/publishContext'
import { publishCartSnapshotWorkflow } from './cart'
import { publishNwcWalletListWorkflow } from './payments'
import { publishMigratedProductWorkflow, type SellerProductListingInput } from './products'

const listing: SellerProductListingInput = {
	name: 'Mug',
	summary: '',
	description: 'A mug',
	price: '10',
	quantity: '2',
	currency: 'SATS',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'Home',
	selectedCollection: null,
	categories: [],
	images: [{ imageUrl: 'https://img.test/mug.png', imageOrder: 0 }],
	specs: [],
	shippings: [],
	weight: null,
	dimensions: null,
	isNSFW: false,
}

describe('cart snapshot publishing', () => {
	test('publishes the snapshot as a NIP-78 app data event', async () => {
		const { context, published } = createTestPublishContext()
		await publishCartSnapshotWorkflow(context, { version: 1, items: [] } as never)

		expect(published[0]).toMatchObject({ kind: 30078, tags: [['d', 'plebeian-market-cart']] })
	})
})

describe('NWC wallet list publishing', () => {
	test('encrypts the wallet list to self and never publishes plaintext URIs', async () => {
		const { context, published } = createTestPublishContext()
		const wallets = [{ id: 'w1', nwcUri: 'nostr+walletconnect://secret' }]
		await publishNwcWalletListWorkflow({ ...context, encryptToSelf: async (plaintext) => `enc(${plaintext.length})` }, wallets)

		expect(published[0].content).not.toContain('secret')
		expect(published[0].content).toMatch(/^enc\(\d+\)$/)
		expect(published[0].tags).toEqual([
			['l', 'market_user_nwc_wallets'],
			['client', 'Plebeian Market'],
		])
	})

	test('marks every wallet as stored on Nostr', async () => {
		const { context } = createTestPublishContext()
		let plaintext = ''
		await publishNwcWalletListWorkflow(
			{
				...context,
				encryptToSelf: async (value) => {
					plaintext = value
					return 'enc'
				},
			},
			[{ id: 'w1', storedOnNostr: false }],
		)
		expect(JSON.parse(plaintext)).toEqual([{ id: 'w1', storedOnNostr: true }])
	})
})

describe('NIP-15 migration publishing', () => {
	test('publishes without shipping and tags the original event', async () => {
		const { context, published } = createTestPublishContext()
		const steps: string[] = []
		const outcome = await publishMigratedProductWorkflow(
			{ ...context, createProductId: () => 'product_1', onStep: (step) => steps.push(step) },
			listing,
			'nip15-event-id',
		)

		expect(outcome.ok).toBe(true)
		expect(published[0].kind).toBe(30402)
		expect(published[0].tags).toContainEqual(['migrated', 'nip15-event-id'])
		expect(published[0].tags).toContainEqual(['d', 'product_1'])
		expect(steps).toEqual(['preparing', 'signing', 'publishing', 'done'])
	})

	test('keeps the other listing rules', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishMigratedProductWorkflow({ ...context, createProductId: () => 'p' }, { ...listing, images: [] }, 'x')

		expect(outcome).toEqual({ ok: false, issue: 'product-image-required' })
		expect(published).toHaveLength(0)
	})
})
