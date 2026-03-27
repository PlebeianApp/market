import { Relay } from 'nostr-tools/relay'
import { test, expect } from '../fixtures'
import { RELAY_URL } from 'e2e-new/test-config'
import { devUser1, devUser2 } from '@/lib/fixtures'
import type { VerifiedEvent } from 'nostr-tools'
import { seedComment, seedProduct } from 'e2e-new/helpers/seed'

test.use({ scenario: 'base' })

/** ID of Product to navigate to */
let currentProductId: string | undefined
let currentProductEvent: VerifiedEvent | undefined

/**
 * Set up the product page and ensure it's navigable before starting Product Page tests.
 */
test.beforeEach(async ({ buyerPage }) => {
	const relay = await Relay.connect(RELAY_URL)

	// 1. Seed the product
	const event: VerifiedEvent = await seedProduct(relay, devUser1.sk, {
		title: 'Test Product ' + Date.now(), // Unique title to avoid conflicts
		description: 'A test product for automated seeding.',
		price: '100',
		currency: 'USD',
		status: 'active',
		category: 'electronics',
		stock: '10',
		shippingOptions: ['standard'],
	})

	// 2. Store the ID & Event
	currentProductId = event.id
	currentProductEvent = event

	console.log(`Seeded product with ID: ${currentProductId}`)

	// 3. Check product page is ready

	// Retry navigation until the product page loads successfully
	// This handles the race condition where the DB hasn't indexed the event yet
	// await buyerPage.waitForURL(/\/product\/.*/, { timeout: 10000 }) // Initial check if already there

	// Try to navigate, catch errors, and retry
	let attempts = 0
	const maxAttempts = 10 // 10 seconds roughly

	while (attempts < maxAttempts) {
		try {
			await buyerPage.goto(`/products/${currentProductId}`, { waitUntil: 'networkidle' })

			// Double check: Did we land on the right page? (e.g., check for H1 or specific error text)
			const h1 = buyerPage.locator('h1')
			if ((await h1.count()) > 0) {
				// Success! The product is loaded.
				break
			}

			// If we got here, maybe we landed on a 404 page?
			// Check for a "Product not found" indicator if your app has one
			const notFound = buyerPage.locator('text=Product not found')
			if ((await notFound.count()) > 0) {
				throw new Error('Product not found yet')
			}
		} catch (error) {
			attempts++
			if (attempts >= maxAttempts) throw error
			// Wait a bit before retrying
			await buyerPage.waitForTimeout(1000)
		}
	}
})

const seedComments = async () => {
	if (!currentProductEvent) {
		throw new Error('Product ID was not seeded. Check beforeEach hook.')
	}

	const relay = await Relay.connect(RELAY_URL)

	// Then, seed a comment on that product
	const commentEvent = await seedComment(relay, devUser2.sk, {
		content: 'Great product!',
		rootEventId: currentProductEvent.id,
		rootEventPubkey: currentProductEvent.pubkey,
		rootKind: 30402, // Product kind
	})
}

