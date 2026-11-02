import {
	WalletAdapterNotFoundError,
	WalletCommandConflictError,
	WalletConfigurationError,
	WalletInvalidTransitionError,
	WalletRecoveryRequiredError,
	WalletStepExecutionError,
} from './errors'
import type {
	CocoOperationPort,
	CocoWalletRuntime,
	WalletAccount,
	WalletAdapterContext,
	WalletApplicationAdapter,
	WalletBalance,
	WalletBalanceQuery,
	WalletHostOptions,
	WalletOperationCommand,
	WalletOperationRecord,
	WalletOperationSnapshot,
	WalletRecoveryResult,
	WalletRunOptions,
	WalletStep,
	WalletStepResult,
} from './types'

const STEPS: readonly WalletStep[] = ['request', 'prepare', 'attempt', 'acknowledge', 'settle', 'refund']
const FINGERPRINT = /^[0-9a-f]{64}$/
const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/

const IN_PROGRESS = new Set([
	'requesting',
	'preparing',
	'attempting',
	'acknowledging',
	'settling',
	'refunding',
	'recovering',
	'cancelling',
])

const startedState: Record<WalletStep, WalletOperationRecord['state']> = {
	request: 'requesting',
	prepare: 'preparing',
	attempt: 'attempting',
	acknowledge: 'acknowledging',
	settle: 'settling',
	refund: 'refunding',
}

const completedState: Record<WalletStep, WalletOperationRecord['state']> = {
	request: 'requested',
	prepare: 'prepared',
	attempt: 'attempted',
	acknowledge: 'acknowledged',
	settle: 'settled',
	refund: 'refunded',
}

const sameAccount = (left: WalletAccount, right: WalletAccount): boolean =>
	left.accountId === right.accountId && left.environmentId === right.environmentId

// ONE injective, length-prefixed derivation shared by every identity map (`runtimes`, `flights`,
// `adapters`, `plans`). Each part is encoded as `${length}:${text}`, so no character a part may
// contain can make two distinct part lists collide — `{environmentId:'x', accountId:'a\u0000b'}`
// and `{environmentId:'x\u0000a', accountId:'b'}` stay distinct keys.
const identityKey = (...parts: readonly string[]): string => parts.map((part) => `${part.length}:${part}`).join('|')

const accountKey = (account: WalletAccount): string => identityKey(account.environmentId, account.accountId)
const adapterKey = (applicationId: string, operationKind: string): string =>
	identityKey(applicationId, operationKind)

// The declared store-record shape, as an explicit allow-list. A store is an injected
// port, so nothing it returns may be trusted to carry only these keys. Unknown TOP-LEVEL keys are
// STRIPPED by the field-by-field projection below (never rejected — a real IndexedDB/SQLite adapter
// that decorates a record with its own `_key`/`_indexedAt` bookkeeping is benign), while a DECLARED
// field carrying a malformed value fails closed here.
const RECORD_REQUIRED_FIELDS = [
	'commandId',
	'applicationId',
	'operationKind',
	'account',
	'money',
	'intentFingerprint',
	'schemaVersion',
	'plan',
	'completedSteps',
	'state',
	'revision',
	'createdAt',
	'updatedAt',
] as const

const STATES: ReadonlySet<string> = new Set([
	'created',
	'requesting',
	'requested',
	'preparing',
	'prepared',
	'attempting',
	'attempted',
	'acknowledging',
	'acknowledged',
	'settling',
	'settled',
	'refunding',
	'refunded',
	'recovering',
	'unresolved',
	'failed',
	'cancelling',
	'cancelled',
])

const requireNonNegativeInteger = (value: unknown, field: string): number => {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new WalletConfigurationError(`${field} must be a non-negative safe integer`)
	}
	return value
}

const requireDeclaredText = (value: unknown, field: string): string => {
	if (typeof value !== 'string') throw new WalletConfigurationError(`${field} must be a string`)
	return requireText(value, field)
}

const requireDeclaredSteps = (value: unknown, field: string): WalletStep[] => {
	if (!Array.isArray(value)) throw new WalletConfigurationError(`${field} must be an array of wallet steps`)
	const steps: WalletStep[] = []
	for (const step of value) {
		if (typeof step !== 'string' || !STEPS.includes(step as WalletStep)) {
			throw new WalletConfigurationError(`${field} must contain only known wallet steps`)
		}
		steps.push(step as WalletStep)
	}
	return steps
}

