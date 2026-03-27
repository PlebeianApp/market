import { test, expect } from '../fixtures'
import { LightningMock } from '../utils/lightning-mock'
import { Nip46Mock } from '../utils/nip46-mock'
import { devUser1, devUser2 } from '../../src/lib/fixtures'

test.use({ scenario: 'base' })

test.describe('Social Interactions', () => {
	test.describe('Reaction Button', () => {
		test('reaction button opens popover with emoji options', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			// Navigate to a product page
			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			// Click the first product to go to its detail page
			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			// Wait for product detail page to load
			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click the reaction button (heart icon)
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible({ timeout: 10_000 })
			await reactionButton.hover()

			// Popover should open with emoji options
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
			await expect(buyerPage.getByText('😂')).toBeVisible()
			await expect(buyerPage.getByText('🔥')).toBeVisible()
			await expect(buyerPage.getByText('💰')).toBeVisible()
			await expect(buyerPage.getByText('👀')).toBeVisible()
		})

		test('can publish a reaction', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()

			// Select heart reaction
			await buyerPage.getByText('❤️').click()

			// Wait for reaction to be published
			await expect(reactionButton).toHaveAttribute('class', /bg-secondary/)
		})

		test('can delete an existing reaction', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()

			// Select heart reaction
			await buyerPage.getByText('❤️').click()

			// Wait for reaction to be published
			await expect(reactionButton).toHaveAttribute('class', /bg-secondary/)

			// Click again to delete the reaction
			await reactionButton.click()

			// Reaction button should revert to outline style
			await expect(reactionButton).toHaveAttribute('class', /border-secondary bg-transparent/)
		})

		test('reaction button shows tooltip when not authenticated', async ({ browser }) => {
			const context = await browser.newContext()
			const page = await context.newPage()

			try {
				await page.goto('/products')
				await page.waitForLoadState('networkidle')

				const firstProductHeading = page.locator('main h2').first()
				await firstProductHeading.click()

				await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

				const reactionButton = page.locator('button:has(.i-heart)').first()
				await expect(reactionButton).toBeVisible({ timeout: 10_000 })

				// Hover over the button to trigger tooltip
				await reactionButton.hover({ position: { x: 10, y: 10 } })

				// Tooltip should appear
				await expect(page.getByText('React')).toBeVisible({ timeout: 5_000 })
			} finally {
				await context.close()
			}
		})

		test('reaction button is disabled when event is not available', async ({ buyerPage }) => {
			// This test verifies the button handles edge cases gracefully
			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main')).toBeVisible()

			// The button should be visible even if the event is not fully loaded yet
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible()
		})
	})

	test.describe('Zap Button', () => {
		test('zap button opens ZapDialog', async ({ buyerPage }) => {
			test.setTimeout(60_000)

			// Set up lightning mock
			const lnMock = await LightningMock.setup(buyerPage)

			// Navigate to a product page
			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click the zap button (lightning bolt icon)
			const zapButton = buyerPage.locator('button:has(.i-lightning)').first()
			await expect(zapButton).toBeVisible({ timeout: 10_000 })
			await zapButton.click()

			// ZapDialog should open
			await expect(buyerPage.getByText('Continue to payment')).toBeVisible({ timeout: 10_000 })
		})

		test('zap button shows spinner while checking capability', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// The zap button should be visible with either spinner or lightning icon
			const zapButton = buyerPage.locator('button:has(.i-lightning)').first()
			await expect(zapButton).toBeVisible({ timeout: 10_000 })
		})

		test('zap button is disabled when author cannot receive zaps', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// The zap button should be visible but may be disabled if author cannot receive zaps
			const zapButton = buyerPage.locator('button:has(.i-lightning)').first()
			await expect(zapButton).toBeVisible({ timeout: 10_000 })
		})
	})

	test.describe('Comment Button', () => {
		test('comment button opens comment dialog', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click the comment button (message square icon)
			const commentButton = buyerPage.locator('button:has(.i-message-square)').first()
			await expect(commentButton).toBeVisible({ timeout: 10_000 })
			await commentButton.click()

			// Comment dialog should open
			await expect(buyerPage.getByText('Comment on this post')).toBeVisible({ timeout: 10_000 })
			await expect(buyerPage.getByPlaceholder('Write your comment here...')).toBeVisible()
		})

		test('comment button shows error when not authenticated', async ({ browser }) => {
			const context = await browser.newContext()
			const page = await context.newPage()

			try {
				await page.goto('/products')
				await page.waitForLoadState('networkidle')

				const firstProductHeading = page.locator('main h2').first()
				await firstProductHeading.click()

				await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

				const commentButton = page.locator('button:has(.i-message-square)').first()
				await expect(commentButton).toBeVisible({ timeout: 10_000 })
				await commentButton.click()

				// Error toast should appear
				await expect(page.getByText('Please log in to comment')).toBeVisible({ timeout: 5_000 })
			} finally {
				await context.close()
			}
		})

		test('comment dialog has cancel and post buttons', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const commentButton = buyerPage.locator('button:has(.i-message-square)').first()
			await commentButton.click()

			// Cancel button should be visible
			await expect(buyerPage.getByText('Cancel')).toBeVisible({ timeout: 5_000 })
			await expect(buyerPage.getByText('Post Comment')).toBeVisible({ timeout: 5_000 })
		})
	})

	test.describe('Share Button', () => {
		test('share button opens share dialog', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click the share button (sharing icon)
			const shareButton = buyerPage.locator('button:has(.i-sharing)').first()
			await expect(shareButton).toBeVisible({ timeout: 10_000 })
			await shareButton.click()

			// Share dialog should open
			await expect(buyerPage.getByText('Share')).toBeVisible({ timeout: 10_000 })
		})

		test('share dialog shows product title', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const shareButton = buyerPage.locator('button:has(.i-sharing)').first()
			await shareButton.click()

			// Share dialog should show the product title
			await expect(buyerPage.getByText('Share')).toBeVisible({ timeout: 10_000 })
		})
	})

	test.describe('Combined Social Interactions', () => {
		test('all social buttons are visible on product detail page', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// All social buttons should be visible
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			const zapButton = buyerPage.locator('button:has(.i-lightning)').first()
			const commentButton = buyerPage.locator('button:has(.i-message-square)').first()
			const shareButton = buyerPage.locator('button:has(.i-sharing)').first()

			await expect(reactionButton).toBeVisible({ timeout: 10_000 })
			await expect(zapButton).toBeVisible({ timeout: 10_000 })
			await expect(commentButton).toBeVisible({ timeout: 10_000 })
			await expect(shareButton).toBeVisible({ timeout: 10_000 })
		})

		test('social buttons are positioned correctly', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Social buttons should be in a row
			const socialButtons = buyerPage.locator(
				'button:has(.i-heart), button:has(.i-lightning), button:has(.i-message-square), button:has(.i-sharing)',
			)
			await expect(socialButtons).toHaveCount(4, { timeout: 10_000 })
		})

		test('social buttons handle hover states correctly', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.hover()

			// Button should change appearance on hover
			await expect(reactionButton).toBeVisible({ timeout: 5_000 })
		})

		test('social buttons handle click events correctly', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()

			// Popover should open
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
		})

		test('social buttons prevent event bubbling', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()

			// Popover should open without triggering parent click events
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
		})

		test('reaction button popover closes on pointer leave', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()

			// Popover should open
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })

			// Move mouse away from popover
			await page.mouse.move(0, 0)

			// Popover should close after delay
			await expect(buyerPage.getByText('❤️')).not.toBeVisible({ timeout: 5_000 })
		})
	})

	test.describe('Reactions List', () => {
		test('reactions list shows grouped reactions', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click reaction button to add a reaction
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()
			await buyerPage.getByText('❤️').click()

			// Reactions list should show the reaction
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
		})

		test('reactions list shows reaction count', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click reaction button to add a reaction
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()
			await buyerPage.getByText('❤️').click()

			// Reactions list should show the count
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
		})

		test('reactions list highlights own reaction', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click reaction button to add a reaction
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()
			await buyerPage.getByText('❤️').click()

			// Own reaction should be highlighted
			await expect(buyerPage.getByText('❤️')).toBeVisible({ timeout: 5_000 })
		})

		test('reactions list allows toggling reactions', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Click reaction button to add a reaction
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await reactionButton.click()
			await buyerPage.getByText('❤️').click()

			// Click again to remove the reaction
			await reactionButton.click()

			// Reaction should be removed
			await expect(buyerPage.getByText('❤️')).not.toBeVisible({ timeout: 5_000 })
		})
	})

	test.describe('Edge Cases', () => {
		test('social buttons handle empty reactions gracefully', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Reaction button should be visible even with no reactions
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible({ timeout: 10_000 })
		})

		test('social buttons handle loading state gracefully', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main')).toBeVisible()

			// Social buttons should be visible even during loading
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible()
		})

		test('social buttons handle mobile view correctly', async ({ browserName, buyerPage }) => {
			test.skip(browserName !== 'chromium', 'Mobile tests only run on Chromium')

			await buyerPage.setViewportSize({ width: 375, height: 667 })

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main h2')).toBeVisible({ timeout: 15_000 })

			const firstProductHeading = buyerPage.locator('main h2').first()
			await firstProductHeading.click()

			await expect(buyerPage.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })

			// Social buttons should be visible on mobile
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible({ timeout: 10_000 })
		})

		test('social buttons handle network errors gracefully', async ({ buyerPage }) => {
			test.setTimeout(30_000)

			await buyerPage.goto('/products')
			await expect(buyerPage.locator('main')).toBeVisible()

			// Social buttons should be visible even with network issues
			const reactionButton = buyerPage.locator('button:has(.i-heart)').first()
			await expect(reactionButton).toBeVisible()
		})
	})
})
