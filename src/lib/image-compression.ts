/**
 * Image compression utility with EXIF orientation handling
 * Provides client-side compression to reduce upload times
 *
 * Note: Canvas operations inherently strip EXIF metadata. This is by design
 * since re-injecting EXIF would require external libraries and add complexity.
 * For most use cases, the EXIF orientation is correctly applied to the image
 * before compression, so the final result is correctly oriented.
 *
 * Memory considerations:
 * - createImageBitmap() loads the full image into memory
 * - For very large images (20+ MP), this is acceptable since:
 *   1. Most modern devices have sufficient memory
 *   2. The resizing immediately creates a smaller canvas
 *   3. Memory is freed once the blob is created
 * - For performance-critical scenarios, consider using Web Workers
 */

export interface CompressionOptions {
	/** Target maximum file size in MB (default: 2) */
	maxSizeMB?: number
	/** JPEG/WebP quality (0.1 - 1, default: 0.7) */
	quality?: number
	/** Maximum width in pixels (default: 1600) */
	maxWidth?: number
	/** Maximum height in pixels (default: 1600) */
	maxHeight?: number
	/** Output format. If not specified, intelligently chosen based on input format:
	 * - PNG with transparency → 'image/png'
	 * - WebP supported → 'image/webp'
	 * - Otherwise → 'image/jpeg' */
	mimeType?: 'image/jpeg' | 'image/webp' | 'image/png'
	/** Debug logging */
	debug?: boolean
}

interface ExifOrientation {
	value: number
	name: string
}

/**
 * Check if browser supports WebP format.
 * This is intentionally lazy so the module can be imported in non-browser
 * environments without touching document during module initialization.
 */
let webpSupport: boolean | undefined

function isWebPSupported(): boolean {
	if (webpSupport !== undefined) {
		return webpSupport
	}

	if (typeof document === 'undefined') {
		return false
	}

	try {
		const canvas = document.createElement('canvas')
		webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
	} catch {
		webpSupport = false
	}

	return webpSupport
}

/**
 * Detect if an image has an alpha (transparency) channel
 * Works for PNG, GIF, WebP formats
 */
async function hasAlphaChannel(file: File): Promise<boolean> {
	try {
		// Only PNG files support alpha channel in a standard way
		if (file.type !== 'image/png' && file.type !== 'image/webp' && file.type !== 'image/gif') {
			return false
		}

		// For PNG: check for IHDR chunk bit depth and color type
		if (file.type === 'image/png') {
			const buffer = await file.slice(0, 1024).arrayBuffer()
			const view = new Uint8Array(buffer)

			// PNG signature: 0x89 0x50 0x4E 0x47 (137 80 78 71)
			if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
				// IHDR chunk starts at byte 8
				// Color type at byte 25: 0=gray, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA
				const colorType = view[25]
				return colorType === 4 || colorType === 6 // 4 = grayscale + alpha, 6 = RGBA
			}
		}

		// For GIF and WebP, transparency detection is more complex
		// Default to true to preserve format
		return file.type === 'image/gif' || file.type === 'image/webp'
	} catch (error) {
		// On error, assume no alpha to allow compression
		return false
	}
}

/**
 * Intelligently select the best MIME type for compression
 */
async function selectOptimalMimeType(file: File, userMimeType?: string): Promise<string> {
	// User explicitly specified format
	if (userMimeType) {
		return userMimeType
	}

	// Check if PNG has transparency - preserve it
	if (file.type === 'image/png') {
		const hasAlpha = await hasAlphaChannel(file)
		if (hasAlpha) {
			return 'image/png'
		}
		// PNG without transparency can be converted to JPEG for better compression
		const supportsWebP = isWebPSupported()
		return supportsWebP ? 'image/webp' : 'image/jpeg'
	}

	const supportsWebP = isWebPSupported()

	// WebP support - modern format with best compression
	if (supportsWebP) {
		return 'image/webp'
	}

	// Fallback to JPEG
	return 'image/jpeg'
}

/**
 * Parse EXIF orientation from image file
 * Returns orientation number (1-8) or 1 if not found
 */