/**
 * Reads each declared field of a store-returned record EXACTLY ONCE into fresh locals, validates those
 * LOCALS, and returns a fresh plain sanitized record built by explicit assignment (never a spread).
 *
 * This is the single load-bearing boundary, and it is a boundary because of the *single read*, not merely
 * because of the checks: a store is an injected port, so a field may be an accessor or a Proxy trap that
 * answers `undefined` on the read a validator performs and a payload on a later read. Validating and then
 * projecting the SAME untrusted object re-reads it, which is a time-of-check/time-of-use hole. After this
 * function every downstream consumer — the projection, `update`, the caller snapshot, the adapter context
 * and the `next` handed to `compareAndSet` — sees only this sanitized plain object, never the store's object.
 *
 * RULE 1: unknown TOP-LEVEL keys are STRIPPED by this field-by-field construction (never rejected — a real
 * IndexedDB/SQLite adapter decorating a record with its own `_key`/`_indexedAt` is benign).
 * RULE 2: a DECLARED field carrying a malformed value fails closed here, naming the field and never echoing
 * the value. This folds in the former `requireRecordShape`/`requireRecordValues`, keeping their messages.
 */
const readRecordOnce = (raw: WalletOperationRecord): WalletOperationRecord => {
	const source = raw as unknown as Record<string, unknown>
	// Exactly one read per declared field; nothing below touches `source` again.
	const commandId = source.commandId
	const applicationId = source.applicationId
	const operationKind = source.operationKind
	const accountValue = source.account
	const moneyValue = source.money
	const intentFingerprint = source.intentFingerprint
	const schemaVersion = source.schemaVersion
	const planValue = source.plan
	const completedStepsValue = source.completedSteps
	const stateValue = source.state
	const revisionValue = source.revision
	const createdAtValue = source.createdAt
	const updatedAtValue = source.updatedAt
	const engineOperationIdValue = source.engineOperationId
	const feeValue = source.fee
	const failureCodeValue = source.failureCode

	// Presence of the required keys: one ownKeys read, never re-read.
	const present = new Set(Object.keys(source))
	const missing = RECORD_REQUIRED_FIELDS.filter((key) => !present.has(key)).sort()
	if (missing.length > 0) {
		throw new WalletConfigurationError(
			`wallet command ${String(commandId)}: the store returned a record missing required keys: ${missing.join(', ')}`,
		)
	}

	// Validate the LOCALS (the former `requireRecordValues`, message for message).
	if (schemaVersion !== 1) {
		throw new WalletConfigurationError('record field schemaVersion must be 1')
	}
	const commandIdText = requireDeclaredText(commandId, 'record field commandId')
	const applicationIdText = requireDeclaredText(applicationId, 'record field applicationId')
	const operationKindText = requireDeclaredText(operationKind, 'record field operationKind')
	if (typeof intentFingerprint !== 'string' || !FINGERPRINT.test(intentFingerprint)) {
		throw new WalletConfigurationError('record field intentFingerprint must be 64 lowercase hexadecimal characters')
	}
	if (typeof accountValue !== 'object' || accountValue === null) {
		throw new WalletConfigurationError('record field account must be an object')
	}
	const accountRecord = accountValue as Record<string, unknown>
	const accountId = accountRecord.accountId
	const environmentId = accountRecord.environmentId
	if (typeof accountId !== 'string' || typeof environmentId !== 'string') {
		throw new WalletConfigurationError('record field account must carry string accountId and environmentId')
	}
	if (typeof moneyValue !== 'object' || moneyValue === null) {
		throw new WalletConfigurationError('record field money must be an object')
	}
	const moneyRecord = moneyValue as Record<string, unknown>
	const mintUrl = moneyRecord.mintUrl
	const unit = moneyRecord.unit
	const amount = moneyRecord.amount
	if (typeof mintUrl !== 'string' || typeof unit !== 'string' || typeof amount !== 'number') {
		throw new WalletConfigurationError('record field money must carry string mintUrl, string unit and numeric amount')
	}
	const amountValue = requireNonNegativeInteger(amount, 'record field money.amount')
	const plan = requireDeclaredSteps(planValue, 'record field plan')
	const completedSteps = requireDeclaredSteps(completedStepsValue, 'record field completedSteps')
	if (typeof stateValue !== 'string' || !STATES.has(stateValue)) {
		throw new WalletConfigurationError('record field state must be a known wallet state')
	}
	const revision = requireNonNegativeInteger(revisionValue, 'record field revision')
	const createdAt = requireNonNegativeInteger(createdAtValue, 'record field createdAt')
	const updatedAt = requireNonNegativeInteger(updatedAtValue, 'record field updatedAt')
	const fee = feeValue === undefined ? undefined : requireNonNegativeInteger(feeValue, 'record field fee')
	if (failureCodeValue !== undefined && (typeof failureCodeValue !== 'string' || !FAILURE_CODE.test(failureCodeValue))) {
		throw new WalletConfigurationError('record field failureCode must match the host failure-code pattern')
	}
	const engineOperationId =
		engineOperationIdValue === undefined
			? undefined
			: requireDeclaredText(engineOperationIdValue, 'record field engineOperationId')

	// Build the sanitized record by explicit assignment from the single-read locals — never a spread, and
	// never a second access to a field of `source`.
	return {
		commandId: commandIdText,
		applicationId: applicationIdText,
		operationKind: operationKindText,
		account: { accountId, environmentId },
		money: { mintUrl, unit, amount: amountValue },
		intentFingerprint,
		schemaVersion: 1,
		plan,
		completedSteps,
		state: stateValue as WalletOperationRecord['state'],
		engineOperationId,
		fee,
		failureCode: failureCodeValue as string | undefined,
		revision,
		createdAt,
		updatedAt,
	}
}

