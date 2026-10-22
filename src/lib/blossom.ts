import { sha256 as sha256Digest } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
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
 * Fetch a blob by its sha256 digest, verifying it before returning it.
 *
 * The digest is the entire trust model of this function. A Blossom server is an
 * arbitrary third party reached over the open network, and the only reason to
 * believe the bytes it returns is that they hash to the digest the event named.
 * `bitkarrot/nostr-cms` reaches the same conclusion and verifies in its own
 * reader; a mismatch is not a warning to log and continue past — the bytes are
 * discarded, because a server that answers a request for a hash with bytes that
 * do not match that hash can answer with anything at all.
 *
 * Servers are tried in order and the first verified response wins. `fetchImpl`
 * exists so tests can supply a local fetch and stay off the network, per
 * ADR-0005.
 */
export interface BlossomBlobResult {
	bytes: Uint8Array
	/** The server that served the verified bytes. */
	server: string
	contentType: string | null
}

export interface BlossomFetchOptions {
	/** Cap on the response body. A blob server is not trusted to be honest about size. */
	maxBytes?: number
	timeoutMs?: number
	fetchImpl?: typeof fetch
}

const DEFAULT_MAX_BLOB_BYTES = 2_000_000
const DEFAULT_BLOB_TIMEOUT_MS = 10_000

export async function fetchBlossomBlob(
	sha256: string,
	servers: string[],
	options: BlossomFetchOptions = {},
): Promise<{ blob: BlossomBlobResult | null; error: string | null }> {
	const digest = sha256.toLowerCase().trim()
	if (!/^[0-9a-f]{64}$/.test(digest)) {
		return { blob: null, error: 'Refusing to fetch a blob without a well-formed sha256 digest' }
	}

	const candidates = servers.length > 0 ? servers : BLOSSOM_SERVERS.filter((s) => s.plan === 'public').map((s) => s.url)
	if (candidates.length === 0) {
		return { blob: null, error: 'No Blossom server to fetch from' }
	}

	const fetchImpl = options.fetchImpl ?? fetch
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BLOB_BYTES
	const timeoutMs = options.timeoutMs ?? DEFAULT_BLOB_TIMEOUT_MS
	const failures: string[] = []

	for (const server of candidates) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			const response = await fetchImpl(`${server.replace(/\/$/, '')}/${digest}`, { signal: controller.signal })
			if (!response.ok) {
				failures.push(`${server}: HTTP ${response.status}`)
				continue
			}

			const buffer = await response.arrayBuffer()
			if (buffer.byteLength > maxBytes) {
				failures.push(`${server}: blob exceeds ${maxBytes} bytes`)
				continue
			}

			const bytes = new Uint8Array(buffer)
			const actual = bytesToHex(sha256Digest(bytes))
			if (actual !== digest) {
				failures.push(`${server}: content does not match the requested hash`)
				continue
			}

			return { blob: { bytes, server, contentType: response.headers?.get?.('content-type') ?? null }, error: null }
		} catch (error) {
			failures.push(`${server}: ${error instanceof Error ? error.message : 'request failed'}`)
		} finally {
			clearTimeout(timer)
		}
	}

	return { blob: null, error: `No Blossom server served a matching blob (${failures.join('; ')})` }
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
