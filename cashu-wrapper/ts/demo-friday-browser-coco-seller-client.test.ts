import { describe, expect, test } from 'bun:test'
import { createBlindSignature, createDLEQProof, pointFromHex } from '@cashu/cashu-ts'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { createDemoFridayBrowserCocoSellerClient, type DemoFridaySellerPlanRegisteredV1 } from './demo-friday-browser-coco-seller-client'
import type { DemoFridayBrowserCocoWallet } from './demo-friday-browser-coco-wallet'
import { createDemoFridayBrowserPaymentState, type DemoFridayBrowserOpeningRefV1, type DemoFridayBrowserPaymentStatePort } from './demo-friday-browser-payment-state'
import type { DemoFridaySellerWinnerPlanEnvelopeV1, DemoFridaySellerWinnerPlanChallengeV1 } from './demo-friday-browser-coco-seller-plan'
import type { DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { demoDenominationKeyDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'

const mintUrl = 'https://172.105.64.142'
const sellerSecret = hexToBytes('11'.padStart(64, '0'))
const sellerActor = bytesToHex(schnorr.getPublicKey(sellerSecret))
const recipientSecret = hexToBytes('12'.padStart(64, '0'))
const recipientPublicKey = bytesToHex(secp256k1.getPublicKey(recipientSecret, true))
const bidderActor = '33'.repeat(32)

function compressed(value: number): string {
	return bytesToHex(secp256k1.getPublicKey(hexToBytes(value.toString(16).padStart(64, '0')), true))
}

const denominations = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
const mintSecret = (amount: number) => hexToBytes((denominations.indexOf(amount) + 41).toString(16).padStart(64, '0'))
const keyset = { id: '00aabbccddeeff11', unit: 'sat' as const,
	keys: Object.fromEntries(denominations.map((amount) => [String(amount), bytesToHex(secp256k1.getPublicKey(mintSecret(amount), true))])) }

function signed(unsigned: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at, unsigned.kind, unsigned.tags, unsigned.content]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), sellerSecret)) }
}

class MemoryState {
	readonly rows = new Map<string, DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>>()
	readonly sellerAcks = new Map<string, any>()
	async runExclusive<T>(_scope: string, run: () => Promise<T>): Promise<T> { return run() }
	async runWalletExclusive<T>(_identity: { actor: string; environmentId: string }, run: () => Promise<T>, signal?: AbortSignal): Promise<T> { signal?.throwIfAborted(); return run() }
	async load(scope: string) { return structuredClone(this.rows.get(scope) ?? null) }
	async savePrepared(scope: string, record: DemoRecipientPrivateRecord<DemoFridayBrowserOpeningRefV1>) {
		const prior = this.rows.get(scope)
		if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('journal conflict')
		this.rows.set(scope, structuredClone(record))
	}
	async markImported(scope: string, requestDigest: string, responseDigest: string) {
		const prior = this.rows.get(scope)
		if (prior === undefined || prior.requestDigest !== requestDigest) throw new Error('journal record absent')
		this.rows.set(scope, { ...prior, importedResponseDigest: responseDigest })
	}
	async loadSellerTerminalAck(identity: { fundingOperationId: string }) {
		return structuredClone(this.sellerAcks.get(identity.fundingOperationId) ?? null)
	}
	async saveSellerTerminalAck(record: { fundingOperationId: string }) {
		const prior = this.sellerAcks.get(record.fundingOperationId)
		if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error('ack conflict')
		this.sellerAcks.set(record.fundingOperationId, structuredClone(record))
	}
}