/**
 * Projects an ALREADY-SANITIZED record (the output of `readRecordOnce`) into the caller-facing snapshot,
 * FIELD BY FIELD, so no key the store supplied can ride out. It never validates and never touches a store
 * object: the record it receives is a fresh plain local, safe to read more than once.
 */
const projectOperation = (record: WalletOperationRecord): WalletOperationSnapshot => {
	const plan = record.plan
	const completedSteps = record.completedSteps
	return {
		commandId: record.commandId,
		applicationId: record.applicationId,
		operationKind: record.operationKind,
		account: { accountId: record.account.accountId, environmentId: record.account.environmentId },
		money: { mintUrl: record.money.mintUrl, unit: record.money.unit, amount: record.money.amount },
		intentFingerprint: record.intentFingerprint,
		schemaVersion: record.schemaVersion,
		plan: [...plan],
		completedSteps: [...completedSteps],
		state: record.state,
		engineOperationId: record.engineOperationId,
		fee: record.fee,
		failureCode: record.failureCode,
		revision: record.revision,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		complete: completedSteps.length === plan.length && record.state === stateAfter(completedSteps),
	}
}

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((value, index) => value === right[index])

const requireText = (value: string, label: string): string => {
	const normalized = value.trim()
	if (!normalized || normalized !== value || normalized.length > 512) {
		throw new WalletConfigurationError(`${label} must be a non-empty, trimmed value of at most 512 characters`)
	}
	return normalized
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

// `requireText` stays permissive for free-text fields (`mintUrl`, an adapter's `engineOperationId`);
// an identity part is stricter, because a control character is what makes a separator-only key
// collision possible and an identity value is never free text.
const requireIdentityText = (value: string, label: string): string => {
	const normalized = requireText(value, label)
	if (CONTROL_CHARACTER.test(normalized)) {
		throw new WalletConfigurationError(`${label} must not contain control characters`)
	}
	return normalized
}

const normalizeAccount = (account: WalletAccount): WalletAccount => ({
	accountId: requireIdentityText(account.accountId, 'accountId'),
	environmentId: requireIdentityText(account.environmentId, 'environmentId'),
})

const normalizeMintUrl = (value: string): string => {
	const normalized = requireText(value, 'mintUrl').replace(/\/+$/, '')
	if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(normalized)) {
		throw new WalletConfigurationError('mintUrl must be an absolute URL')
	}
	return normalized
}

const normalizeCommand = (command: WalletOperationCommand): WalletOperationCommand => {
	if (!FINGERPRINT.test(command.intentFingerprint)) {
		throw new WalletConfigurationError('intentFingerprint must be 64 lowercase hexadecimal characters')
	}
	if (!Number.isSafeInteger(command.money.amount) || command.money.amount <= 0) {
		throw new WalletConfigurationError('money.amount must be a positive safe integer')
	}
	return {
		commandId: requireText(command.commandId, 'commandId'),
		applicationId: requireText(command.applicationId, 'applicationId'),
		operationKind: requireText(command.operationKind, 'operationKind'),
		account: normalizeAccount(command.account),
		money: {
			mintUrl: normalizeMintUrl(command.money.mintUrl),
			unit: requireText(command.money.unit.toLowerCase(), 'money.unit'),
			amount: command.money.amount,
		},
		intentFingerprint: command.intentFingerprint,
	}
}

