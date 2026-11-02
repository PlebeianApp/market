/**
 * cashu-wrapper/ts/port.test.ts — the adapter's conformance suite.
 *
 * `#7a7f2d` Proves the Coco leg's port adapter: it maps the contract's three operations onto the wallet
 * host's own lifecycle (`#2f50be`), keeps the melt quote id in a wrapper-owned leg record linked to the
 * host's command record by the stable command id (`#7654d1`), settles only on a validated preimage, and
 * never drives a cancelled command or a reconcile across the monetary boundary. Test support, out of
 * contract: it mints no statement.
 */
import { describe, expect, test } from 'bun:test'
import {
	CocoPortAdapterError,
	CocoWalletHost,
	CocoWalletPortAdapter,
	MemoryWalletOperationStore,
	type CocoEngineOperation,
	type CocoEngineOperationState,
	type CocoLegCommand,
	type CocoLegKey,
	type CocoLegRecord,
	type CocoLegStore,
	type CocoMeltQuote,
	type CocoMeltRail,
	type CocoMeltResult,
	type CocoOperationPort,
	type CocoReconcilerStatus,
	type CocoWalletRuntime,
	type CocoWalletRuntimeFactory,
	type WalletAccount,
	type WalletOperationRecord,
} from './index'
import type { FundsQuote, FundsRefusal, FundsRung } from '../../funds-contract/ts/index'

const WRAPPER_ID = 'coco'

/** Every reconciler the engine carries, enabled — a composing app's ordinary declaration (`#09f049`). */
const RECONCILERS_ON: CocoReconcilerStatus = {
	proofStateWatcher: true,
	meltQuoteWatcher: true,
	meltSettlementProcessor: true,
}

/** The engine port, faked: `get`/`refresh` record their calls so a test can assert a read happened. */
class FakeEngine implements CocoOperationPort {
	readonly calls: string[] = []
	operation: CocoEngineOperation | null = null
	refreshed: CocoEngineOperation | null = null
	reclaimed: CocoEngineOperation | null = null

	async get(operationId: string): Promise<CocoEngineOperation | null> {
		this.calls.push(`get:${operationId}`)
		return this.operation ? { ...this.operation } : null
	}

	async listPrepared(): Promise<readonly CocoEngineOperation[]> {
		this.calls.push('listPrepared')
		return []
	}

	async listInFlight(): Promise<readonly CocoEngineOperation[]> {
		this.calls.push('listInFlight')
		return []
	}

	async refresh(operationId: string): Promise<CocoEngineOperation> {
		this.calls.push(`refresh:${operationId}`)
		return { ...(this.refreshed ?? this.operation ?? { id: operationId, state: 'executing' as const }) }
	}

	async reclaim(operationId: string): Promise<CocoEngineOperation> {
		this.calls.push(`reclaim:${operationId}`)
		return { ...(this.reclaimed ?? { id: operationId, state: 'rolled_back' as const }) }
	}
}

/** The test-only in-memory leg store: the wallet host's store contract, generalised by key. */
class MemoryCocoLegStore implements CocoLegStore {
	private readonly records = new Map<string, CocoLegRecord>()

	private keyOf(key: CocoLegKey): string {
		return `${key.wrapperId}\u0000${key.legId}`
	}

	private copy(record: CocoLegRecord): CocoLegRecord {
		return {
			...record,
			operations: [...record.operations] as CocoLegRecord['operations'],
			plan: [...record.plan],
			witness: record.witness ? { ...record.witness } : undefined,
		}
	}

	async createOrGet(record: CocoLegRecord): Promise<{ record: CocoLegRecord; created: boolean }> {
		const current = this.records.get(this.keyOf(record))
		if (current) return { record: this.copy(current), created: false }
		this.records.set(this.keyOf(record), this.copy(record))
		return { record: this.copy(record), created: true }
	}

	async get(key: CocoLegKey): Promise<CocoLegRecord | null> {
		const record = this.records.get(this.keyOf(key))
		return record ? this.copy(record) : null
	}

	async list(wrapperId?: string): Promise<readonly CocoLegRecord[]> {
		return [...this.records.values()]
			.filter((record) => !wrapperId || record.wrapperId === wrapperId)
			.map((record) => this.copy(record))
	}

