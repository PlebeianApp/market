/**
 * Same-origin browser transport for the normalized Coco client ports.
 *
 * This adapter contains no trust decisions. It only maps the fixed reviewed
 * authority wire schemas into the stricter browser-facing port types. Every
 * identity is rechecked by `demo-friday-browser-coco-client` before use.
 */
import type {
	DemoFridayCocoTerminalPort,
	DemoFridayFundingAdmissionPort,
	DemoFridayFundingAdmissionStatusV1,
} from './demo-friday-browser-coco-client'
import type {
	DemoFridayBrowserAbortPreparationV1,
	DemoFridayBrowserAbortStatusV1,
	DemoFridayBrowserFundingAbortPort,
} from './demo-friday-browser-funding-abort'

const HEX_32 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const CONFIRM_READINESS_RETRIES = 15
const CONFIRM_READINESS_RETRY_MS = 1_000

function refuse(message: string): never {
	throw new Error(`DEMO_FRIDAY_BROWSER_AUTHORITY_HTTP: ${message}`)
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		refuse(`${label} has missing or unexpected fields`)
	}
}

function exactOrigin(value: string): string {
	const url = new URL(value)
	if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== ''
		|| url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		refuse('authority origin must be one exact HTTPS origin')
	}
	return url.origin
}

function canonical(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) refuse('authority response contains a non-safe integer')
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (typeof value !== 'object') refuse('authority response contains an unsupported type')
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

async function exactJson(response: Response): Promise<unknown> {
	if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json') {
		refuse(`authority returned HTTP ${response.status}`)
	}
	return response.json() as Promise<unknown>
}

async function exactRefusalCode(response: Response): Promise<string | null> {
	if (response.headers.get('content-type')?.split(';')[0] !== 'application/json') return null
	let value: unknown
	try { value = await response.json() }
	catch { return null }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
	const raw = value as Record<string, unknown>
	if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(['error']) || typeof raw.error !== 'string') return null
	return raw.error
}

function exactStatus(value: unknown): DemoFridayFundingAdmissionStatusV1 {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('status is not an object')
	const raw = value as Record<string, unknown>
	const base = ['schema', 'status', 'preparationId', 'fundingAuthorizationEventId', 'fundingOperationId',
		'bidAmount', 'reservedPoolAmount', 'canonicalMintUrl']
	const committed = raw.status === 'admitted' || raw.status === 'rejected_return'
	exactKeys(raw, committed
		? [...base, 'signedBidEventId', 'receiptDigest', 'transactionHash', 'committedHeight',
			...(raw.status === 'rejected_return' ? ['rejectionReason'] : [])] : base, 'status')
	if (raw.schema !== 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1'
		|| !['prepared', 'admitted', 'rejected_return', 'unknown'].includes(String(raw.status))
		|| !HEX_32.test(String(raw.preparationId)) || raw.preparationId !== raw.fundingAuthorizationEventId
		|| !ID.test(String(raw.fundingOperationId)) || !Number.isSafeInteger(raw.bidAmount)
		|| !Number.isSafeInteger(raw.reservedPoolAmount) || Number(raw.reservedPoolAmount) < 1
		|| Number(raw.reservedPoolAmount) > Number(raw.bidAmount)
		|| typeof raw.canonicalMintUrl !== 'string' || exactOrigin(String(raw.canonicalMintUrl)) !== raw.canonicalMintUrl) {
		refuse('authority status identity is malformed')
	}
	if (raw.status === 'rejected_return' && ![
		'auction_not_open', 'seller_self_bid', 'late', 'below_minimum', 'stale_leader', 'funding_expired',
	].includes(String(raw.rejectionReason))) refuse('authority rejection reason is malformed')
	return structuredClone(value) as DemoFridayFundingAdmissionStatusV1
}

