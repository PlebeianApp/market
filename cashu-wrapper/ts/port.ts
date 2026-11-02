/**
 * cashu-wrapper/ts/port.ts — the Coco wrapper's adapter onto the funds contract's port.
 *
 * `#7a7f2d` CocoWalletPortAdapter — the adapter that carries the reviewed wallet host onto the proven port.
 * It maps the contract's three operations onto the host's own lifecycle rather than adding one:
 * `obtain` drives the host's pre-boundary step, `submit` the step that crosses the monetary boundary,
 * and `reconcile` is the host's `recover` (`#2f50be`), the idempotent read that never submits. The
 * Coco leg's own durable reference — the ENGINE's operation id, retained before the proofs are spent,
 * with the mint's melt quote id kept beside it where the engine exposes one (`#badc9a`) — lives in a
 * wrapper-owned leg record linked to the host's command record by the stable command id (`#7654d1`),
 * and no field is added to the host's record. (The ported engine does NOT discard the quote: that claim
 * came from the market's legacy NIP-60 path, never from Coco — `auctions/cocoEngine.ts` reads
 * `ops.*.get` by id and, while an operation is `executing`, calls `ops.receive.refresh(operation.id)`,
 * so the engine keeps the operation and asks the authority again.) The reconcile is therefore a read
 * plus a refresh against the engine, and the app-supplied quote read is a complement, not the only path.
 * The adapter consumes only the host's public snapshot and results (`#7654d1`), so it opens no path by
 * which a store value can carry a seed, proof, token or witness out of the host.
 */
import { WalletHostError } from './errors'
import type { CocoWalletHost } from './host'
import type {
	CocoEngineOperation,
	CocoEngineOperationState,
	CocoOperationPort,
	CocoReconcilerStatus,
	WalletAccount,
	WalletAdapterContext,
	WalletApplicationAdapter,
	WalletMoney,
	WalletOperationCommand,
	WalletOperationSnapshot,
	WalletRecoveryResult,
	WalletStep,
	WalletStepResult,
} from './types'
import type {
	FundsAuthorityKind,
	FundsHandle,
	FundsOperations,
	FundsProgress,
	FundsQuote,
	FundsRefusal,
	FundsRung,
	FundsStep,
	FundsWitness,
	FundsWitnessKind,
	WrapperRegistration,
} from '../../funds-contract/ts/index'

/** `#7a7f2d` CocoPortAdapterError — the adapter's closed error surface, one stable code per refusal. */
export class CocoPortAdapterError extends WalletHostError {
	constructor(code: string, message: string) {
		super('CocoPortAdapterError', code, message)
	}
}

const CONTRACT_PORT = 'funds-contract'
/** `#7a7f2d` the Coco authority is local: the mint is a proof repository the app itself holds. */
const AUTHORITY_KIND: FundsAuthorityKind = 'local'
/** The port's canonical order; the leg's plan is this order projected onto its declared subset. */
const CANONICAL: readonly FundsStep[] = ['obtain', 'submit', 'reconcile']
const ALL_OPERATIONS: FundsOperations = ['obtain', 'submit', 'reconcile']
/**
 * `#7a7f2d` the host lifecycle the port is mapped onto. `prepare` is the pre-boundary step (it obtains the
 * leg's durable reference) and `attempt` is the step that crosses the monetary boundary (the melt).
 */
const HOST_PLAN: readonly WalletStep[] = ['prepare', 'attempt']
const PRE_BOUNDARY_STEP: WalletStep = 'prepare'
const BOUNDARY_STEP: WalletStep = 'attempt'

const REFUSAL_REASONS = {
	invalidAmount: 'invalid-amount',
	overCeiling: 'over-ceiling',
	noReference: 'no-reference',
	invalidAccount: 'invalid-account',
} as const

/** `#7a7f2d` CocoLegKind — the Coco wrapper's one leg: the melt, a local-authority money-mover. */
export type CocoLegKind = 'melt'

/** `#7a7f2d` CocoLegOperationsDeclaration — the subset of the port's operations the leg has, in canonical order. */
export interface CocoLegOperationsDeclaration {
	readonly kind: CocoLegKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
}

const LEG_OPERATIONS: Record<CocoLegKind, FundsOperations> = {
	melt: ['obtain', 'submit', 'reconcile'],
}

const planFor = (operations: FundsOperations): readonly FundsStep[] =>
	CANONICAL.filter((step) => operations.includes(step))

const LEG_KINDS = Object.keys(LEG_OPERATIONS) as CocoLegKind[]

const LEG_DECLARATIONS: readonly CocoLegOperationsDeclaration[] = LEG_KINDS.map((kind) => ({
	kind,
	operations: LEG_OPERATIONS[kind],
	plan: planFor(LEG_OPERATIONS[kind]),
}))

/** The witness kinds this leg can produce: a validating preimage (cryptographic) and the mint's word. */
const WITNESS_KINDS: readonly FundsWitnessKind[] = ['preimage', 'mint_quote_state']

/** `#7a7f2d` CocoLegKey — the leg store's key: per wrapper and leg, the same shape the other rails use. */
export interface CocoLegKey {
	readonly wrapperId: string
	readonly legId: string
}

