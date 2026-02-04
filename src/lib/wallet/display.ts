/**
 * Extract hostname from a mint URL for display purposes.
 * Handles invalid URLs gracefully.
 *
 * @param mintUrl Full mint URL
 * @returns Hostname or the original URL if parsing fails
 */
export function getMintHostname(mintUrl: string): string {
	try {
		return new URL(mintUrl).hostname
	} catch {
		return mintUrl
	}
}

/**
 * Format a sats amount for display.
 * @param sats Amount in satoshis
 * @returns Formatted string with locale-appropriate separators
 */
export function formatSats(sats: number): string {
	return sats.toLocaleString()
}
