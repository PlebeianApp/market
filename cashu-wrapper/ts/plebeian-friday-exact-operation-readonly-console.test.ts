import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL(
	'../../deploy/sidequest-mvp/diagnostics/plebeian-friday-exact-operation-readonly-console.js',
	import.meta.url,
), 'utf8')

const actor = '558ea655bffa18113913c8af8f73c7a4b790c239556f7577b03c29040b63f37b'
const operationId = '2ca379e28fcfb2f2f12770e3f8257395633bd99b73a4c7d5fb2d64dcfa0fa1e2'
const auctionId = 'auction-1794437139881'
const environmentId = 'friday-blue'
const identityKey = `${environmentId}\u0000${actor}\u0000${operationId}`
const cocoName = `plebeian-friday-coco-${environmentId}-${actor}`

type Fixture = {
	origin?: string
	publicActor?: string
	publicState?: unknown
	operation?: unknown
	abortPresent?: boolean
	proofReservationCount?: number
	missingDatabase?: 'private' | 'coco'
	raceMissingDatabase?: 'private' | 'coco'
}

function publicState(publicActor = actor) {
	return {
		schema: 'PLEBEIAN_FRIDAY_BROWSER_PUBLIC_STATE_V2',
		pendingBids: [{ schema: 'PLEBEIAN_FRIDAY_BROWSER_PENDING_BID_V1', actor: publicActor,
			environmentId, sellerActor: 'a'.repeat(64), auctionId, fundingOperationId: operationId,
			bidAmount: 111, fullPoolAmount: 111, reservedPoolAmount: 111, replacesBidId: '',
			locktime: 1_794_437_800, expiresAt: 1_794_437_500 }],
		sellerOperations: [], pendingFaucets: [],
	}
}

function operation() {
	return { schema: 'PLEBEIAN_FRIDAY_BROWSER_PAYMENT_OPERATION_V1', actor, environmentId,
		fundingOperationId: operationId, auctionId, phase: 'envelope_prepared' }
}

function successfulRequest<T>(value: T): IDBRequest<T> {
	const request = { result: value } as IDBRequest<T>
	queueMicrotask(() => request.onsuccess?.(new Event('success')))
	return request
}

function database(
	name: string,
	version: number,
	fixture: Fixture,
	modes: string[],
) {
	const stores = name === 'plebeian-friday-browser-private-v1'
		? ['operations', 'funding-aborts'] : ['coco_cashu_proofs']
	return {
		name, version,
		objectStoreNames: { contains: (store: string) => stores.includes(store) },
		transaction(storeNames: string | string[], mode: string) {
			modes.push(mode)
			if (mode !== 'readonly') throw new Error('forbidden write transaction')
			const allowed = Array.isArray(storeNames) ? storeNames : [storeNames]
			return {
				objectStore(storeName: string) {
					if (!allowed.includes(storeName) || !stores.includes(storeName)) throw new Error('unexpected store')
					if (storeName === 'operations') return {
						get(key: string) {
							expect(key).toBe(identityKey)
							return successfulRequest(fixture.operation)
						},
					}
					if (storeName === 'funding-aborts') return {
						getKey(key: string) {
							expect(key).toBe(identityKey)
							return successfulRequest(fixture.abortPresent ? identityKey : undefined)
						},
					}
					return {
						indexNames: { contains: (index: string) => index === 'usedByOperationId' },
						index(index: string) {
							expect(index).toBe('usedByOperationId')
							return { count(key: string) {
								expect(key).toBe(operationId)
								return successfulRequest(fixture.proofReservationCount ?? 0)
							} }
						},
					}
				},
			}
		},
		close() {},
	}
}

