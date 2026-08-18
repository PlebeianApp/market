/** Hex-encoded SHA-256 of a UTF-8 string, using the platform crypto API. */
export const sha256Hex = async (value: string): Promise<string> => {
	const encoded = new TextEncoder().encode(value)
	const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}
