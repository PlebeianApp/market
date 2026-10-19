import { describe, expect, test } from 'bun:test'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import {
	acceptDemoSigAllRecipientResponse,
	DemoRecipientRefusedError,
	prepareDemoSigAllRecipientOutputs,
	type DemoRecipientBlindedSignature,
	type DemoRecipientCoordinatorResponse,
	type DemoRecipientIntent,
	type DemoRecipientKeyset,
	type DemoRecipientPrivateJournalPort,
	type DemoRecipientPrivateRecord,
	type DemoRecipientRoleBindingPort,
} from './demo-sigall-recipient'
import { demoRecipientCapabilityDigest } from './demo-sigall-settlement'

const privateKey = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (value: number): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey(value)), true))
const RECIPIENT_PRIVATE = privateKey(7)
const RECIPIENT_PUBLIC = publicKey(7)

interface PrivateOpeningRef {
	secret: string
	blinding: string
}

class MemoryPrivateJournal implements DemoRecipientPrivateJournalPort<PrivateOpeningRef> {
	readonly records = new Map<string, DemoRecipientPrivateRecord<PrivateOpeningRef>>()
	failNextMark = false

	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> {
		return run()
	}

	async load(scope: string): Promise<DemoRecipientPrivateRecord<PrivateOpeningRef> | null> {
		return this.records.get(scope) ?? null
	}

	async savePrepared(scope: string, record: DemoRecipientPrivateRecord<PrivateOpeningRef>): Promise<void> {
		if (this.records.has(scope)) throw new Error('test journal conflict')
		this.records.set(scope, record)
	}

	async markImported(scope: string, requestDigest: string, responseDigest: string): Promise<void> {
		if (this.failNextMark) {
			this.failNextMark = false
			throw new Error('simulated crash before journal completion')
		}
		const record = this.records.get(scope)
		if (!record || record.requestDigest !== requestDigest) throw new Error('test journal root mismatch')
		record.importedResponseDigest = responseDigest
	}
}

function intent(role: 'winner_settlement' | 'refund' = 'winner_settlement'): DemoRecipientIntent {
	return {
		schema: 'COCO_DEMO_RECIPIENT_INTENT_V1',
		network: 'demo-testnet',
		chainId: 'demo-chain',
		auctionId: 'auction-1',
		operationId: role === 'winner_settlement' ? 'settle-bid-9' : 'refund-bid-7',
		role,
		mintUrl: 'https://testnut.example',
		unit: 'sat',
		recipientPublicKey: RECIPIENT_PUBLIC,
		amounts: [4, 8],
	}
}

const keyset: DemoRecipientKeyset = {
	id: 'demo-keyset',
	unit: 'sat',
	keys: {
		'1': publicKey(40),
		'2': publicKey(41),
		'4': publicKey(42),
		'8': publicKey(43),
	},
}

function roleBinding(expectedRecipient = RECIPIENT_PUBLIC): DemoRecipientRoleBindingPort & { winnerCalls: number; refundCalls: number } {
	return {
		winnerCalls: 0,
		refundCalls: 0,
		async assertWinnerRecipient(binding) {
			this.winnerCalls += 1
			if (binding.role !== 'winner_settlement' || binding.recipientPublicKey !== expectedRecipient) throw new Error('winner recipient mismatch')
		},
		async assertRefundRecipient(binding) {
			this.refundCalls += 1
			if (binding.role !== 'refund' || binding.recipientPublicKey !== expectedRecipient) throw new Error('refund recipient mismatch')
		},
	}
}

function signer() {
	return {
		async signCapability(request: { digest: string }) {
			return bytesToHex(schnorr.sign(hexToBytes(request.digest), hexToBytes(RECIPIENT_PRIVATE)))
		},
	}
}

function outputFactory(counter: { calls: number }) {
	return {
		async createRecipientOwnedOutput(request: { index: number; amount: number; keysetId: string }) {
			counter.calls += 1
			return {
				message: { amount: request.amount, id: request.keysetId, B_: publicKey(20 + request.index) },
				privateOpeningRef: {
					secret: `private-secret-${request.index}`,
					blinding: `private-blinding-${request.index}`,
				},
			}
		},
	}
}

