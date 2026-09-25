import { StorefrontPageSchema, type StorefrontPage } from '@/lib/schemas/storefront'
import { getNostrIo } from '@/lib/nostr/io'

export async function publishStorefrontPage(page: StorefrontPage) {
	const validatedPage = StorefrontPageSchema.parse(page)
	const user = await getNostrIo().getUser()
	if (!user) throw new Error('No active user')

	const event = await getNostrIo().sign({
		kind: 30024,
		content: JSON.stringify(validatedPage),
		tags: [['d', 'storefront-page']],
		created_at: Math.floor(Date.now() / 1000),
	})
	await getNostrIo().publish(event)
	return event
}
