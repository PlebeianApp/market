import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'

const MOCK_UPLOAD_URL = 'https://nostrcheck.me/e2e-uploaded-image.webp'
const DATA_IMAGE_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

test.use({ scenario: 'merchant' })

function generateBmpImage(width: number, height: number): Buffer {
	const bytesPerPixel = 3
	const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4
	const pixelDataSize = rowSize * height
	const fileSize = 54 + pixelDataSize
	const buffer = Buffer.alloc(fileSize)

	buffer.write('BM', 0, 'ascii')
	buffer.writeUInt32LE(fileSize, 2)
	buffer.writeUInt32LE(54, 10)
	buffer.writeUInt32LE(40, 14)
	buffer.writeInt32LE(width, 18)
	buffer.writeInt32LE(height, 22)
	buffer.writeUInt16LE(1, 26)
	buffer.writeUInt16LE(24, 28)
	buffer.writeUInt32LE(0, 30)
	buffer.writeUInt32LE(pixelDataSize, 34)
	buffer.writeInt32LE(2835, 38)
	buffer.writeInt32LE(2835, 42)

	for (let y = 0; y < height; y++) {
		const rowOffset = 54 + y * rowSize
		for (let x = 0; x < width; x++) {
			const offset = rowOffset + x * bytesPerPixel
			buffer[offset] = (x + y) % 256
			buffer[offset + 1] = (x * 2) % 256
			buffer[offset + 2] = (y * 2) % 256
		}
	}

	return buffer
}

async function waitForProductForm(page: Page) {
	const productForm = page.locator('[data-testid="product-form"]')
	await expect(productForm).toBeVisible({ timeout: 15_000 })
	await expect(page.getByTestId('product-tab-name')).toHaveAttribute('data-state', 'active')
	return productForm
}

async function openNewProductForm(page: Page) {
	await page.goto('/dashboard/products/products/new')
	await waitForProductForm(page)
}

async function fillNameStep(page: Page, productName: string) {
	const titleInput = page.getByTestId('product-name-input')
	const descriptionInput = page.getByTestId('product-description-input')

	await expect(titleInput).toBeVisible({ timeout: 10_000 })
	await titleInput.evaluate((el, value) => {
		el.value = value
		el.dispatchEvent(new Event('input', { bubbles: true }))
		el.dispatchEvent(new Event('change', { bubbles: true }))
	}, productName)
	await descriptionInput.evaluate((el, value) => {
		el.value = value
		el.dispatchEvent(new Event('input', { bubbles: true }))
		el.dispatchEvent(new Event('change', { bubbles: true }))
	}, `${productName} description`)
	await page.evaluate(
		([name, description]) => {
			;(
				window as Window & { __productFormActions?: { updateValues: (values: Record<string, unknown>) => void } }
			).__productFormActions?.updateValues?.({
				name,
				description,
			})
		},
		[productName, `${productName} description`],
	)
	await expect(titleInput).toHaveValue(productName)
	await expect(descriptionInput).toHaveValue(`${productName} description`)
	const nextBtn = page.getByTestId('product-next-button')
	await expect(nextBtn).toBeEnabled({ timeout: 5_000 })
	await nextBtn.click()
	await expect(page.getByTestId('product-tab-detail')).toHaveAttribute('data-state', 'active')
}

async function fillDetailStep(page: Page) {
	const bitcoinPriceInput = page.locator('#bitcoin-price')
	await expect(bitcoinPriceInput).toBeVisible({ timeout: 10_000 })
	await bitcoinPriceInput.fill('10000')

	await page
		.getByTestId('product-quantity-input')
		.or(page.getByLabel(/quantity/i))
		.fill('5')

	await expect(page.getByTestId('product-next-button')).toBeEnabled({ timeout: 5_000 })
	await page.getByTestId('product-next-button').click()
	await expect(page.getByTestId('product-tab-spec')).toHaveAttribute('data-state', 'active')
}

async function fillCategoryStep(page: Page) {
	await expect(page.getByTestId('product-next-button')).toBeEnabled({ timeout: 5_000 })
	await page.getByTestId('product-next-button').click()
	await expect(page.getByTestId('product-tab-category')).toHaveAttribute('data-state', 'active')

	await page.getByTestId('product-main-category-select').click()
	await page.getByTestId('main-category-bitcoin').click()
	await expect(page.getByTestId('product-next-button')).toBeEnabled({ timeout: 5_000 })
	await page.getByTestId('product-next-button').click()
	await expect(page.getByTestId('product-tab-images')).toHaveAttribute('data-state', 'active')
	await expect(page.getByTestId('image-url-input').last()).toBeVisible({ timeout: 5_000 })
}

async function navigateToImagesStep(page: Page, productName: string) {
	await openNewProductForm(page)
	await fillNameStep(page, productName)
	await fillDetailStep(page)
	await fillCategoryStep(page)
}

