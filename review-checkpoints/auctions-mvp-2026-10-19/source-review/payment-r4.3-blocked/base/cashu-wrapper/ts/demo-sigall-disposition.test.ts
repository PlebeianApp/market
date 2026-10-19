import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'

import {
	executeDemoSigAllDisposition,
	type DemoCertifiedDispositionAssertionPort,
} from './demo-sigall-disposition'
import {
	buildDemoSigAllSecret,
	createFourOfFourCommitteePort,
	demoCashuSigAllDigest,
	demoDenominationKeyDigest,
	demoSigAllPackageDigest,
	type DemoFrostParticipantPort,
	type DemoFourOfFourCommitteePort,
	type DemoParticipantId,
	type DemoSigAllContract,
	type DemoSigAllMintPort,
} from './demo-sigall-settlement'
import {
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
	type DemoRecipientRoleBindingPort,
} from './demo-sigall-recipient'
import type { DemoSigAllRecoveryRecord, DemoSigAllRecoveryStore } from './demo-sigall-recovery'
import { proofPoint, type BlindedSignature } from './nut-client'

const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (privateKey: string): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true))
const sign = (digest: string, privateKey: string): string => bytesToHex(schnorr.sign(
	hexToBytes(digest),
	hexToBytes(privateKey),
	new Uint8Array(32),
))
const digest = (byte: string): string => byte.repeat(64)
const proofY = (secret: string): string => bytesToHex(proofPoint({ secret }).toBytes(true))

const BIDDER_PRIVATE = scalar(1)
const ACTOR_PRIVATE = scalar(2)
const BIDDER_PUBLIC = publicKey(BIDDER_PRIVATE)
const ACTOR_ID = publicKey(ACTOR_PRIVATE).slice(2)
const COMMITTEE_PRIVATE = scalar(3)
const COMMITTEE_PUBLIC = publicKey(COMMITTEE_PRIVATE)
const REFUND_PRIVATE = scalar(4)
const REFUND_PUBLIC = publicKey(REFUND_PRIVATE)
const SELLER_XPUB = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42)).publicExtendedKey
const KEYSET: DemoRecipientKeyset = { id: 'demo-keyset', unit: 'sat', keys: { '12': publicKey(scalar(90)) } }

class PrivateJournal implements DemoRecipientPrivateJournalPort<string> {
	private record: DemoRecipientPrivateRecord<string> | null = null

	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async load(_scope: string): Promise<DemoRecipientPrivateRecord<string> | null> { return this.record === null ? null : structuredClone(this.record) }
	async savePrepared(_scope: string, record: DemoRecipientPrivateRecord<string>): Promise<void> { this.record = structuredClone(record) }
	async markImported(_scope: string, requestDigest: string, responseDigest: string): Promise<void> {
		if (this.record === null || this.record.requestDigest !== requestDigest) throw new Error('journal conflict')
		this.record.importedResponseDigest = responseDigest
	}
}

function durableStore(rows = new Map<string, DemoSigAllRecoveryRecord>()): DemoSigAllRecoveryStore {
	return {
		async createOrGet(record) {
			const existing = rows.get(record.scope)
			if (existing !== undefined) return { record: structuredClone(existing), created: false }
			rows.set(record.scope, structuredClone(record))
			return { record: structuredClone(record), created: true }
		},
		async read(scope) {
			const existing = rows.get(scope)
			return existing === undefined ? null : structuredClone(existing)
		},
		async compareAndSwap(scope, expectedRevision, next) {
			const existing = rows.get(scope)
			if (existing === undefined || existing.revision !== expectedRevision || next.revision !== expectedRevision + 1) return false
			rows.set(scope, structuredClone(next))
			return true
		},
	}
}

function roleBinding(counters: { winner: number; refund: number }): DemoRecipientRoleBindingPort {
	return {
		async assertWinnerRecipient() { counters.winner += 1 },
		async assertRefundRecipient() { counters.refund += 1 },
	}
}

const participants = [1, 2, 3, 4].map((identifier) => ({
	identifier: identifier as DemoParticipantId,
	verifyingShare: publicKey(scalar(10 + identifier)),
})) as DemoSigAllContract['participants']

