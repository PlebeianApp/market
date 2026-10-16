import { describe, expect, test } from 'bun:test'
import { createTestPublishContext } from '../../core/testing/publishContext'
import { deleteProductListingWorkflow, publishProductListingWorkflow } from './productPublish'
import type { SellerProductListingInput } from './productListingWorkflow'

const listing: SellerProductListingInput = {
	name: 'Mug',
	summary: '',
	description: 'Ceramic mug',
	price: '21',
	currency: 'SATS',
	quantity: '3',
	status: 'on-sale',
	productType: 'single',
	mainCategory: 'Home',
	selectedCollection: null,
	categories: [],
	images: [{ imageUrl: 'https://images.example/mug.jpg', imageOrder: 0 }],
	specs: [],
	shippings: [{ shipping: { id: '30406:seller:post', name: 'Post' }, extraCost: '' }],
	weight: null,
	dimensions: null,
	isNSFW: false,
} as SellerProductListingInput

describe('product publish workflow', () => {
	test('publishes a listing with a new d tag and returns its coordinate', async () => {
		const { context, published } = createTestPublishContext('seller')
		const outcome = await publishProductListingWorkflow({ ...context, createProductId: () => 'product_new' }, listing)
		if (!outcome.ok) throw new Error(outcome.issue)
		expect(outcome.coordinate).toBe('30402:seller:product_new')
		expect(published).toHaveLength(1)
		expect(published[0].kind).toBe(30402)
		expect(published[0].tags).toContainEqual(['d', 'product_new'])
	})

	test('updates keep the existing d tag and pass the host client tag through', async () => {
		const { context, published } = createTestPublishContext('seller')
		await publishProductListingWorkflow(
			{ ...context, createProductId: () => 'unused', clientTag: ['client', 'Market'] },
			listing,
			'product_old',
		)
		expect(published[0].tags).toContainEqual(['d', 'product_old'])
		expect(published[0].tags).toContainEqual(['client', 'Market'])
	})

	test('invalid listings return the issue and publish nothing', async () => {
		const { context, published } = createTestPublishContext()
		const outcome = await publishProductListingWorkflow({ ...context, createProductId: () => 'x' }, { ...listing, name: ' ' })
		expect(outcome).toEqual({ ok: false, issue: 'product-name-required' })
		expect(published).toHaveLength(0)
	})

	test('delete targets the author listing coordinate', async () => {
		const { context, published } = createTestPublishContext('seller')
		await deleteProductListingWorkflow(context, 'mug')
		expect(published[0]).toMatchObject({ kind: 5, tags: [['a', '30402:seller:mug']] })
	})
})
