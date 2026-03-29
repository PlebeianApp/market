import { describe, expect, test } from 'bun:test'
import { ProductCommentsPanelContent } from '@/components/products/ProductCommentsPanel'
import { renderToStaticMarkup } from 'react-dom/server'

describe('ProductCommentsPanelContent', () => {
	test('renders loading state', () => {
		const html = renderToStaticMarkup(
			<ProductCommentsPanelContent
				comments={[]}
				isLoading
				canCompose={false}
				isPending={false}
				draft=""
				onDraftChange={() => {}}
				onPublish={() => {}}
			/>,
		)

		expect(html).toContain('Loading comments')
	})

	test('renders empty state and unauthenticated prompt', () => {
		const html = renderToStaticMarkup(
			<ProductCommentsPanelContent
				comments={[]}
				isLoading={false}
				canCompose={false}
				isPending={false}
				draft=""
				onDraftChange={() => {}}
				onPublish={() => {}}
			/>,
		)

		expect(html).toContain('No comments yet.')
		expect(html).toContain('Connect a Nostr signer to post a comment.')
	})
})
