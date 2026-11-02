#!/usr/bin/env bun
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { lstat, open, realpath } from 'node:fs/promises'
import { bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

import {
	createBunExactCommandRunner,
	createDemoFridaySshCometReader,
	createDemoFridayValidator4FaultControl,
	createDemoFridayValidator4RecoveryControl,
	DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID,
	exactDemoFridayFaultApproval,
	exactDemoFridayRecoveryApproval,
	type DemoFridayAcceptanceDeploymentId,
	type DemoFridayAcceptanceCometPreflightV1,
	verifyDemoFridayAcceptanceCometPreflight,
	type DemoFridayExactCommandPort,
} from './demo-friday-browser-acceptance-adapters'

const HEX32 = /^[0-9a-f]{64}$/
const ADDRESS = /^[0-9A-F]{40}$/
const ID = /^[A-Za-z0-9_-]{1,160}$/
export const DEMO_FRIDAY_FAULT_CONSUMPTION_ROOT = '/var/lib/plebeian-auctions-friday-operator/acceptance-fault' as const
export const DEMO_FRIDAY_RECOVERY_CONSUMPTION_ROOT = '/var/lib/plebeian-auctions-friday-operator/acceptance-recovery' as const

function fail(): never { throw new Error('Friday acceptance operator command rejected') }
function usage(): never {
	throw new Error('usage: plebeian-friday-acceptance-operator verify-comet --probe-sha256 HEX --chain-id ID --validators-hash HEX --validator-addresses A1,A2,A3,A4 | validator-4-offline --approval ABS --approval-sha256 HEX --unit-sha256 HEX | validator-4-online --approval ABS --approval-sha256 HEX --unit-sha256 HEX --probe-sha256 HEX --chain-id ID --validators-hash HEX --validator-addresses A1,A2,A3,A4')
}

async function exactPublicBytes(path: string): Promise<Uint8Array> {
	if (!path.startsWith('/') || path.includes('\0')) fail()
	const before = await lstat(path)
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || await realpath(path) !== path) fail()
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | 0o2000000)
	try {
		const opened = await handle.stat()
		if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) fail()
		const bytes = await handle.readFile()
		if (bytes.length < 2 || bytes.length > 8_192) fail()
		return bytes
	} finally { await handle.close() }
}

export interface DemoFridayFaultConsumptionReservation {
	finalize(result: unknown): Promise<void>
	close(): Promise<void>
}

async function reserveConsumption(approvalSha256: string, root: string,
	schema: 'PLEBEIAN_FRIDAY_FAULT_CONSUMPTION_V1' | 'PLEBEIAN_FRIDAY_RECOVERY_CONSUMPTION_V1',
): Promise<DemoFridayFaultConsumptionReservation> {
	if (!HEX32.test(approvalSha256)) fail()
	const rootBefore = await lstat(root)
	if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() || rootBefore.uid !== 0
		|| (rootBefore.mode & 0o777) !== 0o700 || await realpath(root) !== root) fail()
	const rootHandle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		const opened = await rootHandle.stat()
		if (!opened.isDirectory() || opened.dev !== rootBefore.dev || opened.ino !== rootBefore.ino
			|| opened.uid !== 0 || (opened.mode & 0o777) !== 0o700) fail()
	} finally { await rootHandle.close() }
	const path = `${root}/${approvalSha256}.json`
	const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
	let closed = false
	const write = async (status: 'reserved' | 'completed', result?: unknown) => {
		const value = `${JSON.stringify({ schema, approvalSha256, status,
			...(result === undefined ? {} : { result }) })}\n`
		await handle.truncate(0); await handle.write(value, 0, 'utf8'); await handle.sync()
	}
	await write('reserved')
	const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY)
	try { await parent.sync() } finally { await parent.close() }
	return {
		async finalize(result) { if (closed) fail(); await write('completed', result) },
		async close() { if (!closed) { closed = true; await handle.close() } },
	}
}

async function waitForValidator4Rejoin(read: () => Promise<DemoFridayAcceptanceCometPreflightV1>, options: {
	nowMilliseconds?: () => number
	sleep?: (milliseconds: number) => Promise<void>
	maxWaitMs?: number
} = {}): Promise<DemoFridayAcceptanceCometPreflightV1> {
	const now = options.nowMilliseconds ?? Date.now, sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
	const maxWaitMs = options.maxWaitMs ?? 60_000
	if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1_000 || maxWaitMs > 120_000) fail()
	const started = now()
	for (;;) {
		const observed = await read()
		if (observed.commitSignatures === 4 && observed.onlineSlots.length === 4
			&& observed.onlineSlots.every((slot, index) => slot === index + 1)) return observed
		if (now() - started >= maxWaitMs) throw new Error('validator-4 did not rejoin a four-signature canonical commit within the bound')
		await sleep(1_000)
	}
}