/** `#7a7f2d` CocoLegCommand — what opens the leg: the rail's own parameters only. */
export interface CocoLegCommand {
	readonly legId: string
	readonly applicationId: string
	readonly operationKind: string
	readonly account: WalletAccount
	readonly money: WalletMoney
	/** the bolt11 the melt pays */
	readonly invoice: string
	/** the app's stable digest of the intent; the host refuses a reuse with a different one */
	readonly intentFingerprint: string
	readonly description?: string
}

/** `#badc9a` CocoMeltQuote — the mint's melt quote: the leg's durable reference, with an ABSOLUTE expiry. */
export interface CocoMeltQuote {
	readonly quoteId: string
	/** the engine's operation id for this melt — the leg's durable reference (`#badc9a`) */
	readonly engineOperationId: string
	/** absolute Unix milliseconds, from the mint — never a duration */
	readonly expiryAt: number
	readonly state: 'unpaid' | 'pending' | 'paid'
	readonly preimage?: string
}

/** `#badc9a` CocoMeltResult — what the melt returns: the mint's state and, when it settled, the preimage. */
export interface CocoMeltResult {
	readonly quoteId: string
	/** the engine's operation id this melt ran as — the durable reference retained before the boundary */
	readonly engineOperationId: string
	readonly state: 'unpaid' | 'pending' | 'paid'
	readonly preimage?: string
}

/**
 * `#7a7f2d` CocoMeltRail — the injected mint port. `quote` and `melt` are the rail's own calls and `readQuote`
 * is the local reconcile; the module opens no network of its own, so a fake drives every test.
 */
export interface CocoMeltRail {
	quote(request: { readonly invoice: string; readonly amountSat: number }): Promise<CocoMeltQuote>
	melt(request: { readonly quoteId: string; readonly invoice: string }): Promise<CocoMeltResult>
	/** the local re-ask: `null` means no answer, never a negative settlement */
	readQuote(request: { readonly quoteId: string }): Promise<CocoMeltQuote | null>
	/** validate a preimage against the invoice's own payment hash */
	validatePreimage(invoice: string, preimage: string): boolean
	/** release a prepared local reservation when the command is cancelled */
	release?(request: { readonly quoteId: string }): Promise<void>
}

/**
 * `#badc9a` CocoLegRecord — the wrapper-owned leg record. It carries the leg's own durable reference — the
 * engine's operation id (with the mint's melt quote id where the engine exposes one) — and links to the
 * host's command record by the stable command id (`#7654d1`); it carries no bearer material.
 * `quoteExpiryAt` is the absolute deadline.
 */
export interface CocoLegRecord {
	readonly wrapperId: string
	readonly legId: string
	/** the link to the host's command record (`#7654d1`) */
	readonly commandId: string
	readonly kind: CocoLegKind
	readonly method: string
	readonly authorityKind: FundsAuthorityKind
	readonly operations: FundsOperations
	readonly plan: readonly FundsStep[]
	readonly invoice: string
	/** the engine's operation id — the leg's durable reference, retained before the proofs are spent */
	readonly engineOperationId?: string
	/** the mint's melt quote id, retained beside the reference where the engine exposes one */
	readonly meltQuoteId?: string
	/** the mint's absolute quote expiry, in Unix milliseconds — never a duration */
	readonly quoteExpiryAt?: number
	readonly progress: FundsProgress
	readonly rung: FundsRung
	readonly witness?: FundsWitness
	/** explicit marker that no witness closes this leg — never an empty string */
	readonly unwitnessed: boolean
	readonly revision: number
	readonly createdAt: number
	readonly updatedAt: number
}

/**
 * `#7a7f2d` CocoLegStore — the durable leg store the wrapper declares and the app injects: the wallet host's
 * store contract, generalised by key per wrapper and leg. `compareAndSet` MUST atomically reject any
 * revision other than `expectedRevision`.
 */
export interface CocoLegStore {
	createOrGet(record: CocoLegRecord): Promise<{ record: CocoLegRecord; created: boolean }>
	get(key: CocoLegKey): Promise<CocoLegRecord | null>
	list(wrapperId?: string): Promise<readonly CocoLegRecord[]>
	compareAndSet(key: CocoLegKey, expectedRevision: number, next: CocoLegRecord): Promise<CocoLegRecord>
}

/** `#7a7f2d` CocoPortAdapterOptions — what the composing app injects. `now` is required, never a clock global. */
export interface CocoPortAdapterOptions {
	readonly wrapperId: string
	readonly method: string
	readonly applicationId: string
	readonly operationKind: string
	readonly store: CocoLegStore
	readonly storeKind: string
	readonly rail: CocoMeltRail
	readonly ceiling: number
	readonly contractVersion: string
	/** Unix milliseconds. Required so the module never reads a host clock global. */
	readonly now: () => number
}

const REFUSAL = (reason: string, field: string): FundsRefusal => ({ refused: true, reason, field })

const requireText = (value: unknown, label: string): string => {
	if (typeof value !== 'string') throw new CocoPortAdapterError('coco_configuration', `${label} must be a string`)
	const normalized = value.trim()
	if (!normalized || normalized !== value) {
		throw new CocoPortAdapterError('coco_configuration', `${label} must be a non-empty, trimmed value`)
	}
	return normalized
}

const requireSafeInteger = (value: unknown, label: string): number => {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new CocoPortAdapterError('coco_record_malformed', `${label} must be a non-negative safe integer`)
	}
	return value
}

