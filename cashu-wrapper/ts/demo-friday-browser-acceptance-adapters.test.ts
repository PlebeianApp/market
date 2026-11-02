import { describe, expect, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	createDemoFridayAuthenticatedAcceptanceConsensus,
	createDemoFridaySshCometReader,
	createDemoFridayValidator4FaultControl,
	createDemoFridayValidator4RecoveryControl,
	verifyDemoFridayAcceptanceCometPreflight,
	type DemoFridayAcceptanceFaultApprovalV1,
	type DemoFridayAcceptanceRecoveryApprovalV1,
	type DemoFridayExactCommandPort,
} from './demo-friday-browser-acceptance-adapters'
import { runDemoFridayCometProbe } from './demo-friday-comet-probe-cli'
import {
	DEMO_FRIDAY_FAULT_CONSUMPTION_ROOT,
	DEMO_FRIDAY_RECOVERY_CONSUMPTION_ROOT,
	runDemoFridayAcceptanceOperatorCli,
} from './demo-friday-acceptance-operator-cli'
import type { DemoParticipantConsensusReader } from './demo-comet-displacement-verifier'

const key = new Uint8Array(32).fill(7), seller = bytesToHex(schnorr.getPublicKey(key))
const validatorsHash = 'aa'.repeat(32)
const roster = [1, 2, 3, 4].map((slot) => ({ slot: slot as 1 | 2 | 3 | 4, address: `${slot}`.repeat(40) }))

function signed(unsigned: { pubkey: string; created_at: number; kind: 28640; tags: string[][]; content: string }) {
	const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, unsigned.pubkey, unsigned.created_at,
		unsigned.kind, unsigned.tags, unsigned.content]))))
	return { ...structuredClone(unsigned), id, sig: bytesToHex(schnorr.sign(hexToBytes(id), key)) }
}
function consensusFixture(options: { wrongReceiptHash?: boolean; transactionCommitSigners?: string[] } = {}) {
	let state: any = { chain_id: 'friday-chain', height: 10,
		auctions: {}, bids: {}, integrated_fundings: {}, integrated_displacements: {}, last_consensus_time: 1_000 }
	const transactions: Uint8Array[] = []
	const observation = () => {
		const canonicalStateBytes = utf8ToBytes(JSON.stringify(state)), appHash = bytesToHex(sha256(canonicalStateBytes))
		return { queryHeight: state.height, appHash, canonicalStateBytes, state: structuredClone(state) }
	}
	const reader: DemoParticipantConsensusReader = {
		async readChainId() { return 'friday-chain' },
		async readCurrentState() { return observation() },
		async readCommit(height) { return { height, blockTime: height === 10 ? 1_000 : 7_777, blockHash: 'bb'.repeat(32),
			appHash: observation().appHash, validatorsHash, commitSignerAddresses: height === 10 && options.transactionCommitSigners !== undefined
				? [...options.transactionCommitSigners] : roster.slice(0, 3).map((value) => value.address) } },
		async readBlock(height) { return { height, blockHash: 'bb'.repeat(32), transactions: transactions.map((value) => value.slice()) } },
	}
	const calls: string[] = []
	const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input.toString()); calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
		if (url.pathname === '/api/event') {
			const event = JSON.parse(String(init?.body)) as { pubkey: string; content: string }
			const content = JSON.parse(event.content) as any
			const signedEvent = JSON.parse(String(init?.body)) as any
			const raw = utf8ToBytes(JSON.stringify({ version: 1, type: 'event', event: { id: signedEvent.id,
				pubkey: signedEvent.pubkey, created_at: signedEvent.created_at, kind: signedEvent.kind,
				tags: signedEvent.tags, content: signedEvent.content, sig: signedEvent.sig } }))
			transactions.push(raw)
			state.auctions[content.auction_id] = { id: content.auction_id, seller: event.pubkey,
				seller_coco_payment_public_key: content.seller_coco_payment_public_key, funding_mode: content.funding_mode,
				status: 'open', leader_bid_id: '', high_bid: 0, reserve: content.reserve,
				original_end_time: 1_900, end_time: 1_900, extension_count: 0 }
			return Response.json({ height: 10, tx_hash: options.wrongReceiptHash ? 'AB'.repeat(32)
				: bytesToHex(sha256(raw)).toUpperCase(), check_code: 0, deliver_code: 0 })
		}
		if (url.pathname === '/api/close') {
			const auctionId = (JSON.parse(String(init?.body)) as any).auction_id
			const raw = utf8ToBytes(JSON.stringify({ version: 1, type: 'close', auction_id: auctionId }))
			transactions.push(raw)
			state.auctions[auctionId] = { ...state.auctions[auctionId]!, status: 'closed', winner: 'cc'.repeat(32) }
			return Response.json({ height: 10, tx_hash: bytesToHex(sha256(raw)).toUpperCase(), check_code: 0, deliver_code: 0 })
		}
		return Response.json({ error: 'unexpected' }, { status: 404 })
	}
	let stopped = 0
	const adapter = createDemoFridayAuthenticatedAcceptanceConsensus({ reader,
		fault: { async setValidatorOfflineExact() { stopped++ } },
		sellerSigner: { async getPublicKey() { return seller }, async signEvent(event) { return signed(event) } },
		chainId: 'friday-chain', validatorsHash, validatorRoster: roster, fetchImpl,
		nowSeconds: () => 1_000, sleep: async () => {}, pollIntervalMs: 100, maxWaitMs: 1_000 })
	return { adapter, reader, calls, stopped: () => stopped, mutate(change: (value: typeof state) => void) { change(state) } }
}