async function addImageUrl(page: Page, imageUrl: string) {
	const imageInput = page.getByTestId('image-url-input').last()
	await expect(imageInput).toBeVisible({ timeout: 5_000 })
	await imageInput.fill(imageUrl)
	await page.getByTestId('image-save-button').last().click()
	await expect(page.getByTestId('image-edit-button').first()).toBeVisible({ timeout: 5_000 })
}

async function mockBlossomUpload(page: Page) {
	let upload: { size: number; contentType: string | undefined } | null = null

	await page.route('https://nostrcheck.me/upload', async (route) => {
		const request = route.request()
		const body = request.postDataBuffer() ?? Buffer.alloc(0)
		const contentType = request.headers()['content-type']

		upload = {
			size: body.length,
			contentType,
		}

		await new Promise((resolve) => setTimeout(resolve, 300))
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: MOCK_UPLOAD_URL,
				x: 'e2e-upload-hash',
				sha256: 'e2e-upload-hash',
				size: String(body.length),
				m: contentType ?? 'image/webp',
			}),
		})
	})

	return {
		getUpload: () => upload,
	}
}

test.describe('Image Upload with Compression', () => {
	test('compresses and uploads a real selected image file', async ({ merchantPage }) => {
		const blossomUpload = await mockBlossomUpload(merchantPage)
		const sourceImage = generateBmpImage(512, 512)

		await navigateToImagesStep(merchantPage, 'Compression File Upload Product')

		const fileChooserPromise = merchantPage.waitForEvent('filechooser')
		await merchantPage.getByRole('button', { name: /click or drag image here/i }).click()
		const fileChooser = await fileChooserPromise
		await fileChooser.setFiles({
			name: 'compression-source.bmp',
			mimeType: 'image/bmp',
			buffer: sourceImage,
		})

		await expect(merchantPage.getByText(/Compressing image|Uploading/i)).toBeVisible({ timeout: 10_000 })
		await expect(merchantPage.getByTestId('image-url-input').first()).toHaveValue(MOCK_UPLOAD_URL, { timeout: 15_000 })
		await expect(merchantPage.locator('img[alt="uploaded media"]').first()).toBeVisible({ timeout: 5_000 })
		await expect(merchantPage.getByTestId('product-next-button')).toBeEnabled({ timeout: 5_000 })

		await expect.poll(() => blossomUpload.getUpload()?.size ?? null, { timeout: 10_000 }).not.toBeNull()
		const upload = blossomUpload.getUpload()
		expect(upload?.contentType).not.toBe('image/bmp')
		expect(upload?.size).toBeLessThan(sourceImage.length)
	})

	test('image URL input accepts manually provided URLs', async ({ merchantPage }) => {
		await navigateToImagesStep(merchantPage, 'URL Upload Test')

		await addImageUrl(merchantPage, DATA_IMAGE_URL)

		await expect(merchantPage.getByTestId('image-url-input').first()).toHaveValue(DATA_IMAGE_URL)
		await expect(merchantPage.locator('img[alt="uploaded media"]').first()).toBeVisible({ timeout: 5_000 })
	})

	test('invalid URLs show error messages', async ({ merchantPage }) => {
		await navigateToImagesStep(merchantPage, 'Invalid URL Test')

		await merchantPage.getByTestId('image-url-input').last().fill('not a valid url')

		await expect(merchantPage.getByText(/invalid url format/i)).toBeVisible({ timeout: 3_000 })
	})

	test('multiple images can be managed in sequence', async ({ merchantPage }) => {
		await navigateToImagesStep(merchantPage, 'Multi-Image Test')

		await addImageUrl(merchantPage, `${DATA_IMAGE_URL}#image-1`)
		await addImageUrl(merchantPage, `${DATA_IMAGE_URL}#image-2`)

		await expect(merchantPage.getByTestId('image-edit-button')).toHaveCount(2)
		await expect(merchantPage.locator('img[alt="uploaded media"]')).toHaveCount(2)
	})

	test('image edit button works when image is set', async ({ merchantPage }) => {
		await navigateToImagesStep(merchantPage, 'Edit Image Test')
		await addImageUrl(merchantPage, DATA_IMAGE_URL)

		await merchantPage.getByTestId('image-edit-button').first().click()

		await expect(merchantPage.getByTestId('image-url-input').first()).toBeEnabled()
		await expect(merchantPage.getByTestId('image-save-button').first()).toBeVisible()
	})
})

test.describe('Image Server Selection', () => {
	test('server selector dropdown is visible', async ({ merchantPage }) => {
		await navigateToImagesStep(merchantPage, 'Server Select Test')

		await expect(merchantPage.getByText('nostrcheck.me (public)').first()).toBeVisible()
	})
})