function responseFor(request: Awaited<ReturnType<typeof prepareDemoSigAllRecipientOutputs>>): DemoRecipientCoordinatorResponse {
	return {
		schema: 'COCO_DEMO_RECIPIENT_RESPONSE_V1',
		operationId: request.capability.operationId,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(request.capability),
		signatures: request.outputs.map((output, index): DemoRecipientBlindedSignature => ({
			amount: output.amount,
			id: output.id,
			C_: publicKey(30 + index),
		})),
	}
}

function privatePorts(counters: { unblind: number; verify: number; walletCalls: number; walletApplies: number }, applied: Set<string>) {
	return {
		unblinder: {
			async unblindExact(request: { privateOpeningRefs: PrivateOpeningRef[] }) {
				counters.unblind += 1
				expect(request.privateOpeningRefs.map(({ secret }) => secret)).toEqual(['private-secret-0', 'private-secret-1'])
				// This is deliberately only an opaque test fixture, not simulated Cashu/DLEQ evidence.
				return { privateFinalProofFixture: 'test-only' }
			},
		},
		verifier: {
			async verifyExact(request: { unblindedRef: { privateFinalProofFixture: string } }) {
				counters.verify += 1
				expect(request.unblindedRef.privateFinalProofFixture).toBe('test-only')
				return { verifiedPrivateHandle: 'test-only' }
			},
		},
		wallet: {
			async importVerified(request: { idempotencyKey: string }) {
				counters.walletCalls += 1
				if (!applied.has(request.idempotencyKey)) {
					applied.add(request.idempotencyKey)
					counters.walletApplies += 1
				}
			},
		},
	}
}

function allKeys(value: unknown, into: string[] = []): string[] {
	if (!value || typeof value !== 'object') return into
	for (const [key, nested] of Object.entries(value)) {
		into.push(key.toLowerCase())
		allKeys(nested, into)
	}
	return into
}