function committee(events: string[], options: { withhold?: boolean; signingCalls: { value: number }; observedPublic?: string[] }): DemoFourOfFourCommitteePort {
	let announced = false
	const ports = [1, 2, 3, 4].map((identifier): DemoFrostParticipantPort => ({
		participantId: identifier as DemoParticipantId,
		verifyingShare: participants[identifier - 1].verifyingShare,
		async roundOne(request) {
			options.observedPublic?.push(JSON.stringify(request))
			options.signingCalls.value += 1
			if (!announced) { events.push('committee'); announced = true }
			return {
				participantId: identifier as DemoParticipantId,
				sessionId: request.sessionId,
				digest: request.digest,
				hiding: publicKey(scalar(30 + identifier)),
				binding: publicKey(scalar(40 + identifier)),
			}
		},
		async roundTwo(request) {
			options.observedPublic?.push(JSON.stringify(request))
			options.signingCalls.value += 1
			if (options.withhold === true && identifier === 4) throw new Error('validator 4 withheld')
			return {
				participantId: identifier as DemoParticipantId,
				sessionId: request.sessionId,
				digest: request.digest,
				transcriptHash: request.transcriptHash,
				share: scalar(50 + identifier),
			}
		},
	}))
	return createFourOfFourCommitteePort(ports, {
		async aggregate(request) { return { transcriptHash: request.transcriptHash, signature: sign(request.digest, COMMITTEE_PRIVATE) } },
	})
}

function intent(): DemoRecipientIntent {
	return {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1',
		network: 'demo-testnet',
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: 'refund-bid-7',
		role: 'refund',
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		recipientPublicKey: REFUND_PUBLIC,
		amounts: [12],
	}
}

async function fixture() {
	const journal = new PrivateJournal()
	const prepared = await prepareDemoSigAllRecipientOutputs({
		intent: intent(),
		keyset: KEYSET,
		roleBinding: roleBinding({ winner: 0, refund: 0 }),
		signer: { async signCapability(request) { return sign(request.digest, REFUND_PRIVATE) } },
		outputFactory: {
			async createRecipientOwnedOutput(request) {
				return {
					message: { amount: request.amount, id: request.keysetId, B_: publicKey(scalar(70 + request.index)) },
					privateOpeningRef: `private-opening-${request.index}`,
				}
			},
		},
		journal,
	})
	const input = {
		amount: 12,
		id: KEYSET.id,
		secret: buildDemoSigAllSecret({
			nonce: digest('a'),
			bidderPublicKey: BIDDER_PUBLIC,
			committeePublicKey: COMMITTEE_PUBLIC,
			locktime: 2_000_000_000,
			refundPublicKey: REFUND_PUBLIC,
		}),
		C: publicKey(scalar(80)),
	}
	const contract: DemoSigAllContract = {
		schema: 'COCO_DEMO_SIGALL_CONTRACT_V1',
		network: intent().network,
		chainId: intent().chainId,
		auctionId: intent().auctionId,
		operationId: intent().operationId,
		bidId: 'bid-7',
		bidEventId: digest('7'),
		bidderActorId: ACTOR_ID,
		role: 'refund',
		outcomeHeight: 42,
		appStateHash: digest('5'),
		amount: 12,
		inputFee: 0,
		mintUrl: intent().mintUrl,
		unit: 'sat',
		sellerP2pkXpub: SELLER_XPUB,
		bidderDerivationPath: 'm/1/2/3/4/5',
		recipientPublicKey: REFUND_PUBLIC,
		mintSeal: {
			mintUrl: intent().mintUrl,
			mintPublicKey: publicKey(scalar(91)),
			serverVersion: 'test/1',
			activeSatKeysetId: KEYSET.id,
			denominationKeyDigest: demoDenominationKeyDigest(KEYSET.keys),
			denominationAmounts: [12],
			inputFeePpk: 0,
			nuts: [4, 7, 9, 10, 11],
		},
		inputs: [input],
		outputs: prepared.outputs,
		bidderPublicKey: BIDDER_PUBLIC,
		committeePublicKey: COMMITTEE_PUBLIC,
		committeeKeysetId: 'committee-keyset',
		committeeKeysetVersion: '1',
		threshold: 4,
		participants,
		recipientCapability: prepared.capability,
		approval: {
			schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1',
			packageDigest: digest('0'),
			cashuSigAllDigest: digest('0'),
			actorPackageSignature: '00'.repeat(64),
			packageSignature: '00'.repeat(64),
			cashuSignature: '00'.repeat(64),
		},
	}
	const packageDigest = demoSigAllPackageDigest(contract)
	const cashuDigest = demoCashuSigAllDigest(contract.inputs, contract.outputs)
	contract.approval = {
		schema: 'COCO_DEMO_SIGALL_BIDDER_APPROVAL_V1',
		packageDigest,
		cashuSigAllDigest: cashuDigest,
		actorPackageSignature: sign(packageDigest, ACTOR_PRIVATE),
		packageSignature: sign(packageDigest, BIDDER_PRIVATE),
		cashuSignature: sign(cashuDigest, BIDDER_PRIVATE),
	}
	return { contract, journal }
}