const validatePlan = (plan: readonly WalletStep[]): readonly WalletStep[] => {
	if (plan.length === 0) throw new WalletConfigurationError('a wallet adapter plan cannot be empty')
	const seen = new Set<WalletStep>()
	for (const step of plan) {
		if (!STEPS.includes(step)) throw new WalletConfigurationError(`unknown wallet step: ${String(step)}`)
		if (seen.has(step)) throw new WalletConfigurationError(`wallet step ${step} appears more than once`)
		seen.add(step)
	}
	if (seen.has('settle') && seen.has('refund')) {
		throw new WalletConfigurationError('one operation plan cannot both settle and refund')
	}
	return [...plan]
}

/** A command's complete immutable identity (its declared fields plus the snapshotted step plan). */
type ImmutableCommandIdentity = WalletOperationCommand & { readonly plan: readonly WalletStep[] }

const immutableCommandMatches = (
	record: ImmutableCommandIdentity,
	command: WalletOperationCommand,
	plan: readonly WalletStep[],
): boolean =>
	record.commandId === command.commandId &&
	record.applicationId === command.applicationId &&
	record.operationKind === command.operationKind &&
	sameAccount(record.account, command.account) &&
	record.money.mintUrl === command.money.mintUrl &&
	record.money.unit === command.money.unit &&
	record.money.amount === command.money.amount &&
	record.intentFingerprint === command.intentFingerprint &&
	sameList(record.plan, plan)

const failureCode = (error: unknown): string => {
	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		FAILURE_CODE.test(error.code)
	) {
		return error.code
	}
	return 'adapter_failure'
}

/**
 * Reads each declared field of an ADAPTER-returned step result EXACTLY ONCE into fresh locals, validates
 * those LOCALS, and returns a fresh plain sanitized result built by explicit assignment (never a spread).
 *
 * An adapter is app code, so `perform` may return an object whose reads are not idempotent: an accessor or a
 * Proxy trap can answer a benign value on the read a validator performs and a payload on a later read, so a
 * result validated against one value and then persisted/emitted from a second read falsifies the invariant.
 * This is the same time-of-check/time-of-use boundary `readRecordOnce` draws for a store, extended to the
 * adapter's own result. Every downstream consumer — the `update` patch, the durable record it writes through
 * `compareAndSet`, the caller snapshot and the adapter context built from it — sees only these locals, never
 * the object the adapter returned. Folds in the former `validateStepResult`, message for message.
 */
const readStepResultOnce = (record: WalletOperationRecord, raw: WalletStepResult): WalletStepResult => {
	const source = raw as unknown as Record<string, unknown>
	// Exactly one read per declared field; nothing below touches `source` again.
	const engineOperationIdValue = source.engineOperationId
	const feeValue = source.fee

	// Validate the LOCALS (the former `validateStepResult`, message for message).
	let engineOperationId: string | undefined
	if (engineOperationIdValue !== undefined) {
		engineOperationId = requireText(engineOperationIdValue as string, 'engineOperationId')
	}
	if (record.engineOperationId && engineOperationId && record.engineOperationId !== engineOperationId) {
		throw new WalletCommandConflictError(record.commandId)
	}
	let fee: number | undefined
	if (feeValue !== undefined) {
		if (!Number.isSafeInteger(feeValue) || (feeValue as number) < 0) {
			throw new WalletConfigurationError('adapter fee must be a non-negative safe integer')
		}
		fee = feeValue as number
	}
	return { engineOperationId, fee }
}

/**
 * The recovery result's own fields, on top of the step-result boundary above: `completedSteps`, `unresolved`
 * and `failureCode` are each read EXACTLY ONCE into locals and returned in a fresh plain object, so the
 * `validateRecovery` checks and the durable `update` that follow read only locals — a non-idempotent
 * `completedSteps` array included.
 */
const readRecoveryResultOnce = (
	record: WalletOperationRecord,
	raw: WalletRecoveryResult,
): WalletRecoveryResult => {
	const step = readStepResultOnce(record, raw)
	// The remaining declared fields, one read each. `completedSteps` is nested: copy it so not even an
	// index accessor survives the boundary.
	const source = raw as unknown as Record<string, unknown>
	const completedStepsValue = source.completedSteps
	const unresolvedValue = source.unresolved
	const failureCodeValue = source.failureCode
	const completedSteps = Array.isArray(completedStepsValue)
		? ([...completedStepsValue] as readonly WalletStep[])
		: (completedStepsValue as readonly WalletStep[])
	return {
		engineOperationId: step.engineOperationId,
		fee: step.fee,
		completedSteps,
		unresolved: unresolvedValue as boolean | undefined,
		failureCode: failureCodeValue as string | undefined,
	}
}

