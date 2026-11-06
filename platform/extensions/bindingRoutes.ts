import { parseRemoteBindingRequest, type RepositorySnapshot } from '@sdk/core/extensions'
import { adminError, adminOk, authenticateAdminRequest, parseJsonBody, type AdminAuthDeps } from './adminAuth'
import { parseServerPubkey } from './sideloadRoutes'
import { MAX_BINDINGS, type ExtensionStateStore } from './stateStore'

export interface BindingRouteDeps extends AdminAuthDeps {
	store: () => ExtensionStateStore
	/** A fresh repository snapshot; binding and approval pin what the server announces right now. */
	getSnapshot: () => Promise<RepositorySnapshot | undefined>
	onChange: () => void
}

type Params = { params?: Record<string, string> }

/**
 * Admin-only remote binding management (ADR-0023 §7.5), NIP-98-authenticated, 404 for non-admins:
 * - `POST /api/extensions/bindings` binds a tool and pins its current `inputSchema` hash;
 * - `PATCH /api/extensions/bindings/:server/:action` enables/disables or approves the current definition;
 * - `DELETE /api/extensions/bindings/:server/:action` removes it.
 */
export function createBindingHandlers(deps: BindingRouteDeps) {
	const findTool = async (serverPubkey: string, toolName: string) => {
		const snapshot = await deps.getSnapshot()
		const entry = snapshot?.entries.find((item) => item.serverPubkey === serverPubkey)
		if (!entry || entry.state !== 'listed') return { error: 'The server is not listed with a valid announcement' } as const
		const tool = entry.tools.find((item) => item.name === toolName)
		if (!tool) return { error: 'The server does not announce this tool' } as const
		if (tool.price) return { error: 'Paid tools cannot be bound: paying third-party services is not supported' } as const
		if (!tool.inputSchemaHash) return { error: 'The tool definition could not be verified' } as const
		return { entry, tool } as const
	}

	const create = async (request: Request): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const parsed = parseRemoteBindingRequest(parseJsonBody(auth.body))
		if (!parsed.ok) return adminError('invalid_input', parsed.error.message)
		const binding = parsed.value

		const found = await findTool(binding.serverPubkey, binding.toolName)
		if ('error' in found) return adminError('invalid_input', found.error)

		const result = deps.store().addBinding({
			serverPubkey: binding.serverPubkey,
			toolName: binding.toolName,
			actionName: binding.actionName,
			capability: binding.capability,
			auth: binding.auth,
			perPubkey: binding.rateLimit.perPubkey,
			windowSeconds: binding.rateLimit.windowSeconds,
			inputSchemaHash: found.tool.inputSchemaHash,
			serverName: found.entry.name,
			enabled: true,
			createdBy: auth.pubkey,
			createdAt: Math.floor((deps.nowMs?.() ?? Date.now()) / 1000),
		})
		if (result === 'exists') return adminError('invalid_input', 'This server already has an action with that name')
		if (result === 'limit_reached') return adminError('invalid_input', `At most ${MAX_BINDINGS} tools can be bound`)
		deps.onChange()
		return adminOk({ serverPubkey: binding.serverPubkey, actionName: binding.actionName })
	}

	const target = (request: Params) => {
		const serverPubkey = parseServerPubkey(request.params?.server)
		const actionName = request.params?.action ?? ''
		const record = serverPubkey
			? deps
					.store()
					.listBindings()
					.find((item) => item.serverPubkey === serverPubkey && item.actionName === actionName)
			: undefined
		return record
	}

	const update = async (request: Request & Params): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const record = target(request)
		if (!record) return adminError('not_found')
		const change = parseJsonBody(auth.body) as { enabled?: unknown; approveCurrentDefinition?: unknown } | undefined
		if (!change || (typeof change.enabled !== 'boolean' && change.approveCurrentDefinition !== true)) {
			return adminError('invalid_input', 'Nothing to change')
		}

		let inputSchemaHash: string | undefined
		if (change.approveCurrentDefinition === true) {
			const found = await findTool(record.serverPubkey, record.toolName)
			if ('error' in found) return adminError('invalid_input', found.error)
			inputSchemaHash = found.tool.inputSchemaHash
		}
		deps.store().updateBinding(record.serverPubkey, record.actionName, {
			...(typeof change.enabled === 'boolean' ? { enabled: change.enabled } : {}),
			...(inputSchemaHash ? { inputSchemaHash } : {}),
		})
		deps.onChange()
		return adminOk({ serverPubkey: record.serverPubkey, actionName: record.actionName })
	}

	const remove = async (request: Request & Params): Promise<Response> => {
		const auth = await authenticateAdminRequest(request, deps)
		if (!auth.ok) return auth.response
		const record = target(request)
		if (!record || !deps.store().removeBinding(record.serverPubkey, record.actionName)) return adminError('not_found')
		deps.onChange()
		return adminOk({ serverPubkey: record.serverPubkey, actionName: record.actionName })
	}

	return { create, update, remove }
}