export function createDemoFridayBrowserAuthorityFundingHttp(options: {
	origin: string
	fetchImpl?: typeof fetch
	waitImpl?: (delayMs: number) => Promise<void>
}): DemoFridayFundingAdmissionPort {
	const origin = exactOrigin(options.origin)
	const fetchImpl = options.fetchImpl ?? fetch
	const waitImpl = options.waitImpl ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)))
	const post = async (path: string, body: unknown): Promise<unknown> => exactJson(await fetchImpl(`${origin}${path}`, {
		method: 'POST', redirect: 'error', credentials: 'same-origin',
		headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
	}))
	return Object.freeze({
		async prepareExact(envelope: unknown) {
			const value = await post('/api/friday/funding', envelope)
			if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('prepare response is not an object')
			const raw = value as Record<string, unknown>
			exactKeys(raw, ['schema', 'status', 'preparationId', 'fundingAuthorizationEventId',
				'fundingOperationId', 'receiptDigest', 'bidAmount', 'reservedPoolAmount',
				'canonicalMintUrl', 'unsignedEvent'], 'prepare response')
			if (raw.schema !== 'PLEBEIAN_FRIDAY_V4_FUNDING_CHALLENGE_V1' || raw.status !== 'signature_required'
				|| !HEX_32.test(String(raw.preparationId)) || raw.preparationId !== raw.fundingAuthorizationEventId
				|| !ID.test(String(raw.fundingOperationId)) || !HEX_32.test(String(raw.receiptDigest))
				|| !Number.isSafeInteger(raw.bidAmount) || !Number.isSafeInteger(raw.reservedPoolAmount)
				|| Number(raw.reservedPoolAmount) < 1 || Number(raw.reservedPoolAmount) > Number(raw.bidAmount)
				|| typeof raw.canonicalMintUrl !== 'string' || exactOrigin(String(raw.canonicalMintUrl)) !== raw.canonicalMintUrl
				|| raw.unsignedEvent === null || typeof raw.unsignedEvent !== 'object') {
				refuse('prepare response identity is malformed')
			}
			return {
				preparationId: String(raw.preparationId), fundingAuthorizationEventId: String(raw.fundingAuthorizationEventId),
				fundingOperationId: String(raw.fundingOperationId), bidAmount: Number(raw.bidAmount),
				reservedPoolAmount: Number(raw.reservedPoolAmount), canonicalMintUrl: String(raw.canonicalMintUrl),
				receiptDigest: String(raw.receiptDigest),
				unsignedBid: structuredClone(raw.unsignedEvent) as never,
			}
		},
		async finalizeExact(request: Parameters<DemoFridayFundingAdmissionPort['finalizeExact']>[0]) {
			if (request.preparationId !== request.fundingAuthorizationEventId) refuse('finalize preparation identity differs')
			const confirmation = {
				schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_CONFIRMATION_V1',
				fundingAuthorizationEventId: request.fundingAuthorizationEventId,
				signedEvent: request.signedBid,
			}
			let result: unknown
			for (let attempt = 0; ; attempt += 1) {
				const response = await fetchImpl(`${origin}/api/friday/funding/confirm`, {
					method: 'POST', redirect: 'error', credentials: 'same-origin',
					headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(confirmation),
				})
				if (response.ok) {
					result = await exactJson(response)
					break
				}
				const refusalCode = await exactRefusalCode(response)
				if (response.status !== 503 || refusalCode !== 'new_operations_unready'
					|| attempt >= CONFIRM_READINESS_RETRIES) {
					refuse(`authority returned HTTP ${response.status}`)
				}
				// The authority emitted this exact refusal before invoking the funding
				// admission mutation. Re-read the already prepared identity before a
				// bounded retry of the same signed bytes. A committed result wins; an
				// unknown or changed identity remains fail-closed.
				const held = exactStatus(await post('/api/friday/funding/status', {
					preparationId: request.preparationId,
					fundingOperationId: request.fundingOperationId,
					fundingAuthorizationEventId: request.fundingAuthorizationEventId,
				}))
				if (held.preparationId !== request.preparationId
					|| held.fundingAuthorizationEventId !== request.fundingAuthorizationEventId
					|| held.fundingOperationId !== request.fundingOperationId) {
					refuse('transient confirm recovery status differs from request')
				}
				if (held.status === 'admitted' || held.status === 'rejected_return') return held
				if (held.status !== 'prepared') refuse('transient confirm recovery status is not prepared')
				await waitImpl(CONFIRM_READINESS_RETRY_MS)
			}
			if (result === null || typeof result !== 'object' || Array.isArray(result)) refuse('finalize response is not an object')
			const raw = result as Record<string, unknown>
			exactKeys(raw, ['schema', 'status', 'fundingAuthorizationEventId', 'fundingOperationId',
				'bidEventId', 'transactionHash', 'committedHeight', 'receiptDigest', 'bidAmount',
				'reservedPoolAmount', 'canonicalMintUrl', ...(raw.status === 'rejected_return' ? ['rejectionReason'] : [])], 'finalize response')
			if (raw.schema !== 'PLEBEIAN_FRIDAY_V4_FUNDING_RESULT_V1'
				|| !['admitted', 'rejected_return'].includes(String(raw.status))
				|| raw.fundingAuthorizationEventId !== request.fundingAuthorizationEventId
				|| raw.fundingOperationId !== request.fundingOperationId) refuse('finalize result differs from request')
			return exactStatus({
				schema: 'PLEBEIAN_FRIDAY_V4_FUNDING_STATUS_V1', status: raw.status as 'admitted' | 'rejected_return',
				preparationId: request.preparationId, fundingAuthorizationEventId: request.fundingAuthorizationEventId,
				fundingOperationId: request.fundingOperationId,
				bidAmount: Number(raw.bidAmount), reservedPoolAmount: Number(raw.reservedPoolAmount),
				canonicalMintUrl: raw.canonicalMintUrl,
				signedBidEventId: raw.bidEventId, receiptDigest: raw.receiptDigest,
				transactionHash: raw.transactionHash, committedHeight: raw.committedHeight,
				...(raw.rejectionReason === undefined ? {} : { rejectionReason: raw.rejectionReason as never }),
			})
		},
		async readExact(request: Parameters<DemoFridayFundingAdmissionPort['readExact']>[0]) {
			return exactStatus(await post('/api/friday/funding/status', request))
		},
	})
}

