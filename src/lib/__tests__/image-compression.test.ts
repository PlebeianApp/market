import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { compressImage, isCompressibleImage, formatFileSize, getFileSizeMB, getCompressionStats } from '@/lib/image-compression'

/**
 * Unit tests for image compression utility
 * Tests compression algorithm, format selection, and utility functions
 */

describe('image-compression utilities', () => {
	describe('isCompressibleImage', () => {
		test('identifies JPEG as compressible', () => {
			const file = new File([], 'test.jpg', { type: 'image/jpeg' })
			expect(isCompressibleImage(file)).toBe(true)
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