// The leg record's declared shape, as an explicit allow-list. The store is an injected port, so nothing
// it returns may be trusted: unknown top-level keys are STRIPPED by the field-by-field projection below
// (never rejected — a real adapter decorates a record with its own bookkeeping), while a DECLARED field
// carrying a malformed value fails closed here, naming the field and never echoing the value.
const LEG_REQUIRED_FIELDS = [
	'wrapperId',
	'legId',
	'commandId',
	'kind',
	'method',
	'authorityKind',
	'operations',
	'plan',
	'invoice',
	'progress',
	'rung',
	'unwitnessed',
	'revision',
	'createdAt',
	'updatedAt',
] as const

const STEPS: ReadonlySet<string> = new Set(['obtain', 'submit', 'reconcile'])
const RUNGS: ReadonlySet<string> = new Set(['attested', 'witnessed-settled', 'unresolved', 'abandoned'])
const PROGRESS: ReadonlySet<string> = new Set(['intent', 'attempted', 'submitted'])
const AUTHORITY_KINDS: ReadonlySet<string> = new Set(['local', 'remote-and-observable'])
const WITNESS_KIND_SET: ReadonlySet<string> = new Set([
	'preimage',
	'zap_receipt',
	'mint_quote_state',
	'lnurl_verify',
	'seller_attestation',
	'ack',
])

const requireSteps = (value: unknown, label: string): readonly FundsStep[] => {
	if (!Array.isArray(value)) throw new CocoPortAdapterError('coco_record_malformed', `${label} must be an array`)
	const steps: FundsStep[] = []
	for (const step of value) {
		if (typeof step !== 'string' || !STEPS.has(step)) {
			throw new CocoPortAdapterError('coco_record_malformed', `${label} must contain only the port's operations`)
		}
		steps.push(step as FundsStep)
	}
	return steps
}

const OPERATION_STATES: ReadonlySet<string> = new Set([
	'prepared',
	'executing',
	'pending',
	'finalized',
	'rolled_back',
])

/**
 * `#b8ce55` Reads an engine-returned operation once into fresh locals and rebuilds it field by field: the
 * engine is an injected port, so nothing it returns may be trusted, and a malformed operation is dropped
 * (null) rather than read twice — the leg then stays unresolved instead of settling on a bad read.
 */
const readOperationOnce = (raw: CocoEngineOperation | null): CocoEngineOperation | null => {
	if (raw === null || typeof raw !== 'object') return null
	const source = raw as unknown as Record<string, unknown>
	const idValue = source.id
	const stateValue = source.state
	const meltQuoteIdValue = source.meltQuoteId
	const preimageValue = source.preimage
	if (typeof idValue !== 'string' || !idValue) return null
	if (typeof stateValue !== 'string' || !OPERATION_STATES.has(stateValue)) return null
	const meltQuoteId = typeof meltQuoteIdValue === 'string' && meltQuoteIdValue ? meltQuoteIdValue : undefined
	const preimage = typeof preimageValue === 'string' && preimageValue ? preimageValue : undefined
	return { id: idValue, state: stateValue as CocoEngineOperationState, meltQuoteId, preimage }
}

/**
 * `#09f049` Whether the app has declared the engine's reconcilers enabled (or an equivalent), read once per
 * flag: a local read may settle the leg only then, so with them disabled a settle candidate is refused.
 */
const reconcilersEnabled = (status: CocoReconcilerStatus | undefined): boolean => {
	if (!status || typeof status !== 'object') return false
	const source = status as unknown as Record<string, unknown>
	const equivalent = source.equivalent
	const proofStateWatcher = source.proofStateWatcher
	const meltQuoteWatcher = source.meltQuoteWatcher
	const meltSettlementProcessor = source.meltSettlementProcessor
	if (equivalent === true) return true
	return proofStateWatcher === true && meltQuoteWatcher === true && meltSettlementProcessor === true
}

/**
 * `#badc9a` Reads each declared field of a store-returned leg record EXACTLY ONCE into fresh locals, validates
 * those LOCALS, and returns a fresh plain record built by explicit assignment (never a spread). This is
 * the wrapper's own boundary: a store is an injected port, so a field may be an accessor or a `Proxy`
 * trap that answers one value on the read a validator performs and a payload on a later read. After this
 * function every consumer sees only this sanitized plain object, never the store's object, so a hostile
 * store returning bearer-shaped material cannot reach the adapter's output.
 */
