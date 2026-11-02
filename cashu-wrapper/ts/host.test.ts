import { describe, expect, test } from 'bun:test'
import {
	CocoWalletHost,
	MemoryWalletOperationStore,
	WalletCommandConflictError,
	WalletConfigurationError,
	WalletInvalidTransitionError,
	WalletRecoveryRequiredError,
	WalletStaleWriterError,
	WalletStepExecutionError,
	defineWalletApplicationAdapter,
	type CocoEngineOperation,
	type CocoOperationPort,
	type CocoReconcilerStatus,
	type CocoWalletRuntime,
	type CocoWalletRuntimeFactory,
	type WalletAccount,
	type WalletApplicationAdapter,
	type WalletBalance,
	type WalletOperationCommand,
	type WalletOperationRecord,
	type WalletOperationSnapshot,
	type WalletOperationStore,
	type WalletStep,
	type WalletStepResult,
} from './index'

/** Every reconciler enabled, the ordinary composing-app declaration the runtime now carries (`#09f049`). */
const RECONCILERS_ON: CocoReconcilerStatus = {
	proofStateWatcher: true,
	meltQuoteWatcher: true,
	meltSettlementProcessor: true,
}

/** A trivial engine satisfying the declared operation port, with a `calls` log the tests assert on. */
const fakeEngine = (calls: string[] = []): FakeEngine => ({
	calls,
	get: async (operationId: string): Promise<CocoEngineOperation | null> => {
		calls.push(`get:${operationId}`)
		return null
	},
	listPrepared: async (): Promise<readonly CocoEngineOperation[]> => [],
	listInFlight: async (): Promise<readonly CocoEngineOperation[]> => [],
	refresh: async (operationId: string): Promise<CocoEngineOperation> => {
		calls.push(`refresh:${operationId}`)
		return { id: operationId, state: 'finalized' }
	},
	reclaim: async (operationId: string): Promise<CocoEngineOperation> => {
		calls.push(`reclaim:${operationId}`)
		return { id: operationId, state: 'rolled_back' }
	},
})

interface FakeEngine extends CocoOperationPort {
	calls: string[]
}

const account = (accountId = 'a'.repeat(64), environmentId = 'test'): WalletAccount => ({
	accountId,
	environmentId,
})

const command = (
	commandId: string,
	applicationId: string,
	operationKind: string,
	overrides: Partial<WalletOperationCommand> = {},
): WalletOperationCommand => ({
	commandId,
	applicationId,
	operationKind,
	account: account(),
	money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 21 },
	intentFingerprint: '1'.repeat(64),
	...overrides,
})

const balance: WalletBalance = {
	available: 90,
	reserved: 3,
	locked: 4,
	pending: 2,
	unresolved: 1,
	total: 100,
}

class FakeRuntimeFactory implements CocoWalletRuntimeFactory<FakeEngine> {
	readonly opened: string[] = []
	readonly disposed: string[] = []
	readonly engines = new Map<string, FakeEngine>()

	async open(runtimeAccount: WalletAccount): Promise<CocoWalletRuntime<FakeEngine>> {
		const key = `${runtimeAccount.environmentId}:${runtimeAccount.accountId}`
		this.opened.push(key)
		const engine = fakeEngine()
		this.engines.set(key, engine)
		return {
			account: { ...runtimeAccount },
			engine,
			reconcilers: RECONCILERS_ON,
			balance: async () => ({ ...balance }),
			dispose: async () => {
				this.disposed.push(key)
			},
		}
	}
}

const testClock = (): (() => number) => {
	let value = 1_000
	return () => value++
}

const adapter = (
	applicationId: string,
	operationKind: string,
	plan: readonly WalletStep[],
	overrides: Partial<WalletApplicationAdapter<FakeEngine>> = {},
): WalletApplicationAdapter<FakeEngine> =>
	defineWalletApplicationAdapter({
		applicationId,
		operationKind,
		plan,
		perform: async (step, context) => {
			context.runtime.engine.calls.push(`${applicationId}:${operationKind}:${step}`)
			return { engineOperationId: `coco:${context.operation.commandId}`, fee: step === 'prepare' ? 1 : undefined }
		},
		recover: async (context) => ({
			completedSteps: context.operation.completedSteps,
			engineOperationId: context.operation.engineOperationId,
		}),
		...overrides,
	})

const hostWith = (
	adapters: readonly WalletApplicationAdapter<FakeEngine>[],
	store: WalletOperationStore = new MemoryWalletOperationStore(),
	factory = new FakeRuntimeFactory(),
) => ({
	host: new CocoWalletHost({ runtimeFactory: factory, store, adapters, now: testClock() }),
	store,
	factory,
})

describe('application-neutral composition', () => {
	test('Auctions, Market, Torii Quest and Continuum use the same host without name branches', async () => {
		const adapters = [
			adapter('auctions', 'bid-lock', ['prepare', 'attempt', 'acknowledge']),
			adapter('market', 'checkout', ['request', 'attempt', 'settle']),
			adapter('torii-quest', 'reward', ['attempt', 'acknowledge']),
			adapter('continuum', 'paid-access', ['attempt', 'settle']),
		]
		const { host, factory } = hostWith(adapters)

		for (const [index, applicationAdapter] of adapters.entries()) {
			const result = await host.run(
				command(`command-${index}`, applicationAdapter.applicationId, applicationAdapter.operationKind, {
					intentFingerprint: String(index + 1).repeat(64),
				}),
			)
			expect(result.complete).toBeTrue()
			expect(result.completedSteps).toEqual(applicationAdapter.plan)
		}

		expect(factory.opened).toHaveLength(1)
		expect(factory.engines.values().next().value?.calls).toHaveLength(10)
	})

	test('duplicate adapter capabilities fail at host construction', () => {
		const duplicate = adapter('auctions', 'bid-lock', ['prepare'])
		expect(() => hostWith([duplicate, duplicate])).toThrow(WalletConfigurationError)
	})

	test('an adapter plan cannot combine settlement and refund', () => {
		expect(() => hostWith([adapter('market', 'bad', ['settle', 'refund'])])).toThrow(WalletConfigurationError)
	})

	test('the host snapshots an adapter plan at construction', async () => {
		const plan: WalletStep[] = ['prepare']
		const appAdapter = adapter('market', 'mutable-plan', plan)
		const { host } = hostWith([appAdapter])
		plan.push('attempt')

		const result = await host.run(command('fixed-plan', 'market', 'mutable-plan'))
		expect(result.plan).toEqual(['prepare'])
		expect(result.completedSteps).toEqual(['prepare'])
	})
})