function fixture(role: 'winner_settlement' | 'refund' = 'winner_settlement') {
	const controls = {
		actor: sellerActor, recipient: recipientPublicKey, now: 1_000,
		deployment: { environmentId: 'friday-browser', canonicalMintUrl: mintUrl, keyset: structuredClone(keyset) },
		mutateChallenge: (_value: DemoFridaySellerWinnerPlanChallengeV1) => {},
		afterRecipient: async () => {}, beforeNostrReturn: async () => {}, beforeRegisterReturn: async () => {}, beforeActorRead: async () => {}, beforeWalletOpen: async () => {}, beforeDispose: async () => {},
		disposals: 0, opens: 0, observedSignal: undefined as AbortSignal | undefined,
		loseRegistrationResponse: false, recipientSigns: 0, nostrSigns: 0, registrations: 0,
	}

	const state = new MemoryState()
	let registered: DemoFridaySellerPlanRegisteredV1 | null = null
	let notice: unknown = null
	let imports = 0
	const acks: unknown[] = []
	let loseAckResponse = false
	const wallet: DemoFridayBrowserCocoWallet = {
		actor: sellerActor, mintUrl, seedLocation: 'indexeddb', async inspect() { throw new Error('unused') },
		async balance() { throw new Error('unused') }, async fundFake() { throw new Error('unused') },
		async prepareThresholdFundingOperation() { throw new Error('unused') },
		async prepareThresholdFunding() { throw new Error('unused') },
		async recoverThresholdFunding() { throw new Error('unused') },
		async importTerminalToken(input) { imports += 1; return { operationId: input.operationId, state: 'finalized' as const } },
		sellerRecipientKey: {
			async getPublicKey() { return controls.recipient },
			async signRecipientCapability(value) { controls.recipientSigns += 1; await controls.afterRecipient(); return bytesToHex(schnorr.sign(hexToBytes(value.digest), recipientSecret)) },
			async signTerminalAck(value) { return bytesToHex(schnorr.sign(hexToBytes(value.digest), recipientSecret)) },
		},
		async dispose() { controls.disposals++; await controls.beforeDispose() },
	}
	const client = createDemoFridayBrowserCocoSellerClient({
		deployment: { async readExact() { return structuredClone(controls.deployment) } },
		walletFactory: { async openExact(request: { signal?: AbortSignal }) { controls.opens++; controls.observedSignal = request.signal; await controls.beforeWalletOpen(); return wallet } } as never,
		state: state as unknown as DemoFridayBrowserPaymentStatePort,
		nostr: { async getPublicKey() { await controls.beforeActorRead(); return controls.actor }, async signEvent(value) { controls.nostrSigns += 1; await controls.beforeNostrReturn(); return signed(value) } },
		plans: {
			async listPendingExact() { return [] },
			async challengeExact(request) { const value: DemoFridaySellerWinnerPlanChallengeV1 = { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_CHALLENGE_V1',
				authNetworkId: 'friday-network', chainId: 'friday-chain', auctionId: request.auctionId,
				fundingOperationId: request.fundingOperationId,
				sellerActor: request.sellerActor, sellerPaymentPublicKey: recipientPublicKey,
				bidderActor, bidAmount: 600, canonicalMintUrl: mintUrl,
				activeSatKeysetId: keyset.id, denominationKeyDigest: demoDenominationKeyDigest(keyset.keys), expiresAt: 1_200 }; controls.mutateChallenge(value); return value },
			async readExact() { return structuredClone(registered) },
			async registerExact(envelope: DemoFridaySellerWinnerPlanEnvelopeV1) {
				controls.registrations += 1
				registered = { schema: 'PLEBEIAN_FRIDAY_SELLER_WINNER_PLAN_REGISTERED_V1', status: 'registered',
					planDigest: envelope.planDigest, plan: structuredClone(envelope.plan) }
				await controls.beforeRegisterReturn()
				if (controls.loseRegistrationResponse) { controls.loseRegistrationResponse = false; throw new Error('registration response lost') }
				return structuredClone(registered)
			},
		},
		terminal: {
			async readNoticeExact() { return structuredClone(notice) },
			async acknowledgeExact(value) {
				acks.push(structuredClone(value))
				if (loseAckResponse) { loseAckResponse = false; throw new Error('ack response lost') }
			},
		},
		nowSeconds: () => controls.now,
	})
	return { client, state, controls, get registered() { return registered }, setNotice(value: unknown) { notice = value },
		get imports() { return imports }, acks, loseNextAckResponse() { loseAckResponse = true }, role }
}