	async compareAndSet(
		key: CocoLegKey,
		expectedRevision: number,
		next: CocoLegRecord,
	): Promise<CocoLegRecord> {
		const current = this.records.get(this.keyOf(key))
		if (!current || current.revision !== expectedRevision || next.revision !== expectedRevision + 1) {
			throw new CocoPortAdapterError('coco_stale_writer', `leg ${key.legId} is stale`)
		}
		this.records.set(this.keyOf(key), this.copy(next))
		return this.copy(next)
	}
}

/** The injected mint port, faked: every call is recorded so a test can assert what was never called. */
class FakeMeltRail implements CocoMeltRail {
	readonly calls: string[] = []
	quoteResult: CocoMeltQuote = { quoteId: 'quote-1', engineOperationId: 'leg-1', expiryAt: 5_000, state: 'unpaid' }
	meltResult: CocoMeltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid' }
	readQuoteResult: CocoMeltQuote | null = null
	preimageValid = true

	async quote(): Promise<CocoMeltQuote> {
		this.calls.push('quote')
		return { ...this.quoteResult }
	}

	async melt(): Promise<CocoMeltResult> {
		this.calls.push('melt')
		return { ...this.meltResult }
	}

	async readQuote(): Promise<CocoMeltQuote | null> {
		this.calls.push('readQuote')
		return this.readQuoteResult ? { ...this.readQuoteResult } : null
	}

	validatePreimage(): boolean {
		return this.preimageValid
	}
}

class FakeRuntimeFactory implements CocoWalletRuntimeFactory<CocoOperationPort> {
	constructor(
		private readonly engine: CocoOperationPort,
		private readonly reconcilers: CocoReconcilerStatus = RECONCILERS_ON,
	) {}

	async open(account: WalletAccount): Promise<CocoWalletRuntime<CocoOperationPort>> {
		return {
			account: { ...account },
			engine: this.engine,
			reconcilers: this.reconcilers,
			balance: async () => ({ available: 0, reserved: 0, locked: 0, pending: 0, unresolved: 0, total: 0 }),
			dispose: async () => undefined,
		}
	}
}

const clock = (): (() => number) => {
	let value = 1_000
	return () => value++
}

const command = (overrides: Partial<CocoLegCommand> = {}): CocoLegCommand => ({
	legId: 'leg-1',
	applicationId: 'market',
	operationKind: 'melt',
	account: { accountId: 'a'.repeat(64), environmentId: 'test' },
	money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 21 },
	invoice: 'lnbc1-invoice',
	intentFingerprint: '1'.repeat(64),
	...overrides,
})

const buildAdapter = (
	store: CocoLegStore,
	rail: FakeMeltRail,
	engine: FakeEngine,
	reconcilers: CocoReconcilerStatus,
	now: () => number,
): { port: CocoWalletPortAdapter<CocoOperationPort>; host: CocoWalletHost<CocoOperationPort> } => {
	const port = new CocoWalletPortAdapter<CocoOperationPort>({
		wrapperId: WRAPPER_ID,
		method: 'cashu-melt',
		applicationId: 'market',
		operationKind: 'melt',
		store,
		storeKind: 'memory',
		rail,
		ceiling: 1_000_000,
		contractVersion: '0.1',
		now,
	})
	const host = new CocoWalletHost<CocoOperationPort>({
		runtimeFactory: new FakeRuntimeFactory(engine, reconcilers),
		store: new MemoryWalletOperationStore(),
		adapters: [port.applicationAdapter],
		now,
	})
	port.attach(host)
	return { port, host }
}

const build = (
	store: CocoLegStore,
): {
	port: CocoWalletPortAdapter<CocoOperationPort>
	host: CocoWalletHost<CocoOperationPort>
	rail: FakeMeltRail
	engine: FakeEngine
	now: () => number
} => {
	const rail = new FakeMeltRail()
	const engine = new FakeEngine()
	const now = clock()
	const { port, host } = buildAdapter(store, rail, engine, RECONCILERS_ON, now)
	return { port, host, rail, engine, now }
}

const setup = (
	options: { reconcilers?: CocoReconcilerStatus } = {},
): {
	port: CocoWalletPortAdapter<CocoOperationPort>
	host: CocoWalletHost<CocoOperationPort>
	store: MemoryCocoLegStore
	rail: FakeMeltRail
	engine: FakeEngine
} => {
	const store = new MemoryCocoLegStore()
	const rail = new FakeMeltRail()
	const engine = new FakeEngine()
	const now = clock()
	const { port, host } = buildAdapter(store, rail, engine, options.reconcilers ?? RECONCILERS_ON, now)
	return { port, host, store, rail, engine }
}

