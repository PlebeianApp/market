/**
 * Outbound-network policy for the validator's mint probes.
 *
 * Seller-provided mint URLs are attacker-controllable inputs, so the
 * validator must not blindly issue requests to them. Probing is
 * **disabled by default** and only enabled when the operator provides
 * an explicit allowlist (`allowedMints`). Two layers:
 *
 *   1. Allowlist gate (opt-in). When no `allowedMints` is configured the
 *      validator makes **no outbound network calls** to mints — it
 *      operates in a passive, listen-only mode. When an allowlist is
 *      provided, only mints on it are probed.
 *   2. Syntactic destination gate (interim containment). Even an
 *      allowlisted mint must pass `isMintDestinationAllowed`:
 *      scheme must be `https` (plain `http` is rejected unless an
 *      operator explicitly allows insecure localhosts for local dev),
 *      the host must not be a private/loopback/link-local/reserved
 *      address (`127.x`, `10.x`, `192.168.x`, `172.16–31.x`,
 *      `169.254.x`, `::1`, `fc00::/7`, …) or the literal `localhost`.
 *
 * The syntactic check is applied BEFORE any network call and at every
 * redirect hop by `createPolicyEnforcedRequest`. DNS-rebinding (a
 * public hostname resolving to a private IP at request time) remains
 * out of scope for this syntactic guard; DNS-aware enforcement can
 * follow separately.
 */

export interface MintDestinationPolicyOptions {
	/** Allow `http://localhost` / `http://127.0.0.1` for local dev. Default false. */
	allowInsecureLocalhost?: boolean
	/**
	 * Operator-approved mint URLs. When empty/undefined (the default),
	 * mint probing is **disabled** — no outbound network calls are made.
	 * When provided, only mints whose origin matches an entry in this
	 * list are probed (in addition to passing the syntactic destination
	 * check). Entries may be base URLs or full endpoint URLs; matching
	 * is by normalized origin (`scheme://host[:port]`).
	 */
	allowedMints?: string[]
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
 * Normalize a URL to its origin (`scheme://host[:port]`) with a trailing
 * slash stripped. Used for allowlist matching so that
 * `https://mint.example.com` and `https://mint.example.com/v1/checkstates`
 * both match an allowlist entry of `https://mint.example.com`.
 */
export const normalizeMintUrlOrigin = (url: string): string => {
	const parsed = new URL(url)
	let origin = parsed.origin
	if (origin.endsWith('/')) origin = origin.slice(0, -1)
	return origin
}

/**
 * Combined allowlist + syntactic gate for a mint URL. This is the
 * pre-flight check: it returns `allowed: false` when probing is disabled
 * (no operator allowlist), when the mint is not on the allowlist, or
 * when the destination fails the syntactic check.
 *
 * `isMintDestinationAllowed` (the syntactic-only check) remains the
 * containment layer applied at every redirect hop inside
 * `createPolicyEnforcedRequest`.
 */
export const checkMintProbeDestination = (mintUrl: string, options: MintDestinationPolicyOptions = {}): DestinationCheck => {
	const allowlist = options.allowedMints
	if (!allowlist || allowlist.length === 0) {
		return { allowed: false, reason: 'mint probing disabled — no operator allowlist configured' }
	}
	let origin: string
	try {
		origin = normalizeMintUrlOrigin(mintUrl)
	} catch {
		return { allowed: false, reason: 'unparseable mint URL' }
	}
	const allowlisted = allowlist.some((m) => {
		try {
			return normalizeMintUrlOrigin(m) === origin
		} catch {
			return false
		}
	})
	if (!allowlisted) {
		return { allowed: false, reason: 'mint not in operator allowlist' }
	}
	return isMintDestinationAllowed(mintUrl, options)
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
 * At the initial endpoint (hop 0) the **allowlist gate**
 * (`checkMintProbeDestination`) applies: when no operator allowlist is
 * configured the request is rejected before any network call. At every
 * redirect hop the **syntactic destination gate**
 * (`isMintDestinationAllowed`) applies: a redirect to a private host is
 * rejected before contact. (DNS-aware enforcement of redirects is a
 * follow-up; the syntactic check is the accepted interim containment.)
 *
 * Redirects are followed manually (`redirect: 'manual'`) and each
 * `Location` is resolved against the current URL and re-validated
 * before contact; a disallowed hop throws without fetching. Non-2xx
 * final responses throw (callers catch and treat the proof state as
 * `unknown`); 2xx responses are parsed as JSON and returned, matching
 * cashu-ts's default `request` contract.
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
			// Hop 0: allowlist gate + syntactic check. Hops > 0: syntactic
			// check only (redirect containment — DNS-aware enforcement of
			// redirects is a follow-up).
			const dest = hop === 0 ? checkMintProbeDestination(url, options) : isMintDestinationAllowed(url, options)
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