const readLegOnce = (raw: CocoLegRecord): CocoLegRecord => {
	const source = raw as unknown as Record<string, unknown>
	// Exactly one read per declared field; nothing below touches `source` again.
	const wrapperIdValue = source.wrapperId
	const legIdValue = source.legId
	const commandIdValue = source.commandId
	const kindValue = source.kind
	const methodValue = source.method
	const authorityKindValue = source.authorityKind
	const operationsValue = source.operations
	const planValue = source.plan
	const invoiceValue = source.invoice
	const engineOperationIdValue = source.engineOperationId
	const meltQuoteIdValue = source.meltQuoteId
	const quoteExpiryAtValue = source.quoteExpiryAt
	const progressValue = source.progress
	const rungValue = source.rung
	const witnessValue = source.witness
	const unwitnessedValue = source.unwitnessed
	const revisionValue = source.revision
	const createdAtValue = source.createdAt
	const updatedAtValue = source.updatedAt

	const present = new Set(Object.keys(source))
	const missing = LEG_REQUIRED_FIELDS.filter((key) => !present.has(key)).sort()
	if (missing.length > 0) {
		throw new CocoPortAdapterError(
			'coco_record_malformed',
			`the leg store returned a record missing required keys: ${missing.join(', ')}`,
		)
	}

	const wrapperId = requireText(wrapperIdValue, 'record field wrapperId')
	const legId = requireText(legIdValue, 'record field legId')
	const commandId = requireText(commandIdValue, 'record field commandId')
	if (kindValue !== 'melt') throw new CocoPortAdapterError('coco_record_malformed', 'record field kind must be the melt leg')
	const method = requireText(methodValue, 'record field method')
	if (typeof authorityKindValue !== 'string' || !AUTHORITY_KINDS.has(authorityKindValue)) {
		throw new CocoPortAdapterError('coco_record_malformed', 'record field authorityKind must be a known kind')
	}
	const operations = requireSteps(operationsValue, 'record field operations') as FundsOperations
	const plan = requireSteps(planValue, 'record field plan')
	const invoice = requireText(invoiceValue, 'record field invoice')
	// optional on the record so a store that strips the reference is reported (never a hard malformed throw);
	// the reconcile says `coco_no_reference` rather than reconciling against nothing.
	const engineOperationId =
		engineOperationIdValue === undefined
			? undefined
			: requireText(engineOperationIdValue, 'record field engineOperationId')
	const meltQuoteId =
		meltQuoteIdValue === undefined ? undefined : requireText(meltQuoteIdValue, 'record field meltQuoteId')
	const quoteExpiryAt =
		quoteExpiryAtValue === undefined
			? undefined
			: requireSafeInteger(quoteExpiryAtValue, 'record field quoteExpiryAt')
	if (typeof progressValue !== 'string' || !PROGRESS.has(progressValue)) {
		throw new CocoPortAdapterError('coco_record_malformed', 'record field progress must be a known marker')
	}
	if (typeof rungValue !== 'string' || !RUNGS.has(rungValue)) {
		throw new CocoPortAdapterError('coco_record_malformed', 'record field rung must be a known rung')
	}
	if (typeof unwitnessedValue !== 'boolean') {
		throw new CocoPortAdapterError('coco_record_malformed', 'record field unwitnessed must be a boolean')
	}
	const revision = requireSafeInteger(revisionValue, 'record field revision')
	const createdAt = requireSafeInteger(createdAtValue, 'record field createdAt')
	const updatedAt = requireSafeInteger(updatedAtValue, 'record field updatedAt')

	let witness: FundsWitness | undefined
	if (witnessValue !== undefined) {
		if (typeof witnessValue !== 'object' || witnessValue === null) {
			throw new CocoPortAdapterError('coco_record_malformed', 'record field witness must be an object')
		}
		const w = witnessValue as Record<string, unknown>
		const kind = w.kind
		const sourceText = w.source
		const observedAt = w.observedAt
		const reference = w.reference
		if (typeof kind !== 'string' || !WITNESS_KIND_SET.has(kind)) {
			throw new CocoPortAdapterError('coco_record_malformed', 'record field witness.kind must be a known witness kind')
		}
		if (typeof sourceText !== 'string' || !sourceText) {
			throw new CocoPortAdapterError('coco_record_malformed', 'record field witness.source must be a non-empty string')
		}
		if (typeof observedAt !== 'number' || !Number.isSafeInteger(observedAt) || observedAt < 0) {
			throw new CocoPortAdapterError('coco_record_malformed', 'record field witness.observedAt must be a safe integer')
		}
		if (reference !== undefined && typeof reference !== 'string') {
			throw new CocoPortAdapterError('coco_record_malformed', 'record field witness.reference must be a string')
		}
		// The witness is rebuilt field by field: it is never bearer material, so a hostile store cannot
		// smuggle a preimage (or a seed) through an extra key on it.
		witness = { kind: kind as FundsWitnessKind, source: sourceText, observedAt, reference: reference as string | undefined }
	}

	// Built by explicit assignment from the single-read locals — never a spread, never a second read.
	return {
		wrapperId,
		legId,
		commandId,
		kind: 'melt',
		method,
		authorityKind: authorityKindValue as FundsAuthorityKind,
		operations,
		plan,
		invoice,
		engineOperationId,
		meltQuoteId,
		quoteExpiryAt,
		progress: progressValue as FundsProgress,
		rung: rungValue as FundsRung,
		witness,
		unwitnessed: unwitnessedValue,
		revision,
		createdAt,
		updatedAt,
	}
}

/**
 * `#7a7f2d` Projects an ALREADY-SANITIZED leg record into the contract's handle, FIELD BY FIELD, so no key the
 * store supplied can ride out. The authority is local, so no `reconcileDeadlineAt` is emitted — the
 * absence is the fact that a local reconcile is an offline read with no deadline.
 */
const handleFor = (record: CocoLegRecord): FundsHandle => ({
	wrapperId: record.wrapperId,
	legId: record.legId,
	progress: record.progress,
	rung: record.rung,
	// the witness is already a fresh plain object, rebuilt field by field by readLegOnce, so a hostile
	// store cannot smuggle a preimage through an extra key on it
	witness: record.witness,
	unwitnessed: record.unwitnessed,
})

