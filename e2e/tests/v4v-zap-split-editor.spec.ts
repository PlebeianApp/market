import { expect, test } from '../fixtures'

/**
 * The feature gate for the V4V zap-payout split editor — the primary user flow of the new UI piece:
 * a seller configures who gets paid, and the screen tells them truthfully what will happen.
 *
 * It asserts the three claims the component makes, each of which is a *product* claim and not a
 * rendering detail:
 *
 * 1. the seller is told their own wallet pays at settlement, not an escrow;
 * 2. an endpoint that cannot receive a zap is surfaced **before** anything is published;
 * 3. the totals shown are the seller's own share, the sats that will be paid, and the sats that will not.
 *
 * No network leaves the harness: the preview renders fixture rows, and no endpoint is ever contacted
 * (the endpoint facts are inputs, exactly as they would be from a liveness check).
 */
test.describe('V4V zap split editor', () => {
	test('tells the seller who pays, and which recipients will not be paid', async ({ page }) => {
		await page.goto('/dev/v4v-zap-preview')

		const editor = page.getByTestId('v4v-zap-split-editor')
		await expect(editor).toBeVisible()

		// 1. the one sentence the screen must not omit: the seller's wallet pays, not an escrow
		await expect(editor).toContainText('your wallet')
		await expect(editor).toContainText('not an escrow')

		// 2. an endpoint that does not accept zaps is visible before publishing (bob, in the fixtures)
		await expect(page.getByTestId('v4v-row-2-status')).toContainText('does not accept zaps')
		// and one that did not answer at all is a different fact (carol)
		await expect(page.getByTestId('v4v-row-3-status')).toContainText('did not answer')
		// while a working recipient is honestly shown as merely scheduled
		await expect(page.getByTestId('v4v-row-1-status')).toContainText('scheduled to be paid')

		// 3. the totals: 60% to recipients, the remaining 40% staying with the seller, and nothing claimed
		//    as paid
		const summary = page.getByTestId('v4v-summary')
		await expect(summary).toContainText('60.01% to recipients')
		await expect(summary).toContainText('stay')
		// it may say what *will* be paid, and must never say what *was* paid: "sats paid" unqualified is
		// the phrase a surface would use after money moved, and a preview has no business using it
		await expect(summary).toContainText('will be paid')
		await expect(summary).not.toContainText('sats paid')

		// the commitment the seller is about to make is shown, because publishing will bind them to it
		await expect(page.getByTestId('v4v-commitment')).toContainText('Committed split:')

		await page.screenshot({ path: 'e2e/artifacts/gate-1-split-editor.png', fullPage: true })
		await editor.screenshot({ path: 'e2e/artifacts/gate-2-editor-detail.png' })
	})

	test('an invalid split names the row to fix instead of silently emptying itself', async ({ page }) => {
		await page.goto('/dev/v4v-zap-preview')

		const row = page.getByTestId('v4v-row-2').getByLabel(/Lightning address/)
		await row.fill('not a destination')

		// the refusal is shown, and it says which row is at fault — the seller is configuring, and this is
		// the moment they can still act on it
		await expect(page.getByTestId('v4v-refusal')).toContainText('Row 2')
		await expect(page.getByTestId('v4v-summary')).toHaveCount(0)
		await page.screenshot({ path: 'e2e/artifacts/gate-3-invalid-destination.png', fullPage: true })
	})

	test('a share that falls below the minimum zap is disclosed as unpaid, never absorbed', async ({ page }) => {
		await page.goto('/dev/v4v-zap-preview')

		// dave is announced, reachable and zap-capable, and still will not be paid: 1 bp of the fixture
		// settlement is 10 sats, under the 100-sat minimum. The row must say so rather than disappear, and
		// the summary must stop claiming every announced sat will be paid.
		await expect(page.getByTestId('v4v-row-4-status')).toContainText('too small to send on its own')
		await expect(page.getByTestId('v4v-summary')).toContainText('will not be paid')
		await page.screenshot({ path: 'e2e/artifacts/gate-4-below-minimum.png', fullPage: true })
		await page.getByTestId('v4v-row-4-status').screenshot({ path: 'e2e/artifacts/gate-5-below-minimum-row.png' })
	})
})