const obtainQuote = async (port: CocoWalletPortAdapter, input: CocoLegCommand): Promise<FundsQuote> => {
	const result = await port.obtain(input)
	if ('refused' in result) throw new Error(`unexpected refusal: ${result.field}`)
	return result
}

const refusalOf = (result: FundsQuote | FundsRefusal): FundsRefusal => {
	if (!('refused' in result)) throw new Error('expected a refusal')
	return result
}

describe('the port is carried onto the host lifecycle', () => {
	test('obtain claims the durable command before the melt and returns the engine operation id as the reference', async () => {
		const { port, host, store, rail } = setup()
		const quote = await obtainQuote(port, command())

		expect(quote.reference).toBe('leg-1')
		expect(quote.authorityKind).toBe('local')
		expect(quote.operations).toEqual(['obtain', 'submit', 'reconcile'])
		expect(quote.plan).toEqual(['obtain', 'submit', 'reconcile'])

		// the host operation obtain maps to: `run` through the pre-boundary step, which claims the record
		const snapshot = await host.get('leg-1')
		expect(snapshot?.state).toBe('prepared')
		expect(snapshot?.completedSteps).toEqual(['prepare'])
		// the claim precedes the mint call, and the quote is the only rail call
		expect(rail.calls).toEqual(['quote'])

		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		expect(record?.engineOperationId).toBe('leg-1')
		expect(record?.meltQuoteId).toBe('quote-1')
		expect(record?.commandId).toBe('leg-1')
		expect(record?.rung).toBe('unresolved')
	})

	test('the leg reference is the engine’s operation id, resolved from the store even when it differs from the leg’s own id', async () => {
		const { port, store, rail } = setup()
		// the engine surfaces its own operation id at prepare: the reference must be THAT, not the leg id
		rail.quoteResult = { quoteId: 'quote-1', engineOperationId: 'op-9', expiryAt: 5_000, state: 'unpaid' }
		const quote = await obtainQuote(port, command())

		expect(quote.reference).toBe('op-9')
		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		expect(record?.engineOperationId).toBe('op-9')
		expect(record?.commandId).toBe('leg-1')

		// the leg is resolvable from the reference alone (the engine's operation id), not only from its own id
		const handle = await port.reconcile(quote.reference)
		expect(handle.legId).toBe('leg-1')
	})

	test('submit crosses the host boundary and performs the melt exactly once', async () => {
		const { port, host, rail } = setup()
		const quote = await obtainQuote(port, command())
		const handle = await port.submit(quote, 'leg-1')

		expect(rail.calls).toEqual(['quote', 'melt'])
		expect(handle.rung).toBe('witnessed-settled')
		const snapshot = await host.get('leg-1')
		expect(snapshot?.completedSteps).toEqual(['prepare', 'attempt'])
	})

	test('reconcile maps onto the host recover and never melts', async () => {
		const { port, rail, engine } = setup()
		await obtainQuote(port, command())
		rail.readQuoteResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', expiryAt: 5_000, state: 'paid' }
		engine.operation = { id: 'leg-1', state: 'pending' }

		const handle = await port.reconcile('leg-1')

		expect(rail.calls).toEqual(['quote', 'readQuote'])
		expect(rail.calls).not.toContain('melt')
		// the reconcile reads the engine's own operation: a pending operation is not settled, but the
		// app-supplied quote read beside it still reports the mint's settled word
		expect(engine.calls).toEqual(['get:leg-1'])
		expect(handle.rung).toBe('witnessed-settled')
	})

	test('the leg record links to the host command record by the stable command id', async () => {
		const { port, host, store } = setup()
		await obtainQuote(port, command())
		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })

		expect(record?.commandId).toBe('leg-1')
		expect(await host.get(record?.commandId ?? '')).not.toBeNull()
	})

	test('the registration declares a local authority with no reconcile deadline and the leg plans all three operations', () => {
		const { port } = setup()
		const registration = port.registration

		expect(registration.authorityKind).toBe('local')
		expect(registration.operations).toEqual(['obtain', 'submit', 'reconcile'])
		expect(registration.plan).toEqual(['obtain', 'submit', 'reconcile'])
		expect(registration.witnessKinds).toEqual(['preimage', 'mint_quote_state'])
		expect('reconcileDeadlineMs' in registration).toBeFalse()
		expect(port.declarations[0]?.operations).toEqual(['obtain', 'submit', 'reconcile'])
	})

	test('the handle carries no reconcile deadline and the leg record keeps the quote expiry absolute', async () => {
		const { port, store } = setup()
		const quote = await obtainQuote(port, command())
		const handle = await port.submit(quote, 'leg-1')

		expect(handle.reconcileDeadlineAt).toBeUndefined()
		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		expect(record?.quoteExpiryAt).toBe(5_000)
	})

	test('a second submit returns the settled handle unchanged — the settle is write-once', async () => {
		const { port, rail } = setup()
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid', preimage: 'PREIMAGE' }
		const quote = await obtainQuote(port, command())

		const first = await port.submit(quote, 'leg-1')
		const second = await port.submit(quote, 'leg-1')

		expect(first.rung).toBe('witnessed-settled')
		expect(second.rung).toBe('witnessed-settled')
		expect(rail.calls.filter((call) => call === 'melt')).toHaveLength(1)
	})
})