const quoteFor = (record: CocoLegRecord): FundsQuote => ({
	wrapperId: record.wrapperId,
	legId: record.legId,
	method: record.method,
	authorityKind: record.authorityKind,
	operations: [...record.operations] as FundsOperations,
	plan: [...record.plan],
	// the durable reference: the engine's operation id the reconcile reads and refreshes (`#badc9a`), with
	// the stable command id only as a fail-closed fallback — a leg is never created without one
	reference: record.engineOperationId ?? record.commandId,
})

interface LegState {
	readonly meltQuoteId?: string
	readonly quoteExpiryAt?: number
	readonly progress: FundsProgress
	readonly rung: FundsRung
	readonly witness?: FundsWitness
	readonly unwitnessed: boolean
}

const stateOf = (record: CocoLegRecord): LegState => ({
	meltQuoteId: record.meltQuoteId,
	quoteExpiryAt: record.quoteExpiryAt,
	progress: record.progress,
	rung: record.rung,
	witness: record.witness,
	unwitnessed: record.unwitnessed,
})

const walletCommandFromSnapshot = (snapshot: WalletOperationSnapshot): WalletOperationCommand => ({
	commandId: snapshot.commandId,
	applicationId: snapshot.applicationId,
	operationKind: snapshot.operationKind,
	account: { accountId: snapshot.account.accountId, environmentId: snapshot.account.environmentId },
	money: { mintUrl: snapshot.money.mintUrl, unit: snapshot.money.unit, amount: snapshot.money.amount },
	intentFingerprint: snapshot.intentFingerprint,
})

/**
 * `#7a7f2d` CocoWalletPortAdapter — the contract's port over the wallet host's own Coco melt lifecycle. It
 * implements the host's `WalletApplicationAdapter` seam and the contract's port at once: the host owns
 * the durable command (the claim, the revision CAS, cancellation, recovery) and the adapter owns the
 * rail (the melt quote, the melt, the local re-ask). The app builds the host with `applicationAdapter`
 * and attaches it.
 */
export class CocoWalletPortAdapter<TEngine extends CocoOperationPort = CocoOperationPort> implements WalletApplicationAdapter<TEngine> {
	readonly applicationId: string
	readonly operationKind: string
	readonly plan: readonly WalletStep[]
	private readonly options: CocoPortAdapterOptions
	private host: CocoWalletHost<TEngine> | undefined
	/** the reconciler declaration seen on the last host-driven step (`#09f049`), checked before any settle */
	private capturedReconcilers: CocoReconcilerStatus | undefined

	constructor(options: CocoPortAdapterOptions) {
		if (typeof options.now !== 'function') {
			throw new CocoPortAdapterError('coco_configuration', 'the adapter requires an injected clock')
		}
		if (!Number.isFinite(options.ceiling) || options.ceiling <= 0) {
			throw new CocoPortAdapterError('coco_configuration', 'ceiling must be a positive number')
		}
		if (!options.rail) throw new CocoPortAdapterError('coco_configuration', 'the adapter requires an injected melt rail')
		this.options = options
		this.applicationId = requireText(options.applicationId, 'applicationId')
		this.operationKind = requireText(options.operationKind, 'operationKind')
		this.plan = [...HOST_PLAN]
	}

	get wrapperId(): string {
		return this.options.wrapperId
	}

	/** The host adapter seam the app registers with `CocoWalletHost`. */
	get applicationAdapter(): WalletApplicationAdapter<TEngine> {
		return this
	}

	/** Wire the host this adapter wraps; the app attaches it after building the host with `applicationAdapter`. */
	attach(host: CocoWalletHost<TEngine>): void {
		this.host = host
	}

	/** The leg declares the subset of the port's operations it has. */
	get declarations(): readonly CocoLegOperationsDeclaration[] {
		return LEG_DECLARATIONS
	}

	operationsFor(kind: CocoLegKind): FundsOperations {
		return LEG_OPERATIONS[kind]
	}

	/** The leg's declared plan: its operations projected onto the port's canonical order. */
	planFor(kind: CocoLegKind): readonly FundsStep[] {
		return planFor(LEG_OPERATIONS[kind])
	}

	/** The declaration the aggregator's acceptance gate validates. The authority is local, so no deadline. */
	get registration(): WrapperRegistration {
		return {
			wrapperId: this.options.wrapperId,
			method: this.options.method,
			port: CONTRACT_PORT,
			authorityKind: AUTHORITY_KIND,
			operations: ALL_OPERATIONS,
			plan: planFor(ALL_OPERATIONS),
			store: 'coco-leg-store',
			storeKind: this.options.storeKind,
			witnessKinds: WITNESS_KINDS,
			journalReference: { shape: 'engine-operation-id+command-id', writtenBefore: 'submit' },
			ceiling: this.options.ceiling,
			contractVersion: this.options.contractVersion,
		}
	}