async function run(fixtureValue: Fixture = {}) {
	const fixture: Fixture = { operation: operation(), proofReservationCount: 2, ...fixtureValue }
	const modes: string[] = [], networkCalls: string[] = []
	let localStorageWrites = 0, abortedUpgrade = false
	const privateMissing = fixture.missingDatabase === 'private'
	const cocoMissing = fixture.missingDatabase === 'coco'
	const catalog = [
		...privateMissing ? [] : [{ name: 'plebeian-friday-browser-private-v1', version: 3 }],
		...cocoMissing ? [] : [{ name: cocoName, version: 360 }],
	]
	const databases = new Map<string, ReturnType<typeof database>>([
		['plebeian-friday-browser-private-v1', database('plebeian-friday-browser-private-v1', 3, fixture, modes)],
		[cocoName, database(cocoName, 360, fixture, modes)],
	])
	const output = await new Promise<{ kind: 'result' | 'failure'; args: unknown[] }>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('diagnostic did not finish')), 1_000)
		const finish = (kind: 'result' | 'failure', args: unknown[]) => {
			clearTimeout(timer); resolve({ kind, args })
		}
		const context = {
			location: { origin: fixture.origin ?? 'https://139.162.161.233' },
			localStorage: {
				getItem(key: string) {
					expect(key).toBe('plebeian-friday-browser-public-operations-v1')
					return JSON.stringify(fixture.publicState ?? publicState(fixture.publicActor))
				},
				setItem() { localStorageWrites += 1; throw new Error('forbidden localStorage write') },
			},
			indexedDB: {
				async databases() { return structuredClone(catalog) },
				open(name: string) {
					const request = {} as IDBOpenDBRequest
					queueMicrotask(() => {
						const raceMissing = (fixture.raceMissingDatabase === 'private' && name === 'plebeian-friday-browser-private-v1')
							|| (fixture.raceMissingDatabase === 'coco' && name === cocoName)
						const held = raceMissing ? undefined : databases.get(name)
						if (held === undefined) {
							Object.defineProperty(request, 'transaction', { value: { abort() { abortedUpgrade = true } } })
							request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
							Object.defineProperty(request, 'error', { value: new Error('aborted') })
							request.onerror?.(new Event('error'))
							return
						}
						Object.defineProperty(request, 'result', { value: held })
						request.onsuccess?.(new Event('success'))
					})
					return request
				},
			},
			console: {
				log: (...args: unknown[]) => finish('result', args),
				error: (...args: unknown[]) => finish('failure', args),
			},
			fetch: () => { networkCalls.push('fetch'); throw new Error('forbidden network') },
			WebSocket: function () { networkCalls.push('WebSocket'); throw new Error('forbidden network') },
			XMLHttpRequest: function () { networkCalls.push('XMLHttpRequest'); throw new Error('forbidden network') },
			EventSource: function () { networkCalls.push('EventSource'); throw new Error('forbidden network') },
			navigator: { sendBeacon() { networkCalls.push('sendBeacon'); throw new Error('forbidden network') } },
		}
		runInNewContext(source, context)
	})
	return { output, modes, networkCalls, localStorageWrites, abortedUpgrade }
}

test('reports only redacted exact-operation status from read-only stores', async () => {
	const held = await run({ abortPresent: true, proofReservationCount: 3 })
	expect(held.output.kind).toBe('result')
	expect(held.output.args).toEqual(['PLEBEIAN_READ_ONLY_DIAGNOSTIC_RESULT', {
		schema: 'PLEBEIAN_FRIDAY_EXACT_OPERATION_DIAGNOSTIC_V1', originMatch: true,
		publicIntentPresent: true, localActorMatch: true, localEnvironmentMatch: true,
		operationPresent: true, operationPhase: 'envelope_prepared',
		proofOperationLinkCount: 3, fundingAbortJournalPresent: true,
	}])
	expect(held.modes).toEqual(['readonly', 'readonly'])
	expect(held.networkCalls).toEqual([])
	expect(held.localStorageWrites).toBe(0)
})

test('reports an absent private operation without inventing identity matches', async () => {
	const held = await run({ operation: undefined, proofReservationCount: 0 })
	expect(held.output.kind).toBe('result')
	expect(held.output.args[1]).toMatchObject({ operationPresent: false, operationPhase: null,
		localActorMatch: null, localEnvironmentMatch: null, proofOperationLinkCount: 0 })
})

test('fails closed for another actor before opening any database', async () => {
	const held = await run({ publicActor: 'b'.repeat(64) })
	expect(held.output.kind).toBe('failure')
	expect(held.output.args[1]).toMatchObject({ message: expect.stringContaining('identity differs') })
	expect(held.modes).toEqual([])
})

test('fails closed for malformed public state', async () => {
	const held = await run({ publicState: { schema: 'wrong', pendingBids: [] } })
	expect(held.output.kind).toBe('failure')
	expect(held.output.args[1]).toMatchObject({ message: expect.stringContaining('schema differs') })
	expect(held.modes).toEqual([])
})

test('does not open an absent database and aborts a deletion race without creation', async () => {
	const absent = await run({ missingDatabase: 'private' })
	expect(absent.output.kind).toBe('failure')
	expect(absent.output.args[1]).toMatchObject({ message: expect.stringContaining('no database was opened') })
	expect(absent.abortedUpgrade).toBe(false)
	const raced = await run({ raceMissingDatabase: 'private' })
	expect(raced.output.kind).toBe('failure')
	expect(raced.output.args[1]).toMatchObject({ message: expect.stringContaining('attempt was aborted') })
	expect(raced.abortedUpgrade).toBe(true)
})

test('contains no storage writer, network request, or secret-output vocabulary', () => {
	expect(source).not.toMatch(/\.put\s*\(|\.add\s*\(|\.delete\s*\(|\.clear\s*\(|deleteDatabase\s*\(/)
	expect(source).not.toMatch(/\bfetch\s*\(|new\s+WebSocket\b|XMLHttpRequest|EventSource|sendBeacon/)
	expect(source).not.toMatch(/paymentSecret|refundSecret|\bsecret\b|\btoken\b|\bsignature\b|\benvelope\b/)
})