describe('Friday browser Coco seller client', () => {
	test('registers only the public plan, imports a winner through Coco, and signs the exact acknowledgement', async () => {
		const held = fixture()
		const registered = await held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
		expect(registered.plan.recipientPublicKey).toBe(recipientPublicKey)
		expect(JSON.stringify(registered)).not.toContain(bytesToHex(recipientSecret))
		const row = [...held.state.rows.values()][0]!
		held.setNotice({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor: sellerActor,
			network: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', operationId: 'funding-1',
			role: 'winner_settlement', mintUrl, amount: 600,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(row.coordinatorRequest.capability),
			signatures: row.coordinatorRequest.outputs.map((output) => {
				const point = pointFromHex(output.B_), secret = mintSecret(output.amount)
				const signature = createBlindSignature(point, secret, output.id), dleq = createDLEQProof(point, secret)
				return { amount: output.amount, id: output.id, C_: signature.C_.toHex(true),
					dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) } }
			}),
		})
		const receipt = await held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
		expect(receipt).toMatchObject({ role: 'winner_settlement', recipientPublicKey, amount: 600, imported: true })
		expect(held.imports).toBe(1)
		expect(held.acks).toHaveLength(1)
		expect(JSON.stringify(held.acks[0])).not.toContain('alreadyImported')
		expect((held.acks[0] as { recipientAckSignature: string }).recipientAckSignature).toMatch(/^[0-9a-f]{128}$/)
	})

	test('rejects a refund notice without opening Coco or acknowledging it', async () => {
		const held = fixture('refund')
		await held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
		const row = [...held.state.rows.values()][0]!
		held.setNotice({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor: sellerActor,
			network: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', operationId: 'funding-1',
			role: 'refund', mintUrl, amount: 600,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(row.coordinatorRequest.capability), signatures: [{
				amount: 600, id: keyset.id, C_: compressed(99),
			}],
		})
		await expect(held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' }))
			.rejects.toThrow(/rejects non-winner/)
		expect(held.imports).toBe(0)
		expect(held.acks).toHaveLength(0)
	})

	test('persists and replays the exact winner acknowledgement after its response is lost', async () => {
		const held = fixture()
		await held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
		const row = [...held.state.rows.values()][0]!
		held.setNotice({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor: sellerActor,
			network: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', operationId: 'funding-1',
			role: 'winner_settlement', mintUrl, amount: 600,
			recipientCapabilityDigest: demoRecipientCapabilityDigest(row.coordinatorRequest.capability),
			signatures: row.coordinatorRequest.outputs.map((output) => {
				const point = pointFromHex(output.B_), secret = mintSecret(output.amount)
				const signature = createBlindSignature(point, secret, output.id), dleq = createDLEQProof(point, secret)
				return { amount: output.amount, id: output.id, C_: signature.C_.toHex(true),
					dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) } }
			}),
		})
		held.loseNextAckResponse()
		await expect(held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' }))
			.rejects.toThrow(/response lost/)
		expect(held.imports).toBe(1)
		expect(held.acks).toHaveLength(1)
		const replayed = await held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
		expect(replayed).toMatchObject({ role: 'winner_settlement', imported: true, alreadyImported: true })
		expect(held.imports).toBe(1)
		expect(held.acks).toHaveLength(2)
		expect(JSON.stringify(held.acks[1])).toBe(JSON.stringify(held.acks[0]))
	})
})


