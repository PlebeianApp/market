import { generateImageVariants, getExtensionFromMimeType, isSupportedImageForVariants } from '@/lib/image-scaler'
import { extractSha256FromUrl, FILE_METADATA_KIND, type UploadedVariant } from '@/lib/responsive-image'
import { ndkActions } from '@/lib/stores/ndk'
import type { BlossomUploadOptions } from '@nostr-dev-kit/blossom'
import NDKBlossom from '@nostr-dev-kit/blossom'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import type { NDKImetaTag } from '@nostr-dev-kit/ndk'

export type BlossomServer = {
	name: string
	url: string
	plan: 'free' | 'paid' | 'public'
}

export const BLOSSOM_SERVERS: BlossomServer[] = [
	{ name: 'nostrcheck.me', url: 'https://nostrcheck.me', plan: 'public' },
	{ name: 'Primal', url: 'https://blossom.primal.net', plan: 'public' },
	{ name: 'Blossom Band', url: 'https://blossom.band', plan: 'paid' },
	{ name: '24242', url: 'https://24242.io', plan: 'public' },
	{ name: 'f7z Blossom', url: 'https://blossom.f7z.io', plan: 'public' },
	{ name: 'nostr.download', url: 'https://nostr.download', plan: 'public' },
]

export interface UploadOptions {
	/**
	 * Preferred server URL to use for upload
	 */
	preferredServer?: string
	/**
	 * Callback for upload progress
	 */
	onProgress?: (progress: { loaded: number; total: number }) => void
	/**
	 * Callback for upload failures
	 */
	onError?: (error: string, serverUrl?: string) => void
	/**
	 * Maximum number of retry attempts
	 */
	maxRetries?: number
	/**
	 * Enable debug logging
	 */
	debug?: boolean
}

export interface UploadResult {
	imeta: NDKImetaTag
	url: string
	hash: string
}

/**
 * Upload a file to Blossom servers using NDKBlossom
 * @param file - File to upload
 * @param options - Upload options
 * @returns Upload result with imeta and URL
 */
export async function uploadFileToBlossom(file: File, options: UploadOptions = {}): Promise<UploadResult> {
	const ndk = ndkActions.getNDK()
	if (!ndk || !ndk.signer) {
		throw new Error('NDK or signer not initialized')
	}

	const blossom = new NDKBlossom(ndk)

	// Enable debug mode if requested
	if (options.debug) {
		blossom.debug = true
	}

	// Setup error callback
	if (options.onError) {
		blossom.onUploadFailed = (error: string, serverUrl?: string) => {
			options.onError!(error, serverUrl)
		}
	}

	// Setup progress callback
	if (options.onProgress) {
		blossom.onUploadProgress = (progress, _file, _serverUrl) => {
			options.onProgress!(progress)
			return 'continue'
		}
	}

	// Configure upload options
	const uploadOptions: BlossomUploadOptions = {}

	// Set preferred server if provided
	if (options.preferredServer) {
		uploadOptions.server = options.preferredServer
	}

	// Set fallback server (use first public server as fallback)
	const fallbackServer = BLOSSOM_SERVERS.find((s) => s.plan === 'public')
	if (fallbackServer && fallbackServer.url !== options.preferredServer) {
		uploadOptions.fallbackServer = fallbackServer.url
	}

	// Set retry options
	if (options.maxRetries !== undefined) {
		uploadOptions.maxRetries = options.maxRetries
	}

	try {
		// Upload the file using NDKBlossom
		const imeta = await blossom.upload(file, uploadOptions)

		// Extract the URL and hash from the imeta
		const url = imeta.url
		const hash = imeta.x || imeta.sha256 || ''

		return {
			imeta,
			url: url || '',
			hash: Array.isArray(hash) ? hash[0] : hash,
		}
	} catch (error: any) {
		// Log the error and re-throw
		console.error('Blossom upload failed:', error)
		throw new Error(error.message || 'Upload failed')
	}
}

/**
 * Check if a blossom server is available
 * @param serverUrl - Server URL to check
 * @param timeoutMs - Timeout in milliseconds
 * @returns True if server is available
 */
