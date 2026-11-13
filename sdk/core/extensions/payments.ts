import { ValidationError } from '../errors'
import { failure, success, type Result } from '../result'
import { ExtensionActionError } from './actions'
import { isLocalhostOrigin } from './hostPorts'

/**
 * User-paid extension calls (ADR-0023 §7.9). The user's own Cashu wallet pays per call, either the extension's payee
 * directly from the browser (`collectedBy: 'payee'`) or this marketplace, which redeems the token before running the
 * action (`collectedBy: 'marketplace'`). Neither is an order payment: no order or payment-lifecycle state is created,
 * and the states below are kept distinct rather than collapsed into "paid".
 */
export const EXTENSION_PAYMENT_METHODS = ['cashu'] as const
export type ExtensionPaymentMethod = (typeof EXTENSION_PAYMENT_METHODS)[number]
export const EXTENSION_PAYMENT_COLLECTORS = ['payee', 'marketplace'] as const
export type ExtensionPaymentCollector = (typeof EXTENSION_PAYMENT_COLLECTORS)[number]
/** Request header carrying the Cashu token for a marketplace-collected call. */
export const EXTENSION_PAYMENT_HEADER = 'x-cashu'

/** Public, client-safe price of one call, published on the action descriptor. Untrusted when parsed by a client. */
export interface ExtensionPaymentRequirement {
	method: ExtensionPaymentMethod
	collectedBy: ExtensionPaymentCollector
	/** `payee` only: https origin the browser pays directly. */
	payee?: string
	/** Face value of the token sent per call; unused value may come back as change. */
	amountSats: number
	/**
	 * Mints the collector accepts; the wallet pays from the first with enough balance. For `marketplace`, Platform
	 * fills these from its collector wallet, so tokens from an arbitrary (worthless) mint are never accepted.
	 */
	mints: readonly string[]
	/** True when the payee returns unspent value as a change token. */
	refundsChange: boolean
	description?: string
}

const MAX_MINTS = 10
const MAX_AMOUNT_SATS = 1_000_000

export function normalizePaymentMintUrl(value: string): string {
	return value.trim().replace(/\/+$/, '')
}

/** https, or http on loopback only (local mints and payees in development and e2e), like egress origins. */
function secureOrLoopback(url: URL): boolean {
	return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhostOrigin(url.origin))
}

function httpsOrigin(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	try {
		const url = new URL(value)
		if (!secureOrLoopback(url) || url.username || url.password) return undefined
		if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return undefined
		return url.origin
	} catch {
		return undefined
	}
}

function httpsMint(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	try {
		const url = new URL(value)
		if (!secureOrLoopback(url) || url.username || url.password || url.search || url.hash) return undefined
		return normalizePaymentMintUrl(url.toString())
	} catch {
		return undefined
	}
}

/** Parses an untrusted payment requirement (e.g. from `/api/config`). https payee and mints (http on loopback only). */
export function parseExtensionPaymentRequirement(input: unknown): Result<ExtensionPaymentRequirement, ValidationError> {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) return failure(new ValidationError('Payment must be an object'))
	const raw = input as Record<string, unknown>
	if (!(EXTENSION_PAYMENT_METHODS as readonly unknown[]).includes(raw.method)) return failure(new ValidationError('Unknown payment method'))
	const collectedBy: ExtensionPaymentCollector = raw.collectedBy === 'marketplace' ? 'marketplace' : 'payee'
	if (raw.collectedBy !== undefined && !(EXTENSION_PAYMENT_COLLECTORS as readonly unknown[]).includes(raw.collectedBy)) {
		return failure(new ValidationError('Unknown payment collector', ['collectedBy']))
	}
	const payee = collectedBy === 'payee' ? httpsOrigin(raw.payee) : undefined
	if (collectedBy === 'payee' && !payee) return failure(new ValidationError('Payee must be an https origin', ['payee']))
	const amount = raw.amountSats
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_SATS) {
		return failure(new ValidationError('amountSats must be a positive integer', ['amountSats']))
	}
	if (!Array.isArray(raw.mints) || raw.mints.length === 0 || raw.mints.length > MAX_MINTS) {
		return failure(new ValidationError('mints must list 1-10 mint URLs', ['mints']))
	}
	const mints = raw.mints.map(httpsMint)
	if (mints.some((mint) => !mint)) return failure(new ValidationError('Mints must be https URLs', ['mints']))
	const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim().slice(0, 200) : undefined
	return success({
		method: 'cashu',
		collectedBy,
		...(payee ? { payee } : {}),
		amountSats: amount,
		mints: [...new Set(mints as string[])],
		refundsChange: raw.refundsChange === true,
		...(description ? { description } : {}),
	})
}