describe('demo SIG_ALL recipient-private boundary', () => {
	test('rejects a non-sat intent before role, output, or journal ports', async () => {
		const selectedIntent = { ...intent(), unit: 'usd' }
		const selectedKeyset = { ...keyset, unit: 'usd' }
		const binding = roleBinding()
		const factoryCounter = { calls: 0 }
		const journal = new MemoryPrivateJournal()
		await expect(prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset: selectedKeyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory(factoryCounter),
			journal,
		})).rejects.toMatchObject({ code: 'DEMO_RECIPIENT_UNIT' })
		expect(binding.winnerCalls).toBe(0)
		expect(binding.refundCalls).toBe(0)
		expect(factoryCounter.calls).toBe(0)
		expect(journal.records.size).toBe(0)
	})

	test('public request and receipt exclude openings and bearer material while winner/refund hooks are explicit', async () => {
		const winnerJournal = new MemoryPrivateJournal()
		const winnerBinding = roleBinding()
		const factoryCounter = { calls: 0 }
		const winnerRequest = await prepareDemoSigAllRecipientOutputs({
			intent: intent('winner_settlement'),
			keyset,
			roleBinding: winnerBinding,
			signer: signer(),
			outputFactory: outputFactory(factoryCounter),
			journal: winnerJournal,
		})
		expect(winnerBinding.winnerCalls).toBe(1)
		expect(winnerBinding.refundCalls).toBe(0)
		expect(Object.keys(winnerRequest).sort()).toEqual(['capability', 'outputs'])
		expect(factoryCounter.calls).toBe(2)
		const forbidden = ['secret', 'blinding', 'opening', 'proof', 'token', 'witness', 'bearer', 'r']
		expect(allKeys(winnerRequest).filter((key) => forbidden.includes(key))).toEqual([])

		const ports = privatePorts({ unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 }, new Set())
		const receipt = await acceptDemoSigAllRecipientResponse({
			intent: intent('winner_settlement'),
			keyset,
			response: responseFor(winnerRequest),
			roleBinding: winnerBinding,
			journal: winnerJournal,
			...ports,
		})
		expect(allKeys(receipt).filter((key) => forbidden.includes(key))).toEqual([])
		expect(receipt).toMatchObject({ imported: true, alreadyImported: false, amount: 12, proofCount: 2 })

		const refundBinding = roleBinding()
		await prepareDemoSigAllRecipientOutputs({
			intent: intent('refund'),
			keyset,
			roleBinding: refundBinding,
			signer: signer(),
			outputFactory: outputFactory({ calls: 0 }),
			journal: new MemoryPrivateJournal(),
		})
		expect(refundBinding.winnerCalls).toBe(0)
		expect(refundBinding.refundCalls).toBe(1)
	})

	test('withheld, mutated, and wrong-recipient responses are refused before unblinding or import', async () => {
		const journal = new MemoryPrivateJournal()
		const selectedIntent = intent()
		const binding = roleBinding()
		const request = await prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory({ calls: 0 }),
			journal,
		})
		const counters = { unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 }
		const ports = privatePorts(counters, new Set())
		const exact = responseFor(request)

		const withheld = { ...exact, signatures: exact.signatures.slice(0, 1) }
		await expect(acceptDemoSigAllRecipientResponse({ intent: selectedIntent, keyset, response: withheld, roleBinding: binding, journal, ...ports }))
			.rejects.toThrow('DEMO_RECIPIENT_RESPONSE_COUNT')

		const mutated = {
			...exact,
			signatures: exact.signatures.map((signature, index) => index === 0 ? { ...signature, amount: signature.amount + 1 } : { ...signature }),
		}
		await expect(acceptDemoSigAllRecipientResponse({ intent: selectedIntent, keyset, response: mutated, roleBinding: binding, journal, ...ports }))
			.rejects.toThrow('DEMO_RECIPIENT_RESPONSE_MUTATED')

		const wrongRecipient = { ...exact, recipientCapabilityDigest: '00'.repeat(32) }
		await expect(acceptDemoSigAllRecipientResponse({ intent: selectedIntent, keyset, response: wrongRecipient, roleBinding: binding, journal, ...ports }))
			.rejects.toThrow('DEMO_RECIPIENT_WRONG_RECIPIENT')
		expect(counters).toEqual({ unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 })
	})

	test('preparation and successful delivery are restart-safe and idempotent', async () => {
		const journal = new MemoryPrivateJournal()
		const selectedIntent = intent()
		const binding = roleBinding()
		const firstFactory = { calls: 0 }
		const firstRequest = await prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory(firstFactory),
			journal,
		})
		const restartedFactory = { calls: 0 }
		const replayedRequest = await prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory(restartedFactory),
			journal,
		})
		expect(replayedRequest).toEqual(firstRequest)
		expect(firstFactory.calls).toBe(2)
		expect(restartedFactory.calls).toBe(0)

		const counters = { unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 }
		const applied = new Set<string>()
		const firstReceipt = await acceptDemoSigAllRecipientResponse({
			intent: selectedIntent,
			keyset,
			response: responseFor(firstRequest),
			roleBinding: binding,
			journal,
			...privatePorts(counters, applied),
		})
		const restartedReceipt = await acceptDemoSigAllRecipientResponse({
			intent: selectedIntent,
			keyset,
			response: responseFor(firstRequest),
			roleBinding: binding,
			journal,
			...privatePorts(counters, applied),
		})
		expect(firstReceipt.alreadyImported).toBe(false)
		expect(restartedReceipt.alreadyImported).toBe(true)
		expect(counters).toEqual({ unblind: 1, verify: 1, walletCalls: 1, walletApplies: 1 })
	})

	test('snapshots recipient values and ports before role and journal awaits', async () => {
		const journal = new MemoryPrivateJournal()
		const selectedIntent = intent()
		const originalFactoryCalls = { calls: 0 }
		let swappedFactoryCalls = 0
		let prepareOptions: Parameters<typeof prepareDemoSigAllRecipientOutputs<PrivateOpeningRef>>[0]
		prepareOptions = {
			intent: selectedIntent,
			keyset,
			roleBinding: {
				async assertWinnerRecipient() {
					selectedIntent.operationId = 'mutated-operation'
					prepareOptions.outputFactory = {
						async createRecipientOwnedOutput() {
							swappedFactoryCalls += 1
							throw new Error('swapped output factory must not run')
						},
					}
				},
				async assertRefundRecipient() { throw new Error('wrong role') },
			},
			signer: signer(),
			outputFactory: outputFactory(originalFactoryCalls),
			journal,
		}
		const prepared = await prepareDemoSigAllRecipientOutputs(prepareOptions)
		expect(prepared.capability.operationId).toBe('settle-bid-9')
		expect(originalFactoryCalls.calls).toBe(2)
		expect(swappedFactoryCalls).toBe(0)

		const counters = { unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 }
		const originalPorts = privatePorts(counters, new Set())
		const deliveryIntent = intent()
		const response = responseFor(prepared)
		let swappedWalletCalls = 0
		let acceptOptions: Parameters<typeof acceptDemoSigAllRecipientResponse<PrivateOpeningRef, { privateFinalProofFixture: string }, { verifiedPrivateHandle: string }>>[0]
		acceptOptions = {
			intent: deliveryIntent,
			keyset,
			response,
			roleBinding: {
				async assertWinnerRecipient() {
					deliveryIntent.operationId = 'mutated-delivery'
					response.operationId = 'mutated-response'
					acceptOptions.wallet = { async importVerified() { swappedWalletCalls += 1 } }
				},
				async assertRefundRecipient() { throw new Error('wrong role') },
			},
			journal,
			...originalPorts,
		}
		const receipt = await acceptDemoSigAllRecipientResponse(acceptOptions)
		expect(receipt.operationId).toBe('settle-bid-9')
		expect(counters.walletApplies).toBe(1)
		expect(swappedWalletCalls).toBe(0)
	})

	test('wallet idempotency survives a crash after import but before journal completion', async () => {
		const journal = new MemoryPrivateJournal()
		const selectedIntent = intent()
		const binding = roleBinding()
		const request = await prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory({ calls: 0 }),
			journal,
		})
		const counters = { unblind: 0, verify: 0, walletCalls: 0, walletApplies: 0 }
		const applied = new Set<string>()
		journal.failNextMark = true
		await expect(acceptDemoSigAllRecipientResponse({
			intent: selectedIntent,
			keyset,
			response: responseFor(request),
			roleBinding: binding,
			journal,
			...privatePorts(counters, applied),
		})).rejects.toThrow('simulated crash')

		const receipt = await acceptDemoSigAllRecipientResponse({
			intent: selectedIntent,
			keyset,
			response: responseFor(request),
			roleBinding: binding,
			journal,
			...privatePorts(counters, applied),
		})
		expect(receipt.alreadyImported).toBe(false)
		expect(counters.walletCalls).toBe(2)
		expect(counters.walletApplies).toBe(1)
	})

	test('a final-proof verifier refusal prevents wallet import', async () => {
		const journal = new MemoryPrivateJournal()
		const selectedIntent = intent()
		const binding = roleBinding()
		const request = await prepareDemoSigAllRecipientOutputs({
			intent: selectedIntent,
			keyset,
			roleBinding: binding,
			signer: signer(),
			outputFactory: outputFactory({ calls: 0 }),
			journal,
		})
		let walletCalls = 0
		await expect(acceptDemoSigAllRecipientResponse({
			intent: selectedIntent,
			keyset,
			response: responseFor(request),
			roleBinding: binding,
			journal,
			unblinder: { async unblindExact() { return { privateFixture: true } } },
			verifier: { async verifyExact() { throw new DemoRecipientRefusedError('TEST_INVALID_PROOF', 'cryptographic verifier rejected proof') } },
			wallet: { async importVerified() { walletCalls += 1 } },
		})).rejects.toThrow('TEST_INVALID_PROOF')
		expect(walletCalls).toBe(0)
	})
})
