import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import {
	authenticatedDemoCometState,
	createLoopbackCometReader,
	exactDemoCometCommit,
	type DemoParticipantConsensusReader,
} from './demo-comet-displacement-verifier'
import type {
	DemoFridayAcceptanceAuctionV1,
	DemoFridayAcceptanceConsensusPort,
	DemoFridayAcceptanceValidatorV1,
} from './demo-friday-browser-acceptance-runner'
import { DEMO_FRIDAY_SIDEQUEST_COMET_PROBE_BINARY } from './demo-friday-sidequest-acceptance-path-contract'

const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/
const ADDRESS = /^[0-9A-F]{40}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
const SAFE_REMOTE_ARG = /^[A-Za-z0-9_./:=+,-]+$/
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024
const ACCEPTANCE_ORIGIN = 'https://139.162.161.233'
const V2_HOST = '172.105.95.57'
const V4_HOST = '172.104.253.247'
const V4_HOST_ID = 'linode-108237424'
export const DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID = 'friday-demo-20261023-r14' as const
export const DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID = 'friday-demo-20261030-separated-v1' as const
export type DemoFridayAcceptanceDeploymentId = typeof DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID
	| typeof DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID
const VALIDATOR_UNIT = 'plebeian-friday-validator.service'
const SSH = '/usr/bin/ssh'
const SSH_AGENT = '/tmp/plebeian-poc-owner-agent.sock'
const KNOWN_HOSTS = '/home/maximoto/.ssh/known_hosts'
const REMOTE_PROBE = '/opt/plebeian-auctions-friday/bin/plebeian-friday-comet-probe'

function remoteProbe(deploymentId: DemoFridayAcceptanceDeploymentId): string {
	return deploymentId === DEMO_FRIDAY_ACCEPTANCE_R20_DEPLOYMENT_ID
		? DEMO_FRIDAY_SIDEQUEST_COMET_PROBE_BINARY : REMOTE_PROBE
}

function fail(message: string): never { throw new Error(`PLEBEIAN_FRIDAY_ACCEPTANCE_ADAPTER: ${message}`) }
function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} has missing or unexpected fields`)
	return value as Record<string, unknown>
}
function exactPositive(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} is invalid`)
	return Number(value)
}

export interface DemoFridayAcceptanceSignedEventV1 {
	id: string
	pubkey: string
	created_at: number
	kind: 28640
	tags: string[][]
	content: string
	sig: string
}
export interface DemoFridayAcceptanceNostrSignerPort {
	getPublicKey(): Promise<string>
	signEvent(event: Omit<DemoFridayAcceptanceSignedEventV1, 'id' | 'sig'>): Promise<DemoFridayAcceptanceSignedEventV1>
}
export interface DemoFridayExactCommandResult {
	exitCode: number
	stdout: string
	stderr: string
}
export interface DemoFridayExactCommandPort {
	runExact(argv: readonly string[], timeoutMs: number): Promise<DemoFridayExactCommandResult>
}
export interface DemoFridayAcceptanceFaultApprovalV1 {
	schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1'
	deploymentId: string
	action: 'STOP_VALIDATOR_4_ONCE'
	targetSlot: 4
	targetHostId: typeof V4_HOST_ID
	targetIpv4: typeof V4_HOST
	unit: typeof VALIDATOR_UNIT
	notBefore: number
	expiresAt: number
	nonce: string
}
export interface DemoFridayAcceptanceRecoveryApprovalV1 {
	schema: 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_APPROVAL_V1'
	deploymentId: string
	action: 'START_VALIDATOR_4_ONCE'
	targetSlot: 4
	targetHostId: typeof V4_HOST_ID
	targetIpv4: typeof V4_HOST
	unit: typeof VALIDATOR_UNIT
	notBefore: number
	expiresAt: number
	nonce: string
}
export interface DemoFridayAcceptanceFaultPort {
	setValidatorOfflineExact(slot: 4): Promise<void>
}
export interface DemoFridayAcceptanceRecoveryPort {
	setValidatorOnlineExact(slot: 4): Promise<void>
}
export interface DemoFridayAcceptanceCometPreflightV1 {
	schema: 'PLEBEIAN_FRIDAY_ACCEPTANCE_COMET_PREFLIGHT_V1'
	trustModel: 'PINNED_LOCAL_COMET_RPC_NOT_INDEPENDENT_LIGHT_CLIENT'
	chainId: string
	stateHeight: number
	commitHeight: number
	commitSignatures: number
	onlineSlots: number[]
}

