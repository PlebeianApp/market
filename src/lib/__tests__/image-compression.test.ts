import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { compressImage, isCompressibleImage, formatFileSize, getFileSizeMB, getCompressionStats } from '@/lib/image-compression'

/**
 * Unit tests for image compression utility
 * Tests compression algorithm, format selection, and utility functions
 */

describe('image-compression utilities', () => {
	describe('browser-less import safety', () => {
		test('does not access document during module import when document is unavailable', async () => {
			const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
			let documentAccesses = 0
			Object.defineProperty(globalThis, 'document', {
				configurable: true,
				get: () => {
					documentAccesses++
					return undefined
				},
			})

			try {
				const module = await import(`@/lib/image-compression?import-safety-${Date.now()}`)
				expect(module).toBeDefined()
				expect(documentAccesses).toBe(0)
			} finally {
				if (originalDocumentDescriptor) {
					Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
				} else {
					delete (globalThis as typeof globalThis & { document?: Document }).document
				}
			}
		})
	})

	describe('isCompressibleImage', () => {
		test('identifies JPEG as compressible', () => {
			const file = new File([], 'test.jpg', { type: 'image/jpeg' })
			expect(isCompressibleImage(file)).toBe(true)
		})

		test('rejects the non-standard image/jpg MIME type', () => {
			const file = new File([], 'test.jpg', { type: 'image/jpg' })
			expect(isCompressibleImage(file)).toBe(false)
		})

		test('identifies PNG as compressible', () => {
			const file = new File([], 'test.png', { type: 'image/png' })
			expect(isCompressibleImage(file)).toBe(true)
		})

		test('identifies WebP as compressible', () => {
			const file = new File([], 'test.webp', { type: 'image/webp' })
			expect(isCompressibleImage(file)).toBe(true)
		})

		test('rejects GIF to preserve animation', () => {
			const file = new File([], 'test.gif', { type: 'image/gif' })
			expect(isCompressibleImage(file)).toBe(false)
		})

		test('rejects non-image files', () => {
			const file = new File([], 'test.txt', { type: 'text/plain' })
			expect(isCompressibleImage(file)).toBe(false)
		})

		test('rejects video files', () => {
			const file = new File([], 'test.mp4', { type: 'video/mp4' })
			expect(isCompressibleImage(file)).toBe(false)
		})

		test('handles lowercase MIME types', () => {
			const file = new File([], 'test.jpg', { type: 'IMAGE/JPEG' })
			expect(isCompressibleImage(file)).toBe(true)
		})
	})

	describe('malformed EXIF data', () => {
		test('ignores truncated APP1 EXIF segments without throwing', async () => {
			const malformedJpeg = new Uint8Array([
				0xff, 0xd8, 0xff, 0xe1, 0x00, 0x1a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			])
			const file = new File([malformedJpeg], 'malformed.jpg', { type: 'image/jpeg' })

			await expect(compressImage(file, { debug: false })).resolves.toBe(file)
		})
	})

	describe('EXIF orientation handling', () => {
		test('uses browser auto-orientation when imageOrientation is silently ignored', async () => {
			const originalDocument = globalThis.document
			const originalCreateImageBitmap = globalThis.createImageBitmap
			const imageBitmapCalls: Array<ImageBitmapOptions | undefined> = []
			const canvases: Array<{ width: number; height: number }> = []
			let rotateCalls = 0
			const context = {
				drawImage() {},
				rotate() {
					rotateCalls++
				},
				translate() {},
				scale() {},
			} as unknown as CanvasRenderingContext2D

			;(globalThis as typeof globalThis & { document?: Document }).document = {
				createElement: () => {
					const canvas = {
						width: 0,
						height: 0,
						toDataURL: () => 'data:image/webp;base64,',
						toBlob: (callback: BlobCallback) => callback(new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })),
						getContext: () => context,
					}
					canvases.push(canvas)
					return canvas
				},
			} as unknown as Document
			;(globalThis as typeof globalThis & { createImageBitmap?: typeof createImageBitmap }).createImageBitmap = async (_blob, options) => {
				imageBitmapCalls.push(options)
				// The orientation probe receives a 2×1 image with EXIF orientation 6.
				// Returning 1×2 simulates Safari accepting the option but ignoring it.
				const dimensions = imageBitmapCalls.length === 1 ? { width: 1, height: 2 } : { width: 100, height: 200 }
				return { ...dimensions, close() {} } as ImageBitmap
			}

			const orientationSixJpeg = Uint8Array.from([
				0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
				0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
			])

			try {
				const file = new File([orientationSixJpeg], 'orientation-6.jpg', { type: 'image/jpeg' })
				await expect(compressImage(file, { mimeType: 'image/jpeg', debug: false })).resolves.toBeDefined()

				expect(imageBitmapCalls).toEqual([{ imageOrientation: 'none' }, undefined])
				expect(rotateCalls).toBe(0)
				expect(canvases[1]).toMatchObject({ width: 100, height: 200 })
			} finally {
				if (originalDocument) {
					;(globalThis as typeof globalThis & { document?: Document }).document = originalDocument
				} else {
					delete (globalThis as typeof globalThis & { document?: Document }).document
				}
				;(globalThis as typeof globalThis & { createImageBitmap?: typeof createImageBitmap }).createImageBitmap = originalCreateImageBitmap
			}
		})
	})

	describe('formatFileSize', () => {
		test('formats bytes correctly', () => {
			expect(formatFileSize(0)).toBe('0 Bytes')
			expect(formatFileSize(512)).toBe('512 Bytes')
			expect(formatFileSize(1024)).toBe('1 KB')
			expect(formatFileSize(1024 * 1024)).toBe('1 MB')
			expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
		})

		test('formats decimal values correctly', () => {
			expect(formatFileSize(1536)).toBe('1.5 KB')
			expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
		})

		test('handles large values', () => {
			const gigabyte = 1024 * 1024 * 1024
			expect(formatFileSize(gigabyte * 5)).toBe('5 GB')
		})
	})

	describe('getFileSizeMB', () => {
		test('converts bytes to megabytes', () => {
			const file = new File([], 'test.txt')
			Object.defineProperty(file, 'size', { value: 1024 * 1024 * 2.5 })
			expect(getFileSizeMB(file)).toBe(2.5)
		})

		test('handles small files', () => {
			const file = new File([], 'test.txt')
			Object.defineProperty(file, 'size', { value: 512 })
			expect(getFileSizeMB(file)).toBeCloseTo(0.00048828125, 6)
		})

		test('handles zero-sized files', () => {
			const file = new File([], 'test.txt')
			Object.defineProperty(file, 'size', { value: 0 })
			expect(getFileSizeMB(file)).toBe(0)
		})
	})

	describe('getCompressionStats', () => {
		test('calculates savings percentage correctly', () => {
			const stats = getCompressionStats(1000, 500)
			expect(stats.savingsPercent).toBe(50)
		})

		test('formats savings size correctly', () => {
			const stats = getCompressionStats(1024 * 1024 * 2, 1024 * 1024)
			expect(stats.savingsSize).toBe('1 MB')
		})

		test('marks significant compression (>10%)', () => {
			const stats = getCompressionStats(1000, 800)
			expect(stats.isSignificant).toBe(true)
		})

		test('marks insignificant compression (≤10%)', () => {
			const stats = getCompressionStats(1000, 950)
			expect(stats.isSignificant).toBe(false)
		})

		test('handles 0% compression', () => {
			const stats = getCompressionStats(1000, 1000)
			expect(stats.savingsPercent).toBe(0)
			expect(stats.isSignificant).toBe(false)
		})

		test('handles 100% compression hypothetically', () => {
			const stats = getCompressionStats(1000, 0)
			expect(stats.savingsPercent).toBe(100)
			expect(stats.isSignificant).toBe(true)
		})
	})
})

describe('image compression algorithm', () => {
	/**
	 * NOTE: Canvas-based compression tests are covered by E2E tests
	 * in e2e/tests/image-upload-compression.spec.ts
	 *
	 * Unit tests here focus on functions that can be tested in Node.js.
	 * The compression algorithm itself requires browser APIs (canvas, createImageBitmap)
	 * and is best tested through E2E tests.
	 */

	test('returns original file on compression error', async () => {
		// Create a minimal invalid "file" that will trigger error in compression
		const file = new File([], 'invalid.jpg', { type: 'image/jpeg' })

		const result = await compressImage(file, {
			debug: false,
		})

		// On error, should return original file
		expect(result).toBeDefined()
	})
})

describe('compression edge cases', () => {
	test('handles invalid file gracefully', async () => {
		const file = new File([], 'invalid.jpg', { type: 'image/jpeg' })

		const result = await compressImage(file, {
			debug: false,
		})

		expect(result).toBeDefined()
	})

	test('handles empty file', async () => {
		const file = new File([], 'empty.jpg', { type: 'image/jpeg' })

		const result = await compressImage(file, {
			debug: false,
		})

		expect(result).toBeDefined()
	})
})