describe('durable idempotent lifecycle', () => {
	test('concurrent same-intent calls join one execution', async () => {
		let releases = 0
		let unblock: (() => void) | undefined
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve
		})
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async (step, context) => {
				releases += 1
				if (step === 'prepare') await blocked
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
		})
		const { host } = hostWith([appAdapter])
		const input = command('same-command', 'auctions', 'bid-lock')
		const first = host.run(input)
		const second = host.run(input)
		unblock?.()
		const [left, right] = await Promise.all([first, second])

		expect(left).toEqual(right)
		expect(releases).toBe(2)
	})

	test('a concurrent joiner with a different immutable binding is rejected, not joined', async () => {
		let unblock: (() => void) | undefined
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve
		})
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async (step, context) => {
				if (step === 'prepare') await blocked
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
		})
		const { host } = hostWith([appAdapter])
		const binding = (amount: number) => ({
			money: { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount },
		})
		// Same commandId and same intentFingerprint, but a different money binding: the sequential path
		// throws WalletCommandConflictError from claim(), so the concurrent joiner must reject too.
		const first = host.run(command('join-conflict', 'auctions', 'bid-lock', binding(21)))
		const second = host.run(command('join-conflict', 'auctions', 'bid-lock', binding(22)))
		unblock?.()
		await expect(second).rejects.toBeInstanceOf(WalletCommandConflictError)
		await expect(first).resolves.toMatchObject({ commandId: 'join-conflict' })
	})

	test('completed steps are skipped on a later retry', async () => {
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'])
		const { host, factory } = hostWith([appAdapter])
		const input = command('retry-command', 'auctions', 'bid-lock')
		await host.run(input)
		await host.run(input)

		expect(factory.engines.values().next().value?.calls).toEqual([
			'auctions:bid-lock:prepare',
			'auctions:bid-lock:attempt',
		])
	})

	test('reusing a command id with a different immutable intent fails closed', async () => {
		const { host } = hostWith([adapter('auctions', 'bid-lock', ['prepare'])])
		await host.run(command('conflict', 'auctions', 'bid-lock'))
		await expect(
			host.run(
				command('conflict', 'auctions', 'bid-lock', {
					intentFingerprint: '2'.repeat(64),
				}),
			),
		).rejects.toBeInstanceOf(WalletCommandConflictError)
	})

	test('domain revalidation runs before the in-progress write and monetary call', async () => {
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			revalidate: async (step) => {
				if (step === 'attempt') throw new Error('auction changed')
			},
		})
		const { host, factory } = hostWith([appAdapter])
		await expect(host.run(command('revalidate', 'auctions', 'bid-lock'))).rejects.toThrow('auction changed')

		const stored = await host.get('revalidate')
		expect(stored?.state).toBe('prepared')
		expect(stored?.completedSteps).toEqual(['prepare'])
		expect(factory.engines.values().next().value?.calls).toEqual(['auctions:bid-lock:prepare'])
	})

	test('a remote-boundary failure is quarantined until recovery reconciles it', async () => {
		let failAttempt = true
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt', 'acknowledge'], {
			perform: async (step, context) => {
				if (step === 'attempt' && failAttempt) {
					failAttempt = false
					throw Object.assign(new Error('response lost'), { code: 'remote_outcome_unknown' })
				}
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
			recover: async (context) => ({
				completedSteps: ['prepare', 'attempt'],
				engineOperationId: context.operation.engineOperationId,
			}),
		})
		const { host } = hostWith([appAdapter])
		const input = command('ambiguous', 'auctions', 'bid-lock')

		await expect(host.run(input)).rejects.toBeInstanceOf(WalletStepExecutionError)
		expect((await host.get(input.commandId))?.state).toBe('unresolved')
		await expect(host.run(input)).rejects.toBeInstanceOf(WalletRecoveryRequiredError)

		const recovered = await host.recover(input.commandId, { resume: true })
		expect(recovered.state).toBe('acknowledged')
		expect(recovered.completedSteps).toEqual(['prepare', 'attempt', 'acknowledge'])
		expect(recovered.complete).toBeTrue()
	})

	test('recovery cannot discard a step the host already committed', async () => {
		const appAdapter = adapter('market', 'checkout', ['prepare', 'attempt'], {
			recover: async () => ({ completedSteps: [] }),
		})
		const { host } = hostWith([appAdapter])
		await host.advance(command('no-regression', 'market', 'checkout'))
		await expect(host.recover('no-regression')).rejects.toBeInstanceOf(WalletStepExecutionError)
		expect((await host.get('no-regression'))?.state).toBe('unresolved')
	})

	test('an unresolved recovery is never reported as complete', async () => {
		const appAdapter = adapter('market', 'receive', ['attempt'], {
			perform: async () => {
				throw Object.assign(new Error('unknown'), { code: 'remote_outcome_unknown' })
			},
			recover: async () => ({
				completedSteps: ['attempt'],
				unresolved: true,
				failureCode: 'proof_state_unknown',
			}),
		})
		const { host } = hostWith([appAdapter])
		await expect(host.run(command('still-unknown', 'market', 'receive'))).rejects.toBeInstanceOf(
			WalletStepExecutionError,
		)

		const result = await host.recover('still-unknown')
		expect(result.state).toBe('unresolved')
		expect(result.completedSteps).toEqual(['attempt'])
		expect(result.complete).toBeFalse()
	})

	test('a prepared reservation cancels through its adapter, but an exposed request cannot', async () => {
		let cancelled = 0
		const prepared = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			cancel: async () => {
				cancelled += 1
			},
		})
		const request = adapter('market', 'fund', ['request', 'settle'])
		const { host } = hostWith([prepared, request])

		await host.advance(command('cancel-me', 'auctions', 'bid-lock'))
		expect((await host.cancel('cancel-me')).state).toBe('cancelled')
		expect(cancelled).toBe(1)

		await host.advance(command('invoice-exposed', 'market', 'fund'))
		await expect(host.cancel('invoice-exposed')).rejects.toBeInstanceOf(WalletInvalidTransitionError)
	})

	test('a cancelled command cannot be resurrected by recovery or a following run', async () => {
		let cancellations = 0
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			cancel: async () => {
				cancellations += 1
			},
		})
		const { host, factory } = hostWith([appAdapter])
		const input = command('cancelled-resurrection', 'auctions', 'bid-lock')

		await host.advance(input)
		expect((await host.get(input.commandId))?.state).toBe('prepared')
		const cancelled = await host.cancel(input.commandId)
		expect(cancelled.state).toBe('cancelled')
		expect(cancelled.completedSteps).toEqual(['prepare'])

		// (a) recovery is refused: a cancelled command is terminal, not unresolved.
		await expect(host.recover(input.commandId)).rejects.toBeInstanceOf(WalletInvalidTransitionError)

		// (b) the guard fired before any write: state, completed steps and revision are unchanged.
		const afterRecover = await host.get(input.commandId)
		expect(afterRecover?.state).toBe('cancelled')
		expect(afterRecover?.completedSteps).toEqual(['prepare'])
		expect(afterRecover?.revision).toBe(cancelled.revision)

		// (c) a following run does not cross the monetary boundary the cancellation released.
		const afterRun = await host.run(input)
		expect(afterRun.state).toBe('cancelled')
		expect(afterRun.completedSteps).toEqual(['prepare'])
		expect(factory.engines.values().next().value?.calls).toEqual(['auctions:bid-lock:prepare'])
		expect(cancellations).toBe(1)
	})
})

