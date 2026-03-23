import { expect, test, describe, beforeEach } from 'bun:test'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKPrivateKeySigner, NDKEvent } from '@nostr-dev-kit/ndk'
import { devUser1, devUser2 } from '@/lib/fixtures'
import { createCommentEvent, publishComment } from '@/publish/comments'
import { fetchAllCommentsByProduct, getProductCommentAddress } from '@/queries/comments'
import { COMMENT_KIND, PRODUCT_KIND } from '@/lib/schemas/productComment'

const RELAY_URL = process.env.APP_RELAY_URL
if (!RELAY_URL) {
	throw new Error('APP_RELAY_URL is not set')
}

describe('Comment Publishing', () => {
	beforeEach(async () => {
		ndkActions.initialize([RELAY_URL])
		await ndkActions.connect()
		const signer = new NDKPrivateKeySigner(devUser1.sk)
		await signer.blockUntilReady()
		ndkActions.setSigner(signer)
	})

	test('createCommentEvent creates event with kind 1111', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const event = createCommentEvent(productAddress, 'Test comment', signer, ndk!)

		expect(event.kind).toBe(COMMENT_KIND)
		expect(event.kind).toBe(1111)
	})

	test('createCommentEvent includes A tag with product address', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const event = createCommentEvent(productAddress, 'Test comment', signer, ndk!)

		const aTag = event.tags.find((t) => t[0] === 'A')
		expect(aTag).toBeDefined()
		expect(aTag?.[1]).toBe(productAddress)
	})

	test('createCommentEvent includes K tag with product kind', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const event = createCommentEvent(productAddress, 'Test comment', signer, ndk!)

		const kTag = event.tags.find((t) => t[0] === 'K')
		expect(kTag).toBeDefined()
		expect(kTag?.[1]).toBe(PRODUCT_KIND.toString())
	})

	test('createCommentEvent includes p tag with author pubkey', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const event = createCommentEvent(productAddress, 'Test comment', signer, ndk!)

		const pTag = event.tags.find((t) => t[0] === 'p')
		expect(pTag).toBeDefined()
		expect(pTag?.[1]).toBe(devUser1.pk)
	})

	test('createCommentEvent for reply includes e and k tags', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const parentId = 'parentcommentid123'
		const event = createCommentEvent(productAddress, 'Reply comment', signer, ndk!, parentId)

		const eTag = event.tags.find((t) => t[0] === 'e')
		const kTag = event.tags.find((t) => t[0] === 'k')

		expect(eTag).toBeDefined()
		expect(eTag?.[1]).toBe(parentId)
		expect(kTag).toBeDefined()
		expect(kTag?.[1]).toBe(COMMENT_KIND.toString())
	})

	test('createCommentEvent for reply does not include A tag', () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'test-product')
		const event = createCommentEvent(productAddress, 'Reply comment', signer, ndk!, 'parentid')

		const aTag = event.tags.find((t) => t[0] === 'A')
		expect(aTag).toBeUndefined()
	})
})

describe('Comment roundtrip', () => {
	beforeEach(async () => {
		ndkActions.initialize([RELAY_URL])
		await ndkActions.connect()
		const signer = new NDKPrivateKeySigner(devUser1.sk)
		await signer.blockUntilReady()
		ndkActions.setSigner(signer)
	})

	test('publishComment returns event ID and event is queryable', async () => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()!
		const productAddress = getProductCommentAddress(devUser1.pk, 'e2e-test-product')

		const eventId = await publishComment(productAddress, 'E2E test comment', signer, ndk!)
		expect(typeof eventId).toBe('string')
		expect(eventId.length).toBe(64)

		await new Promise((r) => setTimeout(r, 1000))

		const comments = await fetchAllCommentsByProduct(productAddress)
		const publishedComment = comments.find((c) => c.id === eventId)
		expect(publishedComment).toBeDefined()
		expect(publishedComment?.content).toBe('E2E test comment')
		expect(publishedComment?.authorPubkey).toBe(devUser1.pk)
	})
})
