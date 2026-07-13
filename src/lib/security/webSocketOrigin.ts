/**
 * WebSocket Origin validation (H1: cross-site WebSocket hijacking).
 *
 * Extracted from src/index.tsx into a pure module so the security-critical
 * allowlist/same-origin logic can be unit-tested without booting the Bun
 * server. Behavior is unchanged.
 */

/**
 * Resolve the explicit allowlist of WebSocket origins (H1: cross-site WS hijacking).
 * Set via the `ALLOWED_ORIGINS` env var as a comma-separated list
 * (e.g. "https://plebeian.market,https://staging.plebeian.market").
 * Production SHOULD set this explicitly; an empty list falls back to same-origin
 * matching in isWebSocketOriginAllowed() so default/dev deployments keep working.
 */
export function getAllowedOrigins(): string[] {
	const raw = process.env.ALLOWED_ORIGINS
	if (raw && raw.trim()) {
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	}
	return []
}

/**
 * H1: Validate the WebSocket Origin header to prevent cross-site WebSocket hijacking.
 *
 * Browser WebSocket clients always send an `Origin` header; programmatic clients
 * (relay software, tests, server-to-server) typically do not. Absent Origin is
 * therefore allowed. When Origin is present:
 *   - if `ALLOWED_ORIGINS` is configured, it must contain the origin verbatim;
 *   - otherwise the origin's host must match the request's `Host` header
 *     (same-origin), which is the common SPA case and still blocks genuine
 *     cross-origin abuse.
 */
export function isWebSocketOriginAllowed(req: Request): boolean {
	const origin = req.headers.get('origin')
	if (!origin) return true // non-browser client (no Origin header)

	const allowlist = getAllowedOrigins()
	if (allowlist.length > 0) {
		return allowlist.includes(origin)
	}
	// No explicit allowlist: accept same-origin only.
	try {
		const originHost = new URL(origin).host
		const requestHost = req.headers.get('host')
		return !!requestHost && originHost === requestHost
	} catch {
		return false
	}
}