	/**
	 * `#7a7f2d` obtain — what must exist before the irreversible step. It drives the host's pre-boundary step
	 * (`host.run` through `prepare`, which claims the durable command record before anything is asked of
	 * the mint, `#18e1c3`) and then obtains and retains the leg's durable reference — the engine's operation
	 * id, with the mint's melt quote id where the engine exposes one (`#badc9a`).
	 */
	async obtain(command: CocoLegCommand): Promise<FundsQuote | FundsRefusal> {
		if (!Number.isSafeInteger(command.money.amount) || command.money.amount <= 0) {
			return REFUSAL(REFUSAL_REASONS.invalidAmount, 'money.amount')
		}
		if (command.money.amount > this.options.ceiling) {
			return REFUSAL(REFUSAL_REASONS.overCeiling, 'money.amount')
		}
		if (!command.invoice) return REFUSAL(REFUSAL_REASONS.noReference, 'invoice')
		if (!command.account?.accountId || !command.account?.environmentId) {
			return REFUSAL(REFUSAL_REASONS.invalidAccount, 'account')
		}
		const host = this.requireHost()
		const existing = await this.readLeg(command.legId)
		const walletCommand: WalletOperationCommand = {
			commandId: command.legId,
			applicationId: command.applicationId,
			operationKind: command.operationKind,
			account: { accountId: command.account.accountId, environmentId: command.account.environmentId },
			money: { mintUrl: command.money.mintUrl, unit: command.money.unit, amount: command.money.amount },
			intentFingerprint: command.intentFingerprint,
		}
		// The host operation: claim the durable command and run the pre-boundary step. The reference is
		// written only after this landed, so nothing is spent before the command exists.
		await host.run(walletCommand, { through: PRE_BOUNDARY_STEP })

		let record = existing
		if (!record) {
			let quote: CocoMeltQuote
			try {
				quote = await this.options.rail.quote({ invoice: command.invoice, amountSat: command.money.amount })
			} catch {
				return REFUSAL(REFUSAL_REASONS.noReference, 'meltQuoteId')
			}
			if (!quote.quoteId) return REFUSAL(REFUSAL_REASONS.noReference, 'meltQuoteId')
			// The durable reference is the engine's operation id; a rail that surfaces none cannot be
			// reconciled against, so it is refused here rather than leaving a leg with nothing to read.
			if (!quote.engineOperationId) return REFUSAL(REFUSAL_REASONS.noReference, 'engineOperationId')
			const now = this.now()
			const candidate: CocoLegRecord = {
				wrapperId: this.options.wrapperId,
				legId: command.legId,
				commandId: walletCommand.commandId,
				kind: 'melt',
				method: this.options.method,
				authorityKind: AUTHORITY_KIND,
				operations: LEG_OPERATIONS.melt,
				plan: planFor(LEG_OPERATIONS.melt),
				invoice: command.invoice,
				engineOperationId: quote.engineOperationId,
				meltQuoteId: quote.quoteId,
				quoteExpiryAt: quote.expiryAt,
				progress: 'attempted',
				rung: 'unresolved',
				unwitnessed: true,
				revision: 0,
				createdAt: now,
				updatedAt: now,
			}
			const created = await this.options.store.createOrGet(candidate)
			record = readLegOnce(created.record)
		}
		return quoteFor(record)
	}

	/**
	 * `#7a7f2d` submit — the step that crosses the monetary boundary. It refuses a cancelled command before
	 * anything is spent, drives the host's boundary step, and then performs the melt itself: the
	 * irreversible call is the adapter's, so the cancelled guard is what keeps it from being reached.
	 */
	async submit(quote: FundsQuote, reference: string): Promise<FundsHandle> {
		const record = await this.requireLeg(reference)
		if (quote.legId !== record.legId) {
			throw new CocoPortAdapterError('coco_leg_unknown', 'submit: the quote names a different leg than the reference')
		}
		if (record.rung === 'witnessed-settled') return handleFor(record)
		const host = this.requireHost()
		const snapshot = await host.get(record.commandId)
		if (!snapshot) {
			throw new CocoPortAdapterError('coco_leg_unknown', `no host command ${record.commandId}`)
		}
		// A cancelled host record is terminal: it is never driven across the boundary.
		if (snapshot.state === 'cancelled') {
			throw new CocoPortAdapterError('coco_cancelled', `command ${record.commandId} is cancelled; a cancelled reservation is never submitted`)
		}
		if (!record.engineOperationId || !record.meltQuoteId) {
			throw new CocoPortAdapterError('coco_no_reference', `leg ${record.legId} has no retained engine operation`)
		}
		// The host operation: cross the boundary. The command is already claimed, so this only records it.
		await host.run(walletCommandFromSnapshot(snapshot), { through: BOUNDARY_STEP })

		// THE IRREVERSIBLE STEP. The durable reference (the engine's operation) already exists from `obtain`.
		let result: CocoMeltResult
		try {
			result = await this.options.rail.melt({ quoteId: record.meltQuoteId, invoice: record.invoice })
		} catch {
			return handleFor(record)
		}
		return handleFor(await this.writeLeg(record, this.judgeMelt(record, result)))
	}

	/**
	 * `#badc9a` reconcile — the idempotent read that never submits. It maps onto the host's `recover`
	 * (`#2f50be`): the host asks this adapter's `recover` to read the engine's own operation by the reference
	 * and refresh it while it is still executing, and nothing here ever calls the melt. A settle already held
	 * (or a non-settlement terminal) is returned unchanged (write-once).
	 */
	async reconcile(reference: string): Promise<FundsHandle> {
		const record = await this.requireLeg(reference)
		if (record.rung === 'witnessed-settled' || record.rung === 'abandoned') return handleFor(record)
		const host = this.requireHost()
		const snapshot = await host.get(record.commandId)
		if (!snapshot) throw new CocoPortAdapterError('coco_leg_unknown', `no host command ${record.commandId}`)
		// A cancelled command is terminal; recovery refuses it, so there is nothing to reconcile.
		if (snapshot.state === 'cancelled') return handleFor(record)
		await host.recover(record.commandId)
		const after = await this.readLeg(record.legId)
		return handleFor(after ?? record)
	}