/** Same-origin transport for the terminal notice and exact recipient acknowledgement. */
export function createDemoFridayBrowserAuthorityTerminalHttp(options: {
	origin: string
	fetchImpl?: typeof fetch
	timeoutMs?: number
}): DemoFridayCocoTerminalPort {
	const origin = exactOrigin(options.origin)
	const fetchImpl = options.fetchImpl ?? fetch
	const timeoutMs = options.timeoutMs ?? 8_000
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
		refuse('terminal request timeout is invalid')
	}
	const post = async (path: string, body: unknown): Promise<unknown> => {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			// Keep the abort timer active through response body parsing. Returning the
			// exactJson promise directly would run finally as soon as headers arrive.
			const result = await exactJson(await fetchImpl(`${origin}${path}`, {
				method: 'POST', redirect: 'error', credentials: 'same-origin', signal: controller.signal,
				headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
			}))
			return result
		} catch (error) {
			if (controller.signal.aborted) {
				const action = path.endsWith('/ack') ? 'acknowledgement' : 'read'
				refuse(`terminal ${action} timed out; the exact operation remains retained for replay`)
			}
			throw error
		} finally { clearTimeout(timer) }
	}
	return Object.freeze({
		async readNoticeExact(request) {
			if (!HEX_32.test(request.actor) || !ID.test(request.fundingOperationId)) {
				refuse('terminal read identity is malformed')
			}
			return structuredClone(await post('/api/friday/terminal/read', request))
		},
		async readAcknowledgementStatusExact(request) {
			if (!HEX_32.test(request.actor) || !ID.test(request.fundingOperationId)) {
				refuse('terminal status identity is malformed')
			}
			const value = await post('/api/friday/terminal/status', request)
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				refuse('terminal status is not an object')
			}
			const raw = value as Record<string, unknown>
			exactKeys(raw, ['schema', 'actor', 'fundingOperationId', 'noticePresent', 'acknowledged'], 'terminal status')
			if (raw.schema !== 'PLEBEIAN_FRIDAY_COCO_TERMINAL_STATUS_V1'
				|| raw.actor !== request.actor || raw.fundingOperationId !== request.fundingOperationId
				|| typeof raw.noticePresent !== 'boolean' || typeof raw.acknowledged !== 'boolean'
				|| (raw.acknowledged === true && raw.noticePresent !== true)) {
				refuse('terminal status identity is malformed')
			}
			return structuredClone(value) as {
				schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_STATUS_V1'; actor: string; fundingOperationId: string;
				noticePresent: boolean; acknowledged: boolean
			}
		},
		async acknowledgeExact(request) {
			const result = await post('/api/friday/terminal/ack', request)
			if (canonical(result) !== canonical(request)) refuse('terminal acknowledgement response changed the exact receipt')
		},
	} satisfies DemoFridayCocoTerminalPort)
}

