/**
 * Outbound-network policy for the validator's mint reachability probes.
 *
 * Seller-provided mint URLs are attacker-controllable inputs, so the
 * validator must not blindly issue requests to them. This module
 * validates a mint URL's *destination* before any network call:
 *
 *   - scheme must be `https` (plain `http` is rejected unless an
 *     operator explicitly allows insecure localhosts for local dev),
 *   - the host must not be a private/loopback/link-local/reserved
 *     address (`127.x`, `10.x`, `192.168.x`, `172.16–31.x`,
 *     `169.254.x`, `::1`, `fc00::/7`, …) or the literal `localhost`.
 *
 * This is a syntactic destination guard applied BEFORE any network
 * call. Redirect following is handled separately by
 * `createPolicyEnforcedRequest`, which validates every redirect hop via
 * this guard before contacting it.
 *
 * Note: DNS-rebinding (a public hostname resolving to a private IP at
 * request time) is out of scope for this syntactic guard.
 */

export interface MintDestinationPolicyOptions {
	/** Allow `http://localhost` / `http://127.0.0.1` for local dev. Default false. */
	allowInsecureLocalhost?: boolean
}

export type DestinationCheck = { allowed: true } | { allowed: false; reason: string }

const PRIVATE_IPV4_PATTERNS: ReadonlyArray<(parts: number[]) => boolean> = [
	(parts) => parts[0] === 10, // 10.0.0.0/8
	(parts) => parts[0] === 127, // 127.0.0.0/8 (loopback)
	(parts) => parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31, // 172.16.0.0/12
	(parts) => parts[0] === 192 && parts[1] === 168, // 192.168.0.0/16
	(parts) => parts[0] === 169 && parts[1] === 254, // 169.254.0.0/16 (link-local)
	(parts) => parts[0] === 0, // 0.0.0.0/8
	(parts) => parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127, // 100.64.0.0/10 (CGNAT)
]

const isPrivateIpv4 = (host: string): boolean => {
	const parts = host.split('.').map(Number)
	if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false
	return PRIVATE_IPV4_PATTERNS.some((match) => match(parts))
}

const isPrivateIpv6 = (host: string): boolean => {
	// Strip IPv6 brackets (Bun's URL.hostname keeps them for literals).
	const h = host.replace(/^\[|\]$/g, '').toLowerCase()
	if (h === '::1' || h === '::') return true // loopback / unspecified
	if (h.startsWith('fe80')) return true // link-local
	if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local fc00::/7
	// IPv4-mapped (::ffff:a.b.c.d) — extract the v4 tail.
	const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
	if (mapped) return isPrivateIpv4(mapped[1]!)
	return false
}

const isIpLiteral = (host: string): boolean => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')

const isLocalhostHost = (host: string): boolean =>
	host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1'

export const isMintDestinationAllowed = (mintUrl: string, options: MintDestinationPolicyOptions = {}): DestinationCheck => {
	let parsed: URL
	try {
		parsed = new URL(mintUrl)
	} catch {
		return { allowed: false, reason: 'unparseable URL' }
	}

	const host = parsed.hostname
	const allowInsecureLocalhost = options.allowInsecureLocalhost ?? false
	const localhost = isLocalhostHost(host)

	if (parsed.protocol === 'http:') {
		if (!(allowInsecureLocalhost && localhost)) {
			return { allowed: false, reason: 'non-https mint URL' }
		}
	} else if (parsed.protocol !== 'https:') {
		return { allowed: false, reason: `unsupported scheme ${parsed.protocol}` }
	}

	// A localhost mint is local by definition; allow it only when the
	// operator opted into insecure-localhost (covers http + https forms).
	if (localhost) {
		return allowInsecureLocalhost ? { allowed: true } : { allowed: false, reason: 'localhost destination' }
	}

	if (isIpLiteral(host)) {
		if (host.includes(':') ? isPrivateIpv6(host) : isPrivateIpv4(host)) {
			return { allowed: false, reason: `private/reserved destination ${host}` }
		}
	}

	// No credentials, no userinfo.
	if (parsed.username || parsed.password) return { allowed: false, reason: 'credentials in URL' }

	return { allowed: true }
}

/**
 * Shape of cashu-ts's `request` options (subset we consume). The
 * `endpoint` is the FULL request URL (mint URL + path), built by
 * `CashuMint` before invoking the custom request.
 */
export interface CashuRequestOptions {
	endpoint: string
	method?: string
	requestBody?: unknown
	headers?: Record<string, string>
	signal?: AbortSignal
}

/**
 * Build a `CashuMint._customRequest`-compatible transport that enforces
 * the outbound destination policy at the actual HTTP request boundary —
 * including every redirect hop — so a seller-provided mint URL (or a
 * `302` it issues to a private host) can never be contacted when
 * disallowed.
 *
 * Redirects are followed manually (`redirect: 'manual'`) and each
 * `Location` is resolved against the current URL and re-validated via
 * `isMintDestinationAllowed` before contact; a disallowed hop throws
 * without fetching. Non-2xx final responses throw (callers catch and
 * treat the proof state as `unknown`); 2xx responses are parsed as JSON
 * and returned, matching cashu-ts's default `request` contract.
 */
export const createPolicyEnforcedRequest = (
	options: MintDestinationPolicyOptions = {},
): ((req: CashuRequestOptions) => Promise<unknown>) => {
	const maxRedirects = 5
	return async (req) => {
		let url = req.endpoint
		const baseInit: RequestInit = {
			method: req.method ?? 'GET',
			redirect: 'manual',
			signal: req.signal,
			headers: {
				Accept: 'application/json, text/plain, */*',
				...(req.requestBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
				...req.headers,
			},
		}
		let body: BodyInit | undefined = req.requestBody !== undefined ? JSON.stringify(req.requestBody) : undefined

		let res: Response | undefined
		for (let hop = 0; ; hop++) {
			const dest = isMintDestinationAllowed(url, options)
			if (!dest.allowed) throw new Error(`mint destination not allowed: ${url} (${dest.reason})`)

			const init: RequestInit = { ...baseInit, body }
			// eslint-disable-next-line no-await-in-loop -- sequential redirect following
			const response = await fetch(url, init)
			if (response.status >= 300 && response.status < 400) {
				if (hop >= maxRedirects) throw new Error(`too many redirects from ${req.endpoint}`)
				const location = response.headers.get('location')
				if (!location) throw new Error(`redirect with no Location from ${url}`)
				// Re-resolve relative redirects against the current URL and
				// re-validate the next hop at the top of the loop. Redirects
				// must not carry the original body/headers onward.
				url = new URL(location, url).toString()
				body = undefined
				baseInit.method = 'GET'
				continue
			}
			res = response
			break
		}

		if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? 'unknown'} from ${url}`)
		return await res.json()
	}
}