	/** The host's adapter seam: the lifecycle marker the host drives; the rail work is the adapter's own. */
	async perform(_step: WalletStep, context: WalletAdapterContext<TEngine>): Promise<WalletStepResult> {
		// Every host-driven step sees the runtime, so the reconciler declaration is captured here and read
		// again by the settle judgment below (`#09f049`).
		this.capturedReconcilers = context.runtime.reconcilers
		return {}
	}

	/**
	 * `#badc9a` The host's recovery seam: the LOCAL reconcile. It reads the engine's own operation by the
	 * leg's durable reference and, while the operation is still `executing`, refreshes it — asking the
	 * authority again — so the settle is the authority's answer rather than the app-supplied quote read
	 * alone. A settled operation read from the engine's own record is the mint's word read at its source and
	 * may reach `witnessed-settled`; a local read cannot prove the mint will not later disagree unless the
	 * refresh is performed, and it is never reported settled with the engine's reconcilers disabled
	 * (`#09f049`).
	 */
	async recover(context: WalletAdapterContext<TEngine>): Promise<WalletRecoveryResult> {
		const record = await this.readLeg(context.operation.commandId)
		if (!record) return { completedSteps: [...context.operation.completedSteps] }
		if (record.rung === 'witnessed-settled') return { completedSteps: [...HOST_PLAN] }
		if (!record.engineOperationId) {
			return {
				completedSteps: [...context.operation.completedSteps],
				unresolved: true,
				failureCode: 'coco_no_reference',
			}
		}
		// The reference is the engine's operation id: read it, and refresh it while it is still executing.
		let operation: CocoEngineOperation | null = null
		try {
			operation = readOperationOnce(await context.runtime.engine.get(record.engineOperationId))
			if (operation && operation.state === 'executing') {
				operation = readOperationOnce(await context.runtime.engine.refresh(record.engineOperationId))
			}
		} catch {
			operation = null
		}
		// The app-supplied quote read stays available as a complement, never the only path.
		let quote: CocoMeltQuote | null = null
		if (record.meltQuoteId) {
			try {
				quote = await this.options.rail.readQuote({ quoteId: record.meltQuoteId })
			} catch {
				quote = null
			}
		}
		const judged = this.judgeReconcile(
			record,
			operation,
			quote,
			reconcilersEnabled(context.runtime.reconcilers),
		)
		await this.writeLeg(record, judged.state)
		if (judged.state.rung === 'witnessed-settled') return { completedSteps: [...HOST_PLAN] }
		return {
			completedSteps: [...context.operation.completedSteps],
			unresolved: true,
			failureCode: judged.failureCode,
		}
	}

	/** The host's cancellation seam: release the local reservation and close the leg non-settled. */
	async cancel(context: WalletAdapterContext<TEngine>): Promise<void> {
		const record = await this.readLeg(context.operation.commandId)
		if (!record) return
		if (record.meltQuoteId && this.options.rail.release) {
			await this.options.rail.release({ quoteId: record.meltQuoteId })
		}
		if (record.rung !== 'witnessed-settled') {
			await this.writeLeg(record, { ...stateOf(record), rung: 'abandoned', unwitnessed: true })
		}
	}

	/**
	 * `#7a7f2d` The witness judgment for the melt. A preimage validating against the invoice's own payment
	 * hash is cryptographic and settles. The mint is the authority for a melt, so a settled melt quote read
	 * at its source — the authority's own word, not a wrapper's declaration — reaches `witnessed-settled`
	 * too; anything else leaves the leg unresolved.
	 */
	private judgeMelt(record: CocoLegRecord, result: CocoMeltResult): LegState {
		const preimage =
			typeof result.preimage === 'string' && result.preimage.length > 0 && this.options.rail.validatePreimage(record.invoice, result.preimage)
				? result.preimage
				: undefined
		if (preimage) {
			return {
				...stateOf(record),
				progress: 'submitted',
				rung: 'witnessed-settled',
				witness: { kind: 'preimage', source: 'melt', observedAt: this.now() },
				unwitnessed: false,
			}
		}
		if (result.state === 'paid') {
			// The mint is the authority and a settled melt quote is its own word at its source, so it settles
			// — but the app must have left the engine's reconcilers enabled (`#09f049`), or a settle read out
			// of that authority must not be reported.
			if (!this.reconcilersAllowed()) {
				return { ...stateOf(record), progress: 'submitted', rung: 'unresolved', witness: undefined, unwitnessed: true }
			}
			return {
				...stateOf(record),
				progress: 'submitted',
				rung: 'witnessed-settled',
				witness: { kind: 'mint_quote_state', source: 'mint', observedAt: this.now() },
				unwitnessed: false,
			}
		}
		return { ...stateOf(record), progress: 'submitted', rung: 'unresolved', witness: undefined, unwitnessed: true }
	}

