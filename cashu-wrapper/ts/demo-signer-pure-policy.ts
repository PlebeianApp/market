/** Closed, invocation-bound local categories. Nothing here is a wire receipt. */
export type DemoSignerPureReason = 'ADMISSION_STALE' | 'ADMISSION_BINDING' | 'ADMISSION_POOL'
	| 'ABORT_TIME' | 'ABORT_BINDING' | 'ABORT_LIFECYCLE' | 'MINT_BINDING' | 'MINT_SPENT' | 'QUORUM_BINDING'
const REASONS = new Set<DemoSignerPureReason>(['ADMISSION_STALE', 'ADMISSION_BINDING', 'ADMISSION_POOL',
	'ABORT_TIME', 'ABORT_BINDING', 'ABORT_LIFECYCLE', 'MINT_BINDING', 'MINT_SPENT', 'QUORUM_BINDING'])
const refusalOwners = new WeakMap<object, { owner: object; reason: DemoSignerPureReason }>()
const unavailableOwners = new WeakMap<object, object>()
const transportFailures = new WeakSet<object>()

export interface DemoSignerPureContext {
	readonly signal: AbortSignal
	check(): void
	refuse(reason: DemoSignerPureReason): never
	/** Only an already capability-limited read belongs here. */
	observe<T>(read: () => Promise<T>): Promise<T>
}

export function createDemoSignerPurePhase(parent: AbortSignal, milliseconds = 3000) {
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 3000) throw new Error('PURE_READ_BUDGET')
	const owner = Object.freeze({}), abort = new AbortController()
	const signal = AbortSignal.any([parent, abort.signal])
	const unavailable = (): Error => { const e = new Error('DEMO_SIGNER_READ_UNAVAILABLE'); unavailableOwners.set(e, owner); return e }
	const check = () => { if (signal.aborted) throw unavailable() }
	const context: DemoSignerPureContext = Object.freeze({ signal, check,
		refuse(reason: DemoSignerPureReason): never {
			check(); if (!REASONS.has(reason)) throw new Error('PURE_REASON_INVALID')
			const error = new Error(`DEMO_SIGNER_PURE_REFUSAL:${reason}`)
			refusalOwners.set(error, { owner, reason }); throw error
		},
		async observe<T>(read: () => Promise<T>): Promise<T> {
			check()
			try { const value = await read(); check(); return value }
			catch (error) {
				if (error instanceof Error && transportFailures.has(error)) throw unavailable()
				throw error
			}
		},
	})
	return { context,
		async run<T>(read: (context: DemoSignerPureContext) => Promise<T>): Promise<T> {
			let timer: ReturnType<typeof setTimeout> | undefined
			const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(unavailable()) }, milliseconds) })
			try { return await Promise.race([read(context), deadline]) }
			finally { clearTimeout(timer); abort.abort() }
		},
		classification(error: unknown): { kind: 'refused'; reason: DemoSignerPureReason } | { kind: 'unavailable' } | { kind: 'unknown' } {
			if (error !== null && typeof error === 'object') {
				const refusal = refusalOwners.get(error)
				if (refusal?.owner === owner) return { kind: 'refused', reason: refusal.reason }
				if (unavailableOwners.get(error) === owner) return { kind: 'unavailable' }
			}
			return { kind: 'unknown' }
		},
	}
}

/** Use only for the pinned Comet/mint observations, never a claim or Rust call. */
export function demoSignerObservationFetch(signal: AbortSignal, fetchImpl: typeof fetch): typeof fetch {
	return (async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input))
		const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
		const allowed = method === 'GET' && (/^\/v1\/(?:keysets|keys(?:\/[^/]+)?)$/.test(url.pathname)
			|| ['status', 'commit', 'block', 'abci_query'].some((path) => url.pathname === `/${path}`))
			|| method === 'POST' && url.pathname === '/v1/checkstate'
		if (!allowed || url.username || url.password) throw new Error('PURE_OBSERVATION_CAPABILITY_DENIED')
		try { return await fetchImpl(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }) }
		catch (cause) {
			// JSON/schema/business checks occur outside this wrapper. An HTTP status
			// or dependency error string cannot manufacture an outage category.
			if (cause instanceof TypeError || (cause instanceof DOMException && cause.name === 'AbortError')) {
				const error = new Error('DEMO_SIGNER_OBSERVATION_TRANSPORT'); transportFailures.add(error); throw error
			}
			throw cause
		}
	}) as typeof fetch
}

export class DemoSignerCachedRejection extends Error {
	readonly status = 422
	constructor(readonly body: string) { super('DEMO_SIGNER_CACHED_OPAQUE_REFUSAL'); this.name = 'DemoSignerCachedRejection' }
}
export function demoSignerRejectionBody(reason: DemoSignerPureReason): string {
	if (!REASONS.has(reason)) throw new Error('PURE_REASON_INVALID')
	return JSON.stringify({ error: `DEMO_SIGNER_LOCAL_REFUSAL:${reason}` })
}

/** Current pure safety may refuse replay of an already-complete success. This
 * is an opaque per-call refusal, never a replacement terminal journal outcome. */
export class DemoSignerOpaquePolicyRefusal extends Error {
	readonly body: string
	constructor(reason: DemoSignerPureReason) { super('DEMO_SIGNER_OPAQUE_CURRENT_POLICY_REFUSAL'); this.body = demoSignerRejectionBody(reason) }
}

export class DemoSignerJournalConflict extends Error { constructor() { super('DEMO_SIGNER_JOURNAL_CONFLICT: request digest changed') } }