async function getExifOrientation(file: File): Promise<number> {
	try {
		const buffer = await file.slice(0, 65536).arrayBuffer()
		const view = new Uint8Array(buffer)

		// Look for JPEG SOI marker (0xFFD8)
		if (view[0] !== 0xff || view[1] !== 0xd8) {
			return 1 // Not a JPEG or no EXIF
		}

		let offset = 2
		while (offset < view.length) {
			// Look for APP1 marker (0xFFE1)
			if (view[offset] === 0xff && view[offset + 1] === 0xe1) {
				offset += 2
				const exifLength = (view[offset] << 8) | view[offset + 1]

				// Check for EXIF header "Exif\0\0"
				if (view[offset + 2] === 0x45 && view[offset + 3] === 0x78 && view[offset + 4] === 0x69 && view[offset + 5] === 0x66) {
					// EXIF found, parse IFD
					const ifdOffset = offset + 8
					const littleEndian = view[ifdOffset + 1] === 0x49

					// Read number of directory entries
					const numEntries = littleEndian
						? view[ifdOffset + 8] | (view[ifdOffset + 9] << 8)
						: (view[ifdOffset + 8] << 8) | view[ifdOffset + 9]

					// Search for Orientation tag (0x0112)
					for (let i = 0; i < numEntries; i++) {
						const tagOffset = ifdOffset + 10 + i * 12
						if (tagOffset + 12 > view.length) {
							break
						}

						const tag = littleEndian ? view[tagOffset] | (view[tagOffset + 1] << 8) : (view[tagOffset] << 8) | view[tagOffset + 1]

						if (tag === 0x0112) {
							// Orientation tag found
							const valueOffset = tagOffset + 8
							const orientation = littleEndian ? view[valueOffset] : view[valueOffset + 3]
							return Math.min(Math.max(orientation, 1), 8)
						}
					}
				}
				return 1
			}

			// Move to next marker
			offset += 2
			const length = (view[offset] << 8) | view[offset + 1]
			offset += length
		}

		return 1
	} catch (error) {
		if ((error as any).debug) {
			console.error('Error reading EXIF orientation:', error)
		}
		return 1
	}
}

/**
 * Return a 2×1 JPEG marked with EXIF orientation 6 (90° clockwise). A browser
 * that honours `imageOrientation: 'none'` decodes it as 2×1; one that ignores
 * the option and auto-orients it decodes it as 1×2.
 */
async function createExifOrientationTestImage(): Promise<Blob> {
	const canvas = document.createElement('canvas')
	canvas.width = 2
	canvas.height = 1

	const jpeg = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob)
			} else {
				reject(new Error('Could not create EXIF orientation test image'))
			}
		}, 'image/jpeg')
	})
	const jpegBytes = new Uint8Array(await jpeg.arrayBuffer())
	if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
		throw new Error('EXIF orientation test image is not a JPEG')
	}

	// APP1 segment containing Exif\0\0, a little-endian TIFF header, and an
	// IFD0 Orientation (0x0112) SHORT value of 6.
	const exifSegment = Uint8Array.from([
		0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01,
		0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	])
	const orientedJpeg = new Uint8Array(jpegBytes.length + exifSegment.length)
	orientedJpeg.set(jpegBytes.subarray(0, 2))
	orientedJpeg.set(exifSegment, 2)
	orientedJpeg.set(jpegBytes.subarray(2), exifSegment.length + 2)

	return new Blob([orientedJpeg], { type: 'image/jpeg' })
}

/**
 * Determine whether EXIF orientation must be applied manually. Older Safari
 * versions accept unknown dictionary members, so a non-throwing
 * `imageOrientation: 'none'` call is not sufficient evidence that the option
 * was honoured. Instead, inspect the dimensions of a deliberately oriented
 * image after decoding it.
 */
async function detectManualExifOrientationRequirement(): Promise<boolean> {
	if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
		return false
	}

	let bitmap: ImageBitmap | undefined
	try {
		bitmap = await createImageBitmap(await createExifOrientationTestImage(), { imageOrientation: 'none' })
		return bitmap.width === 2 && bitmap.height === 1
	} catch {
		return false
	} finally {
		bitmap?.close()
	}
}

let manualExifOrientationRequirement: Promise<boolean> | undefined

function requiresManualExifOrientation(): Promise<boolean> {
	if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
		return Promise.resolve(false)
	}

	manualExifOrientationRequirement ??= detectManualExifOrientationRequirement()
	return manualExifOrientationRequirement
}

/**
 * Apply EXIF orientation to canvas context
 */
function applyExifOrientation(ctx: CanvasRenderingContext2D, orientation: number, width: number, height: number): void {
	switch (orientation) {
		case 2:
			// Horizontal flip
			ctx.translate(width, 0)
			ctx.scale(-1, 1)
			break
		case 3:
			// 180 degree rotation
			ctx.translate(width, height)
			ctx.rotate(Math.PI)
			break
		case 4:
			// Vertical flip
			ctx.translate(0, height)
			ctx.scale(1, -1)
			break
		case 5:
			// Transpose (horizontal flip + rotate 90 CW)
			ctx.rotate((Math.PI / 2) * 1)
			ctx.scale(1, -1)
			break
		case 6:
			// Rotate 90 CW
			ctx.rotate((Math.PI / 2) * 1)
			ctx.translate(0, -height)
			break
		case 7:
			// Transverse (horizontal flip + rotate 90 CCW)
			ctx.rotate((Math.PI / 2) * -1)
			ctx.scale(1, -1)
			break
		case 8:
			// Rotate 90 CCW
			ctx.rotate((Math.PI / 2) * -1)
			ctx.translate(-width, 0)
			break
	}
}