describe('authority, persistence and bearer boundary', () => {
	test('the full account and environment identity key independent runtimes', async () => {
		const { host, factory } = hostWith([adapter('market', 'checkout', ['attempt'])])
		const first = account(`${'a'.repeat(63)}1`, 'staging')
		const second = account(`${'a'.repeat(63)}2`, 'staging')
		await host.run(command('first-account', 'market', 'checkout', { account: first }))
		await host.run(command('second-account', 'market', 'checkout', { account: second }))

		expect(factory.opened).toEqual([
			`staging:${'a'.repeat(63)}1`,
			`staging:${'a'.repeat(63)}2`,
		])
		await host.disposeAccount(first)
		expect(factory.disposed).toEqual([`staging:${'a'.repeat(63)}1`])
	})

	test('two accounts sharing an accountId but differing only in environment key distinct runtimes', async () => {
		const { host, factory } = hostWith([adapter('market', 'checkout', ['attempt'])])
		const identity = 'a'.repeat(64)
		const staging = account(identity, 'staging')
		const production = account(identity, 'production')

		await host.run(command('env-staging-1', 'market', 'checkout', { account: staging }))
		await host.run(command('env-production-1', 'market', 'checkout', { account: production }))
		await host.run(command('env-staging-2', 'market', 'checkout', { account: staging }))

		// one runtime per complete { accountId, environmentId }: the shared accountId must not merge environments.
		expect(factory.opened).toEqual([`staging:${identity}`, `production:${identity}`])
		const stagingEngine = factory.engines.get(`staging:${identity}`)
		const productionEngine = factory.engines.get(`production:${identity}`)
		expect(stagingEngine).not.toBe(productionEngine)
		// neither runtime saw the other's calls: staging ran two commands, production ran one.
		expect(stagingEngine?.calls).toEqual(['market:checkout:attempt', 'market:checkout:attempt'])
		expect(productionEngine?.calls).toEqual(['market:checkout:attempt'])
	})

	test('a runtime opened for the wrong account is disposed, not leaked', async () => {
		const disposed: string[] = []
		const wrongAccountFactory: CocoWalletRuntimeFactory<FakeEngine> = {
			open: async () => ({
				account: account('b'.repeat(64), 'elsewhere'),
				engine: fakeEngine(),
			reconcilers: RECONCILERS_ON,
				balance: async () => ({ ...balance }),
				dispose: async () => {
					disposed.push('disposed')
				},
			}),
		}
		const host = new CocoWalletHost({
			runtimeFactory: wrongAccountFactory,
			store: new MemoryWalletOperationStore(),
			adapters: [adapter('market', 'checkout', ['attempt'])],
			now: testClock(),
		})

		await expect(host.balance(account())).rejects.toBeInstanceOf(WalletConfigurationError)
		expect(disposed).toEqual(['disposed'])
	})

	test('an account identity part containing a control character is rejected before any key is derived', async () => {
		const { host, factory } = hostWith([adapter('market', 'checkout', ['attempt'])])
		// The two pairs that a bare separator key could not tell apart: each contains a NUL.
		const poisonedAccount = { accountId: 'a\u0000b', environmentId: 'x' }
		const poisonedEnvironment = { accountId: 'b', environmentId: 'x\u0000a' }

		await expect(host.balance(poisonedAccount)).rejects.toBeInstanceOf(WalletConfigurationError)
		await expect(host.balance(poisonedEnvironment)).rejects.toBeInstanceOf(WalletConfigurationError)
		await expect(
			host.run(command('poisoned', 'market', 'checkout', { account: poisonedAccount })),
		).rejects.toBeInstanceOf(WalletConfigurationError)
		expect(factory.opened).toHaveLength(0)
	})

	test('account disposal is refused while one of its commands is running', async () => {
		let unblock: (() => void) | undefined
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve
		})
		const appAdapter = adapter('market', 'checkout', ['attempt'], {
			perform: async (_step, context) => {
				await blocked
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
		})
		const { host } = hostWith([appAdapter])
		const running = host.run(command('running', 'market', 'checkout'))
		await Promise.resolve()
		await expect(host.disposeAccount(account())).rejects.toBeInstanceOf(WalletInvalidTransitionError)
		unblock?.()
		await running
	})

	test('balance preserves all monetary states and rejects a dishonest total', async () => {
		const valid = hostWith([adapter('market', 'checkout', ['attempt'])])
		expect(await valid.host.balance(account())).toEqual(balance)

		const badFactory: CocoWalletRuntimeFactory<FakeEngine> = {
			open: async (runtimeAccount) => ({
				account: runtimeAccount,
				engine: fakeEngine(),
			reconcilers: RECONCILERS_ON,
				balance: async () => ({ ...balance, total: 99 }),
				dispose: async () => undefined,
			}),
		}
		const bad = new CocoWalletHost({
			runtimeFactory: badFactory,
			store: new MemoryWalletOperationStore(),
			adapters: [adapter('market', 'checkout', ['attempt'])],
			now: testClock(),
		})
		await expect(bad.balance(account())).rejects.toBeInstanceOf(WalletConfigurationError)
	})

	test('the host record has no app payload or bearer-material field', async () => {
		const { host, store } = hostWith([adapter('auctions', 'bid-lock', ['prepare', 'attempt'])])
		await host.run(command('public-record', 'auctions', 'bid-lock'))
		const record = await store.get('public-record')
		const encoded = JSON.stringify(record)

		expect(Object.keys(record ?? {}).sort()).toEqual([
			'account',
			'applicationId',
			'commandId',
			'completedSteps',
			'createdAt',
			'engineOperationId',
			'fee',
			'intentFingerprint',
			'money',
			'operationKind',
			'plan',
			'revision',
			'schemaVersion',
			'state',
			'updatedAt',
		])
		expect(encoded).not.toMatch(/seed|private|proof|token|witness|bearer/i)
	})

	// The declared WalletOperationSnapshot key set: the six command fields, the ten record fields
	// (including the three optional ones, present as keys) and `complete`.
	const DECLARED_SNAPSHOT_KEYS = [
		'account',
		'applicationId',
		'commandId',
		'complete',
		'completedSteps',
		'createdAt',
		'engineOperationId',
		'failureCode',
		'fee',
		'intentFingerprint',
		'money',
		'operationKind',
		'plan',
		'revision',
		'schemaVersion',
		'state',
		'updatedAt',
	]

	// The declared WalletBalance key set: the five disjoint monetary states plus their total.
	const DECLARED_BALANCE_KEYS = ['available', 'locked', 'pending', 'reserved', 'total', 'unresolved']

	/** A store is an injected port: this one injects bearer material into every record it returns. */
	class LeakyWalletOperationStore implements WalletOperationStore {
		private readonly inner = new MemoryWalletOperationStore()

		private leak(record: WalletOperationRecord): WalletOperationRecord {
			return {
				...record,
				seed: 'SEED_MATERIAL',
				proofs: ['PROOF_BEARER_1'],
				token: 'TOKEN_BEARER_1',
			} as WalletOperationRecord
		}

		async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			const result = await this.inner.createOrGet(record)
			return { record: this.leak(result.record), created: result.created }
		}

		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await this.inner.get(commandId)
			return record ? this.leak(record) : null
		}

		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await this.inner.list(account)).map((record) => this.leak(record))
		}

		async compareAndSet(
			commandId: string,
			expectedRevision: number,
			next: WalletOperationRecord,
		): Promise<WalletOperationRecord> {
			return this.leak(await this.inner.compareAndSet(commandId, expectedRevision, next))
		}
	}

	/** A store that keeps every declared key but rewrites one field on every record it returns. */
	class OverridingWalletOperationStore implements WalletOperationStore {
		private readonly inner = new MemoryWalletOperationStore()

		constructor(private readonly override: (record: WalletOperationRecord) => WalletOperationRecord) {}

		async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			const result = await this.inner.createOrGet(record)
			return { record: this.override(result.record), created: result.created }
		}

		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await this.inner.get(commandId)
			return record ? this.override(record) : null
		}

		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await this.inner.list(account)).map((record) => this.override(record))
		}

		async compareAndSet(
			commandId: string,
			expectedRevision: number,
			next: WalletOperationRecord,
		): Promise<WalletOperationRecord> {
			return this.override(await this.inner.compareAndSet(commandId, expectedRevision, next))
		}
	}

	/** A store decorating every returned record with the bookkeeping a real IndexedDB/SQLite adapter keeps. */
	class DecoratingWalletOperationStore implements WalletOperationStore {
		private readonly inner = new MemoryWalletOperationStore()

		private decorate(record: WalletOperationRecord): WalletOperationRecord {
			return { ...record, _key: 'operations:1', _indexedAt: 1_700_000_000_000 } as WalletOperationRecord
		}

		async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			const result = await this.inner.createOrGet(record)
			return { record: this.decorate(result.record), created: result.created }
		}

		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await this.inner.get(commandId)
			return record ? this.decorate(record) : null
		}

		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await this.inner.list(account)).map((record) => this.decorate(record))
		}

		async compareAndSet(
			commandId: string,
			expectedRevision: number,
			next: WalletOperationRecord,
		): Promise<WalletOperationRecord> {
			return this.decorate(await this.inner.compareAndSet(commandId, expectedRevision, next))
		}
	}

	// (a) RULE 1: unknown top-level keys are STRIPPED, not rejected — a store's own bookkeeping is benign.
	test('a store decorating every returned record still succeeds, emitting exactly the declared snapshot keys', async () => {
		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new DecoratingWalletOperationStore(),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const input = command('decorated-record', 'auctions', 'bid-lock')

		const run = await host.run(input)
		expect(Object.keys(run).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(run)).not.toMatch(/_key|_indexedAt/)

		const got = (await host.get(input.commandId)) as WalletOperationSnapshot
		expect(Object.keys(got).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)

		const listed = await host.list()
		expect(listed).toHaveLength(1)
		for (const entry of listed) expect(Object.keys(entry).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
	})

	// (b) RULE 2: a declared field carrying a malformed value FAILS CLOSED, naming the field; nothing rides out.
	test('a declared field carrying a malformed value fails closed, naming the field', async () => {
		const feeHost = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new OverridingWalletOperationStore(
				(record) =>
					({
						...record,
						fee: { seed: 'FEE_SEED_X', proofs: ['FEE_PROOF_X'], token: 'FEE_TOKEN_X' },
					}) as unknown as WalletOperationRecord,
			),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const feeRejection = await feeHost.run(command('fee-object', 'auctions', 'bid-lock')).then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(feeRejection).toBeInstanceOf(WalletConfigurationError)
		expect((feeRejection as Error).message).toContain('fee')
		expect((feeRejection as Error).message).not.toContain('FEE_SEED_X')

		const planHost = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new OverridingWalletOperationStore(
				(record) =>
					({
						...record,
						plan: [{ seed: 'PLAN_SEED_X', proofs: ['PLAN_PROOF_X'] }],
					}) as unknown as WalletOperationRecord,
			),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const planRejection = await planHost.run(command('plan-object', 'auctions', 'bid-lock')).then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(planRejection).toBeInstanceOf(WalletConfigurationError)
		expect((planRejection as Error).message).toContain('plan')
		expect((planRejection as Error).message).not.toContain('PLAN_SEED_X')
	})

	// (c) balance() projects exactly the six declared states, dropping any extra runtime key.
	test('balance projects exactly the six declared states, dropping any extra runtime key', async () => {
		const noisyFactory: CocoWalletRuntimeFactory<FakeEngine> = {
			open: async (runtimeAccount) => ({
				account: runtimeAccount,
				engine: fakeEngine(),
			reconcilers: RECONCILERS_ON,
				balance: async () => ({ ...balance, seed: 7, token: 8, proofs: [1] }) as unknown as WalletBalance,
				dispose: async () => undefined,
			}),
		}
		const host = new CocoWalletHost({
			runtimeFactory: noisyFactory,
			store: new MemoryWalletOperationStore(),
			adapters: [adapter('market', 'checkout', ['attempt'])],
			now: testClock(),
		})
		const result = await host.balance(account())
		expect(Object.keys(result).sort()).toEqual(DECLARED_BALANCE_KEYS)
		expect(JSON.stringify(result)).not.toMatch(/seed|token|proofs/)
		expect(result).toEqual(balance)
	})

	// The former key-REJECTION test, reversed by RULE 1: the same hostile store now has its keys stripped.
	test('a hostile store cannot leak bearer material across the host boundary, its keys are stripped', async () => {
		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new LeakyWalletOperationStore(),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const input = command('leaky-record', 'auctions', 'bid-lock')

		// run() succeeds — the injected keys are dropped by the projection, never rejected.
		const snapshot = await host.run(input)
		expect(Object.keys(snapshot).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(snapshot)).not.toMatch(/seed|proofs|token|BEARER/i)

		// every other path that returns a store record strips them too; nothing carries the keys out.
		const got = await host.get(input.commandId)
		expect(Object.keys(got ?? {}).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(got)).not.toMatch(/seed|proofs|token|BEARER/i)

		const listed = await host.list()
		expect(listed).toHaveLength(1)
		for (const entry of listed) expect(Object.keys(entry).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)

		const recovered = await host.recover(input.commandId)
		expect(Object.keys(recovered).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(recovered)).not.toMatch(/seed|proofs|token|BEARER/i)
	})

	test('the host boundary emits exactly the declared snapshot keys on run, get, list, recover and adapter context', async () => {
		let contextOperation: WalletOperationSnapshot | undefined
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async (step, context) => {
				contextOperation = context.operation
				return {
					engineOperationId: `coco:${context.operation.commandId}`,
					fee: step === 'prepare' ? 1 : undefined,
				}
			},
		})
		const { host } = hostWith([appAdapter])
		const input = command('declared-keys', 'auctions', 'bid-lock')

		const produced: WalletOperationSnapshot[] = [
			await host.run(input),
			(await host.get(input.commandId)) as WalletOperationSnapshot,
			...(await host.list()),
			await host.recover(input.commandId),
		]
		for (const snapshot of produced) {
			expect(Object.keys(snapshot).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
			expect(JSON.stringify(snapshot)).not.toMatch(/seed|private|proof|token|witness|bearer/i)
		}
		expect(Object.keys(contextOperation ?? {}).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(contextOperation)).not.toMatch(/seed|private|proof|token|witness|bearer/i)
	})

	test('the reference store rejects stale revisions and immutable mutation', async () => {
		const store = new MemoryWalletOperationStore()
		const record: WalletOperationRecord = {
			...command('cas', 'market', 'checkout'),
			schemaVersion: 1,
			plan: ['attempt'],
			completedSteps: [],
			state: 'created',
			revision: 0,
			createdAt: 1,
			updatedAt: 1,
		}
		await store.createOrGet(record)
		await store.compareAndSet('cas', 0, { ...record, state: 'attempting', revision: 1, updatedAt: 2 })
		await expect(
			store.compareAndSet('cas', 0, { ...record, state: 'attempting', revision: 1, updatedAt: 2 }),
		).rejects.toBeInstanceOf(WalletStaleWriterError)
		await expect(
			store.compareAndSet('cas', 1, {
				...record,
				applicationId: 'other-app',
				state: 'attempted',
				revision: 2,
				updatedAt: 3,
			}),
		).rejects.toBeInstanceOf(WalletCommandConflictError)
	})
})


