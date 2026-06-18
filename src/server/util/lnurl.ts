import { bech32 } from '@scure/base'

/** Decode an `lnurl1...` bech32 string back to its underlying URL, or null on failure. */
export function decodeLnurlBech32(lnurl: string): string | null {
	try {
		const decoded = bech32.decode(lnurl.toLowerCase() as `${string}1${string}`, 1500)
		const bytes = bech32.fromWords(decoded.words)
		return new TextDecoder().decode(Uint8Array.from(bytes))
	} catch {
		return null
	}
}

/**
 * Resolve a Lightning identifier (lud16 `name@domain`, lud06 bech32 LNURL,
 * or a direct https URL) to its LNURL-pay endpoint.
 */
export function toLnurlpEndpoint(lightningIdentifier: string): string {
	const trimmed = lightningIdentifier.trim()

	// LUD16: name@domain
	if (trimmed.includes('@')) {
		const [name, domain] = trimmed.split('@')
		if (!name || !domain) throw new Error('Invalid Lightning Address format')
		return `https://${domain}/.well-known/lnurlp/${name}`
	}

	// LUD06: bech32 lnurl
	if (trimmed.toLowerCase().startsWith('lnurl')) {
		const decoded = decodeLnurlBech32(trimmed)
		if (!decoded) throw new Error('Invalid LNURL (lud06)')
		return decoded
	}

	// Some profiles put the LNURL-pay endpoint directly in lud06
	if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
		return trimmed
	}

	throw new Error('Unsupported Lightning identifier (expected lud16 or lud06)')
}
