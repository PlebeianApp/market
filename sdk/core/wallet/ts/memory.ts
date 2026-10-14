/**
 * wallet/ts/memory.ts — the test-only in-memory set store.
 *
 * Test support, out of contract: it mints no statement and cites `#c5418e` only as provenance — it implements the
 * set-store contract that statement declares, including the hash-to-set index and the refund index. Production
 * composers provide a durable atomic compare-and-set store; this one exists so the suite can drive the
 * aggregator with no live node, mint or wallet.
 */
import { PayAggregatorError } from './errors'
import type { SetRecord, SetStore } from './types'

const copy = (record: SetRecord): SetRecord => ({
	...record,
	legs: record.legs.map((leg) => ({
		...leg,
		operations: [...leg.operations],
		plan: [...leg.plan],
		witness: leg.witness ? { ...leg.witness } : undefined,
	})),
})

/**
 * `#c5418e` MemorySetStore — a test-only set store with a revision compare-and-set, keyed sets, the hash-to-set
 * index and the refund index. `compareAndSet` rejects any revision other than the expected one.
 */
export class MemorySetStore implements SetStore {
	private readonly records = new Map<string, SetRecord>()
	private readonly byHash = new Map<string, { setId: string; legId: string }>()
	private readonly refunds = new Map<string, string>()

	async createOrGet(record: SetRecord): Promise<{ record: SetRecord; created: boolean }> {
		const current = this.records.get(record.setId)
		if (current) return { record: copy(current), created: false }
		this.records.set(record.setId, copy(record))
		return { record: copy(record), created: true }
	}

	async get(setId: string): Promise<SetRecord | null> {
		const record = this.records.get(setId)
		return record ? copy(record) : null
	}

	async list(): Promise<readonly SetRecord[]> {
		return [...this.records.values()].map(copy)
	}

	async compareAndSet(setId: string, expectedRevision: number, next: SetRecord): Promise<SetRecord> {
		const current = this.records.get(setId)
		if (!current || current.revision !== expectedRevision) {
			throw new PayAggregatorError('pay_stale_writer', 'the set was written under another revision')
		}
		if (next.revision !== expectedRevision + 1) {
			throw new PayAggregatorError('pay_stale_writer', 'the next revision must be the expected one plus one')
		}
		this.records.set(setId, copy(next))
		return copy(next)
	}

	async claimedLegByHash(paymentHash: string): Promise<{ setId: string; legId: string } | null> {
		return this.byHash.get(paymentHash) ?? null
	}

	async claimHash(paymentHash: string, setId: string, legId: string): Promise<void> {
		const existing = this.byHash.get(paymentHash)
		if (existing && existing.setId !== setId) {
			throw new PayAggregatorError('pay_hash_claimed', 'a payment hash belongs to one leg of one set')
		}
		this.byHash.set(paymentHash, { setId, legId })
	}

	async refundForOrder(orderId: string): Promise<string | null> {
		return this.refunds.get(orderId) ?? null
	}

	async recordRefund(orderId: string, setId: string): Promise<void> {
		this.refunds.set(orderId, setId)
	}
}