const requireBalanceState = (value: unknown, field: string): number => {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new WalletConfigurationError(`balance.${field} must be a non-negative safe integer`)
	}
	return value as number
}

const validateBalance = (balance: WalletBalance): WalletBalance => {
	const source = balance as unknown as Record<string, unknown>
	// ONE read per monetary state into fresh locals; every check and the returned projection read the locals.
	const available = requireBalanceState(source.available, 'available')
	const reserved = requireBalanceState(source.reserved, 'reserved')
	const locked = requireBalanceState(source.locked, 'locked')
	const pending = requireBalanceState(source.pending, 'pending')
	const unresolved = requireBalanceState(source.unresolved, 'unresolved')
	const total = source.total
	const sum = available + reserved + locked + pending + unresolved
	if (!Number.isSafeInteger(total) || (total as number) !== sum) {
		throw new WalletConfigurationError('balance.total must equal the sum of the disjoint monetary states')
	}
	// RULE 1 applied to balance: project the six states FIELD BY FIELD, never a spread, so any extra key
	// the runtime returned (`seed`, `token`, ...) is dropped rather than riding out of `balance()`.
	return { available, reserved, locked, pending, unresolved, total: total as number }
}

const isPrefix = (prefix: readonly WalletStep[], plan: readonly WalletStep[]): boolean =>
	prefix.length <= plan.length && prefix.every((step, index) => step === plan[index])

const stateAfter = (completedSteps: readonly WalletStep[]): WalletOperationRecord['state'] =>
	completedSteps.length === 0 ? 'created' : completedState[completedSteps[completedSteps.length - 1]!]

interface Flight {
	readonly identity: ImmutableCommandIdentity
	readonly accountKey: string
	readonly promise: Promise<WalletOperationSnapshot>
}

/** `#485435` — preserves inference while declaring an adapter as the public capability. */
export const defineWalletApplicationAdapter = <TEngine extends CocoOperationPort>(
	adapter: WalletApplicationAdapter<TEngine>,
): WalletApplicationAdapter<TEngine> => adapter

/** `#f55a54` — explicitly constructed, app-neutral Coco Wallet Host v2. */
export class CocoWalletHost<TEngine extends CocoOperationPort = CocoOperationPort> {
	private readonly adapters = new Map<string, WalletApplicationAdapter<TEngine>>()
	private readonly plans = new Map<string, readonly WalletStep[]>()
	private readonly runtimes = new Map<string, Promise<CocoWalletRuntime<TEngine>>>()
	private readonly flights = new Map<string, Flight>()

	constructor(private readonly options: WalletHostOptions<TEngine>) {
		if (!options.runtimeFactory || !options.store || typeof options.now !== 'function') {
			throw new WalletConfigurationError('runtimeFactory, store and now are required')
		}
		for (const adapter of options.adapters) {
			const applicationId = requireText(adapter.applicationId, 'adapter.applicationId')
			const operationKind = requireText(adapter.operationKind, 'adapter.operationKind')
			const plan = validatePlan(adapter.plan)
			const key = adapterKey(applicationId, operationKind)
			if (this.adapters.has(key)) {
				throw new WalletConfigurationError(`duplicate wallet adapter ${applicationId}/${operationKind}`)
			}
			this.adapters.set(key, adapter)
			this.plans.set(key, plan)
		}
	}

	/** `#f4028b` — return Coco's disjoint state projection, never derive authority from a UI total. */
	async balance(accountInput: WalletAccount, query?: WalletBalanceQuery): Promise<WalletBalance> {
		const account = normalizeAccount(accountInput)
		const runtime = await this.runtimeFor(account)
		const scope = query
			? {
					...(query.mintUrl ? { mintUrl: normalizeMintUrl(query.mintUrl) } : {}),
					...(query.unit ? { unit: requireText(query.unit.toLowerCase(), 'balance unit') } : {}),
				}
			: undefined
		return validateBalance(await runtime.balance(scope))
	}

	/** `#417d51` — run every uncompleted step, or through one named step. */
	async run(commandInput: WalletOperationCommand, options: WalletRunOptions = {}): Promise<WalletOperationSnapshot> {
		const command = normalizeCommand(commandInput)
		const plan = this.resolvePlan(command.applicationId, command.operationKind)
		return this.withFlight({ ...command, plan }, async () => {
			const record = await this.claim(command)
			return this.execute(record, options)
		})
	}

