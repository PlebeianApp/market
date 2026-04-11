import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const PAYMENT_STEP_TIMEOUT_MS = 45_000

export async function waitForWebLnButton(page: Page, timeoutMs = PAYMENT_STEP_TIMEOUT_MS) {
	await expect(page.getByText('Invoices', { exact: true })).toBeVisible({ timeout: timeoutMs })

	const webLnButton = page.getByRole('button', { name: 'Pay with WebLN' })

	await expect(async () => {
		const hasWebLn = await webLnButton.isVisible().catch(() => false)
		const hasSkip = await page
			.getByRole('button', { name: /Pay Later|Skip Payment/i })
			.isVisible()
			.catch(() => false)

		expect(hasWebLn || hasSkip).toBeTruthy()
	}).toPass({ timeout: timeoutMs })

	await expect(webLnButton).toBeVisible({ timeout: timeoutMs })
	return webLnButton
}

export async function payAllInvoicesWithWebLn(page: Page, timeoutMs = PAYMENT_STEP_TIMEOUT_MS) {
	const successMessage = page.getByText('All payments completed successfully!')
	const webLnButton = await waitForWebLnButton(page, timeoutMs)

	for (let attempt = 0; attempt < 12; attempt++) {
		const done = await successMessage.isVisible().catch(() => false)
		if (done) break

		await expect(webLnButton).toBeEnabled({ timeout: 15_000 })
		await webLnButton.click()
		await page.waitForTimeout(1_000)
	}

	await expect(successMessage).toBeVisible({ timeout: 20_000 })
}