export function createBunExactCommandRunner(): DemoFridayExactCommandPort {
	return Object.freeze({
		async runExact(argv: readonly string[], timeoutMs: number) {
			if (argv.length < 2 || argv.some((value) => typeof value !== 'string' || value.length === 0)
				|| !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) fail('command request is invalid')
			const child = Bun.spawn([...argv], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
			let timer: ReturnType<typeof setTimeout> | undefined
			const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
				child.kill('SIGTERM'); reject(new Error('bounded command timed out'))
			}, timeoutMs) })
			try {
				const [exitCode, stdout, stderr] = await Promise.race([
					Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]), timeout,
				])
				if (stdout.length > MAX_COMMAND_OUTPUT || stderr.length > 16_384) fail('command output exceeded its bound')
				return { exitCode, stdout, stderr }
			} finally { if (timer !== undefined) clearTimeout(timer) }
		},
	})
}

function sshArgs(host: typeof V2_HOST | typeof V4_HOST, remote: readonly string[]): string[] {
	if (remote.length === 0 || remote.some((value) => !SAFE_REMOTE_ARG.test(value))) fail('remote command contains an unsafe argument')
	return [SSH, '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', `IdentityAgent=${SSH_AGENT}`,
		'-o', `UserKnownHostsFile=${KNOWN_HOSTS}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
		'-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'VerifyHostKeyDNS=no', '-o', 'ForwardAgent=no',
		'-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-o', 'PasswordAuthentication=no',
		'-o', 'KbdInteractiveAuthentication=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
		'-o', 'ControlPersist=no',
		'-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-o', 'LogLevel=ERROR', '--', `root@${host}`, ...remote]
}

export function exactDemoFridayFaultApproval(encoded: Uint8Array, expectedSha256: string,
	nowSeconds: number,
	expectedDeploymentId: DemoFridayAcceptanceDeploymentId = DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID,
): DemoFridayAcceptanceFaultApprovalV1 {
	if (!HEX32.test(expectedSha256) || bytesToHex(sha256(encoded)) !== expectedSha256
		|| encoded.length < 2 || encoded.length > 8_192) fail('fault approval bytes differ from the external pin')
	let parsed: unknown
	try { parsed = JSON.parse(new TextDecoder().decode(encoded)) }
	catch { return fail('fault approval is not JSON') }
	const value = exactObject(parsed, ['schema', 'deploymentId', 'action', 'targetSlot', 'targetHostId', 'targetIpv4',
		'unit', 'notBefore', 'expiresAt', 'nonce'], 'fault approval')
	if (value.schema !== 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_APPROVAL_V1' || value.action !== 'STOP_VALIDATOR_4_ONCE'
		|| value.targetSlot !== 4 || value.targetHostId !== V4_HOST_ID || value.targetIpv4 !== V4_HOST
		|| value.unit !== VALIDATOR_UNIT || value.deploymentId !== expectedDeploymentId || !HEX32.test(String(value.nonce ?? ''))
		|| !Number.isSafeInteger(value.notBefore) || !Number.isSafeInteger(value.expiresAt)
		|| Number(value.expiresAt) <= Number(value.notBefore) || Number(value.expiresAt) - Number(value.notBefore) > 900
		|| nowSeconds < Number(value.notBefore) || nowSeconds > Number(value.expiresAt)) fail('fault approval scope or validity is invalid')
	return Object.freeze(value as unknown as DemoFridayAcceptanceFaultApprovalV1)
}

export function exactDemoFridayRecoveryApproval(encoded: Uint8Array, expectedSha256: string,
	nowSeconds: number,
	expectedDeploymentId: DemoFridayAcceptanceDeploymentId = DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID,
): DemoFridayAcceptanceRecoveryApprovalV1 {
	if (!HEX32.test(expectedSha256) || bytesToHex(sha256(encoded)) !== expectedSha256
		|| encoded.length < 2 || encoded.length > 8_192) fail('recovery approval bytes differ from the external pin')
	let parsed: unknown
	try { parsed = JSON.parse(new TextDecoder().decode(encoded)) }
	catch { return fail('recovery approval is not JSON') }
	const value = exactObject(parsed, ['schema', 'deploymentId', 'action', 'targetSlot', 'targetHostId', 'targetIpv4',
		'unit', 'notBefore', 'expiresAt', 'nonce'], 'recovery approval')
	if (value.schema !== 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_APPROVAL_V1' || value.action !== 'START_VALIDATOR_4_ONCE'
		|| value.targetSlot !== 4 || value.targetHostId !== V4_HOST_ID || value.targetIpv4 !== V4_HOST
		|| value.unit !== VALIDATOR_UNIT || value.deploymentId !== expectedDeploymentId || !HEX32.test(String(value.nonce ?? ''))
		|| !Number.isSafeInteger(value.notBefore) || !Number.isSafeInteger(value.expiresAt)
		|| Number(value.expiresAt) <= Number(value.notBefore) || Number(value.expiresAt) - Number(value.notBefore) > 900
		|| nowSeconds < Number(value.notBefore) || nowSeconds > Number(value.expiresAt)) fail('recovery approval scope or validity is invalid')
	return Object.freeze(value as unknown as DemoFridayAcceptanceRecoveryApprovalV1)
}

export function createDemoFridayValidator4FaultControl(options: {
	command: DemoFridayExactCommandPort
	approvalBytes: Uint8Array
	expectedApprovalSha256: string
	expectedUnitSha256: string
	nowSeconds?: () => number
	expectedDeploymentId?: DemoFridayAcceptanceDeploymentId
}): DemoFridayAcceptanceFaultPort {
	if (!HEX32.test(options.expectedUnitSha256)) fail('validator unit pin is invalid')
	let consumed = false
	return Object.freeze({
		async setValidatorOfflineExact(slot: 4) {
			if (slot !== 4 || consumed) fail('only one approved validator-4 fault is permitted')
			exactDemoFridayFaultApproval(options.approvalBytes, options.expectedApprovalSha256,
				(options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000)))(),
				options.expectedDeploymentId ?? DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID)
			const unit = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/sha256sum', '--', `/etc/systemd/system/${VALIDATOR_UNIT}`]), 15_000)
			if (unit.exitCode !== 0 || unit.stderr !== ''
				|| unit.stdout !== `${options.expectedUnitSha256}  /etc/systemd/system/${VALIDATOR_UNIT}\n`) {
				fail('validator-4 unit differs from the approved artifact')
			}
			const stopped = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/systemctl', 'stop', VALIDATOR_UNIT]), 20_000)
			if (stopped.exitCode !== 0 || stopped.stdout !== '' || stopped.stderr !== '') fail('validator-4 stop failed or returned diagnostics')
			const status = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/systemctl', 'is-active', VALIDATOR_UNIT]), 15_000)
			if (status.exitCode !== 3 || status.stdout !== 'inactive\n' || status.stderr !== '') fail('validator-4 did not reach exact inactive state')
			consumed = true
		},
	})
}

export function createDemoFridayValidator4RecoveryControl(options: {
	command: DemoFridayExactCommandPort
	approvalBytes: Uint8Array
	expectedApprovalSha256: string
	expectedUnitSha256: string
	nowSeconds?: () => number
	expectedDeploymentId?: DemoFridayAcceptanceDeploymentId
}): DemoFridayAcceptanceRecoveryPort {
	if (!HEX32.test(options.expectedUnitSha256)) fail('validator unit pin is invalid')
	let consumed = false
	return Object.freeze({
		async setValidatorOnlineExact(slot: 4) {
			if (slot !== 4 || consumed) fail('only one approved validator-4 recovery is permitted')
			exactDemoFridayRecoveryApproval(options.approvalBytes, options.expectedApprovalSha256,
				(options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000)))(),
				options.expectedDeploymentId ?? DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID)
			const unit = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/sha256sum', '--', `/etc/systemd/system/${VALIDATOR_UNIT}`]), 15_000)
			if (unit.exitCode !== 0 || unit.stderr !== ''
				|| unit.stdout !== `${options.expectedUnitSha256}  /etc/systemd/system/${VALIDATOR_UNIT}\n`) {
				fail('validator-4 unit differs from the approved artifact')
			}
			const before = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/systemctl', 'is-active', VALIDATOR_UNIT]), 15_000)
			if (before.exitCode !== 3 || before.stdout !== 'inactive\n' || before.stderr !== '') {
				fail('validator-4 was not in the exact approved inactive pre-state')
			}
			const started = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/systemctl', 'start', VALIDATOR_UNIT]), 20_000)
			if (started.exitCode !== 0 || started.stdout !== '' || started.stderr !== '') fail('validator-4 start failed or returned diagnostics')
			const status = await options.command.runExact(sshArgs(V4_HOST,
				['/usr/bin/systemctl', 'is-active', VALIDATOR_UNIT]), 15_000)
			if (status.exitCode !== 0 || status.stdout !== 'active\n' || status.stderr !== '') fail('validator-4 did not reach exact active state')
			consumed = true
		},
	})
}

export function createDemoFridaySshCometReader(options: {
	command: DemoFridayExactCommandPort
	expectedProbeSha256: string
	expectedDeploymentId?: DemoFridayAcceptanceDeploymentId
}): DemoParticipantConsensusReader {
	if (!HEX32.test(options.expectedProbeSha256)) fail('Comet probe pin is invalid')
	const probePath = remoteProbe(options.expectedDeploymentId ?? DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID)
	const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
		const url = new URL(input instanceof Request ? input.url : input.toString())
		if (url.origin !== 'http://127.0.0.1:27657') fail('Comet bridge received a non-loopback endpoint')
		let probe: string[]
		if (url.pathname === '/status' && url.search === '') probe = ['status']
		else if ((url.pathname === '/commit' || url.pathname === '/block') && url.searchParams.size === 1) {
			const height = exactPositive(Number(url.searchParams.get('height')), 'Comet height')
			probe = [url.pathname.slice(1), String(height)]
		} else if (url.pathname === '/abci_query' && url.searchParams.size === 1 && url.searchParams.get('path') === '"/state"') {
			probe = ['state']
		} else fail('Comet bridge RPC method is not allowlisted')
		const pin = await options.command.runExact(sshArgs(V2_HOST, ['/usr/bin/sha256sum', '--', probePath]), 15_000)
		if (pin.exitCode !== 0 || pin.stderr !== '' || pin.stdout !== `${options.expectedProbeSha256}  ${probePath}\n`) {
			fail('remote Comet probe differs from the approved artifact')
		}
		const result = await options.command.runExact(sshArgs(V2_HOST, [probePath, ...probe]), 15_000)
		if (result.exitCode !== 0 || result.stderr !== '' || result.stdout.length < 2) fail('remote Comet probe failed')
		return new Response(result.stdout, { status: 200, headers: { 'content-type': 'application/json' } })
	}
	return createLoopbackCometReader('http://127.0.0.1:27657', fetchImpl as typeof fetch)
}

export async function verifyDemoFridayAcceptanceCometPreflight(options: {
	reader: DemoParticipantConsensusReader
	chainId: string
	validatorsHash: string
	validatorRoster: readonly { slot: 1 | 2 | 3 | 4; address: string }[]
}): Promise<DemoFridayAcceptanceCometPreflightV1> {
	if (!ID.test(options.chainId) || !HEX32.test(options.validatorsHash) || options.validatorRoster.length !== 4
		|| options.validatorRoster.some((value, index) => value.slot !== index + 1 || !ADDRESS.test(value.address))
		|| new Set(options.validatorRoster.map((value) => value.address)).size !== 4) fail('Comet preflight pins are invalid')
	if (await options.reader.readChainId() !== options.chainId) fail('Comet preflight chain differs from the deployment pin')
	const authenticated = await authenticatedDemoCometState(options.reader, options.validatorsHash, 1)
	if (authenticated.observation.state.chain_id !== options.chainId) fail('Comet preflight application state belongs to another chain')
	const commit = await options.reader.readCommit(authenticated.bindingCommit.height)
	exactDemoCometCommit(commit, authenticated.bindingCommit.height, options.validatorsHash)
	const signers = new Set(commit.commitSignerAddresses)
	if (signers.size < 3 || [...signers].some((address) => !options.validatorRoster.some((entry) => entry.address === address))) {
		fail('Comet preflight commit does not contain a pinned 3-of-4 quorum')
	}
	return Object.freeze({ schema: 'PLEBEIAN_FRIDAY_ACCEPTANCE_COMET_PREFLIGHT_V1',
		trustModel: 'PINNED_LOCAL_COMET_RPC_NOT_INDEPENDENT_LIGHT_CLIENT', chainId: options.chainId,
		stateHeight: authenticated.observation.queryHeight, commitHeight: commit.height, commitSignatures: signers.size,
		onlineSlots: options.validatorRoster.filter((entry) => signers.has(entry.address)).map((entry) => entry.slot) })
}

function eventId(event: Omit<DemoFridayAcceptanceSignedEventV1, 'id' | 'sig'>): string {
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))))
}
function exactSignedCreate(value: DemoFridayAcceptanceSignedEventV1,
	expected: Omit<DemoFridayAcceptanceSignedEventV1, 'id' | 'sig'>): DemoFridayAcceptanceSignedEventV1 {
	if (value.pubkey !== expected.pubkey || value.kind !== expected.kind || value.created_at !== expected.created_at
		|| JSON.stringify(value.tags) !== JSON.stringify(expected.tags) || value.content !== expected.content
		|| value.id !== eventId(expected) || !HEX64.test(value.sig)
		|| !schnorr.verify(hexToBytes(value.sig), hexToBytes(value.id), hexToBytes(value.pubkey))) fail('NIP-07 changed or invalidly signed the exact create event')
	return structuredClone(value)
}

export function createDemoFridayAuthenticatedAcceptanceConsensus(options: {
	reader: DemoParticipantConsensusReader
	fault: DemoFridayAcceptanceFaultPort
	sellerSigner: DemoFridayAcceptanceNostrSignerPort
	chainId: string
	validatorsHash: string
	validatorRoster: readonly { slot: 1 | 2 | 3 | 4; address: string }[]
	fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
	nowSeconds?: () => number
	sleep?: (milliseconds: number) => Promise<void>
	pollIntervalMs?: number
	maxWaitMs?: number
}): DemoFridayAcceptanceConsensusPort {
	if (!ID.test(options.chainId) || !HEX32.test(options.validatorsHash) || options.validatorRoster.length !== 4
		|| options.validatorRoster.some((value, index) => value.slot !== index + 1 || !ADDRESS.test(value.address))
		|| new Set(options.validatorRoster.map((value) => value.address)).size !== 4) fail('Comet chain or validator roster pins are invalid')
	const fetchImpl = options.fetchImpl ?? fetch, now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000))
	const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
	const pollInterval = options.pollIntervalMs ?? 1_000, maxWait = options.maxWaitMs ?? 7_200_000
	if (!Number.isSafeInteger(pollInterval) || pollInterval < 100 || pollInterval > 5_000
		|| !Number.isSafeInteger(maxWait) || maxWait < 1_000 || maxWait > 7_200_000) fail('acceptance polling bounds are invalid')
	let checkedChain = false
	const state = async () => {
		if (!checkedChain) {
			if (await options.reader.readChainId() !== options.chainId) fail('Comet chain differs from the deployment pin')
			checkedChain = true
		}
		const result = await authenticatedDemoCometState(options.reader, options.validatorsHash, 1)
		if (result.observation.state.chain_id !== options.chainId) fail('authenticated application state belongs to another chain')
		return result
	}
	const auction = (raw: Record<string, any> | undefined, auctionId: string): DemoFridayAcceptanceAuctionV1 => {
		if (raw === undefined || raw.id !== auctionId || !HEX32.test(String(raw.seller ?? ''))
			|| !['open', 'closed'].includes(String(raw.status ?? '')) || !Number.isSafeInteger(raw.original_end_time)
			|| !Number.isSafeInteger(raw.end_time) || !Number.isSafeInteger(raw.extension_count)
			|| !Number.isSafeInteger(raw.high_bid)) fail('authenticated auction is malformed')
		return { auctionId, seller: raw.seller, status: raw.status, originalEndTime: raw.original_end_time,
			endTime: raw.end_time, extensionCount: raw.extension_count, leaderActor: raw.leader_bid_id === '' ? '' : '',
			leaderBidId: raw.leader_bid_id ?? '', leaderCommittedAt: 0, highBid: raw.high_bid, winner: raw.winner ?? '' }
	}
	const readAuction = async (auctionId: string) => {
		if (!ID.test(auctionId)) fail('auction id is invalid')
		const authenticated = await state(), raw = authenticated.observation.state as any
		const value = auction(raw.auctions?.[auctionId], auctionId)
		if (value.leaderBidId !== '') {
			const bid = raw.bids?.[value.leaderBidId]
			if (bid === undefined || !HEX32.test(String(bid.bidder ?? '')) || bid.amount !== value.highBid
				|| !Number.isSafeInteger(bid.committed_at) || bid.committed_at < 1) fail('authenticated leader bid is malformed')
			value.leaderActor = bid.bidder
			value.leaderCommittedAt = bid.committed_at
		}
		return value
	}
	const poll = async (label: string, test: () => Promise<DemoFridayAcceptanceAuctionV1 | null>) => {
		const started = Date.now()
		for (;;) {
			const value = await test(); if (value !== null) return value
			if (Date.now() - started >= maxWait) fail(`${label} exceeded its bounded wait`)
			await sleep(pollInterval)
		}
	}
	const post = async (path: '/api/event' | '/api/close', body: unknown, expectedTransaction: Uint8Array) => {
		const response = await fetchImpl(`${ACCEPTANCE_ORIGIN}${path}`, { method: 'POST', headers: {
			accept: 'application/json', 'content-type': 'application/json',
		}, body: JSON.stringify(body) })
		let value: any
		try { value = await response.json() } catch { return fail('Friday site returned non-JSON') }
		if (!response.ok || !Number.isSafeInteger(value.height) || value.height < 1
			|| typeof value.tx_hash !== 'string' || !/^[0-9A-F]{64}$/.test(value.tx_hash)
			|| Number(value.check_code) !== 0 || Number(value.deliver_code) !== 0) fail('Friday site did not return one committed transaction receipt')
		const expectedHash = bytesToHex(sha256(expectedTransaction)).toUpperCase()
		if (value.tx_hash !== expectedHash) fail('Friday site receipt hash differs from the exact requested transaction')
		const height = Number(value.height)
		const [commit, block] = await Promise.all([options.reader.readCommit(height), options.reader.readBlock(height)])
		const authenticatedCommit = exactDemoCometCommit(commit, height, options.validatorsHash)
		const transactionSigners = new Set(commit.commitSignerAddresses)
		if (transactionSigners.size < 3
			|| [...transactionSigners].some((address) => !options.validatorRoster.some((entry) => entry.address === address))) {
			fail('transaction commit does not contain a unique pinned 3-of-4 quorum')
		}
		if (block.height !== height || block.blockHash !== authenticatedCommit.blockHash
			|| block.transactions.filter((transaction) => bytesToHex(transaction) === bytesToHex(expectedTransaction)).length !== 1) {
			fail('Friday site receipt is not bound to one exact transaction in the pinned canonical block')
		}
		return { height, commitTime: authenticatedCommit.blockTime }
	}
	const port: DemoFridayAcceptanceConsensusPort = {
		async createAuctionExact(request) {
			if (!ID.test(request.auctionId) || !HEX32.test(request.sellerActor)
				|| !/^(?:02|03)[0-9a-f]{64}$/.test(request.sellerPaymentPublicKey)
				|| !Number.isSafeInteger(request.durationSeconds) || request.durationSeconds < 600
				|| !Number.isSafeInteger(request.startingBid) || request.startingBid < 1 || request.minIncrement !== 100 || request.reserve !== 0
				|| await options.sellerSigner.getPublicKey() !== request.sellerActor) fail('auction create request differs from exact acceptance policy')
			const unsigned = { pubkey: request.sellerActor, created_at: now(), kind: 28640 as const,
				tags: [['auction', request.auctionId]], content: JSON.stringify({ auction_id: request.auctionId,
					title: request.auctionId, description: 'Friday FIPS/FROST Coco v2 acceptance', image_url: '',
					duration_seconds: request.durationSeconds, starting_bid: request.startingBid,
					min_increment: request.minIncrement, reserve: request.reserve, funding_mode: 'threshold_sigall_v1',
					seller_coco_payment_public_key: request.sellerPaymentPublicKey }) }
			const signed = exactSignedCreate(await options.sellerSigner.signEvent(structuredClone(unsigned)), unsigned)
			const expectedTransaction = utf8ToBytes(JSON.stringify({ version: 1, type: 'event', event: { id: signed.id,
				pubkey: signed.pubkey, created_at: signed.created_at, kind: signed.kind, tags: signed.tags,
				content: signed.content, sig: signed.sig } }))
			const transaction = await post('/api/event', signed, expectedTransaction)
			await poll('auction creation finality', async () => {
				const authenticated = await state()
				if (authenticated.observation.queryHeight < transaction.height) return null
				if (authenticated.observation.state.auctions?.[request.auctionId] === undefined) return null
				const value = await readAuction(request.auctionId)
				const raw = (authenticated.observation.state as any).auctions[request.auctionId]
				if (value.seller !== request.sellerActor || value.status !== 'open' || value.leaderBidId !== ''
					|| raw.seller_coco_payment_public_key !== request.sellerPaymentPublicKey
					|| raw.funding_mode !== 'threshold_sigall_v1' || raw.reserve !== request.reserve
					|| value.originalEndTime - transaction.commitTime !== request.durationSeconds) {
					fail('committed auction differs from the exact signed create request')
				}
				return value
			})
		},
		readAuctionExact: readAuction,
		waitForLeaderExact(request) { return poll('leader finality', async () => {
			const value = await readAuction(request.auctionId)
			return value.leaderActor === request.actor && value.highBid === request.amount ? value : null
		}) },
		waitUntilLateWindowExact(request) { return poll('late-bid window', async () => {
			const authenticated = await state(), raw = authenticated.observation.state as any
			const value = await readAuction(request.auctionId)
			return value.status === 'open' && Number(raw.last_consensus_time) >= value.endTime - request.windowSeconds ? value : null
		}) },
		waitUntilCloseEligibleExact(auctionId) { return poll('close eligibility', async () => {
			const authenticated = await state(), raw = authenticated.observation.state as any
			const value = await readAuction(auctionId)
			return value.status === 'open' && Number(raw.last_consensus_time) >= value.endTime ? value : null
		}) },
		async closeAuctionExact(auctionId) {
			if (!ID.test(auctionId)) fail('close auction id is invalid')
			const expectedTransaction = utf8ToBytes(JSON.stringify({ version: 1, type: 'close', auction_id: auctionId }))
			const transaction = await post('/api/close', { auction_id: auctionId }, expectedTransaction)
			await poll('close transaction finality', async () => {
				const authenticated = await state()
				return authenticated.observation.queryHeight >= transaction.height ? readAuction(auctionId) : null
			})
		},
		waitUntilClosedExact(auctionId) { return poll('closed outcome', async () => {
			const value = await readAuction(auctionId); return value.status === 'closed' ? value : null
		}) },
		setValidatorOfflineExact: (slot) => options.fault.setValidatorOfflineExact(slot),
		async readValidatorsExact(): Promise<DemoFridayAcceptanceValidatorV1[]> {
			const authenticated = await state()
			const observed = await options.reader.readCommit(authenticated.bindingCommit.height)
			exactDemoCometCommit(observed, authenticated.bindingCommit.height, options.validatorsHash)
			const signers = new Set(observed.commitSignerAddresses)
			if ([...signers].some((address) => !options.validatorRoster.some((entry) => entry.address === address))) {
				fail('canonical commit contains a signer outside the pinned roster')
			}
			return options.validatorRoster.map((entry) => ({ slot: entry.slot, online: signers.has(entry.address),
				canonicalCommitHeight: authenticated.bindingCommit.height, commitSignatures: signers.size }))
		},
	}
	return Object.freeze(port)
}