describe('seller plan consent and scope boundaries (mocked transports, real local test signatures)', () => {
	const request = { auctionId: 'auction-1', fundingOperationId: 'funding-1' }
	const changes: Record<string, (held: ReturnType<typeof fixture>) => void> = {
		actor: (held) => { held.controls.actor = bidderActor },
		deployment: (held) => { held.controls.deployment.environmentId = 'another-deployment' },
		keyset: (held) => { held.controls.deployment.keyset.id = 'another-keyset' },
		denomination: (held) => { held.controls.deployment.keyset.keys['1'] = compressed(90) },
		recipient: (held) => { held.controls.recipient = compressed(91) },
		expiry: (held) => { held.controls.now = 1_200 },
		auction: (held) => { held.controls.mutateChallenge = (value) => { value.auctionId = 'another-auction' } },
		operation: (held) => { held.controls.mutateChallenge = (value) => { value.fundingOperationId = 'another-operation' } },
		bidder: (held) => { held.controls.mutateChallenge = (value) => { value.bidderActor = '44'.repeat(32) } },
		amount: (held) => { held.controls.mutateChallenge = (value) => { value.bidAmount += 1 } },
		network: (held) => { held.controls.mutateChallenge = (value) => { value.authNetworkId = 'another-network' } },
		chain: (held) => { held.controls.mutateChallenge = (value) => { value.chainId = 'another-chain' } },
		challengeRecipient: (held) => { held.controls.mutateChallenge = (value) => { value.sellerPaymentPublicKey = compressed(92) } },
	}
	for (const [name, change] of Object.entries(changes)) {
		for (const phase of ['recipient', 'nostr'] as const) {
			test(`rejects ${name} change after ${phase} signature before registration`, async () => {
				const held = fixture()
				if (phase === 'recipient') held.controls.afterRecipient = async () => change(held)
				else held.controls.beforeNostrReturn = async () => change(held)
				await expect(held.client.prepareAndRegister(request)).rejects.toThrow(/scope changed|identity changed/)
				expect(held.controls.registrations).toBe(0)
				expect(held.controls.nostrSigns).toBe(phase === 'nostr' ? 1 : 0)
			})
		}
	}
	test('denial leaves the plan discoverable and does not register; fresh retry reuses exact outputs', async () => {
		const held = fixture()
		held.controls.beforeNostrReturn = async () => { throw new Error('user denied') }
		await expect(held.client.prepareAndRegister(request)).rejects.toThrow('user denied')
		expect(held.controls.registrations).toBe(0)
		const before = [...held.state.rows.values()].map((row) => row.coordinatorRequest)
		held.controls.beforeNostrReturn = async () => {}
		await held.client.prepareAndRegister(request)
		expect([...held.state.rows.values()].map((row) => row.coordinatorRequest)).toEqual(before)
		expect(held.controls.registrations).toBe(1)
	})
	test('cancellation releases a stalled extension prompt and discards a late signature', async () => {
		const held = fixture(), abort = new AbortController()
		let release!: () => void, entered!: () => void
		const started = new Promise<void>((resolve) => { entered = resolve })
		held.controls.beforeNostrReturn = async () => { entered(); await new Promise<void>((resolve) => { release = resolve }) }
		const pending = held.client.prepareAndRegister({ ...request, signal: abort.signal })
		await started; abort.abort()
		await expect(pending).rejects.toThrow(/cancelled/)
		release(); await new Promise((resolve) => setTimeout(resolve, 0))
		expect(held.controls.registrations).toBe(0)
	})
	test('checks fresh consent after the Nostr signature', async () => {
		const held = fixture(); let active = true
		held.controls.beforeNostrReturn = async () => { active = false }
		await expect(held.client.prepareAndRegister({ ...request, async assertActive() { if (!active) throw new Error('consent changed') } })).rejects.toThrow('consent changed')
		expect(held.controls.registrations).toBe(0)
	})
	test('lost registration response recovers the exact registered plan without another signature', async () => {
		const held = fixture(); held.controls.loseRegistrationResponse = true
		await expect(held.client.prepareAndRegister(request)).rejects.toThrow('registration response lost')
		const registered = structuredClone(held.registered)
		expect(await held.client.prepareAndRegister(request)).toEqual(registered!)
		expect(held.controls.nostrSigns).toBe(1); expect(held.controls.registrations).toBe(1)
	})
	test('rejects an altered listed challenge before any signing', async () => {
		const held = fixture()
		await expect(held.client.prepareAndRegister({ ...request, expectedChallenge: {} as never })).rejects.toThrow(/challenge changed/)
		expect(held.controls.recipientSigns).toBe(0); expect(held.controls.nostrSigns).toBe(0)
	})
})