const mintSignatures = (): BlindedSignature[] => [{ amount: 12, id: KEYSET.id, C_: publicKey(scalar(95)) }]
const gate = { async runExclusive<T>(_scope: string, _root: string, run: () => Promise<T>): Promise<T> { return run() } }

function certified(events: string[], reject = false): DemoCertifiedDispositionAssertionPort {
	return {
		async assertCertifiedDisposition(assertion) {
			events.push('certified')
			expect(assertion).toMatchObject({ operationId: 'refund-bid-7', role: 'refund', outcomeHeight: 42, amount: 12 })
			if (reject) throw new Error('closure certificate rejected')
		},
	}
}

function recipientPorts(journal: PrivateJournal, imports: { calls: number; applies: number; failNext?: boolean }) {
	const bindingCounters = { winner: 0, refund: 0 }
	return {
		intent: intent(),
		keyset: KEYSET,
		roleBinding: roleBinding(bindingCounters),
		unblinder: { async unblindExact() { return { opaqueUnblinded: true } } },
		verifier: { async verifyExact() { return { opaqueVerified: true } } },
		wallet: {
			async importVerified() {
				imports.calls += 1
				if (imports.failNext === true) { imports.failNext = false; throw new Error('delivery crash') }
				imports.applies += 1
			},
		},
		journal,
		bindingCounters,
	}
}

