import { describe, expect, test } from 'bun:test'
import type { EventTemplate } from 'nostr-tools/pure'
import { deleteShippingOptionWorkflow, publishShippingOptionWorkflow, type ShippingPublishContext } from './shippingPublish'
import { getShippingInfo, getShippingPickupAddressString, parseShippingReference } from './shippingReadModel'
import type { ShippingOptionFormInput } from './shippingWorkflow'

type Signed = EventTemplate & { id: string; pubkey: string }

function createContext() {
	const published: Signed[] = []
	const context: ShippingPublishContext<Signed> = {
		authorPubkey: 'seller',
		now: () => 1_700_000_000,
		createShippingId: () => 'shipping_new',
		signer: { sign: async (template) => ({ ...template, id: `id-${published.length}`, pubkey: 'seller' }) },
		publish: async (event) => {
			published.push(event)
		},
	}
	return { context, published }
}

const form: ShippingOptionFormInput = {
	title: 'Post',
	description: 'Tracked post',
	price: '5',
	currency: 'USD',
	countries: ['DE'],
	service: 'standard',
} as ShippingOptionFormInput

describe('shipping publish workflow', () => {
	test('publishes a new option through the injected signer and publisher', async () => {
		const { context, published } = createContext()
		const outcome = await publishShippingOptionWorkflow(context, form)

		expect(outcome).toMatchObject({ ok: true, shippingDTag: 'shipping_new', shippingRef: '30406:seller:shipping_new' })
		expect(published).toHaveLength(1)
		expect(published[0].kind).toBe(30406)
		expect(published[0].created_at).toBe(1_700_000_000)
		expect(getShippingInfo({ ...published[0], pubkey: 'seller' })).toMatchObject({ id: 'shipping_new', title: 'Post', countries: ['DE'] })
	})

	test('updates keep the existing d tag', async () => {
		const { context } = createContext()
		const outcome = await publishShippingOptionWorkflow(context, form, 'shipping_existing')
		expect(outcome.ok && outcome.shippingDTag).toBe('shipping_existing')
	})

	test('invalid forms return an issue and publish nothing', async () => {
		const { context, published } = createContext()
		const outcome = await publishShippingOptionWorkflow(context, { ...form, title: '' })
		expect(outcome).toEqual({ ok: false, issue: 'shipping-title-required' })
		expect(published).toHaveLength(0)
	})

	test('publish failures propagate instead of reporting success', async () => {
		const { context } = createContext()
		context.publish = async () => {
			throw new Error('no relay accepted')
		}
		await expect(publishShippingOptionWorkflow(context, form)).rejects.toThrow('no relay accepted')
	})

	test('delete references the author coordinate', async () => {
		const { context, published } = createContext()
		await deleteShippingOptionWorkflow(context, 'shipping_old')
		expect(published[0]).toMatchObject({ kind: 5, tags: [['a', '30406:seller:shipping_old']] })
	})
})

describe('shipping read model', () => {
	test('parses composite and bare references', () => {
		expect(parseShippingReference('30406:seller:abc')).toBe('abc')
		expect(parseShippingReference('abc')).toBe('abc')
		expect(parseShippingReference('30402:seller:abc')).toBe('30402:seller:abc')
	})

	test('formats structured and legacy pickup addresses', () => {
		const base = { pubkey: 'p', tags: [] as string[][] }
		expect(
			getShippingPickupAddressString({
				...base,
				tags: [
					['pickup-street', '1 Main'],
					['pickup-city', 'Berlin'],
				],
			}),
		).toBe('1 Main, Berlin')
		expect(getShippingPickupAddressString({ ...base, tags: [['pickup-address', 'Shop, Berlin']] })).toBe('Shop, Berlin')
		expect(getShippingPickupAddressString(base)).toBeNull()
	})

	test('rejects options missing required tags', () => {
		expect(
			getShippingInfo({
				pubkey: 'p',
				tags: [
					['d', 'x'],
					['price', '1', 'USD'],
				],
			}),
		).toBeNull()
	})
})