test('unregistered seller discovery does not block passive payout recovery after a denied approval', async () => {
	const held = fixture()
	held.controls.beforeNostrReturn = async () => { throw new Error('user denied') }
	await expect(held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })).rejects.toThrow('user denied')
	expect(await held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })).toBeNull()
	expect(held.controls.nostrSigns).toBe(1); expect(held.imports).toBe(0)
})


test('cancellation while registration response is pending retains committed-plan recovery', async () => {
	const held = fixture(), abort = new AbortController()
	let release!: () => void, entered!: () => void
	const submitted = new Promise<void>((resolve) => { entered = resolve })
	held.controls.beforeRegisterReturn = async () => { entered(); await new Promise<void>((resolve) => { release = resolve }) }
	const request = { auctionId: 'auction-1', fundingOperationId: 'funding-1' }
	const pending = held.client.prepareAndRegister({ ...request, signal: abort.signal })
	await submitted; abort.abort(); await expect(pending).rejects.toThrow(/cancelled/)
	expect(held.registered).not.toBeNull(); release()
	expect(await held.client.prepareAndRegister(request)).toEqual(held.registered!)
	expect(held.controls.nostrSigns).toBe(1); expect(held.controls.registrations).toBe(1)
})

test('cancellation releases an unavailable identity read before signing', async () => {
	const held = fixture(), abort = new AbortController()
	let release!: () => void, entered!: () => void
	const started = new Promise<void>((resolve) => { entered = resolve })
	held.controls.beforeActorRead = async () => { entered(); await new Promise<void>((resolve) => { release = resolve }) }
	const pending = held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1', signal: abort.signal })
	await started; abort.abort(); await expect(pending).rejects.toThrow(/cancelled/); release()
	expect(held.controls.nostrSigns).toBe(0); expect(held.controls.registrations).toBe(0)
})

test('an expired challenge fails before recipient or Nostr signing', async () => {
	const held = fixture(); held.controls.now = 1_201
	await expect(held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })).rejects.toThrow(/expired/)
	expect(held.controls.nostrSigns).toBe(0); expect(held.controls.recipientSigns).toBe(0)
})


function gate() {
	let resolve!: () => void
	const promise = new Promise<void>((yes) => { resolve = yes })
	return { promise, resolve }
}
const progress = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Contract-level Web Locks adapter shared by two state instances (two tabs).
// Signals cancel queued acquisition, never eject a running callback's lease.
function sharedWalletLocks() {
	const tails = new Map<string, Promise<unknown>>()
	const names: string[] = []
	const locks = { request<T>(name: string, options: { mode: 'exclusive'; signal?: AbortSignal }, callback: () => Promise<T>): Promise<T> {
		names.push(name)
		const previous = tails.get(name) ?? Promise.resolve()
		const done = gate(); tails.set(name, previous.catch(() => {}).then(() => done.promise))
		return new Promise<T>((resolve, reject) => {
			let started = false
			const onAbort = () => { if (!started) reject(options.signal?.reason ?? new Error('aborted')) }
			options.signal?.addEventListener('abort', onAbort, { once: true })
			void previous.catch(() => {}).then(async () => {
				try {
					options.signal?.throwIfAborted(); started = true
					options.signal?.removeEventListener('abort', onAbort)
					resolve(await callback())
				} catch (error) { reject(error) }
				finally { options.signal?.removeEventListener('abort', onAbort); done.resolve() }
			})
		})
	} }
	const tab = () => createDemoFridayBrowserPaymentState({ locks, indexedDB: {} as IDBFactory })
	return { tab, names }
}

