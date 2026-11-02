import { WalletCommandConflictError, WalletStaleWriterError } from './errors'
import type { WalletAccount, WalletOperationRecord, WalletOperationStore } from './types'

const copy = (record: WalletOperationRecord): WalletOperationRecord => ({
	...record,
	account: { ...record.account },
	money: { ...record.money },
	plan: [...record.plan],
	completedSteps: [...record.completedSteps],
})

const sameAccount = (left: WalletAccount, right: WalletAccount): boolean =>
	left.accountId === right.accountId && left.environmentId === right.environmentId

const samePlan = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((step, index) => step === right[index])

const sameImmutableIdentity = (left: WalletOperationRecord, right: WalletOperationRecord): boolean =>
	left.commandId === right.commandId &&
	left.applicationId === right.applicationId &&
	left.operationKind === right.operationKind &&
	sameAccount(left.account, right.account) &&
	left.money.mintUrl === right.money.mintUrl &&
	left.money.unit === right.money.unit &&
	left.money.amount === right.money.amount &&
	left.intentFingerprint === right.intentFingerprint &&
	samePlan(left.plan, right.plan) &&
	left.createdAt === right.createdAt

/** Test/reference store. Production composers provide a durable atomic CAS implementation. */
export class MemoryWalletOperationStore implements WalletOperationStore {
	private readonly records = new Map<string, WalletOperationRecord>()

	async createOrGet(record: WalletOperationRecord): Promise<{ record: WalletOperationRecord; created: boolean }> {
		const current = this.records.get(record.commandId)
		if (current) return { record: copy(current), created: false }
		this.records.set(record.commandId, copy(record))
		return { record: copy(record), created: true }
	}

	async get(commandId: string): Promise<WalletOperationRecord | null> {
		const record = this.records.get(commandId)
		return record ? copy(record) : null
	}

	async list(account?: WalletAccount): Promise<readonly WalletOperationRecord[]> {
		return [...this.records.values()]
			.filter((record) => !account || sameAccount(record.account, account))
			.map(copy)
	}

	async compareAndSet(
		commandId: string,
		expectedRevision: number,
		next: WalletOperationRecord,
	): Promise<WalletOperationRecord> {
		const current = this.records.get(commandId)
		if (!current || current.revision !== expectedRevision) throw new WalletStaleWriterError(commandId)
		if (!sameImmutableIdentity(current, next)) throw new WalletCommandConflictError(commandId)
		if (next.revision !== expectedRevision + 1) throw new WalletStaleWriterError(commandId)
		this.records.set(commandId, copy(next))
		return copy(next)
	}
}
