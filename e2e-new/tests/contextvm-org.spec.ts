import { test, expect } from '@playwright/test'

const SERVER_URL = 'https://contextvm.org/s/29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'
const EXPECTED_PUBKEY = '29bd6461f780c07b29c89b4df8017db90973d5608a3cd811a0522b15c1064f15'

const TEST_PRIVATE_KEY = process.env.TEST_CONTEXTVM_NSEC || 'eb1021aeaec60f2bef13c588be23935b5dde947cdd51209fc3589de6b1433e3b'

async function loginToContextVm(page: import('@playwright/test').Page) {
	const loginBtn = page.locator('header button', { hasText: /^Login$/ })
	await loginBtn.click()
	await page.waitForTimeout(1000)

	await page
		.locator('button', { hasText: /^Private Key$/ })
		.first()
		.click()
	await page.waitForTimeout(500)

	await page.locator('input#account-private-key').fill(TEST_PRIVATE_KEY)
	await page.waitForTimeout(300)

	await page.getByRole('button', { name: 'Connect', exact: true }).click()
	await page.waitForTimeout(5000)

	const connectBtn = page.locator('button', { hasText: /^Connect to Server$/ })
	await expect(connectBtn).toBeEnabled({ timeout: 15000 })
}

async function navigateToTools(page: import('@playwright/test').Page) {
	const toolsTab = page.locator('button', { hasText: /^tools$/ })
	await toolsTab.click({ timeout: 10000 })
	await page.waitForTimeout(2000)
}

async function clickTool(page: import('@playwright/test').Page, toolName: string) {
	const toolButton = page.locator('button').filter({ hasText: toolName }).first()
	await toolButton.click({ timeout: 10000 })
	await page.waitForTimeout(3000)
}

async function submitTool(page: import('@playwright/test').Page, toolName: string) {
	const toolButtons = page.locator('button', { hasText: /^Submit$/ })
	const count = await toolButtons.count()
	const index = toolName === 'get_btc_price' ? 0 : count - 1
	await toolButtons.nth(index).click()
}

async function waitForToolResult(page: import('@playwright/test').Page, timeoutMs = 20000): Promise<string> {
	const startTime = Date.now()
	while (Date.now() - startTime < timeoutMs) {
		const text = await page.innerText('body')
		if (!text.includes('Waiting for the server')) {
			return text
		}
		await page.waitForTimeout(2000)
	}
	throw new Error('Timed out waiting for tool result')
}

test.describe.configure({ timeout: 60_000 })

test.describe('ContextVM.org - Server Page (no login required)', () => {
	test('server page loads with correct name and version', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })

		await expect(page.locator('body')).toContainText('Plebeian Currency Server')
		await expect(page.locator('body')).toContainText('1.0.0')
		await expect(page.locator('body')).toContainText('plebeian.market')
	})

	test('server page shows correct pubkey', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })

		await expect(page.locator('body')).toContainText(EXPECTED_PUBKEY)
	})

	test('both tools are listed', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })

		await expect(page.locator('body')).toContainText('get_btc_price')
		await expect(page.locator('body')).toContainText('get_btc_price_single')
	})

	test('get_btc_price has correct description', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })

		await expect(page.locator('body')).toContainText('Aggregates from Yadio, CoinDesk, Binance, and CoinGecko')
		await expect(page.locator('body')).toContainText('median calculation')
	})

	test('server info section shows version and identity', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })

		await expect(page.locator('body')).toContainText('Plebeian Currency Server')
		await expect(page.locator('body')).toContainText('Version')
		await expect(page.locator('body')).toContainText('1.0.0')
		await expect(page.locator('body')).toContainText('Encryption')
		await expect(page.locator('body')).toContainText('Supported')
	})
})

test.describe('ContextVM.org - Tool Forms (login required)', () => {
	test('get_btc_price tool has refresh checkbox input', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price')

		const refreshInput = page.locator('input[name="root_refresh"]').first()
		await expect(refreshInput).toBeVisible({ timeout: 10000 })
		await expect(refreshInput).toHaveAttribute('type', 'checkbox')
	})

	test('get_btc_price_single tool has currency text input', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price_single')

		const currencyInput = page.locator('input#root_currency')
		await expect(currencyInput).toBeVisible({ timeout: 10000 })
		await expect(currencyInput).toHaveAttribute('name', 'root_currency')
	})
})

test.describe('ContextVM.org - Tool Execution (login + currency server required)', () => {
	test.beforeEach(async ({}, testInfo) => {
		testInfo.skip(
			!process.env.RUN_CONTEXTVM_EXECUTION_TESTS,
			'Set RUN_CONTEXTVM_EXECUTION_TESTS=true to run these tests. Requires running currency server.',
		)
	})

	test('get_btc_price returns rates with reasonable values', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price')
		await submitTool(page, 'get_btc_price')

		const text = await waitForToolResult(page)

		expect(text).toContain('USD')
		expect(text).toContain('EUR')

		const pres = await page.locator('pre').allTextContents()
		const resultJson = pres.find((p) => p.includes('"rates"') && !p.includes('"inputSchema"'))
		if (resultJson) {
			const parsed = JSON.parse(resultJson)
			expect(parsed.rates.USD).toBeGreaterThan(10000)
			expect(parsed.rates.USD).toBeLessThan(500000)
			expect(parsed.rates.EUR).toBeGreaterThan(10000)
			expect(parsed.rates.EUR).toBeLessThan(500000)
		}
	})

	test('get_btc_price_single with USD returns numeric rate', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price_single')

		await page.locator('input#root_currency').fill('USD')
		await page.waitForTimeout(300)
		await submitTool(page, 'get_btc_price_single')

		const text = await waitForToolResult(page)
		expect(text).toContain('USD')

		const pres = await page.locator('pre').allTextContents()
		const resultJson = pres.find((p) => p.includes('"rate"') && !p.includes('"inputSchema"'))
		if (resultJson) {
			const parsed = JSON.parse(resultJson)
			expect(parsed.rate).toBeGreaterThan(10000)
			expect(parsed.rate).toBeLessThan(500000)
		}
	})

	test('get_btc_price_single with invalid currency returns error', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price_single')

		await page.locator('input#root_currency').fill('INVALIDCODE')
		await page.waitForTimeout(300)
		await submitTool(page, 'get_btc_price_single')

		const text = await waitForToolResult(page)
		expect(text).toContain('Unsupported currency')
	})

	test('get_btc_price with refresh=true returns fresh rates', async ({ page }) => {
		await page.goto(SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 })
		await loginToContextVm(page)
		await navigateToTools(page)
		await clickTool(page, 'get_btc_price')

		const refreshCheckbox = page.locator('input[name="root_refresh"]').first()
		await refreshCheckbox.check()
		await page.waitForTimeout(300)
		await submitTool(page, 'get_btc_price')

		const text = await waitForToolResult(page)
		expect(text).toContain('USD')
	})
})