describe('certified durable SIG_ALL disposition composition', () => {
	test('certified closure precedes committee authorization and the recipient imports the exact response', async () => {
		const { contract, journal } = await fixture()
		const events: string[] = []
		const signingCalls = { value: 0 }
		let mintCalls = 0
		const imports = { calls: 0, applies: 0 }
		const recipient = recipientPorts(journal, imports)
		const result = await executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: certified(events),
			committee: committee(events, { signingCalls }),
			operationGate: gate,
			mint: { async swapExact() { events.push('mint'); mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { throw new Error('not a replay') } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient,
		})
		expect(events.indexOf('certified')).toBeLessThan(events.indexOf('committee'))
		expect(result).toMatchObject({ deliverySource: 'submitted', recipient: { imported: true, alreadyImported: false, amount: 12 } })
		expect(mintCalls).toBe(1)
		expect(imports).toEqual({ calls: 1, applies: 1 })
	})

	test('post-locktime restart restores a pre-locktime terminal response without committee or second swap', async () => {
		const { contract, journal } = await fixture()
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const imports = { calls: 0, applies: 0, failNext: true }
		const firstSigningCalls = { value: 0 }
		const replaySigningCalls = { value: 0 }
		let mintCalls = 0
		let restoreCalls = 0
		let clock = 1_999_999_900
		const mint: DemoSigAllMintPort = { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } }
		const common = {
			contract,
			certifiedDisposition: certified([]),
			operationGate: gate,
			mint,
			recoveryStore: durableStore(rows),
			terminalResponse: { async restoreCompleted() { restoreCalls += 1; return { signatures: mintSignatures() } } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			nowSeconds: () => clock,
		}
		await expect(executeDemoSigAllDisposition({
			...common,
			committee: committee([], { signingCalls: firstSigningCalls }),
			recipient: recipientPorts(journal, imports),
		})).rejects.toThrow('delivery crash')
		clock = 2_000_000_001
		const result = await executeDemoSigAllDisposition({
			...common,
			committee: committee([], { signingCalls: replaySigningCalls }),
			recipient: recipientPorts(journal, imports),
		})
		expect(result.deliverySource).toBe('terminal_restore')
		expect(result.recipient.imported).toBe(true)
		expect(mintCalls).toBe(1)
		expect(restoreCalls).toBe(1)
		expect(firstSigningCalls.value).toBe(8)
		expect(replaySigningCalls.value).toBe(0)
		expect(imports.applies).toBe(1)
	})

	test('a terminal committed after the initial read is restored when the second process reaches the cutoff', async () => {
		const { contract, journal } = await fixture()
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const backing = durableStore(rows)
		const imports = { calls: 0, applies: 0, failNext: true }
		let mintCalls = 0
		let clock = 1_999_999_900
		const common = {
			contract,
			certifiedDisposition: certified([]),
			operationGate: gate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			terminalResponse: { async restoreCompleted() { return { signatures: mintSignatures() } } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			nowSeconds: () => clock,
		}
		await expect(executeDemoSigAllDisposition({
			...common,
			committee: committee([], { signingCalls: { value: 0 } }),
			recoveryStore: backing,
			recipient: recipientPorts(journal, imports),
		})).rejects.toThrow('delivery crash')

		clock = 1_999_999_940
		let hideTerminalOnce = true
		const racingStore: DemoSigAllRecoveryStore = {
			createOrGet: backing.createOrGet.bind(backing),
			async read(scope) {
				if (hideTerminalOnce) { hideTerminalOnce = false; return null }
				return backing.read(scope)
			},
			compareAndSwap: backing.compareAndSwap.bind(backing),
		}
		const replaySigningCalls = { value: 0 }
		const result = await executeDemoSigAllDisposition({
			...common,
			committee: committee([], { signingCalls: replaySigningCalls }),
			recoveryStore: racingStore,
			recipient: recipientPorts(journal, imports),
		})
		expect(result.deliverySource).toBe('terminal_restore')
		expect(result.recipient.imported).toBe(true)
		expect(mintCalls).toBe(1)
		expect(replaySigningCalls.value).toBe(0)
		expect(imports.applies).toBe(1)
	})

	test('a durable terminal restore bypasses operation-gate replay and never resubmits', async () => {
		const { contract, journal } = await fixture()
		const rows = new Map<string, DemoSigAllRecoveryRecord>()
		const imports = { calls: 0, applies: 0 }
		let mintCalls = 0
		let stored: { signatures: BlindedSignature[] } | undefined
		const replayingGate = {
			async runExclusive<T>(_scope: string, _root: string, run: () => Promise<T>): Promise<T> {
				if (stored !== undefined) return structuredClone(stored) as T
				const result = await run()
				stored = structuredClone(result) as { signatures: BlindedSignature[] }
				return result
			},
		}
		const common = {
			contract,
			certifiedDisposition: certified([]),
			committee: committee([], { signingCalls: { value: 0 } }),
			operationGate: replayingGate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(rows),
			terminalResponse: { async restoreCompleted() { return { signatures: mintSignatures() } } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
		}
		await executeDemoSigAllDisposition({ ...common, recipient: recipientPorts(journal, imports) })
		const replay = await executeDemoSigAllDisposition({ ...common, recipient: recipientPorts(journal, imports) })
		expect(replay.deliverySource).toBe('terminal_restore')
		expect(replay.recipient.alreadyImported).toBe(true)
		expect(mintCalls).toBe(1)
	})

	test('a withheld fourth committee participant causes zero mint calls and zero imports', async () => {
		const { contract, journal } = await fixture()
		let mintCalls = 0
		const imports = { calls: 0, applies: 0 }
		await expect(executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: certified([]),
			committee: committee([], { withhold: true, signingCalls: { value: 0 } }),
			operationGate: gate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { return null } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient: recipientPorts(journal, imports),
		})).rejects.toThrow('DEMO_SIGALL_FOUR_OF_FOUR_UNAVAILABLE')
		expect(mintCalls).toBe(0)
		expect(imports).toEqual({ calls: 0, applies: 0 })
	})

	test('closure rejection causes zero committee signing, zero mint calls, and zero imports', async () => {
		const { contract, journal } = await fixture()
		const signingCalls = { value: 0 }
		let mintCalls = 0
		const imports = { calls: 0, applies: 0 }
		await expect(executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: certified([], true),
			committee: committee([], { signingCalls }),
			operationGate: gate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { return null } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient: recipientPorts(journal, imports),
		})).rejects.toThrow('closure certificate rejected')
		expect(signingCalls.value).toBe(0)
		expect(mintCalls).toBe(0)
		expect(imports).toEqual({ calls: 0, applies: 0 })
	})

	test('a proof-state reference not derived from the exact contract input is refused before certification or signing', async () => {
		const { contract, journal } = await fixture()
		let certifiedCalls = 0
		const signingCalls = { value: 0 }
		let mintCalls = 0
		await expect(executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: { async assertCertifiedDisposition() { certifiedCalls += 1 } },
			committee: committee([], { signingCalls }),
			operationGate: gate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { return null } },
			proofStateRefs: [publicKey(scalar(99))],
			recipient: recipientPorts(journal, { calls: 0, applies: 0 }),
		})).rejects.toMatchObject({ code: 'DEMO_DISPOSITION_PROOF_STATE_REFS' })
		expect(certifiedCalls).toBe(0)
		expect(signingCalls.value).toBe(0)
		expect(mintCalls).toBe(0)
	})

	test('rejects a same-id recipient keyset with different denomination keys before certification or spend', async () => {
		const { contract, journal } = await fixture()
		const signingCalls = { value: 0 }
		let certifiedCalls = 0
		let mintCalls = 0
		const imports = { calls: 0, applies: 0 }
		const recipient = recipientPorts(journal, imports)
		recipient.keyset = {
			...recipient.keyset,
			keys: { '12': publicKey(scalar(89)) },
		}
		await expect(executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: { async assertCertifiedDisposition() { certifiedCalls += 1 } },
			committee: committee([], { signingCalls }),
			operationGate: gate,
			mint: { async swapExact() { mintCalls += 1; return { signatures: mintSignatures() } } },
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { return null } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient,
		})).rejects.toMatchObject({ code: 'DEMO_DISPOSITION_RECIPIENT_KEYSET' })
		expect(certifiedCalls).toBe(0)
		expect(signingCalls.value).toBe(0)
		expect(mintCalls).toBe(0)
		expect(imports).toEqual({ calls: 0, applies: 0 })
	})

	test('keeps bearer proof secrets out of disposition ports and the committee authorization call', async () => {
		const { contract, journal } = await fixture()
		const publicBoundaryValues: string[] = []
		const recoveryRows = new Map<string, DemoSigAllRecoveryRecord>()
		let mintReceivedSecret = false
		await executeDemoSigAllDisposition({
			contract,
			certifiedDisposition: {
				async assertCertifiedDisposition(assertion) { publicBoundaryValues.push(JSON.stringify(assertion)) },
			},
			committee: committee([], { signingCalls: { value: 0 }, observedPublic: publicBoundaryValues }),
			operationGate: {
				async runExclusive<T>(scope: string, root: string, run: () => Promise<T>): Promise<T> {
					publicBoundaryValues.push(JSON.stringify({ scope, root }))
					return run()
				},
			},
			mint: {
				async swapExact(request) {
					mintReceivedSecret = request.inputs[0]?.secret === contract.inputs[0]?.secret
					return { signatures: mintSignatures() }
				},
			},
			recoveryStore: durableStore(recoveryRows),
			terminalResponse: { async restoreCompleted() { throw new Error('not a replay') } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient: recipientPorts(journal, { calls: 0, applies: 0 }),
		})
		for (const row of recoveryRows.values()) publicBoundaryValues.push(JSON.stringify(row))
		expect(mintReceivedSecret).toBe(true)
		const publicValues = publicBoundaryValues.join('\n')
		expect(publicValues).not.toContain(contract.inputs[0]!.secret)
		expect(publicValues).not.toContain(contract.bidderDerivationPath)
	})

	test('snapshots contract, recipient values, and port references before async certification', async () => {
		const { contract, journal } = await fixture()
		const imports = { calls: 0, applies: 0 }
		const originalRecipient = recipientPorts(journal, imports)
		let submittedOperation = ''
		let mutableOptions: Parameters<typeof executeDemoSigAllDisposition<string, { opaqueUnblinded: boolean }, { opaqueVerified: boolean }>>[0]
		mutableOptions = {
			contract,
			certifiedDisposition: {
				async assertCertifiedDisposition() {
					contract.operationId = 'mutated-contract-b'
					mutableOptions.recipient.intent.operationId = 'mutated-recipient-b'
					mutableOptions.recipient.wallet = { async importVerified() { throw new Error('swapped wallet must not run') } }
				},
			},
			committee: committee([], { signingCalls: { value: 0 } }),
			operationGate: gate,
			mint: {
				async swapExact(request) {
					submittedOperation = request.operationId
					return { signatures: mintSignatures() }
				},
			},
			recoveryStore: durableStore(),
			terminalResponse: { async restoreCompleted() { return null } },
			proofStateRefs: [proofY(contract.inputs[0]!.secret)],
			recipient: originalRecipient,
		}
		const result = await executeDemoSigAllDisposition(mutableOptions)
		expect(submittedOperation).toBe('refund-bid-7')
		expect(result.recipient.imported).toBe(true)
		expect(imports.applies).toBe(1)
	})
})