/**
 * Compress an image file with intelligent format selection
 * Returns a new compressed Blob
 *
 * Algorithm:
 * 1. Detect optimal format (PNG with transparency → PNG, otherwise WebP/JPEG)
 * 2. Resize to fit maxWidth/maxHeight while maintaining aspect ratio
 * 3. Apply EXIF orientation correction
 * 4. Iteratively compress, reducing quality if needed to hit size target
 */
export async function compressImage(file: File, options: CompressionOptions = {}): Promise<Blob> {
	const { maxSizeMB = 2, quality = 0.7, maxWidth = 1600, maxHeight = 1600, mimeType, debug = false } = options

	try {
		// Determine optimal MIME type
		const selectedMimeType = await selectOptimalMimeType(file, mimeType)
		if (debug) {
			console.log(`[ImageCompression] Selected format: ${selectedMimeType}`)
		}

		// Get EXIF orientation for proper rotation
		const orientation = await getExifOrientation(file)
		if (debug) {
			console.log(`[ImageCompression] Original file size: ${(file.size / 1024 / 1024).toFixed(2)}MB, EXIF orientation: ${orientation}`)
		}

		// Load image using createImageBitmap for efficiency. Browsers that honour
		// `imageOrientation: 'none'` need the manual canvas transform below;
		// browsers that auto-orient need neither that transform nor a dimension swap.
		const requiresManualOrientation = await requiresManualExifOrientation()
		const bitmap = await createImageBitmap(file, requiresManualOrientation ? { imageOrientation: 'none' } : undefined)

		// Calculate dimensions maintaining aspect ratio
		let width = bitmap.width
		let height = bitmap.height

		// Handle EXIF rotation that swaps dimensions
		if (requiresManualOrientation && (orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8)) {
			;[width, height] = [height, width]
		}

		const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
		const newWidth = Math.floor(width * ratio)
		const newHeight = Math.floor(height * ratio)

		if (debug) {
			console.log(`[ImageCompression] Resizing from ${bitmap.width}x${bitmap.height} to ${newWidth}x${newHeight}`)
		}

		// Create canvas and context
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d')
		if (!ctx) {
			throw new Error('Could not get canvas context')
		}

		// Set canvas dimensions
		canvas.width = newWidth
		canvas.height = newHeight

		// Apply EXIF orientation only when the bitmap was decoded without it.
		if (requiresManualOrientation) {
			applyExifOrientation(ctx, orientation, newWidth, newHeight)
		}

		// Draw the image
		ctx.drawImage(bitmap, 0, 0, newWidth, newHeight)

		// Compress using canvas toBlob with adaptive quality
		return new Promise((resolve, reject) => {
			let currentQuality = quality
			let attempt = 0
			const maxAttempts = 5

			const tryCompress = () => {
				canvas.toBlob(
					(blob) => {
						if (!blob) {
							reject(new Error('Failed to compress image'))
							return
						}

						const sizeMB = blob.size / 1024 / 1024

						// If file is still too large, reduce quality and retry
						if (sizeMB > maxSizeMB && attempt < maxAttempts && currentQuality > 0.2) {
							attempt++
							currentQuality = Math.max(currentQuality - 0.15, 0.2)
							if (debug) {
								console.log(
									`[ImageCompression] Attempt ${attempt}/${maxAttempts}: ${sizeMB.toFixed(2)}MB > ${maxSizeMB}MB target, reducing quality to ${currentQuality.toFixed(2)}`,
								)
							}
							tryCompress()
						} else {
							if (debug) {
								const compression = ((1 - blob.size / file.size) * 100).toFixed(1)
								console.log(
									`[ImageCompression] ✓ Final: ${sizeMB.toFixed(2)}MB (quality: ${currentQuality.toFixed(2)}, compression: ${compression}%)`,
								)
							}
							resolve(blob)
						}
					},
					selectedMimeType,
					currentQuality,
				)
			}

			tryCompress()
		})
	} catch (error) {
		if (debug) {
			console.error('[ImageCompression] Error during compression:', error)
		}
		// Return original file as fallback on error
		return file
	}
}

/**
 * Check if a file is compressible (is an image)
 * Note: GIF is excluded to preserve animation - canvas encoding would convert to still frame
 */
export function isCompressibleImage(file: File): boolean {
	const compressibleTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp']
	return compressibleTypes.includes(file.type.toLowerCase())
}

/**
 * Get file size in MB
 */
export function getFileSizeMB(file: Blob | File): number {
	return file.size / 1024 / 1024
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 Bytes'
	const k = 1024
	const sizes = ['Bytes', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Calculate compression ratio and statistics
 */
export function getCompressionStats(
	originalSize: number,
	compressedSize: number,
): {
	savingsPercent: number
	savingsSize: string
	isSignificant: boolean
} {
	const savings = originalSize - compressedSize
	const savingsPercent = Math.round((savings / originalSize) * 100)
	return {
		savingsPercent,
		savingsSize: formatFileSize(savings),
		isSignificant: savingsPercent > 10, // Only notify if >10% savings
	}
}