test('queued wallet-lease cancellation settles before a held tab releases and never opens later', async () => {
	const held = fixture(), shared = sharedWalletLocks(), tabA = shared.tab(), tabB = shared.tab(), owned = gate(), release = gate()
	const walletId = { actor: sellerActor, environmentId: 'friday-browser' }
	const owner = tabA.runWalletExclusive(walletId, async () => { owned.resolve(); await release.promise })
	await owned.promise
	held.state.runWalletExclusive = tabB.runWalletExclusive
	const abort = new AbortController(); let cancelled = false
	const request = held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1', signal: abort.signal }).catch(() => { cancelled = true })
	await progress(); abort.abort(); await progress()
	expect(cancelled).toBe(true); expect(held.controls.opens).toBe(0)
	release.resolve(); await owner; await request; await progress()
	expect(held.controls.opens).toBe(0); expect(held.controls.nostrSigns).toBe(0)
	let recovered = false
	await tabB.runWalletExclusive(walletId, async () => { recovered = true })
	expect(recovered).toBe(true); expect(new Set(shared.names).size).toBe(1)
})

test('late wallet initialization is disposed under the lease before passive recovery may open', async () => {
	const held = fixture(), shared = sharedWalletLocks(), tab = shared.tab(), otherTab = shared.tab()
	held.state.runWalletExclusive = tab.runWalletExclusive
	const opening = gate(), initialized = gate(), disposing = gate(), closed = gate()
	held.controls.beforeWalletOpen = async () => { opening.resolve(); await initialized.promise }
	held.controls.beforeDispose = async () => { disposing.resolve(); await closed.promise }
	const abort = new AbortController(); let outcome = 'pending'
	const request = held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1', signal: abort.signal })
		.then(() => { outcome = 'registered' }, () => { outcome = 'cancelled' })
	await opening.promise; abort.abort(); await progress()
	expect(outcome).toBe('cancelled'); expect(held.controls.observedSignal).toBe(abort.signal)
	let recoveryOpened = false
	const recovery = otherTab.runWalletExclusive({ actor: sellerActor, environmentId: 'friday-browser' }, async () => { recoveryOpened = true })
	await progress(); expect(recoveryOpened).toBe(false)
	initialized.resolve(); await disposing.promise; await progress()
	expect(held.controls.disposals).toBe(1); expect(recoveryOpened).toBe(false)
	closed.resolve(); await recovery; await request
	expect(recoveryOpened).toBe(true); expect(held.controls.nostrSigns).toBe(0); expect(held.controls.registrations).toBe(0)
})

test('two tabs use the same actor/deployment lease for balance, seller approval and import', async () => {
	const held = fixture(), shared = sharedWalletLocks(), sellerTab = shared.tab(), balanceTab = shared.tab()
	held.state.runWalletExclusive = sellerTab.runWalletExclusive
	const walletId = { actor: sellerActor, environmentId: 'friday-browser' }, entered = gate(), release = gate()
	let active = 0, maximum = 0
	const balance = balanceTab.runWalletExclusive(walletId, async () => { active++; maximum = Math.max(maximum,active); entered.resolve(); await release.promise; active-- })
	await entered.promise
	held.controls.beforeWalletOpen = async () => { active++; maximum = Math.max(maximum,active) }
	held.controls.beforeDispose = async () => { active-- }
	const approval = held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
	await progress(); expect(held.controls.opens).toBe(0)
	release.resolve(); await balance; await approval
	expect(maximum).toBe(1); expect(active).toBe(0); expect(new Set(shared.names).size).toBe(1)
	const row = [...held.state.rows.values()][0]!
	held.setNotice({ schema: 'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1', actor: sellerActor,
		network: 'friday-network', chainId: 'friday-chain', auctionId: 'auction-1', operationId: 'funding-1',
		role: 'winner_settlement', mintUrl, amount: 600,
		recipientCapabilityDigest: demoRecipientCapabilityDigest(row.coordinatorRequest.capability),
		signatures: row.coordinatorRequest.outputs.map((output) => {
			const point = pointFromHex(output.B_), secret = mintSecret(output.amount)
			const signature = createBlindSignature(point, secret, output.id), dleq = createDLEQProof(point, secret)
			return { amount: output.amount, id: output.id, C_: signature.C_.toHex(true),
				dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) } }
		}),
	})
	const reading = gate(), finishReading = gate()
	const nextBalance = balanceTab.runWalletExclusive(walletId, async () => { active++; maximum = Math.max(maximum,active); reading.resolve(); await finishReading.promise; active-- })
	await reading.promise
	const payout = held.client.importWinnerExact({ auctionId: 'auction-1', fundingOperationId: 'funding-1' })
	await progress(); expect(held.controls.opens).toBe(1)
	finishReading.resolve(); await nextBalance; await payout
	expect(held.imports).toBe(1); expect(held.acks).toHaveLength(1)
	expect(maximum).toBe(1); expect(active).toBe(0); expect(new Set(shared.names).size).toBe(1)
})

