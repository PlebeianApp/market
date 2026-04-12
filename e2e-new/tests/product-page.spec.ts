// e2e-new/tests/product-page-view.spec.ts
import { test, expect } from '../fixtures'
import { Relay } from 'nostr-tools/relay'
import { RELAY_URL } from 'e2e-new/test-config'
import { devUser1, devUser2, devUser3 } from '@/lib/fixtures'
import { kinds, type VerifiedEvent } from 'nostr-tools'
import type { Locator, Page } from '@playwright/test'
import { seedComment, seedProduct, seedReaction } from 'e2e-new/scenarios'

// ==========================================
// == GLOBAL STATE & SEEDING               ==
// ==========================================

let currentProductId: string | undefined
let currentProductEvent: VerifiedEvent | undefined

// Setup: Seed a product once before each test in the suite

test.beforeEach(async () => {
	const relay = await Relay.connect(RELAY_URL)
	const event = await seedProduct(relay, devUser1.sk, {
		title: 'View Test Product ' + Date.now(),
		description: 'A product for viewing tests.',
		price: '100',
		currency: 'USD',
		status: 'active',
		category: 'electronics',
		stock: '10',
		dTag: 'test-product-' + Date.now(),
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
 * Returns the comment input locator for reply field within a comment
 */
const getCommentInputReply = (comment: Locator) => comment.getByPlaceholder(/write your reply/i)

/**
 * Returns the submit button for comments
 */
const getCommentSubmitButton = (page: Page) => page.getByRole('button', { name: /submit/i })

/**
 * Returns the submit button for comments for reply fields within a comment
 */
const getCommentSubmitButtonReply = (comment: Locator) => comment.getByRole('button', { name: /submit/i })

/**
 * Helper to get the reaction button locator
 */
const getProductHero = (page: Page): Locator => page.locator('.hero-content-product')

const getReactionButton = (page: Page): Locator => {
	return getProductHero(page).getByTestId('reaction-button')
}

const getReactionsList = (page: Page): Locator => {
	return page.getByTestId('reactions-list')
}

const getZapButton = (page: Page): Locator => {
	return getProductHero(page).getByTestId('zap-button')
}

const getCommentButton = (page: Page): Locator => {
	return getProductHero(page).getByTestId('comment-button')
}

const getShareButton = (page: Page): Locator => {
	return getProductHero(page).getByTestId('share-button')
}

/**
 * Verifies the reaction button is in the "filled" (active) state.
 */
const expectReactionButtonToBeFilled = async (page: Page, expectedEmoji?: string): Promise<void> => {
	const button = getReactionButton(page)

	// Check for the filled background class
	await expect(button).toHaveClass(/bg-neo-purple/)

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

	// Check for neo-purple text color (unfilled state)
	await expect(button).toHaveClass(/text-neo-purple/)

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
		rootEventDTag: currentProductEvent.tags.find((tag) => tag[0] == 'd')?.[1],
		rootKind: currentProductEvent.kind,
	})
}

/**
 * Seeds a reaction on the current product
 */
const seedExistingReaction = async (emoji: string, skUser = devUser3.sk) => {
	if (!currentProductEvent) throw new Error('Product not seeded')
	const relay = await Relay.connect(RELAY_URL)

	return seedReaction(relay, skUser, {
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

test.use({ scenario: 'base' })

test.describe('Product Page - View Only (Unauthenticated)', () => {
	// --- SocialInteractions Tests ---

	test('should display correct product details', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const headerContent = unauthenticatedPage.locator('.hero-content-product')

		await expect(headerContent).toBeVisible()
		await expect(headerContent.getByText('View Test Product')).toBeVisible()
		await expect(headerContent.getByText(/100(?:\.00)?\s+USD/)).toBeVisible({ timeout: 15000 })
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

	test('should display SocialInteractions component at product level', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Verify ReactionButton is visible
		await expect(getReactionButton(unauthenticatedPage)).toBeVisible({ timeout: 15000 })

		// Verify ZapButton is visible
		await expect(getZapButton(unauthenticatedPage)).toBeVisible({ timeout: 15000 })

		// Verify CommentButton is visible
		await expect(getCommentButton(unauthenticatedPage)).toBeVisible({ timeout: 15000 })

		// Verify ShareButton is visible
		await expect(getShareButton(unauthenticatedPage)).toBeVisible({ timeout: 15000 })
	})

	test('should display ReactionsList for product reactions', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)

		// Verify ReactionsList container exists (even if empty)
		const reactionsList = getReactionsList(buyerPage)
		await expect(reactionsList).toBeAttached() // Use beAttached instead of beVisible since it might be empty
	})

	test('should show login prompt when clicking reaction button (unauthenticated)', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Click the reaction button
		await getReactionButton(unauthenticatedPage).click()

		// Verify login prompt appears
		await expect(unauthenticatedPage.getByText(/You must be logged in/i)).toBeVisible()
	})

	test('can view existing reactions from other users', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Seed a reaction from devUser2 (different user)
		await seedExistingReaction('🔥')

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Attempt to find the emoji in the reaction list area
		await expect(getReactionsList(unauthenticatedPage).getByText('🔥')).toBeVisible({ timeout: 10000 })
	})
	test('should navigate to comments tab when clicking product-level comment button', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		// Click the comment button in SocialInteractions
		await getCommentButton(unauthenticatedPage).click()

		// Verify we're on the comments tab
		const commentsTab = getTabsList(unauthenticatedPage).getByRole('tab', { name: 'Comments' })
		await expect(commentsTab).toHaveAttribute('data-state', 'active')
	})

	test('should display SocialInteractions for each comment', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await seedExistingComment()
		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const commentsTab = getTabsList(unauthenticatedPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// Wait for comment to load
		await unauthenticatedPage.getByText('Existing seeded comment for testing.').waitFor()

		// Verify each comment has its own SocialInteractions
		const commentSocialInteractions = unauthenticatedPage.locator('[data-testid="product-comments"] .comment-social-interactions')
		await expect(commentSocialInteractions).toBeVisible()

		// Verify reaction button on comment
		const commentReactionBtn = commentSocialInteractions.locator('[data-testid="reaction-button"]').first()
		await expect(commentReactionBtn).toBeVisible()

		// Verify zap button on comment
		const commentZapBtn = commentSocialInteractions.locator('[data-testid="zap-button"]').first()
		await expect(commentZapBtn).toBeVisible()

		// No share button for comments, so no check necessary.
	})

	test('should show existing reactions on a comment', async ({ unauthenticatedPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		// Seed a reaction on the comment
		const relay = await Relay.connect(RELAY_URL)
		const commentEvent = await seedComment(relay, devUser2.sk, {
			content: 'Comment for reaction testing.',
			rootEventId: currentProductEvent!.id,
			rootEventPubkey: currentProductEvent!.pubkey,
			rootEventDTag: currentProductEvent!.tags.find((tag) => tag[0] == 'd')?.[1],
			rootKind: currentProductEvent!.kind,
		})
		await seedReaction(relay, devUser3.sk, {
			emoji: '🔥',
			targetEventId: commentEvent.id,
			targetEventPubkey: commentEvent.pubkey,
			targetDTag: commentEvent.tags.find((tag) => tag[0] == 'd')?.[1],
			targetKind: commentEvent.kind,
		})

		await unauthenticatedPage.goto(`/products/${currentProductId}`)

		const commentsTab = getTabsList(unauthenticatedPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// Wait for comment to load
		await unauthenticatedPage.getByText('Comment for reaction testing.').waitFor()

		// Verify reaction appears on comment
		const commentSocialInteractions = unauthenticatedPage.locator('[data-testid="product-comments"] .comment-social-interactions')
		await expect(commentSocialInteractions.getByText('🔥')).toBeVisible()
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

		// Wait for comment to load
		await buyerPage.getByText('Existing seeded comment for testing.').waitFor()

		// Press reply button on comment's SocialInteractions
		const commentSocialInteractions = buyerPage.locator('[data-testid="product-comments"] .comment-social-interactions')
		const replyBtn = commentSocialInteractions.locator('[data-testid="comment-button"]').first()
		await expect(replyBtn).toBeVisible({ timeout: 15000 })
		await replyBtn.click()

		// Check for reply indicator above input
		await expect(buyerPage.getByText(/replying to:/i)).toBeVisible()

		// Post reply comment
		const replyText = `Reply to parent comment`
		const containerComment = buyerPage.getByTestId('product-comments')
		const input = getCommentInputReply(containerComment)
		await input.fill(replyText)
		await getCommentSubmitButtonReply(containerComment).click()

		await expect(buyerPage.locator('[data-testid="product-comments"]').getByText(replyText)).toBeVisible()
	})

	test('should cancel comment draft', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await buyerPage.goto(`/products/${currentProductId}`)
		await getTabsList(buyerPage).getByRole('tab', { name: 'Comments' }).click()

		// Seed a comment on product
		await seedExistingComment()

		// Navigate to page, then comments tab
		await buyerPage.goto(`/products/${currentProductId}`)
		const commentsTab = getTabsList(buyerPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// Wait for comment to load
		await buyerPage.getByText('Existing seeded comment for testing.').waitFor()

		// Press reply button on comment's SocialInteractions
		const commentSocialInteractions = buyerPage.locator('[data-testid="product-comments"] .comment-social-interactions')
		const replyBtn = commentSocialInteractions.locator('[data-testid="comment-button"]').first()
		await expect(replyBtn).toBeVisible({ timeout: 15000 })
		await replyBtn.click()

		// Check for reply indicator above input
		await expect(buyerPage.getByText(/replying to:/i)).toBeVisible()

		const containerComment = buyerPage.getByTestId('product-comments')
		const input = getCommentInputReply(containerComment)
		await input.fill('Draft text')

		const cancelBtn = containerComment.getByRole('button', { name: /cancel/i })
		await expect(cancelBtn).toBeVisible()
		await cancelBtn.click()

		// Expect comment input to disappear
		await expect(input).toBeHidden()
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
	})

	test('can remove an own-user reaction by clicking it', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')

		await seedExistingReaction('😂', devUser2.sk)

		await buyerPage.goto(`/products/${currentProductId}`)

		const reactionBtn = getReactionButton(buyerPage)
		await reactionBtn.hover()

		// Remove reaction (click again)
		await reactionBtn.click()

		// Verify it reverts to outline/default state
		await expectReactionButtonToBeUnfilled(buyerPage)
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

	test.skip('should allow adding reaction to a comment', async ({ buyerPage }) => {
		if (!currentProductId) throw new Error('Product not seeded')
		await seedExistingComment()
		await buyerPage.goto(`/products/${currentProductId}`)

		const commentsTab = getTabsList(buyerPage).getByRole('tab', { name: 'Comments' })
		await commentsTab.click()

		// Wait for comment to load
		await buyerPage.getByText('Existing seeded comment for testing.').waitFor()

		// Find comment's reaction button
		const commentSocialInteractions = buyerPage.locator('[data-testid="product-comments"] .comment-social-interactions')
		const commentReactionBtn = commentSocialInteractions.locator('[data-testid="reaction-button"]').first()

		// Hover to open popover
		await commentReactionBtn.hover()

		// Select emoji
		await buyerPage.getByText('❤️').click()

		// Verify reaction was added - check for filled state
		await expect(commentReactionBtn).toHaveClass(/bg-neo-purple/)

		// Verify the emoji appears with count
		const commentContainer = buyerPage.getByTestId('product-comments')
		await expect(commentContainer.getByText('❤️')).toBeVisible()
		await expect(commentContainer.getByText('1')).toBeVisible()
	})
})
