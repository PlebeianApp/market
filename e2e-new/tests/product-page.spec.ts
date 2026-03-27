// e2e-new/tests/product-page-view.spec.ts
import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { RELAY_URL } from 'e2e-new/test-config'
import { seedComment, seedProduct, seedReaction } from 'e2e-new/helpers/seed'
import { devUser1, devUser2, devUser3 } from '@/lib/fixtures'
import { kinds, type VerifiedEvent } from 'nostr-tools'
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
const getCommentSubmitButton = (page: Page) => page.getByRole('button', { name: /submit/i })

/**
 * Helper to get the reaction button locator
 */
const getReactionButton = (page: Page): Locator => {
	return page.getByTestId('reaction-button')
}

const getReactionsList = (page: Page): Locator => {
	return page.getByTestId('reactions-list')
}

/**
 * Verifies the reaction button is in the "filled" (active) state.
 */
const expectReactionButtonToBeFilled = async (page: Page, expectedEmoji?: string): Promise<void> => {
	const button = getReactionButton(page)

	// Check for the filled background class
	await expect(button).toHaveClass(/bg-secondary/)

	// Check for white text (indicates filled state)
	await expect(button).toHaveClass(/text-white/)

	// Verify the content inside the button
	if (expectedEmoji) {
		const emojiSpan = button.locator('span').filter({ hasText: expectedEmoji })
		await expect(emojiSpan).toBeVisible()
	} else {
		// Check for the Heart Icon (i-heart-fill)
		const heartIcon = button.locator('.i-heart-fill')
		await expect(heartIcon).toBeVisible()
	}
}

/**
 * Verifies the reaction button is in the "unfilled" (inactive) state.
 */
const expectReactionButtonToBeUnfilled = async (page: Page): Promise<void> => {
	const button = getReactionButton(page)

	// Check for transparent background
	await expect(button).toHaveClass(/bg-transparent/)

	// Check for secondary text color
	await expect(button).toHaveClass(/text-secondary/)

	// Verify the icon is the outline version
	const icon = button.locator('.i-heart')
	await expect(icon).toBeVisible()
}

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
		rootKind: currentProductEvent.kind,
	})
}

/**
 * Seeds a reaction on the current product
 */
const seedExistingReaction = async (emoji: string) => {
	if (!currentProductEvent) throw new Error('Product not seeded')
	const relay = await Relay.connect(RELAY_URL)

	return seedReaction(relay, devUser3.sk, {
		emoji,
		targetEventId: currentProductEvent.id,
		targetEventPubkey: currentProductEvent.pubkey,
		targetDTag: currentProductEvent.tags.find((tag) => tag[0] == 'd')?.[1],
		targetKind: 30402,
	})
}

// ==========================================
// == SECTION: Unauthenticated User (View)   ==
// ==========================================

test.describe('Product Page - View Only (Unauthenticated)', () => {
	test('should display correct product details', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const headerContent = unauthenticatedPage.locator('.hero-content-product')

		await expect(headerContent).toBeVisible()
		await expect(headerContent.getByText('View Test Product')).toBeVisible()
		await expect(headerContent.getByText('100.00 USD')).toBeVisible()
		await expect(headerContent.getByText('10 in stock')).toBeVisible()
		await expect(headerContent.getByText('Test Merchant')).toBeVisible()
	})

	test('should show product image', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const headerContent = unauthenticatedPage.locator('.hero-content-product')
		const img = headerContent.locator('img[alt*="View Test Product"]')

		await expect(img).toBeVisible()
		await expect(img).toHaveAttribute('src', /cdn\.satellite\.earth/)
	})

	test('should navigate through tabs and show content', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const tabsList = getTabsList(unauthenticatedPage)
		const tabsPanels = getTabsPanels(unauthenticatedPage)

		// Description
		const descTab = tabsList.getByRole('tab', { name: 'Description' })
		await descTab.click()
		await expect(descTab).toHaveAttribute('data-state', 'active')
		await expect(tabsPanels.getByText('A product for viewing tests.')).toBeVisible()

		// Specs
		const specsTab = tabsList.getByRole('tab', { name: 'Spec' })
		await specsTab.click()
		await expect(specsTab).toHaveAttribute('data-state', 'active')
		await expect(tabsPanels.filter({ has: unauthenticatedPage.getByText('No specifications available') })).toBeVisible()

		// Shipping
		const shippingTab = tabsList.getByRole('tab', { name: 'Shipping' })
		await shippingTab.click()
		await expect(shippingTab).toHaveAttribute('data-state', 'active')
		const shippingPanel = tabsPanels.filter({ has: unauthenticatedPage.getByText('Shipping Options') })
		await expect(shippingPanel).toBeVisible()
		await expect(shippingPanel.getByText('Shipping Information')).toBeVisible()

		// Comments (Empty State)
		const commentsTab = tabsList.getByRole('tab', { name: 'Comments' })
		await commentsTab.click()
		await expect(commentsTab).toHaveAttribute('data-state', 'active')

		const commentsPanel = tabsPanels.filter({ has: unauthenticatedPage.getByText('No comments yet. Be the first to comment!') })
		await expect(commentsPanel).toBeVisible()
		await expect(commentsPanel.getByText('Please log in to leave a comment.')).toBeVisible()
	})
})