test('uncooperative queued callback is still prevented from acting after cancellation', async () => {
	const held = fixture(), entered = gate(), release = gate(), abort = new AbortController()
	held.state.runWalletExclusive = async <T>(_id: unknown, run: () => Promise<T>) => { entered.resolve(); await release.promise; return run() }
	let outcome = 'pending'
	const pending = held.client.prepareAndRegister({ auctionId: 'auction-1', fundingOperationId: 'funding-1', signal: abort.signal })
		.then(() => { outcome = 'registered' }, () => { outcome = 'cancelled' })
	await entered.promise; abort.abort(); await progress(); expect(outcome).toBe('cancelled')
	release.resolve(); await pending; await progress()
	expect(held.controls.opens).toBe(0); expect(held.controls.registrations).toBe(0)
})

for (const phase of ['approval', 'winner-import'] as const) test(`P2 seller ${phase} rejected cleanup fences the common production lease`, async () => {
 const held=fixture(), shared=sharedWalletLocks()
 held.controls.deployment.environmentId=`p2-seller-${phase}`
 const tab=shared.tab();held.state.runWalletExclusive=tab.runWalletExclusive
 const request={auctionId:'auction-1',fundingOperationId:'funding-1'}
 if(phase==='winner-import'){
  await held.client.prepareAndRegister(request)
  const row=[...held.state.rows.values()][0]!
  held.setNotice({schema:'PLEBEIAN_FRIDAY_COCO_TERMINAL_NOTICE_V1',actor:sellerActor,network:'friday-network',chainId:'friday-chain',auctionId:'auction-1',operationId:'funding-1',role:'winner_settlement',mintUrl,amount:600,recipientCapabilityDigest:demoRecipientCapabilityDigest(row.coordinatorRequest.capability),signatures:row.coordinatorRequest.outputs.map(output=>{
   const point=pointFromHex(output.B_),secret=mintSecret(output.amount),signature=createBlindSignature(point,secret,output.id),dleq=createDLEQProof(point,secret)
   return {amount:output.amount,id:output.id,C_:signature.C_.toHex(true),dleq:{e:bytesToHex(dleq.e),s:bytesToHex(dleq.s)}}
  })})
 }
 held.controls.beforeDispose=async()=>{throw new Error('P2 disposal unconfirmed')}
 const action=phase==='approval'?held.client.prepareAndRegister(request):held.client.importWinnerExact(request)
 await expect(action).rejects.toThrow(/DRAIN_UNCONFIRMED/)
 const opens=held.controls.opens;let next=false
 await expect(shared.tab().runWalletExclusive({actor:sellerActor,environmentId:held.controls.deployment.environmentId},async()=>{next=true})).rejects.toThrow(/DRAIN_UNCONFIRMED/)
 expect(next).toBe(false);expect(held.controls.opens).toBe(opens);expect(held.acks).toHaveLength(0)
 if(phase==='winner-import')expect(held.imports).toBe(1)
})