	/**
	 * Run the next step of the command's plan, for review/confirm flows such as Auctions prepare → publish.
	 * Under concurrency a same-id command already in flight is joined rather than a second flight started, so
	 * the returned snapshot is that flight's progress and may exceed one step; a flight this call starts itself
	 * performs exactly one step.
	 */
	async advance(commandInput: WalletOperationCommand): Promise<WalletOperationSnapshot> {
		const command = normalizeCommand(commandInput)
		const plan = this.resolvePlan(command.applicationId, command.operationKind)
		return this.withFlight({ ...command, plan }, async () => {
			const record = await this.claim(command)
			return this.execute(record, {}, 1)
		})
	}

	async get(commandIdInput: string): Promise<WalletOperationSnapshot | null> {
		const commandId = requireText(commandIdInput, 'commandId')
		const raw = await this.options.store.get(commandId)
		if (!raw) return null
		return projectOperation(readRecordOnce(raw))
	}

	async list(accountInput?: WalletAccount): Promise<readonly WalletOperationSnapshot[]> {
		const account = accountInput ? normalizeAccount(accountInput) : undefined
		return (await this.options.store.list(account))
			.map((raw) => readRecordOnce(raw))
			.filter((record) => !account || sameAccount(record.account, account))
			.map((record) => projectOperation(record))
	}

	/** `#2f50be` — reconcile Coco/app state before any replay. */
	async recover(commandIdInput: string, options: { resume?: boolean } = {}): Promise<WalletOperationSnapshot> {
		const commandId = requireText(commandIdInput, 'commandId')
		const initial = await this.requireRecord(commandId)
		return this.withFlight(initial, async () => {
			let record = await this.requireRecord(commandId)
			// `#7889e5` — cancellation is terminal; recovery never revives a cancelled command.
			if (record.state === 'cancelled') {
				throw new WalletInvalidTransitionError(
					record.commandId,
					'recovery does not apply to a terminal (cancelled) command',
				)
			}
			const adapter = this.adapterFor(record.applicationId, record.operationKind)
			const runtime = await this.runtimeFor(record.account)
			record = await this.update(record, { state: 'recovering', failureCode: undefined })
			let result: WalletRecoveryResult
			try {
				result = readRecoveryResultOnce(record, await adapter.recover(this.context(runtime, record)))
				this.validateRecovery(record, result)
			} catch (error) {
				const code = failureCode(error)
				await this.update(record, { state: 'unresolved', failureCode: code })
				throw new WalletStepExecutionError(record.commandId, 'recover', code)
			}
			const recoveredState = result.unresolved ? 'unresolved' : stateAfter(result.completedSteps)
			record = await this.update(record, {
				state: recoveredState,
				completedSteps: [...result.completedSteps],
				engineOperationId: result.engineOperationId ?? record.engineOperationId,
				fee: result.fee ?? record.fee,
				failureCode: result.unresolved ? this.requireFailureCode(result.failureCode) : undefined,
			})
			if (options.resume && !result.unresolved) return this.execute(record, {})
			return projectOperation(record)
		})
	}

	/** Continue a known resolved command without asking the app to reconstruct the input. */
	async resume(commandIdInput: string, options: WalletRunOptions = {}): Promise<WalletOperationSnapshot> {
		const commandId = requireText(commandIdInput, 'commandId')
		const initial = await this.requireRecord(commandId)
		return this.withFlight(initial, async () =>
			this.execute(await this.requireRecord(commandId), options),
		)
	}

	/** Prepared local reservations may be cancelled; exposed requests and remote attempts may not. */
	async cancel(commandIdInput: string): Promise<WalletOperationSnapshot> {
		const commandId = requireText(commandIdInput, 'commandId')
		const initial = await this.requireRecord(commandId)
		return this.withFlight(initial, async () => {
			let record = await this.requireRecord(commandId)
			if (record.state === 'cancelled') return projectOperation(record)
			this.requireResolved(record)
			if (record.completedSteps.some((step) => step !== 'prepare')) {
				throw new WalletInvalidTransitionError(record.commandId, 'only a local prepared reservation may be cancelled')
			}
			const adapter = this.adapterFor(record.applicationId, record.operationKind)
			if (record.completedSteps.includes('prepare') && !adapter.cancel) {
				throw new WalletInvalidTransitionError(record.commandId, 'its adapter cannot cancel the prepared reservation')
			}
			const runtime = await this.runtimeFor(record.account)
			record = await this.update(record, { state: 'cancelling', failureCode: undefined })
			try {
				await adapter.cancel?.(this.context(runtime, record))
			} catch (error) {
				const code = failureCode(error)
				await this.update(record, { state: 'unresolved', failureCode: code })
				throw new WalletStepExecutionError(record.commandId, 'cancel', code)
			}
			record = await this.update(record, { state: 'cancelled', failureCode: undefined })
			return projectOperation(record)
		})
	}

