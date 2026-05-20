import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

test.use({ scenario: 'merchant' })

const COLLECTIONS_PATH = '/dashboard/products/collections'

type CollectionFields = {
	name: string
	description: string
	summary?: string
}

async function gotoCollections(page: Page) {
	await page.goto(COLLECTIONS_PATH)
	await expect(page).toHaveURL(/\/dashboard\/products\/collections$/)
	await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible({ timeout: 15_000 })
	await expect(page.getByTestId('add-collection-button')).toBeVisible()
}

async function openNewCollection(page: Page) {
	await gotoCollections(page)
	await page.getByTestId('add-collection-button').click()
	await expect(page).toHaveURL(/\/dashboard\/products\/collections\/new$/)
	await expect(page.getByTestId('collection-name-input')).toBeVisible({ timeout: 15_000 })
}

async function fillCollectionInfo(page: Page, fields: CollectionFields) {
	await page.getByTestId('collection-name-input').fill(fields.name)
	await page.getByTestId('collection-description-input').fill(fields.description)

	const summaryInput = page.getByTestId('collection-summary-input')
	if (fields.summary !== undefined) {
		await summaryInput.fill(fields.summary)
	}
}

async function selectSeededProduct(page: Page, name: string) {
	await page.getByTestId('collection-form-next').click()
	await expect(page.getByRole('tab', { name: 'Products', selected: true })).toBeVisible()

	const checkbox = page.getByRole('checkbox', { name })
	await expect(checkbox).toBeVisible({ timeout: 15_000 })
	await checkbox.click()
	await expect(page.getByText('1 product selected')).toBeVisible()
}

async function continueToShipping(page: Page) {
	await page.getByTestId('collection-form-next').click()
	await expect(page.getByRole('tab', { name: 'Shipping', selected: true })).toBeVisible()
}

async function addSeededShippingOption(page: Page, testId = 'add-shipping-option-worldwide-standard') {
	const addButton = page.getByTestId(testId)
	await expect(addButton).toBeVisible({ timeout: 15_000 })
	await addButton.click()
	await expect(page.getByText('Selected Shipping Options')).toBeVisible()
}

async function submitCollection(page: Page, buttonLabel: 'Publish Collection' | 'Update Collection') {
	const submitButton = page.getByTestId('collection-form-submit')
	await expect(submitButton).toBeEnabled()
	await expect(submitButton).toHaveText(buttonLabel)
	await submitButton.click()
	await expect(page).toHaveURL(/\/dashboard\/products\/collections$/)
}

function collectionTitle(page: Page, name: string) {
	return page.getByText(name, { exact: true })
}

function collectionEditButton(page: Page, name: string) {
	return page.getByRole('button', { name: `Edit ${name}` })
}

function collectionDeleteButton(page: Page, name: string) {
	return page.getByRole('button', { name: `Delete ${name}` })
}

async function expandCollection(page: Page, name: string) {
	await collectionTitle(page, name).click()
}

async function expectCollectionVisible(page: Page, name: string) {
	await expect(collectionTitle(page, name)).toBeVisible({ timeout: 15_000 })
}

async function expectCollectionAbsent(page: Page, name: string) {
	await expect(collectionTitle(page, name)).toHaveCount(0)
}

async function revisitCollectionsAndAssert(page: Page, assertion: () => Promise<void>) {
	await expect(async () => {
		await gotoCollections(page)
		await assertion()
	}).toPass({ timeout: 20_000 })
}

async function createCollection(
	page: Page,
	fields: CollectionFields,
	options?: {
		productName?: string
		shippingTestId?: string
	},
) {
	await openNewCollection(page)
	await fillCollectionInfo(page, fields)
	await selectSeededProduct(page, options?.productName ?? 'Bitcoin Hardware Wallet')
	await continueToShipping(page)
	await addSeededShippingOption(page, options?.shippingTestId)
	await submitCollection(page, 'Publish Collection')
	await expectCollectionVisible(page, fields.name)
}

test.describe('Collection Management', () => {
	test('collections list page is accessible', async ({ merchantPage }) => {
		await gotoCollections(merchantPage)
	})

	test('can create a collection', async ({ merchantPage }) => {
		const collection = {
			name: `E2E Collection ${Date.now()}`,
			description: 'Created by the collection CRUD spec.',
			summary: 'Create flow persistence check',
		}

		await createCollection(merchantPage, collection)
		await revisitCollectionsAndAssert(merchantPage, async () => {
			await expectCollectionVisible(merchantPage, collection.name)
		})
	})

	test('can edit a collection', async ({ merchantPage }) => {
		const original = {
			name: `E2E Editable Collection ${Date.now()}`,
			description: 'Initial description before update.',
			summary: 'Initial summary',
		}
		const updated = {
			name: `${original.name} Updated`,
			description: 'Updated description after edit.',
			summary: 'Updated summary',
		}

		await createCollection(merchantPage, original)

		await gotoCollections(merchantPage)
		await collectionEditButton(merchantPage, original.name).click()
		await expect(merchantPage).toHaveURL(/\/dashboard\/products\/collections\/.+$/)
		await expect(merchantPage.getByTestId('collection-name-input')).toHaveValue(original.name)
		await expect(merchantPage.getByTestId('collection-description-input')).toHaveValue(original.description)
		await expect(merchantPage.getByTestId('collection-summary-input')).toHaveValue(original.summary)

		await fillCollectionInfo(merchantPage, updated)
		await submitCollection(merchantPage, 'Update Collection')

		await revisitCollectionsAndAssert(merchantPage, async () => {
			await expectCollectionVisible(merchantPage, updated.name)
			await expectCollectionAbsent(merchantPage, original.name)
			await expandCollection(merchantPage, updated.name)
			await expect(merchantPage.getByText(updated.summary, { exact: true })).toBeVisible()
			await expect(merchantPage.getByText(updated.description, { exact: true })).toBeVisible()
			await collectionEditButton(merchantPage, updated.name).click()
			await expect(merchantPage.getByTestId('collection-name-input')).toHaveValue(updated.name)
			await expect(merchantPage.getByTestId('collection-description-input')).toHaveValue(updated.description)
			await expect(merchantPage.getByTestId('collection-summary-input')).toHaveValue(updated.summary)
		})
	})

	test('can delete a collection', async ({ merchantPage }) => {
		const collection = {
			name: `E2E Deletable Collection ${Date.now()}`,
			description: 'Delete flow persistence check.',
			summary: 'Delete me',
		}

		await createCollection(merchantPage, collection)
		await gotoCollections(merchantPage)

		merchantPage.once('dialog', (dialog) => dialog.accept())
		await collectionDeleteButton(merchantPage, collection.name).click()

		await revisitCollectionsAndAssert(merchantPage, async () => {
			await expectCollectionAbsent(merchantPage, collection.name)
		})
	})
})