export async function checkBlossomServerAvailability(serverUrl: string, timeoutMs = 3000): Promise<boolean> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const normalizedUrl = serverUrl.replace(/\/$/, '')
		const response = await fetch(normalizedUrl, {
			method: 'HEAD',
			signal: controller.signal,
		})
		return response.ok
	} catch (error) {
		return false
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Get available blossom servers by checking their availability
 * @param timeoutMs - Timeout for each server check
 * @returns Array of available server URLs
 */
export async function getAvailableBlossomServers(timeoutMs = 3000): Promise<BlossomServer[]> {
	const availabilityChecks = BLOSSOM_SERVERS.map(async (server) => {
		const isAvailable = await checkBlossomServerAvailability(server.url, timeoutMs)
		return isAvailable ? server : null
	})

	const results = await Promise.all(availabilityChecks)
	return results.filter((server): server is BlossomServer => server !== null)
}

export interface ResponsiveUploadOptions extends UploadOptions {
	/** Overall progress callback (0-100) covering scaling + upload + publish */
	onOverallProgress?: (percent: number) => void
}

export interface ResponsiveUploadResult {
	/** URL of the original image (the one to store in product tags) */
	url: string
	/** sha256 hash of the original image */
	hash: string
	/** All uploaded variants */
	variants: UploadedVariant[]
}

/**
 * Build an imeta tag for a single variant (NIP-92/94 format)
 */
function buildImetaTag(v: UploadedVariant): string[] {
	const tag = ['imeta', `url ${v.url}`, `x ${v.sha256}`, `m ${v.mimeType}`, `dim ${v.width}x${v.height}`, `variant ${v.variant}`]
	if (v.size !== undefined) tag.push(`size ${v.size}`)
	return tag
}

/**
 * Upload an image with responsive variants.
 *
 * 1. Generate scaled variants (thumb → original) using canvas
 * 2. Upload each variant blob to Blossom
 * 3. Create and publish a kind 1063 binding event with imeta tags
 *
 * Falls back to a plain single upload for unsupported image types or videos.
 */
export async function uploadResponsiveImage(file: File, options: ResponsiveUploadOptions = {}): Promise<ResponsiveUploadResult> {
	// If not a supported image, fall back to plain upload
	if (!isSupportedImageForVariants(file)) {
		console.log('[variants] Unsupported image type, falling back to plain upload')
		const result = await uploadFileToBlossom(file, options)
		return { url: result.url, hash: result.hash, variants: [] }
	}

	const ndk = ndkActions.getNDK()
	if (!ndk || !ndk.signer) {
		throw new Error('NDK or signer not initialized')
	}

	// Phase 1: Generate variants (0-30%)
	console.log(`[variants] Phase 1: Generating variants for ${file.name} (${(file.size / 1024).toFixed(0)}KB)`)
	const scaledImages = await generateImageVariants(file, (percent) => {
		options.onOverallProgress?.(Math.round(percent * 0.3))
	})

	console.log(`[variants] Generated ${scaledImages.length} variants`)

	// Phase 2: Upload each variant (30-90%)
	const uploadedVariants: UploadedVariant[] = []
	const progressPerVariant = 60 / scaledImages.length

	for (let i = 0; i < scaledImages.length; i++) {
		const scaled = scaledImages[i]
		const extension = getExtensionFromMimeType(scaled.mimeType)
		const variantFile = new File([scaled.blob], `${file.name.replace(/\.[^.]+$/, '')}-${scaled.variant}.${extension}`, {
			type: scaled.mimeType,
		})

		console.log(
			`[variants] Phase 2: Uploading ${scaled.variant} (${scaled.width}x${scaled.height}, ${(scaled.blob.size / 1024).toFixed(0)}KB)`,
		)

		const result = await uploadFileToBlossom(variantFile, {
			...options,
			onProgress: (progress) => {
				const variantProgress = (progress.loaded / progress.total) * progressPerVariant
				options.onOverallProgress?.(Math.round(30 + i * progressPerVariant + variantProgress))
			},
		})

		// NDKBlossom often returns empty hash - extract from Blossom URL as fallback
		const sha256 = result.hash || extractSha256FromUrl(result.url) || ''
		if (!sha256) {
			console.warn(`[variants]   WARNING: No sha256 hash for ${scaled.variant} - binding event will be incomplete`)
		}

		uploadedVariants.push({
			variant: scaled.variant,
			url: result.url,
			sha256,
			width: scaled.width,
			height: scaled.height,
			mimeType: scaled.mimeType,
			size: scaled.blob.size,
		})

		console.log(`[variants]   Uploaded ${scaled.variant}: ${result.url} (hash: ${sha256.slice(0, 12)}...)`)
	}

	// Phase 3: Create and publish kind 1063 binding event (90-100%)
	options.onOverallProgress?.(90)
	console.log('[variants] Phase 3: Publishing kind 1063 binding event')

	// Sort variants smallest-to-largest for consistent ordering
	const variantOrder = ['thumb', 'mobile-sm', 'mobile-lg', 'desktop-sm', 'desktop-md', 'desktop-lg', 'original']
	const sortedVariants = [...uploadedVariants].sort((a, b) => variantOrder.indexOf(a.variant) - variantOrder.indexOf(b.variant))

	// Build tags
	const tags: string[][] = []
	for (const v of sortedVariants) {
		tags.push(buildImetaTag(v))
	}
	for (const v of sortedVariants) {
		tags.push(['x', v.sha256])
	}

	// Create and publish the event
	const event = new NDKEvent(ndk)
	event.kind = FILE_METADATA_KIND
	event.content = ''
	event.tags = tags

	await ndkActions.publishEvent(event)

	const originalVariant = uploadedVariants.find((v) => v.variant === 'original') || uploadedVariants[uploadedVariants.length - 1]

	console.log(`[variants] Published kind ${FILE_METADATA_KIND} binding event with ${sortedVariants.length} variants`)
	console.log(`[variants] Original URL: ${originalVariant.url}`)

	options.onOverallProgress?.(100)

	return {
		url: originalVariant.url,
		hash: originalVariant.sha256,
		variants: uploadedVariants,
	}
}