describe('the witness judgment', () => {
	test('a preimage validated against the payment hash settles the leg', async () => {
		const { port, rail } = setup()
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid', preimage: 'PREIMAGE' }
		const quote = await obtainQuote(port, command())

		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('preimage')
		expect(handle.unwitnessed).toBeFalse()
	})

	test('a settled melt quote is the mint’s own word read at its source and reaches the witnessing rung', async () => {
		const { port, rail } = setup()
		// the mint says paid with no preimage: the mint is the authority, so this is its own word at source
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid' }
		const quote = await obtainQuote(port, command())

		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('mint_quote_state')
		expect(handle.unwitnessed).toBeFalse()
	})

	test('a preimage that does not validate is never used as a preimage witness', async () => {
		const { port, rail } = setup()
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'pending', preimage: 'WRONG' }
		rail.preimageValid = false
		const quote = await obtainQuote(port, command())

		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('unresolved')
		expect(handle.witness).toBeUndefined()
		expect(handle.unwitnessed).toBeTrue()
	})

	test('a local reconcile whose quote expired with no artifact reaches the non-settlement terminal', async () => {
		const { port, rail } = setup()
		await obtainQuote(port, command())
		// expiryAt 1 is in the past: the window elapsed and no artifact will arrive
		rail.readQuoteResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', expiryAt: 1, state: 'unpaid' }

		const handle = await port.reconcile('leg-1')

		expect(handle.rung).toBe('abandoned')
		expect(handle.unwitnessed).toBeTrue()
		expect(handle.witness).toBeUndefined()
	})

	test('a local reconcile that cannot answer leaves the leg unresolved, never settled', async () => {
		const { port, rail } = setup()
		await obtainQuote(port, command())
		rail.readQuoteResult = null

		const handle = await port.reconcile('leg-1')

		expect(handle.rung).toBe('unresolved')
		expect(handle.unwitnessed).toBeTrue()
	})
})