	/** `#269648` — account switch/logout closes exactly one full-identity runtime. */
	async disposeAccount(accountInput: WalletAccount): Promise<void> {
		const account = normalizeAccount(accountInput)
		const key = accountKey(account)
		if ([...this.flights.values()].some((flight) => flight.accountKey === key)) {
			throw new WalletInvalidTransitionError(key, 'cannot dispose an account while its wallet command is running')
		}
		const pending = this.runtimes.get(key)
		if (!pending) return
		this.runtimes.delete(key)
		await (await pending).dispose()
	}

	async dispose(): Promise<void> {
		if (this.flights.size > 0) {
			throw new WalletConfigurationError('cannot dispose the wallet host while commands are running')
		}
		const runtimes = [...this.runtimes.values()]
		this.runtimes.clear()
		const results = await Promise.allSettled(runtimes.map(async (runtime) => (await runtime).dispose()))
		const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
		if (failure) throw failure.reason
	}

	private async claim(command: WalletOperationCommand): Promise<WalletOperationRecord> {
		const plan = this.resolvePlan(command.applicationId, command.operationKind)
		const now = this.now()
		const candidate: WalletOperationRecord = {
			...command,
			schemaVersion: 1,
			plan,
			completedSteps: [],
			state: 'created',
			revision: 0,
			createdAt: now,
			updatedAt: now,
		}
		const claimed = await this.options.store.createOrGet(candidate)
		const record = readRecordOnce(claimed.record)
		if (!immutableCommandMatches(record, command, plan)) {
			throw new WalletCommandConflictError(command.commandId)
		}
		return record
	}

	private async execute(
		initial: WalletOperationRecord,
		options: WalletRunOptions,
		maximumSteps = Number.POSITIVE_INFINITY,
	): Promise<WalletOperationSnapshot> {
		let record = initial
		this.requireResolved(record)
		if (record.state === 'cancelled') return projectOperation(record)
		if (!isPrefix(record.completedSteps, record.plan)) {
			throw new WalletInvalidTransitionError(record.commandId, 'completed steps are not an ordered plan prefix')
		}
		if (options.through && !record.plan.includes(options.through)) {
			throw new WalletInvalidTransitionError(record.commandId, `step ${options.through} is not in its plan`)
		}
		const adapter = this.adapterFor(record.applicationId, record.operationKind)
		const runtime = await this.runtimeFor(record.account)
		let performed = 0
		for (const step of record.plan.slice(record.completedSteps.length)) {
			await adapter.revalidate?.(step, this.context(runtime, record))
			record = await this.update(record, { state: startedState[step], failureCode: undefined })
			let result: WalletStepResult
			try {
				result = readStepResultOnce(record, await adapter.perform(step, this.context(runtime, record)))
			} catch (error) {
				const code = failureCode(error)
				const state = step === 'prepare' ? 'failed' : 'unresolved'
				await this.update(record, { state, failureCode: code })
				throw new WalletStepExecutionError(record.commandId, step, code)
			}
			record = await this.update(record, {
				state: completedState[step],
				completedSteps: [...record.completedSteps, step],
				engineOperationId: result.engineOperationId ?? record.engineOperationId,
				fee: result.fee ?? record.fee,
				failureCode: undefined,
			})
			performed += 1
			if (options.through === step || performed >= maximumSteps) break
		}
		return projectOperation(record)
	}

	private validateRecovery(record: WalletOperationRecord, result: WalletRecoveryResult): void {
		if (!isPrefix(result.completedSteps, record.plan)) {
			throw new WalletConfigurationError('recovery completedSteps must be an ordered prefix of the immutable plan')
		}
		if (!isPrefix(record.completedSteps, result.completedSteps)) {
			throw new WalletConfigurationError('recovery cannot discard a step the host already committed')
		}
		if (result.unresolved) this.requireFailureCode(result.failureCode)
	}

	private requireFailureCode(value: string | undefined): string {
		if (!value || !FAILURE_CODE.test(value)) {
			throw new WalletConfigurationError('an unresolved recovery result requires a safe failureCode')
		}
		return value
	}

	private requireResolved(record: WalletOperationRecord): void {
		if (record.state === 'unresolved' || record.state === 'failed' || IN_PROGRESS.has(record.state)) {
			throw new WalletRecoveryRequiredError(record.commandId)
		}
	}