describe('concrete Friday acceptance adapters', () => {
	test('submits an exact NIP-07 create and accepts only authenticated Comet state and roster commits', async () => {
		const held = consensusFixture(), payment = `02${'44'.repeat(32)}`
		await held.adapter.createAuctionExact({ auctionId: 'auction-1', sellerActor: seller,
			sellerPaymentPublicKey: payment, durationSeconds: 900, startingBid: 1_000, minIncrement: 100, reserve: 0 })
		expect((await held.adapter.readAuctionExact('auction-1')).seller).toBe(seller)
		held.mutate((state) => { state.bids['cc'.repeat(32)] = { id: 'cc'.repeat(32), auction_id: 'auction-1',
			bidder: 'dd'.repeat(32), amount: 2_000, committed_at: 1_799,
			integrated_funding_id: 'funding-1', replaces_bid_id: '' }
			state.auctions['auction-1'] = { ...state.auctions['auction-1']!, leader_bid_id: 'cc'.repeat(32), high_bid: 2_000,
				original_end_time: 1_900, end_time: 1_900 }; state.last_consensus_time = 1_800 })
		expect((await held.adapter.waitForLeaderExact({ auctionId: 'auction-1', actor: 'dd'.repeat(32), amount: 2_000 })).highBid).toBe(2_000)
		expect((await held.adapter.waitUntilLateWindowExact({ auctionId: 'auction-1', windowSeconds: 180 })).status).toBe('open')
		expect((await held.adapter.readValidatorsExact()).map((value) => value.online)).toEqual([true, true, true, false])
		await held.adapter.setValidatorOfflineExact(4); expect(held.stopped()).toBe(1)
		held.mutate((state) => { state.last_consensus_time = 1_900 })
		await held.adapter.waitUntilCloseEligibleExact('auction-1'); await held.adapter.closeAuctionExact('auction-1')
		expect((await held.adapter.waitUntilClosedExact('auction-1')).winner).toBe('cc'.repeat(32))
		expect(held.calls).toEqual(['POST /api/event', 'POST /api/close'])
	})

	test('rejects a wrong chain before accepting any application state', async () => {
		const held = consensusFixture() as any
		held.adapter = createDemoFridayAuthenticatedAcceptanceConsensus({
			reader: { async readChainId() { return 'wrong' }, async readCurrentState() { throw new Error('must not read') },
				async readCommit() { throw new Error('must not read') }, async readBlock() { throw new Error('must not read') } },
			fault: { async setValidatorOfflineExact() {} }, sellerSigner: { async getPublicKey() { return seller }, async signEvent(event: any) { return signed(event) } },
			chainId: 'friday-chain', validatorsHash, validatorRoster: roster, fetchImpl: async () => Response.json({}),
		})
		await expect(held.adapter.readAuctionExact('auction-1')).rejects.toThrow(/chain differs/)
	})

	test('rejects an HTTP success receipt whose hash is not the exact signed Comet transaction', async () => {
		const held = consensusFixture({ wrongReceiptHash: true })
		await expect(held.adapter.createAuctionExact({ auctionId: 'auction-receipt-mismatch', sellerActor: seller,
			sellerPaymentPublicKey: `02${'44'.repeat(32)}`, durationSeconds: 900,
			startingBid: 1_000, minIncrement: 100, reserve: 0 })).rejects.toThrow(/receipt hash differs/)
	})

	test('binds auction duration to the transaction commit time rather than the later state-binding header', async () => {
		const held = consensusFixture()
		await held.adapter.createAuctionExact({ auctionId: 'auction-commit-time', sellerActor: seller,
			sellerPaymentPublicKey: `02${'45'.repeat(32)}`, durationSeconds: 900,
			startingBid: 1_000, minIncrement: 100, reserve: 0 })
		expect((await held.adapter.readAuctionExact('auction-commit-time')).originalEndTime).toBe(1_900)
	})

	test('rejects a transaction-height commit containing a signer outside the pinned four-validator roster', async () => {
		const held = consensusFixture({ transactionCommitSigners: [roster[0]!.address, roster[1]!.address, 'F'.repeat(40)] })
		await expect(held.adapter.createAuctionExact({ auctionId: 'auction-transaction-outsider', sellerActor: seller,
			sellerPaymentPublicKey: `02${'46'.repeat(32)}`, durationSeconds: 900,
			startingBid: 1_000, minIncrement: 100, reserve: 0 })).rejects.toThrow(/transaction commit.*pinned 3-of-4/)
	})

	test('rejects a canonical quorum containing any signer outside the pinned roster', async () => {
		const base = consensusFixture().reader
		const reader: DemoParticipantConsensusReader = { ...base, async readCommit(height) {
			const commit = await base.readCommit(height)
			return { ...commit, commitSignerAddresses: [roster[0]!.address, roster[1]!.address, 'F'.repeat(40)] }
		} }
		await expect(verifyDemoFridayAcceptanceCometPreflight({ reader, chainId: 'friday-chain', validatorsHash,
			validatorRoster: roster })).rejects.toThrow(/outside|quorum/)
	})

	test('executes only one externally pinned validator-4 stop and verifies exact argv and inactive state', async () => {
		const approval: DemoFridayAcceptanceFaultApprovalV1 = { schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1',
			deploymentId: 'friday-demo-20261023-r14', action: 'STOP_VALIDATOR_4_ONCE', targetSlot: 4,
			targetHostId: 'linode-108237424', targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service',
			notBefore: 900, expiresAt: 1_200, nonce: 'ef'.repeat(32) }
		const bytes = utf8ToBytes(JSON.stringify(approval)), pin = bytesToHex(sha256(bytes)), unit = 'ab'.repeat(32), calls: string[][] = []
		const command: DemoFridayExactCommandPort = { async runExact(argv) { calls.push([...argv])
			if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
				stdout: `${unit}  /etc/systemd/system/plebeian-friday-validator.service\n`, stderr: '' }
			if (argv.includes('stop')) return { exitCode: 0, stdout: '', stderr: '' }
			return { exitCode: 3, stdout: 'inactive\n', stderr: '' } } }
		const fault = createDemoFridayValidator4FaultControl({ command, approvalBytes: bytes,
			expectedApprovalSha256: pin, expectedUnitSha256: unit, nowSeconds: () => 1_000 })
		await fault.setValidatorOfflineExact(4)
		expect(calls).toHaveLength(3)
		expect(calls.every((argv) => argv.includes('root@172.104.253.247') && argv.includes('ForwardAgent=no'))).toBeTrue()
		await expect(fault.setValidatorOfflineExact(4)).rejects.toThrow(/only one/)
	})

	test('rejects an otherwise well-formed fault approval for another deployment', async () => {
		const approval: DemoFridayAcceptanceFaultApprovalV1 = { schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1',
			deploymentId: 'friday-demo-20261023-other', action: 'STOP_VALIDATOR_4_ONCE', targetSlot: 4,
			targetHostId: 'linode-108237424', targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service',
			notBefore: 900, expiresAt: 1_200, nonce: 'aa'.repeat(32) }
		const bytes = utf8ToBytes(JSON.stringify(approval))
		const command: DemoFridayExactCommandPort = { async runExact() { throw new Error('must not execute') } }
		const fault = createDemoFridayValidator4FaultControl({ command, approvalBytes: bytes,
			expectedApprovalSha256: bytesToHex(sha256(bytes)), expectedUnitSha256: 'ab'.repeat(32), nowSeconds: () => 1_000 })
		await expect(fault.setValidatorOfflineExact(4)).rejects.toThrow(/scope or validity/)
	})

	test('executes one separately approved validator-4 start from exact inactive to active', async () => {
		const approval: DemoFridayAcceptanceRecoveryApprovalV1 = {
			schema: 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_APPROVAL_V1', deploymentId: 'friday-demo-20261023-r14',
			action: 'START_VALIDATOR_4_ONCE', targetSlot: 4, targetHostId: 'linode-108237424',
			targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service',
			notBefore: 900, expiresAt: 1_200, nonce: 'bc'.repeat(32),
		}
		const bytes = utf8ToBytes(JSON.stringify(approval)), pin = bytesToHex(sha256(bytes)), unit = 'ab'.repeat(32)
		const calls: string[][] = []; let statusReads = 0
		const command: DemoFridayExactCommandPort = { async runExact(argv) { calls.push([...argv])
			if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
				stdout: `${unit}  /etc/systemd/system/plebeian-friday-validator.service\n`, stderr: '' }
			if (argv.includes('start')) return { exitCode: 0, stdout: '', stderr: '' }
			statusReads++
			return statusReads === 1 ? { exitCode: 3, stdout: 'inactive\n', stderr: '' }
				: { exitCode: 0, stdout: 'active\n', stderr: '' } } }
		const recovery = createDemoFridayValidator4RecoveryControl({ command, approvalBytes: bytes,
			expectedApprovalSha256: pin, expectedUnitSha256: unit, nowSeconds: () => 1_000 })
		await recovery.setValidatorOnlineExact(4)
		expect(calls).toHaveLength(4)
		expect(calls.some((argv) => argv.includes('start'))).toBeTrue()
		expect(calls.every((argv) => argv.includes('root@172.104.253.247') && argv.includes('ForwardAgent=no'))).toBeTrue()
		await expect(recovery.setValidatorOnlineExact(4)).rejects.toThrow(/only one/)
	})

	test('operator CLI durably consumes the exact fault approval before one bounded stop', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-fault-cli-'))
		try {
			const approval: DemoFridayAcceptanceFaultApprovalV1 = { schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1',
				deploymentId: 'friday-demo-20261023-r14', action: 'STOP_VALIDATOR_4_ONCE', targetSlot: 4,
				targetHostId: 'linode-108237424', targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service',
				notBefore: 900, expiresAt: 1_200, nonce: 'cd'.repeat(32) }
			const bytes = utf8ToBytes(JSON.stringify(approval)), approvalPath = join(root, 'approval.json')
			const consumptionPath = join(root, 'consumption.json'), approvalHash = bytesToHex(sha256(bytes)), unitHash = 'ab'.repeat(32)
			await writeFile(approvalPath, bytes, { mode: 0o600 })
			let calls = 0
			const command: DemoFridayExactCommandPort = { async runExact(argv) { calls++
				if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
					stdout: `${unitHash}  /etc/systemd/system/plebeian-friday-validator.service\n`, stderr: '' }
				if (argv.includes('stop')) return { exitCode: 0, stdout: '', stderr: '' }
				return { exitCode: 3, stdout: 'inactive\n', stderr: '' } } }
			let reserved = false
			const reserveFaultConsumption = async (hash: string) => {
				if (reserved || hash !== approvalHash) throw new Error('replayed or wrong approval')
				reserved = true
				return { async finalize(result: unknown) { await writeFile(consumptionPath,
					`${JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_FAULT_CONSUMPTION_V1', approvalSha256: hash,
						status: 'completed', result })}\n`, { mode: 0o600 }) }, async close() {} }
			}
			const argv = ['validator-4-offline', '--approval', approvalPath, '--approval-sha256', approvalHash,
				'--unit-sha256', unitHash]
			expect(await runDemoFridayAcceptanceOperatorCli(argv, { command, nowSeconds: () => 1_000, reserveFaultConsumption }))
				.toEqual({ schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_RESULT_V1', slot: 4, status: 'inactive', approvalSha256: approvalHash })
			expect(JSON.parse(await readFile(consumptionPath, 'utf8')).status).toBe('completed')
			await expect(runDemoFridayAcceptanceOperatorCli(argv, { command, nowSeconds: () => 1_000, reserveFaultConsumption })).rejects.toThrow()
			expect(calls).toBe(3)
			expect(DEMO_FRIDAY_FAULT_CONSUMPTION_ROOT).toBe('/var/lib/plebeian-auctions-friday-operator/acceptance-fault')
			await expect(runDemoFridayAcceptanceOperatorCli([...argv, '--consumption', consumptionPath], {
				command, nowSeconds: () => 1_000, reserveFaultConsumption,
			})).rejects.toThrow(/usage|rejected/)
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('operator CLI consumes a distinct start approval only after four-signature rejoin', async () => {
		const root = await mkdtemp(join(tmpdir(), 'friday-recovery-cli-'))
		try {
			const approval: DemoFridayAcceptanceRecoveryApprovalV1 = {
				schema: 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_APPROVAL_V1', deploymentId: 'friday-demo-20261023-r14',
				action: 'START_VALIDATOR_4_ONCE', targetSlot: 4, targetHostId: 'linode-108237424',
				targetIpv4: '172.104.253.247', unit: 'plebeian-friday-validator.service',
				notBefore: 900, expiresAt: 1_200, nonce: 'de'.repeat(32),
			}
			const bytes = utf8ToBytes(JSON.stringify(approval)), approvalPath = join(root, 'approval.json')
			const consumptionPath = join(root, 'consumption.json'), approvalHash = bytesToHex(sha256(bytes)), unitHash = 'ab'.repeat(32)
			await writeFile(approvalPath, bytes, { mode: 0o600 })
			let calls = 0, statusReads = 0, reserved = false
			const command: DemoFridayExactCommandPort = { async runExact(argv) { calls++
				if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
					stdout: `${unitHash}  /etc/systemd/system/plebeian-friday-validator.service\n`, stderr: '' }
				if (argv.includes('start')) return { exitCode: 0, stdout: '', stderr: '' }
				statusReads++
				return statusReads === 1 ? { exitCode: 3, stdout: 'inactive\n', stderr: '' }
					: { exitCode: 0, stdout: 'active\n', stderr: '' } } }
			const reserveRecoveryConsumption = async (hash: string) => {
				if (reserved || hash !== approvalHash) throw new Error('replayed or wrong recovery approval')
				reserved = true
				return { async finalize(result: unknown) { await writeFile(consumptionPath,
					`${JSON.stringify({ schema: 'PLEBEIAN_FRIDAY_RECOVERY_CONSUMPTION_V1', approvalSha256: hash,
						status: 'completed', result })}\n`, { mode: 0o600 }) }, async close() {} }
			}
			const preflight = { schema: 'PLEBEIAN_FRIDAY_ACCEPTANCE_COMET_PREFLIGHT_V1' as const,
				trustModel: 'PINNED_LOCAL_COMET_RPC_NOT_INDEPENDENT_LIGHT_CLIENT' as const, chainId: 'friday-chain',
				stateHeight: 51, commitHeight: 52, commitSignatures: 4, onlineSlots: [1, 2, 3, 4] }
			const argv = ['validator-4-online', '--approval', approvalPath, '--approval-sha256', approvalHash,
				'--unit-sha256', unitHash, '--probe-sha256', '12'.repeat(32), '--chain-id', 'friday-chain',
				'--validators-hash', validatorsHash, '--validator-addresses', roster.map((entry) => entry.address).join(',')]
			expect(await runDemoFridayAcceptanceOperatorCli(argv, { command, nowSeconds: () => 1_000,
				reserveRecoveryConsumption, verifyRecoveryRejoin: async () => preflight })).toEqual({
				schema: 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_RESULT_V1', slot: 4, status: 'active_rejoined',
				approvalSha256: approvalHash, commitHeight: 52, commitSignatures: 4,
			})
			expect(JSON.parse(await readFile(consumptionPath, 'utf8')).status).toBe('completed')
			expect(calls).toBe(4)
			expect(DEMO_FRIDAY_RECOVERY_CONSUMPTION_ROOT)
				.toBe('/var/lib/plebeian-auctions-friday-operator/acceptance-recovery')
			await expect(runDemoFridayAcceptanceOperatorCli(argv, { command, nowSeconds: () => 1_000,
				reserveRecoveryConsumption, verifyRecoveryRejoin: async () => preflight })).rejects.toThrow()
		} finally { await rm(root, { recursive: true, force: true }) }
	})

	test('bridges only allowlisted Comet RPC commands over the fixed V2 SSH target', async () => {
		const probeHash = '12'.repeat(32), calls: string[][] = []
		const command: DemoFridayExactCommandPort = { async runExact(argv) { calls.push([...argv])
			if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
				stdout: `${probeHash}  /opt/plebeian-auctions-friday/bin/plebeian-friday-comet-probe\n`, stderr: '' }
			return { exitCode: 0, stdout: JSON.stringify({ jsonrpc: '2.0', id: -1,
				result: { node_info: { network: 'friday-chain' } } }) + '\n', stderr: '' } } }
		const reader = createDemoFridaySshCometReader({ command, expectedProbeSha256: probeHash })
		expect(await reader.readChainId()).toBe('friday-chain')
		expect(calls).toHaveLength(2)
		expect(calls[1]!.slice(-2)).toEqual(['/opt/plebeian-auctions-friday/bin/plebeian-friday-comet-probe', 'status'])
		expect(calls.every((argv) => argv.includes('root@172.105.95.57') && argv.includes('ClearAllForwardings=yes'))).toBeTrue()
	})

	test('selects the immutable release probe only for the R20 deployment profile', async () => {
		const probeHash = '12'.repeat(32), calls: string[][] = []
		const releaseProbe = '/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-friday-comet-probe'
		const command: DemoFridayExactCommandPort = { async runExact(argv) { calls.push([...argv])
			if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
				stdout: `${probeHash}  ${releaseProbe}\n`, stderr: '' }
			return { exitCode: 0, stdout: JSON.stringify({ jsonrpc: '2.0', id: -1,
				result: { node_info: { network: 'friday-chain-r20' } } }) + '\n', stderr: '' } } }
		const reader = createDemoFridaySshCometReader({ command, expectedProbeSha256: probeHash,
			expectedDeploymentId: 'friday-demo-20261030-separated-v1' })
		expect(await reader.readChainId()).toBe('friday-chain-r20')
		expect(calls[1]!.slice(-2)).toEqual([releaseProbe, 'status'])
		for (const option of ['GlobalKnownHostsFile=/dev/null', 'PasswordAuthentication=no',
			'KbdInteractiveAuthentication=no', 'ControlMaster=no', 'ControlPath=none', 'ControlPersist=no']) {
			expect(calls[0]).toContain(option)
		}
	})

	test('probe CLI accepts only fixed loopback methods and bounded JSON', async () => {
		const fetchImpl = async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : input.toString())
			expect(url.origin).toBe('http://127.0.0.1:27657')
			return new Response(JSON.stringify({ result: { ok: true } }), { status: 200,
				headers: { 'content-type': 'application/json' } })
		}
		expect(JSON.parse(await runDemoFridayCometProbe(['commit', '42'], fetchImpl))).toEqual({ result: { ok: true } })
		await expect(runDemoFridayCometProbe(['tx', '42'], fetchImpl)).rejects.toThrow(/rejected/)
	})

	test('operator CLI rejects incomplete Comet pins before invoking a command', async () => {
		let calls = 0
		const command: DemoFridayExactCommandPort = { async runExact() { calls++; throw new Error('must not execute') } }
		await expect(runDemoFridayAcceptanceOperatorCli(['verify-comet', '--probe-sha256', '00'], { command })).rejects.toThrow(/usage|rejected/)
		expect(calls).toBe(0)
	})

	test('operator CLI verifies exact remote-probe bytes, chain, state header and pinned 3-of-4 roster', async () => {
		const probeHash = '12'.repeat(32), state = { chain_id: 'friday-chain', height: 10,
			auctions: {}, bids: {}, integrated_fundings: {}, integrated_displacements: {} }
		const canonical = utf8ToBytes(JSON.stringify(state)), appHash = bytesToHex(sha256(canonical)), calls: string[][] = []
		const envelope = (result: unknown) => `${JSON.stringify({ jsonrpc: '2.0', id: -1, result })}\n`
		const command: DemoFridayExactCommandPort = { async runExact(argv) { calls.push([...argv])
			if (argv.includes('/usr/bin/sha256sum')) return { exitCode: 0,
				stdout: `${probeHash}  /opt/plebeian-auctions-friday/bin/plebeian-friday-comet-probe\n`, stderr: '' }
			const action = argv.at(-1)
			if (action === 'status') return { exitCode: 0, stdout: envelope({ node_info: { network: 'friday-chain' } }), stderr: '' }
			if (action === 'state') return { exitCode: 0, stdout: envelope({ response: { code: 0, height: '10',
				value: Buffer.from(JSON.stringify({ state, app_hash: appHash,
					canonical_state: Buffer.from(canonical).toString('base64') })).toString('base64') } }), stderr: '' }
			if (argv.at(-2) === 'commit' && action === '11') return { exitCode: 0, stdout: envelope({ canonical: true,
				signed_header: { header: { height: '11', time: '2026-10-23T00:00:00Z', app_hash: appHash.toUpperCase(),
					validators_hash: validatorsHash.toUpperCase() }, commit: { block_id: { hash: 'BB'.repeat(32) },
					signatures: roster.slice(0, 3).map((entry) => ({ block_id_flag: 2, validator_address: entry.address })) } } }), stderr: '' }
			throw new Error(`unexpected command: ${argv.join(' ')}`) } }
		const result = await runDemoFridayAcceptanceOperatorCli(['verify-comet', '--probe-sha256', probeHash,
			'--chain-id', 'friday-chain', '--validators-hash', validatorsHash,
			'--validator-addresses', roster.map((entry) => entry.address).join(',')], { command })
		expect(result).toEqual({ schema: 'PLEBEIAN_FRIDAY_ACCEPTANCE_COMET_PREFLIGHT_V1',
			trustModel: 'PINNED_LOCAL_COMET_RPC_NOT_INDEPENDENT_LIGHT_CLIENT', chainId: 'friday-chain',
			stateHeight: 10, commitHeight: 11, commitSignatures: 3, onlineSlots: [1, 2, 3] })
		expect(calls).toHaveLength(8)
		expect(calls.every((argv) => argv.includes('root@172.105.95.57') && argv.includes('StrictHostKeyChecking=yes'))).toBeTrue()
	})
})