describe('the reconcile against the engine’s own operation (read plus refresh)', () => {
	test('a melt still in flight at startup reconciles by reading and refreshing, and settles on the authority’s refreshed answer', async () => {
		const { port, engine, rail } = setup()
		const quote = await obtainQuote(port, command())
		// crashed while the engine was still executing the operation
		engine.operation = { id: 'leg-1', state: 'executing', meltQuoteId: 'quote-1' }
		// the authority’s refreshed answer: settled
		engine.refreshed = { id: 'leg-1', state: 'finalized', meltQuoteId: 'quote-1' }
		rail.calls.length = 0

		const handle = await port.reconcile(quote.reference)

		expect(engine.calls).toEqual(['get:leg-1', 'refresh:leg-1'])
		expect(rail.calls).not.toContain('melt')
		expect(handle.rung).toBe('witnessed-settled')
		expect(handle.witness?.kind).toBe('mint_quote_state')
	})

	test('an in-flight operation whose refresh does not settle leaves the leg unresolved, never settled', async () => {
		const { port, engine } = setup()
		const quote = await obtainQuote(port, command())
		engine.operation = { id: 'leg-1', state: 'executing', meltQuoteId: 'quote-1' }
		// the authority’s refreshed answer is still in flight — nothing may be reported settled
		engine.refreshed = { id: 'leg-1', state: 'pending', meltQuoteId: 'quote-1' }

		const handle = await port.reconcile(quote.reference)

		expect(engine.calls).toEqual(['get:leg-1', 'refresh:leg-1'])
		expect(handle.rung).toBe('unresolved')
		expect(handle.unwitnessed).toBeTrue()
	})

	test('a crash at each engine operation state leaves the leg resolvable rather than lost', async () => {
		const cases: ReadonlyArray<{ state: CocoEngineOperationState; rung: FundsRung }> = [
			{ state: 'prepared', rung: 'unresolved' },
			{ state: 'executing', rung: 'unresolved' },
			{ state: 'pending', rung: 'unresolved' },
			{ state: 'finalized', rung: 'witnessed-settled' },
			{ state: 'rolled_back', rung: 'abandoned' },
		]
		for (const { state, rung } of cases) {
			const { port, engine, store } = setup()
			const quote = await obtainQuote(port, command())
			engine.operation = { id: 'leg-1', state, meltQuoteId: 'quote-1' }
			engine.refreshed = { id: 'leg-1', state, meltQuoteId: 'quote-1' }

			const handle = await port.reconcile(quote.reference)

			expect(handle.legId).toBe('leg-1')
			expect(handle.rung).toBe(rung)
			// the leg record still exists and still names its reference: resolvable, not lost
			const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
			expect(record?.engineOperationId).toBe('leg-1')
		}
	})

	test('with the engine’s own reconcilers disabled a local read cannot settle and is never reported settled', async () => {
		const { port, engine } = setup({
			reconcilers: { proofStateWatcher: false, meltQuoteWatcher: false, meltSettlementProcessor: false },
		})
		const quote = await obtainQuote(port, command())
		engine.operation = { id: 'leg-1', state: 'finalized', meltQuoteId: 'quote-1' }

		const handle = await port.reconcile(quote.reference)

		expect(handle.rung).toBe('unresolved')
		expect(handle.unwitnessed).toBeTrue()
		expect(handle.witness).toBeUndefined()
	})

	test('with the engine’s own reconcilers disabled even a settled melt is not reported settled', async () => {
		const { port, rail } = setup({
			reconcilers: { proofStateWatcher: false, meltQuoteWatcher: false, meltSettlementProcessor: false },
		})
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid' }
		const quote = await obtainQuote(port, command())

		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('unresolved')
		expect(handle.unwitnessed).toBeTrue()
	})

	test('a leg whose reference is missing cannot be reconciled and says so', async () => {
		const { port, host, store } = setup()
		const quote = await obtainQuote(port, command())
		// a store that strips the engine's operation id leaves the leg with no reference to read
		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		await store.compareAndSet(
			{ wrapperId: WRAPPER_ID, legId: 'leg-1' },
			record?.revision ?? 0,
			{ ...(record as CocoLegRecord), engineOperationId: undefined, revision: (record?.revision ?? 0) + 1 },
		)

		const handle = await port.reconcile(quote.reference)

		expect(handle.rung).toBe('unresolved')
		expect(handle.unwitnessed).toBeTrue()

		const snapshot = await host.recover('leg-1')
		expect(snapshot.state).toBe('unresolved')
		expect(snapshot.failureCode).toBe('coco_no_reference')
	})
})