// The double-read (TOCTOU) boundary: a store is an injected port, so nothing it returns may be read
// more than once. Each hostile store below makes one declared field NON-IDEMPOTENT — an accessor or a
// Proxy trap that yields a benign value on the read validation sees and the payload on a later read —
// so a host that reads the same untrusted value twice validates the benign read then emits the hostile one.
describe('single-read (TOCTOU) boundary', () => {
	const PAYLOAD = { seed: 'PAY_SEED', proofs: ['PAY_PROOF'], token: 'PAY_TOKEN' }
	const LEAK = /PAY_SEED|PAY_PROOF|PAY_TOKEN/

	const DECLARED_SNAPSHOT_KEYS = [
		'account',
		'applicationId',
		'commandId',
		'complete',
		'completedSteps',
		'createdAt',
		'engineOperationId',
		'failureCode',
		'fee',
		'intentFingerprint',
		'money',
		'operationKind',
		'plan',
		'revision',
		'schemaVersion',
		'state',
		'updatedAt',
	]

	/**
	 * Replaces one declared field with a non-idempotent accessor: the first `validUntil` reads yield
	 * `validValue` (what a validator reads) and every later read yields the payload (what a projection,
	 * or the next durable write, would then read).
	 */
	const withAccessor = (
		record: WalletOperationRecord,
		field: string,
		validValue: unknown,
		validUntil = 1,
	): WalletOperationRecord => {
		let reads = 0
		const clone = { ...record } as Record<string, unknown>
		Object.defineProperty(clone, field, {
			enumerable: true,
			configurable: true,
			get() {
				reads += 1
				return reads <= validUntil ? validValue : PAYLOAD
			},
		})
		return clone as unknown as WalletOperationRecord
	}

	class AccessorFeeStore implements WalletOperationStore {
		private readonly inner = new MemoryWalletOperationStore()
		readonly writes: unknown[] = []

		private plant(record: WalletOperationRecord): WalletOperationRecord {
			return withAccessor(record, 'fee', undefined)
		}

		async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			const result = await this.inner.createOrGet(record)
			return { record: this.plant(result.record), created: result.created }
		}

		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await this.inner.get(commandId)
			return record ? this.plant(record) : null
		}

		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await this.inner.list(account)).map((record) => this.plant(record))
		}

		async compareAndSet(
			commandId: string,
			expectedRevision: number,
			next: WalletOperationRecord,
		): Promise<WalletOperationRecord> {
			this.writes.push(next)
			return this.plant(await this.inner.compareAndSet(commandId, expectedRevision, next))
		}
	}

	// (a) the store hands back a record whose `fee` is non-idempotent: the payload (if it rides out at
	// all) must never reach the caller snapshot, the adapter context, or the value handed to compareAndSet.
	test('(a) a non-idempotent `fee` accessor never lets the payload reach the snapshot, context or a write', async () => {
		let contextOperation: WalletOperationSnapshot | undefined
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async (_step, context) => {
				contextOperation = context.operation
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
		})
		const store = new AccessorFeeStore()
		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store,
			adapters: [appAdapter],
			now: testClock(),
		})

		const outcome = await host.run(command('accessor-fee', 'auctions', 'bid-lock')).then(
			(snapshot) => ({ ok: true as const, snapshot }),
			(error: unknown) => ({ ok: false as const, error }),
		)

		expect(JSON.stringify({ outcome, contextOperation, writes: store.writes })).not.toMatch(LEAK)
	})

	// (b) the same trick on a balance state: the projection read of `available` must not emit the payload.
	test('(b) a non-idempotent balance state accessor never emits the payload', async () => {
		const accessorFactory: CocoWalletRuntimeFactory<FakeEngine> = {
			open: async (runtimeAccount) => ({
				account: runtimeAccount,
				engine: fakeEngine(),
			reconcilers: RECONCILERS_ON,
				balance: async () =>
					withAccessor({ ...balance } as unknown as WalletOperationRecord, 'available', balance.available, 3) as unknown as WalletBalance,
				dispose: async () => undefined,
			}),
		}
		const host = new CocoWalletHost({
			runtimeFactory: accessorFactory,
			store: new MemoryWalletOperationStore(),
			adapters: [adapter('market', 'checkout', ['attempt'])],
			now: testClock(),
		})

		const outcome = await host.balance(account()).then(
			(result) => ({ ok: true as const, result }),
			(error: unknown) => ({ ok: false as const, error }),
		)

		expect(JSON.stringify(outcome)).not.toMatch(LEAK)
	})

	// (c) a Proxy record whose `get`/`ownKeys` traps are non-idempotent: no leak and exactly the declared keys.
	test('(c) a Proxy record with non-idempotent get/ownKeys traps leaks nothing', async () => {
		class ProxyStore implements WalletOperationStore {
			private readonly inner = new MemoryWalletOperationStore()

			private wrap(record: WalletOperationRecord): WalletOperationRecord {
				let feeReads = 0
				let keyReads = 0
				const target = { ...record } as Record<string, unknown>
				return new Proxy(target, {
					ownKeys: (held) => {
						keyReads += 1
						const keys = Reflect.ownKeys(held)
						return keyReads === 1 ? [...keys, 'seed'] : keys
					},
					get: (held, property, receiver) => {
						if (property === 'fee') {
							feeReads += 1
							return feeReads === 1 ? undefined : PAYLOAD
						}
						return Reflect.get(held, property, receiver)
					},
				}) as unknown as WalletOperationRecord
			}

			async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
				const result = await this.inner.createOrGet(record)
				return { record: this.wrap(result.record), created: result.created }
			}

			async get(commandId: string): Promise<WalletOperationRecord | null> {
				const record = await this.inner.get(commandId)
				return record ? this.wrap(record) : null
			}

			async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
				return (await this.inner.list(account)).map((record) => this.wrap(record))
			}

			async compareAndSet(
				commandId: string,
				expectedRevision: number,
				next: WalletOperationRecord,
			): Promise<WalletOperationRecord> {
				return this.wrap(await this.inner.compareAndSet(commandId, expectedRevision, next))
			}
		}

		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new ProxyStore(),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})

		const snapshot = await host.run(command('proxy-record', 'auctions', 'bid-lock'))
		expect(Object.keys(snapshot).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(snapshot)).not.toMatch(LEAK)
	})

	// (d) the value RETURNED by compareAndSet is itself untrusted. A two-step plan makes the returned record
	// read MORE THAN ONCE (once by the next step's adapter context, once by the following durable write), so a
	// non-idempotent `fee` on that return is observable: the payload would be persisted and then emitted.
	test('(d) a store whose compareAndSet returns a poisoning record leaks nothing', async () => {
		class PoisonReturnStore implements WalletOperationStore {
			private readonly inner = new MemoryWalletOperationStore()

			async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
				return this.inner.createOrGet(record)
			}

			async get(commandId: string): Promise<WalletOperationRecord | null> {
				return this.inner.get(commandId)
			}

			async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
				return this.inner.list(account)
			}

			async compareAndSet(
				commandId: string,
				expectedRevision: number,
				next: WalletOperationRecord,
			): Promise<WalletOperationRecord> {
				const stored = await this.inner.compareAndSet(commandId, expectedRevision, next)
				return withAccessor(stored, 'fee', undefined)
			}

			/** The record actually persisted, read WITHOUT the poisoning layer. */
			async durable(commandId: string): Promise<WalletOperationRecord | null> {
				return this.inner.get(commandId)
			}
		}

		const contexts: WalletOperationSnapshot[] = []
		const appAdapter = adapter('market', 'checkout', ['prepare', 'attempt'], {
			perform: async (_step, context) => {
				contexts.push(context.operation)
				// No fee on the result, so each step's update reads the CAS return's `fee` again.
				return { engineOperationId: `coco:${context.operation.commandId}` }
			},
		})
		const store = new PoisonReturnStore()
		const host = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store,
			adapters: [appAdapter],
			now: testClock(),
		})

		const snapshot = await host.run(command('poison-return', 'market', 'checkout'))
		const reread = await host.get('poison-return')
		const persisted = await store.durable('poison-return')

		expect(snapshot.fee).toBeUndefined()
		expect(reread?.fee).toBeUndefined()
		expect(persisted?.fee).toBeUndefined()
		expect(JSON.stringify({ snapshot, reread, persisted, contexts })).not.toMatch(LEAK)
	})

	// (e) the plain-object attacks still hold after the change: extra top-level keys and a store's own
	// bookkeeping keys are stripped by the field-by-field projection, never rejected and never emitted.
	test('(e) plain-object attacks still hold: injected top-level keys and bookkeeping keys are stripped', async () => {
		class PlainLeakStore implements WalletOperationStore {
			private readonly inner = new MemoryWalletOperationStore()

			private leak(record: WalletOperationRecord): WalletOperationRecord {
				return {
					...record,
					seed: 'SEED_MATERIAL',
					proofs: ['PROOF_BEARER_1'],
					token: 'TOKEN_BEARER_1',
				} as WalletOperationRecord
			}

			async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
				const result = await this.inner.createOrGet(record)
				return { record: this.leak(result.record), created: result.created }
			}

			async get(commandId: string): Promise<WalletOperationRecord | null> {
				const record = await this.inner.get(commandId)
				return record ? this.leak(record) : null
			}

			async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
				return (await this.inner.list(account)).map((record) => this.leak(record))
			}

			async compareAndSet(
				commandId: string,
				expectedRevision: number,
				next: WalletOperationRecord,
			): Promise<WalletOperationRecord> {
				return this.leak(await this.inner.compareAndSet(commandId, expectedRevision, next))
			}
		}

		class PlainDecorateStore implements WalletOperationStore {
			private readonly inner = new MemoryWalletOperationStore()

			private decorate(record: WalletOperationRecord): WalletOperationRecord {
				return { ...record, _key: 'operations:1', _indexedAt: 1_700_000_000_000 } as WalletOperationRecord
			}

			async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
				const result = await this.inner.createOrGet(record)
				return { record: this.decorate(result.record), created: result.created }
			}

			async get(commandId: string): Promise<WalletOperationRecord | null> {
				const record = await this.inner.get(commandId)
				return record ? this.decorate(record) : null
			}

			async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
				return (await this.inner.list(account)).map((record) => this.decorate(record))
			}

			async compareAndSet(
				commandId: string,
				expectedRevision: number,
				next: WalletOperationRecord,
			): Promise<WalletOperationRecord> {
				return this.decorate(await this.inner.compareAndSet(commandId, expectedRevision, next))
			}
		}

		const leakHost = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new PlainLeakStore(),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const leaked = await leakHost.run(command('plain-leak', 'auctions', 'bid-lock'))
		expect(Object.keys(leaked).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(leaked)).not.toMatch(/seed|proofs|token|BEARER/i)

		const decorateHost = new CocoWalletHost({
			runtimeFactory: new FakeRuntimeFactory(),
			store: new PlainDecorateStore(),
			adapters: [adapter('auctions', 'bid-lock', ['prepare', 'attempt'])],
			now: testClock(),
		})
		const decorated = await decorateHost.run(command('plain-decorate', 'auctions', 'bid-lock'))
		expect(Object.keys(decorated).sort()).toEqual(DECLARED_SNAPSHOT_KEYS)
		expect(JSON.stringify(decorated)).not.toMatch(/_key|_indexedAt/)
	})
})