	/**
	 * `#badc9a` The witness judgment for the local read. A validated preimage settles. The mint is the
	 * authority for a melt and the engine is that authority's local proxy, so a settled operation read from
	 * the engine's own record (`finalized`) — or a settled mint quote beside it — is the authority's word
	 * read at its source and reaches `witnessed-settled`; but a local read proves only the engine's view of
	 * the mint's state, so with the engine's reconcilers disabled a settle candidate is refused and stays
	 * unresolved (`#09f049`). A `rolled_back` operation, or an elapsed quote with no artifact, reaches the
	 * non-settlement terminal `abandoned`; a no-answer stays unresolved, never a negative settlement.
	 */
	private judgeReconcile(
		record: CocoLegRecord,
		operation: CocoEngineOperation | null,
		quote: CocoMeltQuote | null,
		reconcilersOn: boolean,
	): { state: LegState; failureCode: string } {
		const enginePreimage =
			operation && typeof operation.preimage === 'string' && operation.preimage.length > 0 && this.options.rail.validatePreimage(record.invoice, operation.preimage)
				? operation.preimage
				: undefined
		const quotePreimage =
			quote && typeof quote.preimage === 'string' && quote.preimage.length > 0 && this.options.rail.validatePreimage(record.invoice, quote.preimage)
				? quote.preimage
				: undefined
		const preimage = enginePreimage ?? quotePreimage
		if (preimage) {
			return {
				state: {
					...stateOf(record),
					progress: 'submitted',
					rung: 'witnessed-settled',
					witness: { kind: 'preimage', source: enginePreimage ? 'engine' : 'mint', observedAt: this.now() },
					unwitnessed: false,
				},
				failureCode: 'coco_unresolved',
			}
		}
		const settled = operation?.state === 'finalized' || quote?.state === 'paid'
		if (settled) {
			if (!reconcilersOn) {
				return {
					state: { ...stateOf(record), rung: 'unresolved', witness: undefined, unwitnessed: true },
					failureCode: 'coco_reconcilers_disabled',
				}
			}
			return {
				state: {
					...stateOf(record),
					progress: 'submitted',
					rung: 'witnessed-settled',
					witness: {
						kind: 'mint_quote_state',
						source: operation?.state === 'finalized' ? 'engine' : 'mint',
						observedAt: this.now(),
					},
					unwitnessed: false,
				},
				failureCode: 'coco_unresolved',
			}
		}
		if (operation?.state === 'rolled_back') {
			return {
				state: { ...stateOf(record), rung: 'abandoned', witness: undefined, unwitnessed: true },
				failureCode: 'coco_unresolved',
			}
		}
		if (quote && quote.expiryAt <= this.now()) {
			return {
				state: { ...stateOf(record), rung: 'abandoned', witness: undefined, unwitnessed: true },
				failureCode: 'coco_unresolved',
			}
		}
		return {
			state: { ...stateOf(record), rung: 'unresolved', witness: undefined, unwitnessed: true },
			failureCode: 'coco_unresolved',
		}
	}

	private async writeLeg(record: CocoLegRecord, state: LegState): Promise<CocoLegRecord> {
		const next: CocoLegRecord = {
			wrapperId: record.wrapperId,
			legId: record.legId,
			commandId: record.commandId,
			kind: record.kind,
			method: record.method,
			authorityKind: record.authorityKind,
			operations: [...record.operations] as FundsOperations,
			plan: [...record.plan],
			invoice: record.invoice,
			engineOperationId: record.engineOperationId,
			meltQuoteId: state.meltQuoteId,
			quoteExpiryAt: state.quoteExpiryAt,
			progress: state.progress,
			rung: state.rung,
			witness: state.witness,
			unwitnessed: state.unwitnessed,
			revision: record.revision + 1,
			createdAt: record.createdAt,
			updatedAt: this.now(),
		}
		const stored = await this.options.store.compareAndSet(
			{ wrapperId: record.wrapperId, legId: record.legId },
			record.revision,
			next,
		)
		return readLegOnce(stored)
	}

	private async readLeg(legId: string): Promise<CocoLegRecord | null> {
		const raw = await this.options.store.get({ wrapperId: this.options.wrapperId, legId })
		return raw ? readLegOnce(raw) : null
	}

	/**
	 * `#badc9a` Resolve a leg from the reference the port carries — the engine's operation id. The store is
	 * keyed by the leg's own id, so a reference that is not the key is found by matching the record's durable
	 * reference; a reference that resolves to nothing is reported, never reconciled against nothing.
	 */
	private async resolveLeg(reference: string): Promise<CocoLegRecord | null> {
		const direct = await this.readLeg(reference)
		if (direct) return direct
		for (const raw of await this.options.store.list(this.options.wrapperId)) {
			const record = readLegOnce(raw)
			if (record.engineOperationId === reference) return record
		}
		return null
	}

	private async requireLeg(reference: string): Promise<CocoLegRecord> {
		const record = await this.resolveLeg(reference)
		if (!record) throw new CocoPortAdapterError('coco_leg_unknown', `no leg ${reference}`)
		return record
	}

	private requireHost(): CocoWalletHost<TEngine> {
		if (!this.host) {
			throw new CocoPortAdapterError('coco_not_attached', 'the adapter has no host; call attach(host) after building it')
		}
		return this.host
	}

	private reconcilersAllowed(): boolean {
		return reconcilersEnabled(this.capturedReconcilers)
	}

	private now(): number {
		const value = this.options.now()
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new CocoPortAdapterError('coco_configuration', 'now() must return non-negative Unix milliseconds')
		}
		return value
	}
}
