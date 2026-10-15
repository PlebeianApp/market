/**
 * bolt11-wrapper/ts/memory.ts — the test-only in-memory leg store.
 *
 * Test support, out of contract: it mints no statement and cites `#0dc3ca` only as provenance — it
 * implements the leg-store contract that statement declares. Production composers provide a durable atomic
 * compare-and-set store; this one exists so the conformance suite can drive the port with no store of its
 * own and no live network.
 */
import { Bolt11WrapperError } from './errors'
import type { Bolt11LegKey, Bolt11LegRecord, Bolt11LegStore } from './types'

const copy = (record: Bolt11LegRecord): Bolt11LegRecord => ({
	...record,
	operations: [...record.operations] as Bolt11LegRecord['operations'],
	plan: [...record.plan],
	witness: record.witness ? { ...record.witness } : undefined,
})

const keyOf = (key: Bolt11LegKey): string => `${key.wrapperId}\u0000${key.legId}`

const sameKey = (record: Bolt11LegRecord, key: Bolt11LegKey): boolean =>
	record.wrapperId === key.wrapperId && record.legId === key.legId

const sameImmutableIdentity = (left: Bolt11LegRecord, right: Bolt11LegRecord): boolean =>
	left.wrapperId === right.wrapperId &&
	left.legId === right.legId &&
	left.kind === right.kind &&
	left.method === right.method &&
	left.bolt11 === right.bolt11 &&
	left.paymentHash === right.paymentHash &&
	left.createdAt === right.createdAt

/** `#0dc3ca` MemoryBolt11LegStore — a test-only leg store keyed per wrapper and leg, with a revision CAS. */
export class MemoryBolt11LegStore implements Bolt11LegStore {
	private readonly records = new Map<string, Bolt11LegRecord>()

	async createOrGet(record: Bolt11LegRecord): Promise<{ record: Bolt11LegRecord; created: boolean }> {
		const current = this.records.get(keyOf(record))
		if (current) return { record: copy(current), created: false }
		this.records.set(keyOf(record), copy(record))
		return { record: copy(record), created: true }
	}

	async get(key: Bolt11LegKey): Promise<Bolt11LegRecord | null> {
		const record = this.records.get(keyOf(key))
		return record ? copy(record) : null
	}

	async list(wrapperId?: string): Promise<readonly Bolt11LegRecord[]> {
		return [...this.records.values()]
			.filter((record) => !wrapperId || record.wrapperId === wrapperId)
			.map(copy)
	}

	async compareAndSet(
		key: Bolt11LegKey,
		expectedRevision: number,
		next: Bolt11LegRecord,
	): Promise<Bolt11LegRecord> {
		const current = this.records.get(keyOf(key))
		if (!current || current.revision !== expectedRevision) {
			throw new Bolt11WrapperError('bolt11_stale_writer', `leg ${key.wrapperId}/${key.legId} is stale`)
		}
		if (!sameKey(next, key) || !sameImmutableIdentity(current, next)) {
			throw new Bolt11WrapperError('bolt11_command_conflict', `leg ${key.wrapperId}/${key.legId} changed intent`)
		}
		if (next.revision !== expectedRevision + 1) {
			throw new Bolt11WrapperError('bolt11_stale_writer', `leg ${key.wrapperId}/${key.legId} is stale`)
		}
		this.records.set(keyOf(key), copy(next))
		return copy(next)
	}
}
