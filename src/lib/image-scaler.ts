/**
 * Client-side image scaling for responsive image variants
 *
 * Generates multiple resolution variants of an image with EXIF stripping.
 * Follows NIP-XX Responsive Image Variants specification.
 * Ported from Smesh.
 */

import type { ImageVariant } from './responsive-image'

export type ScaledImage = {
	variant: ImageVariant
	blob: Blob
	width: number
	height: number
	mimeType: string
}

/** Target widths for each variant per NIP-XX */
const VARIANT_WIDTHS: Record<Exclude<ImageVariant, 'original'>, number> = {
	thumb: 128,
	'mobile-sm': 512,
	'mobile-lg': 1024,
	'desktop-sm': 1536,
	'desktop-md': 2048,
	'desktop-lg': 2560,
}

/** JPEG quality settings per variant */
const VARIANT_QUALITY: Record<ImageVariant, number> = {
	thumb: 0.7,
	'mobile-sm': 0.75,
	'mobile-lg': 0.8,
	'desktop-sm': 0.85,
	'desktop-md': 0.88,
	'desktop-lg': 0.9,
	original: 0.92,
}

/** Variants in order from smallest to largest */
const VARIANT_ORDER: ImageVariant[] = ['thumb', 'mobile-sm', 'mobile-lg', 'desktop-sm', 'desktop-md', 'desktop-lg', 'original']

/**
 * Get the output MIME type based on input type (preserve format where useful)
 */
function getOutputMimeType(inputType: string): string {
	if (inputType === 'image/png') return 'image/png'
	if (inputType === 'image/webp') return 'image/webp'
	if (inputType === 'image/gif') return 'image/png'
	return 'image/jpeg'
}

/**
 * Scale an image to a target width while preserving aspect ratio
 */
function scaleToWidth(source: ImageBitmap, targetWidth: number, mimeType: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const aspectRatio = source.height / source.width
		const targetHeight = Math.round(targetWidth * aspectRatio)

		const canvas = document.createElement('canvas')
		canvas.width = targetWidth
		canvas.height = targetHeight

		const ctx = canvas.getContext('2d')
		if (!ctx) {
			reject(new Error('Failed to get canvas context'))
			return
		}

		ctx.imageSmoothingEnabled = true
		ctx.imageSmoothingQuality = 'high'
		ctx.drawImage(source, 0, 0, targetWidth, targetHeight)

		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob)
				else reject(new Error('Failed to create blob from canvas'))
			},
			mimeType,
			quality,
		)
	})
}

/**
 * Create the original variant (full size but EXIF stripped)
 */
function createOriginal(source: ImageBitmap, mimeType: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const canvas = document.createElement('canvas')
		canvas.width = source.width
		canvas.height = source.height

		const ctx = canvas.getContext('2d')
		if (!ctx) {
			reject(new Error('Failed to get canvas context'))
			return
		}

		ctx.drawImage(source, 0, 0)

		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob)
				else reject(new Error('Failed to create blob from canvas'))
			},
			mimeType,
			quality,
		)
	})
}

/**
 * Determine which variants to generate based on original image width.
 * Only generates variants smaller than the original.
 */
function getVariantsToGenerate(originalWidth: number): ImageVariant[] {
	const variants: ImageVariant[] = ['original']

	for (const [variant, targetWidth] of Object.entries(VARIANT_WIDTHS)) {
		if (targetWidth < originalWidth) {
			variants.push(variant as ImageVariant)
		}
	}

	return variants.sort((a, b) => VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b))
}

/**
 * Generate all applicable image variants for a file.
 *
 * @param file - The image file to scale
 * @param onProgress - Optional progress callback (0-100)
 * @returns Array of scaled images, sorted from smallest to largest
 */
export async function generateImageVariants(file: File, onProgress?: (percent: number) => void): Promise<ScaledImage[]> {
	onProgress?.(0)

	const bitmap = await createImageBitmap(file)
	const mimeType = getOutputMimeType(file.type)

	onProgress?.(10)

	const variantsToGenerate = getVariantsToGenerate(bitmap.width)
	const results: ScaledImage[] = []

	console.log(`[variants] Generating ${variantsToGenerate.length} variants from ${bitmap.width}x${bitmap.height} ${file.type}`)

	for (let i = 0; i < variantsToGenerate.length; i++) {
		const variant = variantsToGenerate[i]
		const quality = VARIANT_QUALITY[variant]

		let blob: Blob
		let width: number
		let height: number

		if (variant === 'original') {
			blob = await createOriginal(bitmap, mimeType, quality)
			width = bitmap.width
			height = bitmap.height
		} else {
			const targetWidth = VARIANT_WIDTHS[variant]
			const aspectRatio = bitmap.height / bitmap.width
			width = targetWidth
			height = Math.round(targetWidth * aspectRatio)
			blob = await scaleToWidth(bitmap, targetWidth, mimeType, quality)
		}

		console.log(`[variants]   ${variant}: ${width}x${height} (${(blob.size / 1024).toFixed(0)}KB)`)

		results.push({ variant, blob, width, height, mimeType })

		const progress = 10 + Math.round(((i + 1) / variantsToGenerate.length) * 80)
		onProgress?.(progress)
	}

	onProgress?.(90)
	return results
}

/**
 * Check if a file is a supported image type for variant generation
 */
export function isSupportedImageForVariants(file: File): boolean {
	return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
	const extensions: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
	}
	return extensions[mimeType] ?? 'jpg'
}