// --- Paid call lifecycle -------------------------------------------------------------------------------------------

export type PaidCallState =
	| 'awaiting_approval'
	| 'declined'
	| 'approved'
	| 'insufficient_funds'
	| 'wallet_failed'
	| 'token_created'
	| 'request_sent'
	| 'provider_accepted'
	| 'provider_rejected'
	| 'change_received'
	| 'change_unclaimed'
	| 'no_change'
	| 'reclaimed'
	| 'reclaim_failed'

const TRANSITIONS: Record<PaidCallState, readonly PaidCallState[]> = {
	awaiting_approval: ['declined', 'approved'],
	declined: [],
	approved: ['insufficient_funds', 'wallet_failed', 'token_created'],
	insufficient_funds: [],
	wallet_failed: [],
	token_created: ['request_sent'],
	request_sent: ['provider_accepted', 'provider_rejected'],
	provider_accepted: ['change_received', 'change_unclaimed', 'no_change'],
	provider_rejected: ['change_received', 'change_unclaimed', 'reclaimed', 'reclaim_failed'],
	change_received: [],
	change_unclaimed: [],
	no_change: [],
	reclaimed: [],
	reclaim_failed: [],
}

export interface PaidCallRecord {
	state: PaidCallState
	collectedBy: ExtensionPaymentCollector
	/** Payee origin, or absent when this marketplace collected the payment. */
	payee?: string
	amountSats: number
	mint?: string
	/** Sats returned to the wallet as change or by reclaiming the unspent token. */
	returnedSats?: number
	/**
	 * A change token the wallet could not receive. Kept so the user can redeem it by hand; never logged or sent
	 * anywhere.
	 */
	unclaimedChangeToken?: string
	history: readonly { state: PaidCallState; at: number }[]
}

export function createPaidCallRecord(requirement: ExtensionPaymentRequirement, now = Date.now()): PaidCallRecord {
	return {
		state: 'awaiting_approval',
		collectedBy: requirement.collectedBy,
		...(requirement.payee ? { payee: requirement.payee } : {}),
		amountSats: requirement.amountSats,
		history: [{ state: 'awaiting_approval', at: now }],
	}
}

/** Moves a record forward; any transition not in the table is a programming error and is rejected. */
export function advancePaidCall(
	record: PaidCallRecord,
	next: PaidCallState,
	patch: Partial<Pick<PaidCallRecord, 'mint' | 'returnedSats' | 'unclaimedChangeToken'>> = {},
	now = Date.now(),
): Result<PaidCallRecord, ValidationError> {
	if (!TRANSITIONS[record.state].includes(next)) {
		return failure(new ValidationError(`Invalid paid call transition ${record.state} → ${next}`))
	}
	return success({ ...record, ...patch, state: next, history: [...record.history, { state: next, at: now }] })
}

export function isTerminalPaidCallState(state: PaidCallState): boolean {
	return TRANSITIONS[state].length === 0
}