describe('the negative behaviours', () => {
	test('a cancelled host record is not driven across the boundary', async () => {
		const { port, host, store, rail } = setup()
		const quote = await obtainQuote(port, command())
		await host.cancel('leg-1')
		rail.calls.length = 0

		await expect(port.submit(quote, 'leg-1')).rejects.toBeInstanceOf(CocoPortAdapterError)

		expect(rail.calls).not.toContain('melt')
		const record = await store.get({ wrapperId: WRAPPER_ID, legId: 'leg-1' })
		expect(record?.rung).not.toBe('witnessed-settled')
	})

	test('a hostile leg store returning bearer-shaped material cannot reach the adapter output', async () => {
		class LeakyLegStore extends MemoryCocoLegStore {
			private leak(record: CocoLegRecord): CocoLegRecord {
				return {
					...record,
					seed: 'SEED_MATERIAL',
					proofs: ['PROOF_BEARER_1'],
					token: 'TOKEN_BEARER_1',
					// and a bearer preimage smuggled through a declared sub-object
					witness: record.witness ? { ...record.witness, preimage: 'BEARER_PREIMAGE' } : record.witness,
				} as CocoLegRecord
			}

			override async createOrGet(record: CocoLegRecord): Promise<{ record: CocoLegRecord; created: boolean }> {
				const result = await super.createOrGet(record)
				return { record: this.leak(result.record), created: result.created }
			}

			override async get(key: CocoLegKey): Promise<CocoLegRecord | null> {
				const record = await super.get(key)
				return record ? this.leak(record) : null
			}

			override async list(wrapperId?: string): Promise<readonly CocoLegRecord[]> {
				return (await super.list(wrapperId)).map((record) => this.leak(record))
			}

			override async compareAndSet(
				key: CocoLegKey,
				expectedRevision: number,
				next: CocoLegRecord,
			): Promise<CocoLegRecord> {
				return this.leak(await super.compareAndSet(key, expectedRevision, next))
			}
		}

		const store = new LeakyLegStore()
		const { port, rail } = build(store)
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid', preimage: 'PREIMAGE' }
		const quote = await obtainQuote(port, command())
		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('witnessed-settled')
		expect('preimage' in (handle.witness ?? {})).toBeFalse()
		expect(JSON.stringify({ quote, handle })).not.toMatch(/seed|proofs|token|BEARER/i)
		expect(Object.keys(handle).sort()).toEqual(['legId', 'progress', 'rung', 'unwitnessed', 'witness', 'wrapperId'])
		expect(Object.keys(quote).sort()).toEqual([
			'authorityKind',
			'legId',
			'method',
			'operations',
			'plan',
			'reference',
			'wrapperId',
		])
	})

	test('the adapter consumes only the host snapshot: a hostile host store leaks nothing to the port', async () => {
		class LeakyHostStore extends MemoryWalletOperationStore {
			private leak(record: WalletOperationRecord): WalletOperationRecord {
				return {
					...record,
					seed: 'SEED_MATERIAL',
					proofs: ['PROOF_BEARER_1'],
					token: 'TOKEN_BEARER_1',
				} as unknown as WalletOperationRecord
			}

			override async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
				const result = await super.createOrGet(record)
				return { record: this.leak(result.record), created: result.created }
			}

			override async get(commandId: string): Promise<WalletOperationRecord | null> {
				const record = await super.get(commandId)
				return record ? this.leak(record) : null
			}

			override async compareAndSet(
				commandId: string,
				expectedRevision: number,
				next: WalletOperationRecord,
			): Promise<WalletOperationRecord> {
				return this.leak(await super.compareAndSet(commandId, expectedRevision, next))
			}
		}

		const rail = new FakeMeltRail()
		rail.meltResult = { quoteId: 'quote-1', engineOperationId: 'leg-1', state: 'paid', preimage: 'PREIMAGE' }
		const now = clock()
		const store = new MemoryCocoLegStore()
		const port = new CocoWalletPortAdapter({
			wrapperId: WRAPPER_ID,
			method: 'cashu-melt',
			applicationId: 'market',
			operationKind: 'melt',
			store,
			storeKind: 'memory',
			rail,
			ceiling: 1_000_000,
			contractVersion: '0.1',
			now,
		})
		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(new FakeEngine()),
			store: new LeakyHostStore(),
			adapters: [port.applicationAdapter],
			now,
		})
		port.attach(host)

		const quote = await obtainQuote(port, command())
		const handle = await port.submit(quote, 'leg-1')

		expect(handle.rung).toBe('witnessed-settled')
		expect(JSON.stringify({ quote, handle })).not.toMatch(/seed|proofs|token|BEARER/i)
	})

	test('obtain refuses an invalid amount, an over-ceiling amount and a missing invoice without asking the mint', async () => {
		const { port, rail } = setup()

		expect(refusalOf(await port.obtain(command({ money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 0 } }))).reason).toBe('invalid-amount')
		expect(refusalOf(await port.obtain(command({ money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 2_000_000 } }))).reason).toBe('over-ceiling')
		expect(refusalOf(await port.obtain(command({ invoice: '' }))).reason).toBe('no-reference')

		expect(rail.calls).toEqual([])
	})

	test('the adapter refuses to run without an injected clock or a positive ceiling', () => {
		const store = new MemoryCocoLegStore()
		const base = {
			wrapperId: WRAPPER_ID,
			method: 'cashu-melt',
			applicationId: 'market',
			operationKind: 'melt',
			store,
			storeKind: 'memory',
			rail: new FakeMeltRail(),
			contractVersion: '0.1',
		}

		expect(() => new CocoWalletPortAdapter({ ...base, ceiling: 1_000_000, now: undefined as unknown as () => number })).toThrow(CocoPortAdapterError)
		expect(() => new CocoWalletPortAdapter({ ...base, ceiling: 0, now: clock() })).toThrow(CocoPortAdapterError)
	})
})
