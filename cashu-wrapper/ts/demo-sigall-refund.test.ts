import { describe, expect, test } from 'bun:test'
import { Amount, verifyP2PKSpendingConditions, type Proof } from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
	type DemoRecipientRoleBindingPort,
} from './demo-sigall-recipient'
import {
	createDemoBidderLocalRefundExecutor,
	type DemoBidderLocalRefundPackage,
} from './demo-sigall-refund'
import {
	submitDemoSigAllRefundSwap,
	type DemoSigAllRecoveryRecord,
	type DemoSigAllRecoveryStore,
} from './demo-sigall-recovery'
import {
	buildDemoSigAllSecret,
	demoCashuSigAllSource,
	demoDenominationKeyDigest,
} from './demo-sigall-settlement'
import { proofPoint, type BlindedSignature } from './nut-client'

const key = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const sign = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(privateKey)))

const MAIN_PRIVATE = key(1)
const COMMITTEE_PRIVATE = key(2)
const REFUND_PRIVATE = key(3)
const MAIN_PUBLIC = publicKey(MAIN_PRIVATE)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_PRIVATE)
const REFUND_PUBLIC = publicKey(REFUND_PRIVATE)
const KEYSET = 'demo-keyset'
const KEYSET_KEYS = { '4': publicKey(key(31)) }

type OpeningRef = { secret: string; blinding: string }

class PrivateJournal implements DemoRecipientPrivateJournalPort<OpeningRef> {
	readonly rows: Map<string, DemoRecipientPrivateRecord<OpeningRef>>
	failNextMark = false

	constructor(rows = new Map<string, DemoRecipientPrivateRecord<OpeningRef>>()) {
		this.rows = rows
	}

	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async load(scope: string) { return structuredClone(this.rows.get(scope) ?? null) }
	async savePrepared(scope: string, record: DemoRecipientPrivateRecord<OpeningRef>) {
		if (this.rows.has(scope)) throw new Error('recipient journal conflict')
		this.rows.set(scope, structuredClone(record))
	}
	async markImported(scope: string, requestDigest: string, responseDigest: string) {
		if (this.failNextMark) {
			this.failNextMark = false
			throw new Error('simulated crash after wallet import')
		}
		const record = this.rows.get(scope)
		if (!record || record.requestDigest !== requestDigest) throw new Error('recipient journal root mismatch')
		record.importedResponseDigest = responseDigest
	}
}

function recoveryStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore {
	return {
		async createOrGet(record) {
			const existing = rows.get(record.scope)
			if (existing) return { record: structuredClone(existing), created: false }
			rows.set(record.scope, structuredClone(record))
			return { record: structuredClone(record), created: true }
		},
		async read(scope) { return structuredClone(rows.get(scope) ?? null) },
		async compareAndSwap(scope, expectedRevision, next) {
			const existing = rows.get(scope)
			if (!existing || existing.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
			rows.set(scope, structuredClone(next))
			return true
		},
	}
}

function roleBinding(): DemoRecipientRoleBindingPort {
	return {
		async assertWinnerRecipient() { throw new Error('refund fixture reached winner role') },
		async assertRefundRecipient(binding) {
			if (binding.role !== 'refund' || binding.recipientPublicKey !== REFUND_PUBLIC) {
				throw new Error('refund recipient mismatch')
			}
		},
	}
}

async function refundPackage(journal: PrivateJournal): Promise<DemoBidderLocalRefundPackage> {
	const recipient = await prepareDemoSigAllRecipientOutputs({
		intent: {
			schema: 'COCO_DEMO_RECIPIENT_INTENT_V1',
			network: 'demo-testnet',
			chainId: 'demo-chain',
			auctionId: 'auction-1',
			operationId: 'refund-bid-1',
			role: 'refund',
			mintUrl: 'https://testnut.example',
			unit: 'sat',
			recipientPublicKey: REFUND_PUBLIC,
			amounts: [4],
		},
		keyset: { id: KEYSET, unit: 'sat', keys: KEYSET_KEYS },
		roleBinding: roleBinding(),
		signer: {
			async signCapability(request) { return sign(request.digest, REFUND_PRIVATE) },
		},
		outputFactory: {
			async createRecipientOwnedOutput(request) {
				return {
					message: { amount: request.amount, id: request.keysetId, B_: publicKey(key(21)) },
					privateOpeningRef: { secret: 'bidder-private-secret', blinding: 'bidder-private-blinding' },
				}
			},
		},
		journal,
	})
	return {
		schema: 'COCO_DEMO_BIDDER_LOCAL_REFUND_PACKAGE_V1',
		network: recipient.capability.network,
		chainId: recipient.capability.chainId,
		auctionId: recipient.capability.auctionId,
		operationId: recipient.capability.operationId,
		mintUrl: recipient.capability.mintUrl,
		unit: 'sat',
		inputFee: 0,
		mintSeal: {
			mintUrl: recipient.capability.mintUrl,
			mintPublicKey: publicKey(key(30)),
			serverVersion: 'fixture/1',
			activeSatKeysetId: KEYSET,
			denominationKeyDigest: demoDenominationKeyDigest(KEYSET_KEYS),
			denominationAmounts: [4],
			inputFeePpk: 0,
			nuts: [4, 7, 10, 11],
		},
		inputs: [{
			amount: 4,
			id: KEYSET,
			secret: buildDemoSigAllSecret({
				nonce: 'a1'.repeat(32),
				bidderPublicKey: MAIN_PUBLIC,
				committeePublicKey: COMMITTEE_PUBLIC,
				locktime: 100,
				refundPublicKey: REFUND_PUBLIC,
			}),
			C: publicKey(key(20)),
		}],
		outputs: recipient.outputs,
		recipientCapability: recipient.capability,
	}
}

interface HarnessOptions {
	rows?: Map<string, DemoSigAllRecoveryRecord>
	journal: PrivateJournal
	nowSeconds?: number
	signerPublicKey?: string
	onMint?: (request: import('./demo-sigall-settlement').DemoSigAllSwapRequest) => Promise<{ signatures: BlindedSignature[] }>
	reconcile?: () => Promise<
		| { status: 'completed'; signatures: BlindedSignature[] }
		| { status: 'safe_to_retry'; reconciliationId: string }
		| { status: 'indeterminate'; reasonCode: string }
	>
	restore?: () => Promise<{ signatures: BlindedSignature[] } | null>
	walletFailNext?: { value: boolean }
	walletApplied?: Set<string>
	counters?: { signer: number; mint: number; walletCalls: number; walletApplies: number }
}

function harness(options: HarnessOptions) {
	const counters = options.counters ?? { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
	const walletApplied = options.walletApplied ?? new Set<string>()
	const walletFailNext = options.walletFailNext ?? { value: false }
	const rows = options.rows ?? new Map<string, DemoSigAllRecoveryRecord>()
	const defaultSignatures = [{ amount: 4, id: KEYSET, C_: publicKey(key(40)) }]
	const executor = createDemoBidderLocalRefundExecutor({
		signer: {
			publicKey: options.signerPublicKey ?? REFUND_PUBLIC,
			async signExactDigest(request) {
				counters.signer += 1
				return sign(request.digest, REFUND_PRIVATE)
			},
		},
		mint: {
			async swapExact(request) {
				counters.mint += 1
				if (options.onMint) return options.onMint(request)
				return { signatures: structuredClone(defaultSignatures) }
			},
		},
		recoveryStore: recoveryStore(rows),
		recovery: {
			async reconcileExact() {
				return options.reconcile ? options.reconcile() : { status: 'indeterminate', reasonCode: 'fixture_no_recovery' }
			},
		},
		terminalResponse: {
			async restoreCompleted() {
				return options.restore ? options.restore() : { signatures: structuredClone(defaultSignatures) }
			},
		},
		recipientKeyset: { id: KEYSET, unit: 'sat', keys: KEYSET_KEYS },
		recipientRoleBinding: roleBinding(),
		recipientUnblinder: {
			async unblindExact(request) {
				expect(request.privateOpeningRefs).toEqual([{ secret: 'bidder-private-secret', blinding: 'bidder-private-blinding' }])
				return { fixture: 'unblinded' }
			},
		},
		recipientVerifier: {
			async verifyExact(request) {
				expect(request.unblindedRef).toEqual({ fixture: 'unblinded' })
				return { fixture: 'verified' }
			},
		},
		recipientWallet: {
			async importVerified(request) {
				counters.walletCalls += 1
				if (walletFailNext.value) {
					walletFailNext.value = false
					throw new Error('simulated wallet unavailable')
				}
				if (!walletApplied.has(request.idempotencyKey)) {
					walletApplied.add(request.idempotencyKey)
					counters.walletApplies += 1
				}
			},
		},
		recipientJournal: options.journal,
		now: () => 1_000,
		nowSeconds: () => options.nowSeconds ?? 101,
	})
	return { executor, counters, rows, walletApplied, defaultSignatures }
}

describe('bidder-wallet-local distinct-key refund executor', () => {
	test('durably submits an exact expired REFUND and reports success only after recipient import', async () => {
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		let verifiedRefundWitness = false
		const instance = harness({
			journal,
			async onMint(request) {
				const witness = request.inputs[0]?.witness
				const proof: Proof = {
					amount: Amount.from(request.inputs[0]!.amount),
					id: request.inputs[0]!.id,
					secret: request.inputs[0]!.secret,
					C: request.inputs[0]!.C,
					witness,
				}
				verifiedRefundWitness = verifyP2PKSpendingConditions(
					proof,
					undefined,
					demoCashuSigAllSource(request.inputs, request.outputs),
				).success
				return { signatures: [{ amount: 4, id: KEYSET, C_: publicKey(key(40)) }] }
			},
		})
		const result = await instance.executor.refundExact(pkg)
		expect(verifiedRefundWitness).toBe(true)
		expect(result).toMatchObject({
			status: 'refunded',
			deliverySource: 'mint_response',
			recipient: { imported: true, role: 'refund', amount: 4, proofCount: 1 },
		})
		expect(instance.counters).toMatchObject({ signer: 1, mint: 1, walletCalls: 1, walletApplies: 1 })
		const serialized = JSON.stringify(result).toLowerCase()
		for (const forbidden of ['witness', 'signature', 'secret', 'blinding', 'opening', 'proofs']) {
			expect(serialized).not.toContain(forbidden)
		}
	})

	test('refuses pre-expiry, another signer, changed outputs, and a non-refund recipient before spend I/O', async () => {
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		const counters = { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
		await expect(harness({ journal, counters, nowSeconds: 99 }).executor.refundExact(pkg)).rejects.toMatchObject({ code: 'DEMO_REFUND_NOT_EXPIRED' })
		await expect(harness({ journal, counters, signerPublicKey: MAIN_PUBLIC }).executor.refundExact(pkg)).rejects.toMatchObject({ code: 'DEMO_REFUND_KEY' })
		const changed = structuredClone(pkg)
		changed.outputs[0]!.B_ = publicKey(key(22))
		await expect(harness({ journal, counters }).executor.refundExact(changed)).rejects.toMatchObject({ code: 'DEMO_REFUND_RECIPIENT' })
		const seller = structuredClone(pkg)
		seller.recipientCapability.recipientPublicKey = publicKey(key(23))
		await expect(harness({ journal, counters }).executor.refundExact(seller)).rejects.toMatchObject({ code: 'DEMO_REFUND_RECIPIENT' })
		expect(counters).toEqual({ signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 })
	})

	test('recovers a committed response after transport loss without a second mint spend', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		const counters = { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
		const completed = [{ amount: 4, id: KEYSET, C_: publicKey(key(40)) }]
		const first = harness({
			rows, journal, counters,
			async onMint() { throw new Error('response lost after commit') },
		})
		await expect(first.executor.refundExact(pkg)).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const reconstructed = harness({
			rows, journal, counters,
			async reconcile() { return { status: 'completed', signatures: completed } },
			async restore() { return { signatures: completed } },
		})
		await expect(reconstructed.executor.recoverExact(pkg)).resolves.toMatchObject({
			status: 'refunded', deliverySource: 'exact_recovery', recipient: { imported: true },
		})
		expect(counters.mint).toBe(1)
		expect(counters.walletApplies).toBe(1)
	})

	test('restores a durable terminal response after wallet-import failure without spending twice', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		const counters = { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
		const walletFailNext = { value: true }
		const first = harness({ rows, journal, counters, walletFailNext })
		await expect(first.executor.refundExact(pkg)).rejects.toThrow('simulated wallet unavailable')
		const reconstructed = harness({ rows, journal, counters, walletFailNext })
		await expect(reconstructed.executor.refundExact(pkg)).resolves.toMatchObject({
			status: 'refunded', deliverySource: 'terminal_restore', recipient: { imported: true },
		})
		expect(counters.mint).toBe(1)
		expect(counters.walletApplies).toBe(1)
	})

	test('wallet idempotency closes a crash after import but before recipient-journal completion', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const journal = new PrivateJournal()
		journal.failNextMark = true
		const pkg = await refundPackage(journal)
		const counters = { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
		const applied = new Set<string>()
		const first = harness({ rows, journal, counters, walletApplied: applied })
		await expect(first.executor.refundExact(pkg)).rejects.toThrow('simulated crash after wallet import')
		const reconstructed = harness({ rows, journal, counters, walletApplied: applied })
		await expect(reconstructed.executor.refundExact(pkg)).resolves.toMatchObject({ status: 'refunded', deliverySource: 'terminal_restore' })
		expect(counters).toMatchObject({ mint: 1, walletCalls: 2, walletApplies: 1 })
	})

	test('keeps an unavailable mint indeterminate and never reports or imports a refund', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		const counters = { signer: 0, mint: 0, walletCalls: 0, walletApplies: 0 }
		const first = harness({ rows, journal, counters, async onMint() { throw new Error('mint unavailable') } })
		await expect(first.executor.refundExact(pkg)).rejects.toMatchObject({ code: 'DEMO_SIGALL_RECOVERY_AMBIGUOUS' })
		const reconstructed = harness({
			rows, journal, counters,
			async reconcile() { return { status: 'indeterminate', reasonCode: 'mint_unreachable' } },
		})
		await expect(reconstructed.executor.recoverExact(pkg)).resolves.toEqual({ status: 'indeterminate', reasonCode: 'mint_unreachable' })
		expect(counters).toMatchObject({ mint: 1, walletCalls: 0, walletApplies: 0 })
	})

	test('post-locktime submitter rejects a one-signature MAIN witness mislabeled as refund', async () => {
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const journal = new PrivateJournal()
		const pkg = await refundPackage(journal)
		let captured: import('./demo-sigall-settlement').DemoSigAllSwapRequest | undefined
		const instance = harness({
			rows, journal,
			async onMint(request) {
				captured = structuredClone(request)
				return { signatures: [{ amount: 4, id: KEYSET, C_: publicKey(key(40)) }] }
			},
		})
		await instance.executor.refundExact(pkg)
		if (!captured) throw new Error('fixture did not capture request')
		const malicious = structuredClone(captured)
		malicious.inputs[0]!.witness = JSON.stringify({ signatures: [sign(malicious.cashuSigAllDigest, MAIN_PRIVATE)] })
		let mintCalls = 0
		await expect(submitDemoSigAllRefundSwap({
			store: recoveryStore(),
			mint: { async swapExact() { mintCalls += 1; return { signatures: [] } } },
			value: {
				scope: 'fresh\u0000scope',
				operationRoot: malicious.packageDigest,
				request: malicious,
				proofStateRefs: [bytesToHex(proofPoint(captured.inputs[0]!).toBytes(true))],
			},
			nowSeconds: () => 101,
		})).rejects.toMatchObject({ code: 'DEMO_SIGALL_REFUND_PATH' })
		expect(mintCalls).toBe(0)
	})
})