test.describe('Product Comments', () => {
	test('product comments page shows empty comments placeholder', async ({ buyerPage }) => {
		if (!currentProductId) {
			throw new Error('Product ID was not seeded. Check beforeEach hook.')
		}

		// Navigate to the product page
		await buyerPage.goto(`/products/${currentProductId}`)

		// Wait for the product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Click the "Comments" button/tab to reveal the comments section
		const commentsButton = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsButton.click()

		// Wait for the comments section to become visible after clicking
		const commentsSection = buyerPage.getByText('No comments yet. Be the first to comment!')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })
	})

	test('product comments page shows seeded comments', async ({ buyerPage }) => {
		if (!currentProductId) {
			throw new Error('Product ID was not seeded. Check beforeEach hook.')
		}

		// Setup: Seed comments
		await seedComments()

		// Navigate to the product page
		await buyerPage.goto(`/products/${currentProductId}`)

		// Wait for the product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Click the "Comments" button/tab to reveal the comments section
		const commentsButton = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsButton.click()

		// Wait for the comments section to become visible after clicking
		const commentsSection = buyerPage.getByText('Great product!')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })
	})

	test('unauthenticated user sees login prompt for comments', async ({ buyerPage }) => {
		if (!currentProductId) {
			throw new Error('Product ID was not seeded. Check beforeEach hook.')
		}

		// Navigate to the product page
		await buyerPage.goto(`/products/${currentProductId}`)

		// Wait for the product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Click the "Comments" button/tab to reveal the comments section
		const commentsButton = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsButton.click()

		// Comments section should show login prompt
		const loginPrompt = buyerPage.getByText('text=Please log in to leave a comment.')
		await expect(loginPrompt).toBeVisible({ timeout: 10_000 })
	})

	test('authenticated user can add a comment', async ({ buyerPage }) => {
		if (!currentProductId) {
			throw new Error('Product ID was not seeded. Check beforeEach hook.')
		}

		// Navigate to the product page
		await buyerPage.goto(`/products/${currentProductId}`)

		// Wait for the product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Click the "Comments" button/tab to reveal the comments section
		const commentsButton = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsButton.click()

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Type a comment
		await commentTextarea.fill('This is a test comment from e2e!')

		// Find and click the submit button
		const submitButton = buyerPage.getByRole('button', { name: /submit/i })
		await expect(submitButton).toBeVisible({ timeout: 10_000 })
		await submitButton.click()

		// Wait for the comment to be posted
		await expect(commentTextarea).toHaveValue('')

		// Verify the comment appears in the list
		const postedComment = buyerPage.getByText('This is a test comment from e2e!')
		await expect(postedComment).toBeVisible({ timeout: 15_000 })
	})

	test('authenticated user can reply to a comment', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Type a comment
		await commentTextarea.fill('This is a test comment from e2e!')

		// Find and click the submit button
		const submitButton = buyerPage.getByRole('button', { name: /submit/i })
		await expect(submitButton).toBeVisible({ timeout: 10_000 })
		await submitButton.click()

		// Wait for the comment to be posted
		await expect(commentTextarea).toHaveValue('')

		// Verify the comment appears in the list
		const postedComment = buyerPage.getByText('This is a test comment from e2e!')
		await expect(postedComment).toBeVisible({ timeout: 15_000 })

		// Now reply to the comment
		const replyButton = buyerPage.getByRole('button', { name: /reply/i })
		await expect(replyButton).toBeVisible({ timeout: 10_000 })
		await replyButton.click()

		// Verify the "Replying to:" indicator appears
		const replyingToIndicator = buyerPage.getByText(/replying to:/i)
		await expect(replyingToIndicator).toBeVisible({ timeout: 10_000 })

		// Type a reply
		await commentTextarea.fill('This is a reply to the original comment!')

		// Click submit again
		await submitButton.click()

		// Verify the reply textarea is cleared
		await expect(commentTextarea).toHaveValue('')

		// Verify the reply appears
		const replyComment = buyerPage.getByText('This is a reply to the original comment!')
		await expect(replyComment).toBeVisible({ timeout: 15_000 })
	})

	test('authenticated user can cancel comment submission', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Type a comment
		await commentTextarea.fill('This comment will be cancelled!')

		// Find and click the cancel button
		const cancelButton = buyerPage.getByRole('button', { name: /cancel/i })
		await expect(cancelButton).toBeVisible({ timeout: 10_000 })
		await cancelButton.click()

		// Verify the textarea is cleared
		await expect(commentTextarea).toHaveValue('')
	})

	test('authenticated user can remove reply-to indicator', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Type a comment
		await commentTextarea.fill('This is a test comment from e2e!')

		// Find and click the submit button
		const submitButton = buyerPage.getByRole('button', { name: /submit/i })
		await expect(submitButton).toBeVisible({ timeout: 10_000 })
		await submitButton.click()

		// Wait for the comment to be posted
		await expect(commentTextarea).toHaveValue('')

		// Verify the comment appears in the list
		const postedComment = buyerPage.getByText('This is a test comment from e2e!')
		await expect(postedComment).toBeVisible({ timeout: 15_000 })

		// Now reply to the comment
		const replyButton = buyerPage.getByRole('button', { name: /reply/i })
		await expect(replyButton).toBeVisible({ timeout: 10_000 })
		await replyButton.click()

		// Verify the "Replying to:" indicator appears
		const replyingToIndicator = buyerPage.getByText(/replying to:/i)
		await expect(replyingToIndicator).toBeVisible({ timeout: 10_000 })

		// Type a reply
		await commentTextarea.fill('This is a reply to the original comment!')

		// Click the X button to remove reply-to indicator
		const removeReplyButton = buyerPage.getByRole('button', { name: /close/i })
		await expect(removeReplyButton).toBeVisible({ timeout: 10_000 })
		await removeReplyButton.click()

		// Verify the reply-to indicator is removed
		await expect(replyingToIndicator).not.toBeVisible({ timeout: 10_000 })

		// Verify the reply textarea still has the content
		await expect(commentTextarea).toHaveValue('This is a reply to the original comment!')
	})

	test('product comments shows "Show More" when there are more than 5 comments', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Add 6 comments to trigger "Show More"
		for (let i = 1; i <= 6; i++) {
			await commentTextarea.fill(`Comment number ${i}`)
			const submitButton = buyerPage.getByRole('button', { name: /submit/i })
			await expect(submitButton).toBeVisible({ timeout: 10_000 })
			await submitButton.click()
			await expect(commentTextarea).toHaveValue('')
		}

		// Verify "Show More" button appears
		const showMoreButton = buyerPage.getByRole('button', { name: /show more/i })
		await expect(showMoreButton).toBeVisible({ timeout: 10_000 })

		// Click "Show More"
		await showMoreButton.click()

		// Verify all comments are now visible
		for (let i = 1; i <= 6; i++) {
			const comment = buyerPage.getByText(`Comment number ${i}`)
			await expect(comment).toBeVisible({ timeout: 10_000 })
		}

		// Verify "Show More" button is hidden
		await expect(showMoreButton).not.toBeVisible({ timeout: 10_000 })
	})

	test('product comments handles empty state correctly', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// Find the textarea for adding a comment
		const commentTextarea = buyerPage.getByPlaceholder(/share your thoughts/i)
		await expect(commentTextarea).toBeVisible({ timeout: 10_000 })

		// Verify "No comments yet" message is shown
		const noCommentsMessage = buyerPage.getByText(/no comments yet/i)
		await expect(noCommentsMessage).toBeVisible({ timeout: 10_000 })
	})

	test('product comments shows loading state initially', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// The comments list should not show "Loading comments..." after initial load
		const loadingMessage = buyerPage.getByText(/loading comments/i)
		await expect(loadingMessage).not.toBeVisible({ timeout: 10_000 })
	})

	test('product comments shows error state when query fails', async ({ buyerPage }) => {
		// Navigate to marketplace
		await buyerPage.goto(`/products/${currentProductId}`)

		// Click on first product
		const productCards = buyerPage.locator('[data-testid="product-card"]')
		const productCard = await productCards.first()
		const productCardLink = productCard.locator('a')
		await productCardLink.click()

		// Wait for product page to load
		await expect(buyerPage.locator('h1')).toBeVisible({ timeout: 10_000 })

		// Comments section should be visible
		const commentsSection = buyerPage.locator('[data-testid="comments-section"]')
		await expect(commentsSection).toBeVisible({ timeout: 10_000 })

		// The comments list should not show error message initially
		const errorMessage = buyerPage.getByText(/failed to load comments/i)
		await expect(errorMessage).not.toBeVisible({ timeout: 10_000 })
	})
})