// PART 2: every sanitization site must be load-bearing. Each test below layers a store that plants a single
// non-idempotent declared field on ONE method's returned records (benign on the reads a validator performs,
// the payload on any later read), so restoring a RAW record path at that site changes observable behaviour and
// the test fails. PART 3: the adapter's own `perform` result is the same boundary.
describe('single-read boundary: adapter result and every store site', () => {
	const CLEAN_MONEY = { mintUrl: 'https://testnut.cashu.space', unit: 'sat', amount: 21 }
	const PAY_MONEY = { mintUrl: 'PAY_MINT_URL', unit: 'PAY_UNIT', amount: 999 }
	const PAY_ENGINE_OP = 'PAY_ENGINE_OP'
	const PAY_FEE = 987654321
	const LEAK = /PAY_MINT_URL|PAY_UNIT|PAY_ENGINE_OP|987654321/

	/** One declared field read benignly at most `validUntil` times, then as `payload`. */
	const plant = (
		record: WalletOperationRecord,
		field: string,
		payload: unknown,
		validUntil = 1,
	): WalletOperationRecord => {
		const valid = (record as unknown as Record<string, unknown>)[field]
		let reads = 0
		const clone = { ...record } as Record<string, unknown>
		Object.defineProperty(clone, field, {
			enumerable: true,
			configurable: true,
			get() {
				reads += 1
				return reads <= validUntil ? valid : payload
			},
		})
		return clone as unknown as WalletOperationRecord
	}

	type Site = 'createOrGet' | 'get' | 'list' | 'compareAndSet'

	/** A store planting one non-idempotent field on the records returned from the named site(s) only. */
	class SiteStore implements WalletOperationStore {
		private readonly inner = new MemoryWalletOperationStore()
		readonly durable: WalletOperationRecord[] = []

		constructor(
			private readonly sites: readonly Site[],
			private readonly field: string,
			private readonly payload: unknown,
		) {}

		private at(site: Site, record: WalletOperationRecord): WalletOperationRecord {
			return this.sites.includes(site) ? plant(record, this.field, this.payload) : record
		}

		async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
			const result = await this.inner.createOrGet(record)
			return { record: this.at('createOrGet', result.record), created: result.created }
		}

		async get(commandId: string): Promise<WalletOperationRecord | null> {
			const record = await this.inner.get(commandId)
			return record ? this.at('get', record) : null
		}

		async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
			return (await this.inner.list(account)).map((record) => this.at('list', record))
		}

		async compareAndSet(
			commandId: string,
			expectedRevision: number,
			next: WalletOperationRecord,
		): Promise<WalletOperationRecord> {
			this.durable.push(next)
			return this.at('compareAndSet', await this.inner.compareAndSet(commandId, expectedRevision, next))
		}
	}

	// `get`: a raw projection would read the poisoned `money` a second time and emit the payload.
	test('a raw `get` path would emit a poisoned declared field; the single read prevents it', async () => {
		const store = new SiteStore(['get'], 'money', PAY_MONEY)
		const { host } = hostWith([adapter('auctions', 'bid-lock', ['prepare', 'attempt'])], store)
		await host.run(command('site-get', 'auctions', 'bid-lock'))

		const snapshot = await host.get('site-get')
		expect(snapshot?.money).toEqual(CLEAN_MONEY)
		expect(JSON.stringify(snapshot)).not.toMatch(LEAK)
	})

	// `list`: the same non-idempotent field, exercised through the collection path.
	test('a raw `list` path would emit a poisoned declared field; the single read prevents it', async () => {
		const store = new SiteStore(['list'], 'money', PAY_MONEY)
		const { host } = hostWith([adapter('auctions', 'bid-lock', ['prepare', 'attempt'])], store)
		await host.run(command('site-list', 'auctions', 'bid-lock'))

		const listed = await host.list()
		expect(listed).toHaveLength(1)
		expect(listed[0]?.money).toEqual(CLEAN_MONEY)
		expect(JSON.stringify(listed)).not.toMatch(LEAK)
	})

	// `requireRecord`: the record it hands back is read several times by the durable write, so a raw path
	// persists the payload and the caller snapshot then emits it.
	test('a raw `requireRecord` path would emit a poisoned declared field; the single read prevents it', async () => {
		const store = new SiteStore(['get'], 'money', PAY_MONEY)
		const { host } = hostWith([adapter('auctions', 'bid-lock', ['prepare', 'attempt'])], store)
		await host.advance(command('site-require', 'auctions', 'bid-lock'))

		const snapshot = await host.resume('site-require')
		expect(snapshot.money).toEqual(CLEAN_MONEY)
		expect(JSON.stringify(snapshot)).not.toMatch(LEAK)
	})

	// `claim`: the record it returns is compared against the immutable command more than once, so a raw path
	// turns a benign read into a spurious conflict and a valid command is rejected.
	test('a raw `claim` path would reject a valid command; the single read keeps it matching', async () => {
		const store = new SiteStore(['createOrGet'], 'money', PAY_MONEY)
		const { host } = hostWith([adapter('auctions', 'bid-lock', ['prepare', 'attempt'])], store)

		const snapshot = await host.run(command('site-claim', 'auctions', 'bid-lock'))
		expect(snapshot.money).toEqual(CLEAN_MONEY)
		expect(JSON.stringify(snapshot)).not.toMatch(LEAK)
	})

	// the `compareAndSet` RETURN: a two-step plan re-reads the returned record, so a poisoned return is
	// persisted; a raw return leaves the payload in the durable record.
	test('a raw `compareAndSet` return would persist a poisoned declared field; the single read prevents it', async () => {
		const store = new SiteStore(['compareAndSet'], 'fee', PAY_FEE)
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			// No fee on the result, so each step's update re-reads the CAS return's `fee`.
			perform: async (_step, context) => ({ engineOperationId: `coco:${context.operation.commandId}` }),
		})
		const { host } = hostWith([appAdapter], store)

		const snapshot = await host.run(command('site-cas', 'auctions', 'bid-lock'))
		const reread = await host.get('site-cas')
		expect(snapshot.fee).toBeUndefined()
		expect(reread?.fee).toBeUndefined()
		expect(JSON.stringify({ snapshot, reread, durable: store.durable })).not.toMatch(LEAK)
	})

	// PART 3 — the adapter's `perform` result: `engineOperationId` valid on its first read, a payload later.
	test('a step result whose engineOperationId is non-idempotent never reaches the record, snapshot or context', async () => {
		const contexts: WalletOperationSnapshot[] = []
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async (_step, context) => {
				contexts.push(context.operation)
				let reads = 0
				const result: Record<string, unknown> = {}
				Object.defineProperty(result, 'engineOperationId', {
					enumerable: true,
					configurable: true,
					get() {
						reads += 1
						return reads === 1 ? 'coco:op' : PAY_ENGINE_OP
					},
				})
				return result as WalletStepResult
			},
		})
		const store = new SiteStore([], 'engineOperationId', PAY_ENGINE_OP)
		const { host } = hostWith([appAdapter], store)

		const snapshot = await host.run(command('result-engine-op', 'auctions', 'bid-lock'))
		const reread = await host.get('result-engine-op')
		expect(snapshot.engineOperationId).toBe('coco:op')
		expect(reread?.engineOperationId).toBe('coco:op')
		expect(JSON.stringify({ snapshot, reread, contexts, durable: store.durable })).not.toMatch(LEAK)
	})

	// PART 3 — the same for `fee`.
	test('a step result whose fee is non-idempotent never reaches the record or the caller', async () => {
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare', 'attempt'], {
			perform: async () => {
				let reads = 0
				const result: Record<string, unknown> = { engineOperationId: 'coco:op' }
				Object.defineProperty(result, 'fee', {
					enumerable: true,
					configurable: true,
					get() {
						reads += 1
						return reads === 1 ? undefined : PAY_FEE
					},
				})
				return result as WalletStepResult
			},
		})
		const store = new SiteStore([], 'fee', PAY_FEE)
		const { host } = hostWith([appAdapter], store)

		const snapshot = await host.run(command('result-fee', 'auctions', 'bid-lock'))
		const reread = await host.get('result-fee')
		expect(snapshot.fee).toBeUndefined()
		expect(reread?.fee).toBeUndefined()
		expect(JSON.stringify({ snapshot, reread, durable: store.durable })).not.toMatch(LEAK)
	})

	// PART 3 — the plain case is unchanged: an ordinary `{ engineOperationId, fee }` round-trips.
	test('a plain step result with an engineOperationId and a fee round-trips unchanged', async () => {
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare'], {
			perform: async () => ({ engineOperationId: 'coco:plain', fee: 7 }),
		})
		const { host } = hostWith([appAdapter])
		const snapshot = await host.run(command('result-plain-fee', 'auctions', 'bid-lock'))
		expect(snapshot.engineOperationId).toBe('coco:plain')
		expect(snapshot.fee).toBe(7)
	})

	// PART 3 — and `fee` may be absent without becoming a persisted key.
	test('a plain step result with no fee is accepted and leaves fee unwritten', async () => {
		const appAdapter = adapter('auctions', 'bid-lock', ['prepare'], {
			perform: async () => ({ engineOperationId: 'coco:no-fee' }),
		})
		const { host, store } = hostWith([appAdapter])
		const snapshot = await host.run(command('result-no-fee', 'auctions', 'bid-lock'))
		expect(snapshot.engineOperationId).toBe('coco:no-fee')
		expect(snapshot.fee).toBeUndefined()
		expect((await store.get('result-no-fee'))?.fee).toBeUndefined()
	})

	// recover()'s result is the same boundary: a non-idempotent engineOperationId must not persist.
	test('a recovery result whose engineOperationId is non-idempotent never reaches the record or snapshot', async () => {
		let reads = 0
		const appAdapter = adapter('market', 'receive', ['attempt'], {
			perform: async () => {
				throw Object.assign(new Error('unknown'), { code: 'remote_outcome_unknown' })
			},
			recover: async () => {
				reads = 0
				const result: Record<string, unknown> = { completedSteps: ['attempt'] }
				Object.defineProperty(result, 'engineOperationId', {
					enumerable: true,
					configurable: true,
					get() {
						reads += 1
						return reads === 1 ? 'coco:recovered' : PAY_ENGINE_OP
					},
				})
				return result as never
			},
		})
		const { host } = hostWith([appAdapter])
		await expect(host.run(command('recover-engine-op', 'market', 'receive'))).rejects.toBeInstanceOf(
			WalletStepExecutionError,
		)
		const snapshot = await host.recover('recover-engine-op')
		expect(snapshot.engineOperationId).toBe('coco:recovered')
		expect(JSON.stringify(snapshot)).not.toMatch(LEAK)
	})
})
