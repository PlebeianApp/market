// e2e-new/tests/product-page-view.spec.ts
import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { RELAY_URL } from 'e2e-new/test-config'
import { seedComment, seedProduct } from 'e2e-new/helpers/seed'
import { devUser1, devUser2 } from '@/lib/fixtures'
import type { VerifiedEvent } from 'nostr-tools'
import type { Locator, Page } from '@playwright/test'

// ==========================================
// == GLOBAL STATE & SEEDING               ==
// ==========================================

test.use({ scenario: 'base' })

let currentProductId: string | undefined
let currentProductEvent: VerifiedEvent | undefined

// Setup: Seed a product once before each test in the suite

test.beforeAll(async () => {
	const relay = await Relay.connect(RELAY_URL)
	const event = await seedProduct(relay, devUser1.sk, {
		title: 'View Test Product ' + Date.now(),
		description: 'A product for viewing tests.',
		price: '100',
		currency: 'USD',
		status: 'active',
		category: 'electronics',
		stock: '10',
	})
	currentProductId = event.id
	currentProductEvent = event
})

// ==========================================
// == HELPER FUNCTIONS & SELECTORS           ==
// ==========================================

/**
 * Returns the main tabs container locator
 */
const getTabsContainer = (page: Page) => page.locator('[data-slot="tabs"]')

/**
 * Returns the tab list locator
 */
const getTabsList = (page: Page) => getTabsContainer(page).locator('[role="tablist"]')

/**
 * Returns the tab panels locator
 */
const getTabsPanels = (page: Page) => getTabsContainer(page).locator('[role="tabpanel"]')

/**
 * Returns the comment input locator
 */
const getCommentInput = (page: Page) => page.getByPlaceholder(/share your thoughts/i)

/**
 * Returns the submit button for comments
 */
const getCommentSubmitButton = (page: Page) => page.getByRole('button', { name: /post comment|submit/i })

/**
 * Returns the reaction button (heart icon)
 */
const getReactionButton = (page: Page) => page.locator('button:has(.i-heart)').first()

/**
 * Returns the emoji popover options
 */
const getEmojiOptions = (page: Page) => page.locator('[role="menuitem"]') // Adjust selector based on actual popover structure

/**
 * Seeds a comment on the current product
 */
const seedExistingComment = async () => {
	if (!currentProductEvent) throw new Error('Product not seeded')
	const relay = await Relay.connect(RELAY_URL)
	return seedComment(relay, devUser2.sk, {
		content: 'Existing seeded comment for testing.',
		rootEventId: currentProductEvent.id,
		rootEventPubkey: currentProductEvent.pubkey,
		rootKind: 30402,
	})
}

/**
 * Seeds a reaction on the current product
 */
const seedExistingReaction = async (emoji: string) => {
	if (!currentProductEvent) throw new Error('Product not seeded')
	const relay = await Relay.connect(RELAY_URL)
	// Note: Ensure your seedReaction helper supports passing the emoji string
	return seedReaction(relay, devUser2.sk, {
		emoji,
		rootEventId: currentProductEvent.id,
		rootEventPubkey: currentProductEvent.pubkey,
	})
}

// ===================================
// == SECTION: Unauthenticated User ==
// ===================================

