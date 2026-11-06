import { nip19 } from 'nostr-tools'
import { adminError, adminOk, authenticateAdminRequest, parseJsonBody, type AdminAuthDeps } from './adminAuth'
import { MAX_SIDELOADS, type ExtensionStateStore } from './stateStore'

export interface SideloadRouteDeps extends AdminAuthDeps {
	store: () => ExtensionStateStore
	/** Called after a change so cached repository listings are refreshed. */
	onChange: () => void
}

/** Hex pubkey from a hex string or npub; anything else (nsec, nprofile, garbage) is rejected. */
export function parseServerPubkey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
	if (!trimmed.startsWith('npub1')) return undefined
	try {
		const decoded = nip19.decode(trimmed)
		return decoded.type === 'npub' ? decoded.data : undefined
	} catch {
		return undefined
	}
}

/**
 * `POST /api/extensions/sideloads` and `DELETE /api/extensions/sideloads/:pubkey` (ADR-0023 §7.2). Admin-only via
 * NIP-98; non-admins get 404 like the catalog. Sideloading lists a server for review; it grants it nothing.
 */
export function createSideloadHandlers(deps: SideloadRouteDeps) {
	const add = async (request: Request): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const server = parseServerPubkey((parseJsonBody(auth.body) as { server?: unknown } | undefined)?.server)
		if (!server) return adminError('invalid_input', 'Enter a server pubkey as 64-character hex or npub')

		const result = deps
			.store()
			.addSideload({ pubkey: server, addedBy: auth.pubkey, addedAt: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000) })
		if (result === 'limit_reached') return adminError('invalid_input', `At most ${MAX_SIDELOADS} servers can be sideloaded`)
		if (result === 'added') deps.onChange()
		return adminOk({ pubkey: server })
	}

	const remove = async (request: Request & { params?: Record<string, string> }): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const pubkey = parseServerPubkey(request.params?.pubkey)
		if (!pubkey || !deps.store().removeSideload(pubkey)) return adminError('not_found')
		deps.onChange()
		return adminOk({ pubkey })
	}

	return { add, remove }
}
