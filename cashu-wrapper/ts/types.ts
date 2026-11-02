/** `#f4028b` — the monetary/business boundaries the host keeps distinct. */
export type WalletStep = 'request' | 'prepare' | 'attempt' | 'acknowledge' | 'settle' | 'refund'

/** `#f4028b` — no boolean can collapse this lifecycle. */
export type WalletOperationState =
	| 'created'
	| 'requesting'
	| 'requested'
	| 'preparing'
	| 'prepared'
	| 'attempting'
	| 'attempted'
	| 'acknowledging'
	| 'acknowledged'
	| 'settling'
	| 'settled'
	| 'refunding'
	| 'refunded'
	| 'recovering'
	| 'unresolved'
	| 'failed'
	| 'cancelling'
	| 'cancelled'

/** `#269648` — complete, stable identity; never a shortened pubkey prefix. */
export interface WalletAccount {
	accountId: string
	environmentId: string
}

/** Public, non-bearer monetary binding for one application command. */
export interface WalletMoney {
	mintUrl: string
	unit: string
	amount: number
}

/** `#18e1c3` — the immutable command an app submits to the host. */
export interface WalletOperationCommand {
	commandId: string
	applicationId: string
	operationKind: string
	account: WalletAccount
	money: WalletMoney
	/** Lowercase SHA-256 (or an equally stable 32-byte digest) of the canonical app intent. */
	intentFingerprint: string
}

/**
 * `#7654d1` — the complete host record. Deliberately no arbitrary metadata or bearer-material field.
 * App recovery data belongs to the app repository and is joined by commandId.
 */
export interface WalletOperationRecord extends WalletOperationCommand {
	schemaVersion: 1
	plan: readonly WalletStep[]
	completedSteps: readonly WalletStep[]
	state: WalletOperationState
	engineOperationId?: string
	fee?: number
	failureCode?: string
	revision: number
	createdAt: number
	updatedAt: number
}

/** Read-only result returned to app/UI composers. */
export interface WalletOperationSnapshot extends WalletOperationRecord {
	complete: boolean
}

/** Optional scope for a balance projection. */
export interface WalletBalanceQuery {
	mintUrl?: string
	unit?: string
}

/** `#f4028b` — a projection over disjoint Coco monetary states, not an authority. */
export interface WalletBalance {
	available: number
	reserved: number
	locked: number
	pending: number
	unresolved: number
	total: number
}

/** The only public facts an adapter may return after a step. */
export interface WalletStepResult {
	engineOperationId?: string
	fee?: number
}

/** `#2f50be` — reconciliation returns an ordered prefix of the original plan. */
export interface WalletRecoveryResult extends WalletStepResult {
	completedSteps: readonly WalletStep[]
	unresolved?: boolean
	failureCode?: string
}

/**
 * `#b8ce55` CocoEngineOperationState — the states the engine's own operation record moves through, as the
 * reconcile reads them: `prepared` before the melt is executed, `executing` while the engine is asking the
 * authority, `pending` once executed but not finalized, `finalized` when the authority has settled it, and
 * `rolled_back` when it has been reclaimed.
 */
export type CocoEngineOperationState = 'prepared' | 'executing' | 'pending' | 'finalized' | 'rolled_back'

/**
 * `#b8ce55` CocoEngineOperation — one operation as the engine reports it: its id (the leg's durable
 * reference), its state, the mint's melt quote id where the engine exposes one, and the settling preimage
 * where the engine has already observed one.
 */
export interface CocoEngineOperation {
	readonly id: string
	readonly state: CocoEngineOperationState
	/** the mint's melt quote id, where the engine surfaces one */
	readonly meltQuoteId?: string
	/** the settling preimage, where the engine has observed one */
	readonly preimage?: string
}

/**
 * `#b8ce55` CocoOperationPort — the declared engine surface a Coco leg requires, supplied by the composing
 * app and imported by no code here: read an operation by id, enumerate what is prepared and what is in
 * flight, refresh an operation whose state is still `executing`, and reclaim one that must be rolled back.
 * The engine stays the app's; only the requirement becomes typed and checkable rather than opaque.
 */