test.describe('Product Page - View Only (Unauthenticated)', () => {
	test('should display correct product details', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const headerContent = unauthenticatedPage.locator('.hero-content-product')

		// Ensure Header is there
		await expect(headerContent).toBeVisible()

		// Verify Title
		await expect(headerContent).toContainText('View Test Product')

		// Verify Price
		await expect(headerContent.getByText('100.00 USD')).toBeVisible()
		await expect(headerContent.getByText('10 in stock')).toBeVisible()

		// Verify Seller
		await expect(headerContent.getByText('Test Merchant')).toBeVisible()
	})

	test('should show product image', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const headerContent = unauthenticatedPage.locator('.hero-content-product')

		// Ensure Header is there
		await expect(headerContent).toBeVisible()

		const img = headerContent.locator('img[alt*="View Test Product"]')

		await expect(img).toBeVisible()

		// Check if image has a source
		await expect(img).toHaveAttribute('src', /cdn\.satellite\.earth/)
	})

	test('should navigate through tabs and show content', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Define the main tabs container to scope our interactions
		const tabsContainer = unauthenticatedPage.locator('[data-slot="tabs"]')
		const tabsList = tabsContainer.locator('[role="tablist"]')
		const tabsPanels = tabsContainer.locator('[role="tabpanel"]')

		// --- Description Tab ---
		const descTab = tabsList.getByRole('tab', { name: 'Description' })
		await descTab.click()

		// Verify tab is active
		await expect(descTab).toHaveAttribute('data-state', 'active')

		// Verify Description Content
		await expect(tabsPanels.getByText('A product for viewing tests.')).toBeVisible()

		// --- Specs Tab ---
		const specsTab = tabsList.getByRole('tab', { name: 'Spec' }) // Note: HTML says "Spec", not "Specs"
		await specsTab.click()
		await expect(specsTab).toHaveAttribute('data-state', 'active')

		// Verify Specs Content
		await expect(tabsPanels.filter({ has: unauthenticatedPage.getByText('No specifications available') })).toBeVisible()

		// --- Shipping Tab ---
		const shippingTab = tabsList.getByRole('tab', { name: 'Shipping' })
		await shippingTab.click()
		await expect(shippingTab).toHaveAttribute('data-state', 'active')

		// Verify Shipping Content
		const shippingPanel = tabsPanels.filter({ has: unauthenticatedPage.getByText('Shipping Options') })
		await expect(shippingPanel).toBeVisible()
		await expect(shippingPanel.getByText('Shipping Information')).toBeVisible()

		// --- Comments Tab ---
		const commentsTab = tabsList.getByRole('tab', { name: 'Comments' })
		await commentsTab.click()
		await expect(commentsTab).toHaveAttribute('data-state', 'active')

		// Verify Empty State Message (Scoped to the comments panel)
		const commentsPanel = tabsPanels.filter({ has: unauthenticatedPage.getByText('No comments yet. Be the first to comment!') })
		await expect(commentsPanel).toBeVisible()

		// Verify Login Prompt (Scoped to the comments panel)
		await expect(commentsPanel.getByText('Please log in to leave a comment.')).toBeVisible()
	})
})

// =================================
// == SECTION: Authenticated User ==
// =================================

test.use({ scenario: 'base' })

test.describe('Product Page - Interactions (Authenticated)', () => {
	test('should allow posting a new comment', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await buyerPage.goto(`/products/${currentProductId}`)

		// Switch to Comments Tab
		const commentsTab = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsTab.click()
		await expect(commentsTab).toHaveAttribute('data-state', 'active')

		// Locate the input area
		// Based on HTML: textarea with placeholder "Share your thoughts..."
		const commentInput = await getCommentInputSection(buyerPage)
		await expect(commentInput).toBeVisible()

		const testComment = `Test comment ${Date.now()}`
		await commentInput.fill(testComment)

		// Submit
		await clickCommentSubmitButton(buyerPage)

		// Wait for the comment to appear in the list
		// The HTML shows comments are likely in a list. We look for the text.
		await expect(buyerPage.getByText(testComment)).toBeVisible({ timeout: 15000 })

		// Verify input is cleared
		await expect(commentInput).toHaveValue('')
	})

	test('should allow replying to an existing comment', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await buyerPage.goto(`/products/${currentProductId}`)
		const commentsTab = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// 1. Post the parent comment first
		const parentCommentText = `Parent ${Date.now()}`
		const input = await getCommentInputSection(buyerPage)
		await input.fill(parentCommentText)
		await clickCommentSubmitButton(buyerPage)

		await expect(buyerPage.getByText(parentCommentText)).toBeVisible()

		// 2. Find the reply button for that specific comment
		// Assuming the UI has a reply button near the comment text
		// We use a more specific locator if possible, or generic "Reply" if unique in context
		const replyBtn = buyerPage.locator('button:has-text("Reply")').first()
		await expect(replyBtn).toBeVisible()
		await replyBtn.click()

		// 3. Verify "Replying to" indicator appears
		const replyingTo = buyerPage.getByText(/replying to:/i)
		await expect(replyingTo).toBeVisible()

		// 4. Post the reply
		const replyText = `Reply to ${parentCommentText}`
		await input.fill(replyText)
		await clickCommentSubmitButton(buyerPage)

		// 5. Verify reply appears
		await expect(buyerPage.getByText(replyText)).toBeVisible()
	})

	test('should cancel comment draft', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await buyerPage.goto(`/products/${currentProductId}`)
		const commentsTab = buyerPage.getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		const input = await getCommentInputSection(buyerPage)
		await input.fill('Draft text that will be cancelled')

		const cancelBtn = buyerPage.getByRole('button', { name: /cancel/i })
		await expect(cancelBtn).toBeVisible()
		await cancelBtn.click()

		await expect(input).toHaveValue('')
	})
})