/** Sats that left the wallet for good, once the call has finished. */
export function paidCallSpentSats(record: PaidCallRecord): number | undefined {
	if (!isTerminalPaidCallState(record.state)) return undefined
	if (['declined', 'insufficient_funds', 'wallet_failed'].includes(record.state)) return 0
	return Math.max(0, record.amountSats - (record.returnedSats ?? 0))
}

// --- Client execution ----------------------------------------------------------------------------------------------

/** The user's wallet, adapted by the app. Amounts are sats. */
export interface PaidCallWallet {
	balanceAt(mint: string): number | Promise<number>
	/** Creates a token for exactly `amount` from `mint`; the wallet keeps it reclaimable until claimed. */
	send(mint: string, amount: number): Promise<string>
	/** Redeems a token into the wallet and returns the sats received. */
	receive(token: string): Promise<number>
	/** Takes back an unclaimed sent token; false when the payee already claimed it. */
	reclaim(token: string): Promise<boolean>
}

export interface PayeeResponse {
	status: number
	body: string
}

/** Fetch bound to one payee origin: only same-origin absolute paths, no redirects, capped bodies. */
export type PayeeFetch = (
	path: string,
	init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<PayeeResponse>

export type PaidExecutorOutcome<Output> =
	| { outcome: 'accepted'; output: Output; changeToken?: string }
	| { outcome: 'rejected'; error: ExtensionActionError; changeToken?: string }

/**
 * Runs one paid call against the payee with the token. Built-in extensions ship these as pure functions; remote
 * extensions cannot, so a remote action with a payment requirement is not callable.
 */
export type PaidClientExecutor<Input, Output> = (
	context: { token: string; config: unknown; fetch: PayeeFetch; signal?: AbortSignal },
	input: Input,
) => Promise<PaidExecutorOutcome<Output>>

const MAX_PAYEE_RESPONSE_BYTES = 1_000_000

export function createPayeeFetch(payee: string, fetchImpl: typeof fetch = globalThis.fetch): PayeeFetch {
	return async (path, init) => {
		if (!path.startsWith('/') || path.startsWith('//')) throw new ValidationError('Payee path must be absolute')
		const url = new URL(path, payee)
		if (url.origin !== payee) throw new ValidationError('Payee path left the payee origin')
		const response = await fetchImpl(url.toString(), {
			method: init.method,
			headers: init.headers,
			body: init.body,
			signal: init.signal,
			redirect: 'error',
			credentials: 'omit',
		})
		const body = await response.text()
		if (body.length > MAX_PAYEE_RESPONSE_BYTES) return { status: 502, body: '' }
		return { status: response.status, body }
	}
}

export type PaidCallFailureReason = 'declined' | 'insufficient_funds' | 'wallet_failed' | 'provider_rejected' | 'invalid_state'

export class PaidCallError extends Error {
	readonly reason: PaidCallFailureReason
	readonly record: PaidCallRecord
	readonly providerError?: ExtensionActionError

	constructor(reason: PaidCallFailureReason, record: PaidCallRecord, providerError?: ExtensionActionError) {
		super(`Paid call ${reason}`)
		this.name = 'PaidCallError'
		this.reason = reason
		this.record = record
		this.providerError = providerError
	}
}

export interface RunPaidCallParams<Input, Output> {
	requirement: ExtensionPaymentRequirement
	executor: PaidClientExecutor<Input, Output>
	input: Input
	config: unknown
	wallet: PaidCallWallet
	/** Shows the price to the user; resolves true only on explicit approval. */
	approve: (requirement: ExtensionPaymentRequirement) => Promise<boolean>
	fetch?: typeof fetch
	signal?: AbortSignal
	onState?: (record: PaidCallRecord) => void
	now?: () => number
}

/**
 * Approve → pick a mint with enough balance → create a token → call the payee → recover value: change on success,
 * change or a reclaim of the untouched token on failure. Every step is a recorded state.
 */
export async function runPaidExtensionCall<Input, Output>(
	params: RunPaidCallParams<Input, Output>,
): Promise<{ output: Output; record: PaidCallRecord }> {
	const now = params.now ?? Date.now
	let record = createPaidCallRecord(params.requirement, now())
	const move = (next: PaidCallState, patch?: Parameters<typeof advancePaidCall>[2]) => {
		const advanced = advancePaidCall(record, next, patch, now())
		if (!advanced.ok) throw new PaidCallError('invalid_state', record)
		record = advanced.value
		params.onState?.(record)
	}
	params.onState?.(record)

	if (!(await params.approve(params.requirement))) {
		move('declined')
		throw new PaidCallError('declined', record)
	}
	move('approved')

	let mint: string | undefined
	for (const candidate of params.requirement.mints) {
		if ((await params.wallet.balanceAt(candidate)) >= params.requirement.amountSats) {
			mint = candidate
			break
		}
	}
	if (!mint) {
		move('insufficient_funds')
		throw new PaidCallError('insufficient_funds', record)
	}

	let token: string
	try {
		token = await params.wallet.send(mint, params.requirement.amountSats)
	} catch {
		move('wallet_failed', { mint })
		throw new PaidCallError('wallet_failed', record)
	}
	move('token_created', { mint })
	move('request_sent')

	const result = await params
		.executor({ token, config: params.config, fetch: payeeFetchFor(params.requirement, params.fetch), signal: params.signal }, params.input)
		.catch((cause): PaidExecutorOutcome<Output> => ({ outcome: 'rejected', error: toNetworkError(cause) }))

	if (result.outcome === 'accepted') {
		move('provider_accepted')
		await recoverChange(result.changeToken, params.wallet, move)
		return { output: result.output, record }
	}

	move('provider_rejected')
	if (result.changeToken) {
		await recoverChange(result.changeToken, params.wallet, move)
	} else {
		const reclaimed = await params.wallet.reclaim(token).catch(() => false)
		move(reclaimed ? 'reclaimed' : 'reclaim_failed', reclaimed ? { returnedSats: params.requirement.amountSats } : {})
	}
	throw new PaidCallError('provider_rejected', record, result.error)
}

async function recoverChange(
	changeToken: string | undefined,
	wallet: PaidCallWallet,
	move: (next: PaidCallState, patch?: Parameters<typeof advancePaidCall>[2]) => void,
): Promise<void> {
	if (!changeToken) {
		move('no_change')
		return
	}
	try {
		move('change_received', { returnedSats: await wallet.receive(changeToken) })
	} catch {
		move('change_unclaimed', { unclaimedChangeToken: changeToken })
	}
}

function payeeFetchFor(requirement: ExtensionPaymentRequirement, fetchImpl?: typeof fetch): PayeeFetch {
	if (requirement.payee) return createPayeeFetch(requirement.payee, fetchImpl)
	return async () => {
		throw new ValidationError('This payment has no payee to call')
	}
}

/** Response of a marketplace-collected call: change on success, a refund on failure, both Cashu tokens. */
export interface CollectedCallResponse<Output> {
	result: Result<Output, ExtensionActionError>
	returnedToken?: string
}

/** Executor for marketplace-collected payments: sends the token with the signed action request. */
export function createMarketplaceCollectedExecutor<Input, Output>(
	invoke: (input: Input, token: string, signal?: AbortSignal) => Promise<CollectedCallResponse<Output>>,
): PaidClientExecutor<Input, Output> {
	return async ({ token, signal }, input) => {
		const { result, returnedToken } = await invoke(input, token, signal)
		const change = returnedToken ? { changeToken: returnedToken } : {}
		return result.ok ? { outcome: 'accepted', output: result.value, ...change } : { outcome: 'rejected', error: result.error, ...change }
	}
}

function toNetworkError(cause: unknown): ExtensionActionError {
	return new ExtensionActionError('network_error', 'Payee request failed', cause)
}