export interface CocoOperationPort {
	get(operationId: string): Promise<CocoEngineOperation | null>
	listPrepared(): Promise<readonly CocoEngineOperation[]>
	listInFlight(): Promise<readonly CocoEngineOperation[]>
	refresh(operationId: string): Promise<CocoEngineOperation>
	reclaim(operationId: string): Promise<CocoEngineOperation>
}

/**
 * `#09f049` CocoReconcilerStatus — the composing app's declaration, on the runtime, of whether the engine's
 * own reconcilers are enabled. A local read may settle the leg only when all three run, or when the app
 * declares an equivalent; with them disabled a leg cannot settle and is never reported settled.
 */
export interface CocoReconcilerStatus {
	readonly proofStateWatcher: boolean
	readonly meltQuoteWatcher: boolean
	readonly meltSettlementProcessor: boolean
	/** true when the app reconciles outside the engine's own three and declares it equivalent */
	readonly equivalent?: boolean
}

/**
 * `#b8ce55` CocoWalletRuntime — one account-scoped Coco runtime supplied by the composing app. The engine is
 * declared, not opaque — its type is bounded by `CocoOperationPort`, so an app that cannot read or refresh an
 * operation fails to compile rather than at the mint — and `reconcilers` is the app's declaration of the
 * engine's own reconcilers (`#09f049`).
 */
export interface CocoWalletRuntime<TEngine extends CocoOperationPort = CocoOperationPort> {
	readonly account: WalletAccount
	readonly engine: TEngine
	/** the app's declaration of the engine's own reconcilers (`#09f049`) */
	readonly reconcilers: CocoReconcilerStatus
	balance(query?: WalletBalanceQuery): Promise<WalletBalance>
	dispose(): Promise<void>
}

/** The app owns seed custody, repositories, Coco initialization and authority configuration. */
export interface CocoWalletRuntimeFactory<TEngine extends CocoOperationPort = CocoOperationPort> {
	open(account: WalletAccount): Promise<CocoWalletRuntime<TEngine>>
}

/** Context visible to one registered application adapter. */
export interface WalletAdapterContext<TEngine extends CocoOperationPort = CocoOperationPort> {
	readonly runtime: CocoWalletRuntime<TEngine>
	readonly operation: WalletOperationSnapshot
}

/**
 * `#485435` — the only application seam. An Auctions adapter and a Torii adapter implement
 * this same contract without adding branches to the host.
 */
export interface WalletApplicationAdapter<TEngine extends CocoOperationPort = CocoOperationPort> {
	readonly applicationId: string
	readonly operationKind: string
	readonly plan: readonly WalletStep[]
	revalidate?(step: WalletStep, context: WalletAdapterContext<TEngine>): Promise<void>
	perform(step: WalletStep, context: WalletAdapterContext<TEngine>): Promise<WalletStepResult>
	recover(context: WalletAdapterContext<TEngine>): Promise<WalletRecoveryResult>
	cancel?(context: WalletAdapterContext<TEngine>): Promise<void>
}

/**
 * `#18e1c3` — adapters implement this store against IndexedDB, SQLite, or another local backend.
 * compareAndSet MUST atomically reject any revision other than expectedRevision.
 */
export interface WalletOperationStore {
	createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }>
	get(commandId: string): Promise<WalletOperationRecord | null>
	list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]>
	compareAndSet(
		commandId: string,
		expectedRevision: number,
		next: WalletOperationRecord,
	): Promise<WalletOperationRecord>
}

export interface WalletHostOptions<TEngine extends CocoOperationPort = CocoOperationPort> {
	runtimeFactory: CocoWalletRuntimeFactory<TEngine>
	store: WalletOperationStore
	adapters: readonly WalletApplicationAdapter<TEngine>[]
	/** Unix milliseconds. Required so the module never reads a host clock global. */
	now: () => number
}

export interface WalletRunOptions {
	/** Stop after this completed step; omitted means run the complete adapter plan. */
	through?: WalletStep
}