	private adapterFor(applicationId: string, operationKind: string): WalletApplicationAdapter<TEngine> {
		const adapter = this.adapters.get(adapterKey(applicationId, operationKind))
		if (!adapter) throw new WalletAdapterNotFoundError(applicationId, operationKind)
		return adapter
	}

	/** Resolve an adapter's snapshotted step plan; an unregistered adapter fails closed. */
	private resolvePlan(applicationId: string, operationKind: string): readonly WalletStep[] {
		const adapter = this.adapterFor(applicationId, operationKind)
		const plan = this.plans.get(adapterKey(adapter.applicationId, adapter.operationKind))
		if (!plan) throw new WalletAdapterNotFoundError(applicationId, operationKind)
		return plan
	}

	private context(
		runtime: CocoWalletRuntime<TEngine>,
		record: WalletOperationRecord,
	): WalletAdapterContext<TEngine> {
		return { runtime, operation: projectOperation(record) }
	}

	private async runtimeFor(account: WalletAccount): Promise<CocoWalletRuntime<TEngine>> {
		const key = accountKey(account)
		let pending = this.runtimes.get(key)
		if (!pending) {
			pending = this.options.runtimeFactory.open({ ...account }).then(async (runtime) => {
				if (!sameAccount(runtime.account, account)) {
					// Never leak an orphaned (possibly money-bearing) runtime: dispose it before failing closed.
					await runtime.dispose()
					throw new WalletConfigurationError('runtime factory returned a runtime for a different account')
				}
				return runtime
			})
			this.runtimes.set(key, pending)
			pending.catch(() => {
				if (this.runtimes.get(key) === pending) this.runtimes.delete(key)
			})
		}
		return pending
	}

	private async requireRecord(commandId: string): Promise<WalletOperationRecord> {
		const raw = await this.options.store.get(commandId)
		if (!raw) throw new WalletInvalidTransitionError(commandId, 'does not exist')
		return readRecordOnce(raw)
	}

	private async update(
		record: WalletOperationRecord,
		patch: Partial<
			Pick<
				WalletOperationRecord,
				'state' | 'completedSteps' | 'engineOperationId' | 'fee' | 'failureCode'
			>
		>,
	): Promise<WalletOperationRecord> {
		const next: WalletOperationRecord = {
			commandId: record.commandId,
			applicationId: record.applicationId,
			operationKind: record.operationKind,
			account: { accountId: record.account.accountId, environmentId: record.account.environmentId },
			money: { mintUrl: record.money.mintUrl, unit: record.money.unit, amount: record.money.amount },
			intentFingerprint: record.intentFingerprint,
			schemaVersion: record.schemaVersion,
			plan: [...record.plan],
			completedSteps: patch.completedSteps ? [...patch.completedSteps] : [...record.completedSteps],
			state: patch.state ?? record.state,
			engineOperationId: patch.engineOperationId ?? record.engineOperationId,
			fee: patch.fee ?? record.fee,
			failureCode: patch.failureCode ?? record.failureCode,
			revision: record.revision + 1,
			createdAt: record.createdAt,
			updatedAt: this.now(),
		}
		if (patch.failureCode === undefined) delete next.failureCode
		// The store's compareAndSet RETURN is untrusted too: run it through the same single-read sanitizer
		// before it is used, so a store cannot hand back a hostile object that is later re-read.
		return readRecordOnce(await this.options.store.compareAndSet(record.commandId, record.revision, next))
	}

	private now(): number {
		const value = this.options.now()
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new WalletConfigurationError('now() must return non-negative Unix milliseconds')
		}
		return value
	}

	private async withFlight(
		identity: ImmutableCommandIdentity,
		task: () => Promise<WalletOperationSnapshot>,
	): Promise<WalletOperationSnapshot> {
		const commandId = identity.commandId
		const current = this.flights.get(commandId)
		if (current) {
			// A joiner must pass the same immutable-identity check the sequential `claim()` path applies,
			// so a matching fingerprint with a different binding cannot silently ride the running flight.
			if (!immutableCommandMatches(current.identity, identity, identity.plan)) {
				throw new WalletCommandConflictError(commandId)
			}
			return current.promise
		}
		const flightAccountKey = accountKey(identity.account)
		const promise = task()
		this.flights.set(commandId, {
			identity: {
				...identity,
				account: { ...identity.account },
				money: { ...identity.money },
				plan: [...identity.plan],
			},
			accountKey: flightAccountKey,
			promise,
		})
		try {
			return await promise
		} finally {
			if (this.flights.get(commandId)?.promise === promise) this.flights.delete(commandId)
		}
	}
}
