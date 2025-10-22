import { ndkActions } from '@/lib/stores/ndk'
import type { BlossomUploadOptions } from '@nostr-dev-kit/blossom'
import NDKBlossom from '@nostr-dev-kit/blossom'
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