/**
 * Same-origin transport for validator-confirmed FundingAbort recovery.
 *
 * This layer deliberately performs no signing and never interprets a missing
 * response as a cancellation. The browser client validates the complete
 * certificate, H/H+1/H+2 finality and proof-state evidence before importing.
 */
export function createDemoFridayBrowserAuthorityFundingAbortHttp(options: {
	origin: string
	fetchImpl?: typeof fetch
}): DemoFridayBrowserFundingAbortPort {
	const origin = exactOrigin(options.origin)
	const fetchImpl = options.fetchImpl ?? fetch
	const post = async (path: string, body: unknown): Promise<unknown> => exactJson(await fetchImpl(`${origin}${path}`, {
		method: 'POST', redirect: 'error', credentials: 'same-origin',
		headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body),
	}))
	const preparation = (value: unknown): DemoFridayBrowserAbortPreparationV1 => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('abort preparation is not an object')
		const raw = value as Record<string, unknown>
		exactKeys(raw, ['schema', 'preparationId', 'terms'], 'abort preparation')
		if (raw.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_PREPARATION_V1'
			|| !HEX_32.test(String(raw.preparationId)) || raw.terms === null
			|| typeof raw.terms !== 'object' || Array.isArray(raw.terms)) refuse('abort preparation is malformed')
		return structuredClone(value) as DemoFridayBrowserAbortPreparationV1
	}
	const status = (value: unknown): DemoFridayBrowserAbortStatusV1 => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) refuse('abort status is not an object')
		const raw = value as Record<string, unknown>
		const committed = raw.status === 'COMMITTED_ABORT'
		exactKeys(raw, committed
			? ['schema', 'preparationId', 'actor', 'fundingOperationId', 'status', 'certificate', 'finality', 'proofStates']
			: ['schema', 'preparationId', 'actor', 'fundingOperationId', 'status'], 'abort status')
		if (raw.schema !== 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_ABORT_STATUS_V1'
			|| !HEX_32.test(String(raw.preparationId)) || !HEX_32.test(String(raw.actor))
			|| !ID.test(String(raw.fundingOperationId))
			|| !['PENDING', 'UNKNOWN', 'SPENT', 'COMMITTED_ABORT'].includes(String(raw.status))
			|| (committed && (raw.certificate === null || typeof raw.certificate !== 'object'
				|| raw.finality === null || typeof raw.finality !== 'object' || !Array.isArray(raw.proofStates)))) {
			refuse('abort status is malformed')
		}
		return structuredClone(value) as DemoFridayBrowserAbortStatusV1
	}
	return Object.freeze({
		async registerCapsuleExact(capsule: Parameters<DemoFridayBrowserFundingAbortPort['registerCapsuleExact']>[0]) {
			const value = await post('/api/friday/funding-abort/capsule', capsule)
			if (value === null || typeof value !== 'object' || Array.isArray(value)
				|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['capsuleDigest'])
				|| !HEX_32.test(String((value as { capsuleDigest?: unknown }).capsuleDigest))) {
				refuse('abort capsule registration response is malformed')
			}
			return { capsuleDigest: String((value as { capsuleDigest: string }).capsuleDigest) }
		},
		async prepareExact(request: Parameters<DemoFridayBrowserFundingAbortPort['prepareExact']>[0]) {
			return preparation(await post('/api/friday/funding-abort/prepare', request))
		},
		async requestAbortExact(request: Parameters<DemoFridayBrowserFundingAbortPort['requestAbortExact']>[0]) {
			return status(await post('/api/friday/funding-abort/request', request))
		},
		async readExact(request: Parameters<DemoFridayBrowserFundingAbortPort['readExact']>[0]) {
			return status(await post('/api/friday/funding-abort/status', request))
		},
	})
}
