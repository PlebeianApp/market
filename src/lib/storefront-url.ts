const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function isStorefrontBaseUrl(value: string): boolean {
	try {
		const url = new URL(value)
		const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
		return (
			(url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
			!url.username &&
			!url.password &&
			url.pathname === '/' &&
			!url.search &&
			!url.hash &&
			url.hostname.split('.').every((label) => DNS_LABEL.test(label)) &&
			!/^[\d.]+$/.test(url.hostname)
		)
	} catch {
		return false
	}
}

/** Only one DNS label directly below the configured base host names a store. */
export function storefrontNameFromHostname(hostname: string, baseUrl?: string): string | null {
	if (!baseUrl) return null
	const base = new URL(baseUrl).hostname
	const host = hostname.toLowerCase()
	if (!host.endsWith(`.${base}`)) return null
	const name = host.slice(0, -(base.length + 1))
	return DNS_LABEL.test(name) ? name : null
}

export function storefrontPublicHref(name: string, baseUrl?: string): string {
	if (!baseUrl) return `/${encodeURIComponent(name)}`
	const url = new URL(baseUrl)
	if (DNS_LABEL.test(name) && `${name}.${url.hostname}`.length <= 253) {
		url.hostname = `${name}.${url.hostname}`
	} else {
		// Existing path registrations can contain names that are not DNS labels.
		url.pathname = `/${encodeURIComponent(name)}`
	}
	return url.href
}