// ==========================================
// == SECTION: Authenticated User (Interact) ==
// ==========================================

test.describe('Product Page - Interactions & Social (Authenticated)', () => {
	// --- Comment Tests ---

	test('should allow posting a new comment', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)

		const commentsTab = getTabsList(buyerPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		const input = getCommentInput(buyerPage)
		await expect(input).toBeVisible()

		const testComment = `Test comment ${Date.now()}`
		await input.fill(testComment)
		await getCommentSubmitButton(buyerPage).click()

		await expect(buyerPage.getByText(testComment)).toBeVisible({ timeout: 15000 })
		await expect(input).toHaveValue('')
	})

	test('should allow replying to an existing comment', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		// Seed a comment on product
		await seedExistingComment()

		// Navigate to page, then comments tab
		await buyerPage.goto(`/products/${currentProductId}`)
		const commentsTab = getTabsList(buyerPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// Press reply button on comment
		const replyBtn = buyerPage.locator('button:has-text("Reply")').first()
		await expect(replyBtn).toBeVisible({ timeout: 15000 })
		await replyBtn.click()

		// Check for reply indicator above input
		await expect(buyerPage.getByText(/replying to:/i)).toBeVisible()

		// Post reply comment
		const replyText = `Reply to parent comment`
		const input = getCommentInput(buyerPage)
		await input.fill(replyText)
		await getCommentSubmitButton(buyerPage).click()

		await expect(buyerPage.locator('[data-testid="product-comments"]').getByText(replyText)).toBeVisible()
	})

	test('should cancel comment draft', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)
		await getTabsList(buyerPage).getByRole('tab', { name: 'Comments' }).click()

		const input = getCommentInput(buyerPage)
		await input.fill('Draft text')

		const cancelBtn = buyerPage.getByRole('button', { name: /cancel/i })
		await expect(cancelBtn).toBeVisible()
		await cancelBtn.click()

		await expect(input).toHaveValue('')
	})

	// --- Social Reaction Tests ---

	test('reaction button opens popover with emoji options', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)

		const reactionBtn = getReactionButton(buyerPage)
		await expect(reactionBtn).toBeVisible()

		// Hover to open popover
		await reactionBtn.hover()

		// Verify emojis appear
		await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5000 })
		await expect(buyerPage.getByText('😂')).toBeVisible()
		await expect(buyerPage.getByText('🔥')).toBeVisible()
		await expect(buyerPage.getByText('💰')).toBeVisible()
		await expect(buyerPage.getByText('👀')).toBeVisible()
	})

	test('can add a reaction by selecting an emoji', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)

		const reactionBtn = getReactionButton(buyerPage)
		await reactionBtn.hover()

		// Select Fire emoji
		await buyerPage.getByText('😂').click()

		// Verify button state changes
		await expectReactionButtonToBeFilled(buyerPage, '😂')

		// Remove reaction (click again)
		await reactionBtn.click()

		// Verify it reverts to outline/default state
		await expectReactionButtonToBeUnfilled(buyerPage)
	})

	test('can view existing reactions from other users', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		// Seed a reaction from devUser2 (different user)
		await seedExistingReaction('🔥')

		await buyerPage.goto(`/products/${currentProductId}`)

		// Attempt to find the emoji in the reaction list area
		await expect(getReactionsList(buyerPage).getByText('🔥')).toBeVisible({ timeout: 10000 })
	})

	test('can click an existing reaction to add it', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		// Seed a reaction from someone else
		await seedExistingReaction('💰')

		await buyerPage.goto(`/products/${currentProductId}`)

		// Wait for seeding to complete
		const reactionBtn = getReactionsList(buyerPage).getByRole('button', { name: '💰' })
		await expect(reactionBtn).toBeVisible({ timeout: 15000 })

		// Click the existing reaction
		await reactionBtn.click()

		// Verify the count increases and the reaction button reflects the new state
		await expect(reactionBtn).toBeVisible()
		await expect(reactionBtn.getByText('2')).toBeVisible()
		await expectReactionButtonToBeFilled(buyerPage, '💰')
	})

	test('can remove a reaction by clicking the existing one in the list', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		// Seed a reaction from someone else, then we add ours
		await seedExistingReaction('👀')

		await buyerPage.goto(`/products/${currentProductId}`)

		const reactionBtn = getReactionsList(buyerPage).getByRole('button', { name: '👀' })
		await reactionBtn.click()

		// Now try to remove it by clicking the button again (toggle behavior)
		await reactionBtn.click()

		// Verify removal
		await expect(reactionBtn).toBeVisible()
		await expect(reactionBtn.getByText('1')).toBeVisible()
	})
})