export async function runDemoFridayAcceptanceOperatorCli(argv = process.argv.slice(2), dependencies: {
	command?: DemoFridayExactCommandPort
	nowSeconds?: () => number
	reserveFaultConsumption?: (approvalSha256: string) => Promise<DemoFridayFaultConsumptionReservation>
	reserveRecoveryConsumption?: (approvalSha256: string) => Promise<DemoFridayFaultConsumptionReservation>
	verifyRecoveryRejoin?: () => Promise<DemoFridayAcceptanceCometPreflightV1>
	nowMilliseconds?: () => number
	sleep?: (milliseconds: number) => Promise<void>
	maxRejoinWaitMs?: number
	expectedDeploymentId?: DemoFridayAcceptanceDeploymentId
} = {}): Promise<unknown> {
	const command = dependencies.command ?? createBunExactCommandRunner()
	if (argv[0] === 'verify-comet') {
		if (argv.length !== 9 || argv[1] !== '--probe-sha256' || argv[3] !== '--chain-id'
			|| argv[5] !== '--validators-hash' || argv[7] !== '--validator-addresses') usage()
		const addresses = argv[8]!.split(',')
		if (!HEX32.test(argv[2]!) || !ID.test(argv[4]!) || !HEX32.test(argv[6]!) || addresses.length !== 4
			|| addresses.some((address) => !ADDRESS.test(address))) fail()
		return verifyDemoFridayAcceptanceCometPreflight({
			reader: createDemoFridaySshCometReader({ command, expectedProbeSha256: argv[2]!,
				expectedDeploymentId: dependencies.expectedDeploymentId }),
			chainId: argv[4]!, validatorsHash: argv[6]!,
			validatorRoster: addresses.map((address, index) => ({ slot: (index + 1) as 1 | 2 | 3 | 4, address })),
		})
	}
	if (argv[0] === 'validator-4-offline') {
		if (argv.length !== 7 || argv[1] !== '--approval' || argv[3] !== '--approval-sha256'
			|| argv[5] !== '--unit-sha256') usage()
		if (!HEX32.test(argv[4]!) || !HEX32.test(argv[6]!)) fail()
		const bytes = await exactPublicBytes(argv[2]!)
		const expectedDeploymentId = dependencies.expectedDeploymentId ?? DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID
		exactDemoFridayFaultApproval(bytes, argv[4]!,
			(dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1_000)))(), expectedDeploymentId)
		const reserved = await (dependencies.reserveFaultConsumption
			?? ((hash) => reserveConsumption(hash, DEMO_FRIDAY_FAULT_CONSUMPTION_ROOT,
				'PLEBEIAN_FRIDAY_FAULT_CONSUMPTION_V1')))(argv[4]!)
		try {
			const fault = createDemoFridayValidator4FaultControl({ command, approvalBytes: bytes,
				expectedApprovalSha256: argv[4]!, expectedUnitSha256: argv[6]!, nowSeconds: dependencies.nowSeconds,
				expectedDeploymentId })
			await fault.setValidatorOfflineExact(4)
			const result = { schema: 'PLEBEIAN_FRIDAY_VALIDATOR_FAULT_RESULT_V1', slot: 4, status: 'inactive',
				approvalSha256: bytesToHex(sha256(bytes)) }
			await reserved.finalize(result)
			return result
		} finally { await reserved.close() }
	}
	if (argv[0] === 'validator-4-online') {
		if (argv.length !== 15 || argv[1] !== '--approval' || argv[3] !== '--approval-sha256'
			|| argv[5] !== '--unit-sha256' || argv[7] !== '--probe-sha256' || argv[9] !== '--chain-id'
			|| argv[11] !== '--validators-hash' || argv[13] !== '--validator-addresses') usage()
		const addresses = argv[14]!.split(',')
		if (!HEX32.test(argv[4]!) || !HEX32.test(argv[6]!) || !HEX32.test(argv[8]!)
			|| !ID.test(argv[10]!) || !HEX32.test(argv[12]!) || addresses.length !== 4
			|| addresses.some((address) => !ADDRESS.test(address))) fail()
		const bytes = await exactPublicBytes(argv[2]!)
		const expectedDeploymentId = dependencies.expectedDeploymentId ?? DEMO_FRIDAY_ACCEPTANCE_R14_DEPLOYMENT_ID
		exactDemoFridayRecoveryApproval(bytes, argv[4]!,
			(dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1_000)))(), expectedDeploymentId)
		const reserved = await (dependencies.reserveRecoveryConsumption
			?? ((hash) => reserveConsumption(hash, DEMO_FRIDAY_RECOVERY_CONSUMPTION_ROOT,
				'PLEBEIAN_FRIDAY_RECOVERY_CONSUMPTION_V1')))(argv[4]!)
		try {
			const recovery = createDemoFridayValidator4RecoveryControl({ command, approvalBytes: bytes,
				expectedApprovalSha256: argv[4]!, expectedUnitSha256: argv[6]!, nowSeconds: dependencies.nowSeconds,
				expectedDeploymentId })
			await recovery.setValidatorOnlineExact(4)
			const read = dependencies.verifyRecoveryRejoin ?? (() => verifyDemoFridayAcceptanceCometPreflight({
				reader: createDemoFridaySshCometReader({ command, expectedProbeSha256: argv[8]!, expectedDeploymentId }),
				chainId: argv[10]!, validatorsHash: argv[12]!,
				validatorRoster: addresses.map((address, index) => ({ slot: (index + 1) as 1 | 2 | 3 | 4, address })),
			}))
			const rejoin = await waitForValidator4Rejoin(read, { nowMilliseconds: dependencies.nowMilliseconds,
				sleep: dependencies.sleep, maxWaitMs: dependencies.maxRejoinWaitMs })
			const result = { schema: 'PLEBEIAN_FRIDAY_VALIDATOR_RECOVERY_RESULT_V1', slot: 4, status: 'active_rejoined',
				approvalSha256: bytesToHex(sha256(bytes)), commitHeight: rejoin.commitHeight,
				commitSignatures: rejoin.commitSignatures }
			await reserved.finalize(result)
			return result
		} finally { await reserved.close() }
	}
	usage()
}

if (import.meta.main) {
	try { process.stdout.write(`${JSON.stringify(await runDemoFridayAcceptanceOperatorCli())}\n`) }
	catch { process.stderr.write('Friday acceptance operator command rejected\n'); process.exitCode = 1 }
}
