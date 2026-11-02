/**
 * Fixed-argument DKG wrapper for the isolated fake-money FIPS lab.
 *
 * It provisions one fresh 3-of-4 Rust keyset and four distinct SignerRPC
 * identities. Private material is written only to each participant's existing
 * node directory; the public result contains paths/bindings but no secrets.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { createDemoFipsDkgPhaseJournal } from './demo-fips-dkg-phase-journal'
import { provisionEphemeralDemoThreshold3 } from './demo-frost-threshold3-dkg'
import { demoDispositionEnrollmentPermit } from './demo-disposition-signer-anchor'

const APPLICATION_SCHEMA = 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2' as const
const RESULT_SCHEMA = 'PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1' as const
const RUN_ROOT_PREFIX = '/tmp/plebeian-friday-fips-lab.'

interface ApplicationConfig {
	schema: typeof APPLICATION_SCHEMA
	run_id: string
	fips_ulas: [string, string, string, string]
	comet_p2p_port: 26656
	comet_rpc_port: 26657
	signer_rpc_port: 39101
	mint_port: 3338
	network_root: string
	dkg_root: string
	driver_result: string
}

function exactKeys(value: unknown, expected: string[], label: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
		throw new Error(`DEMO_FIPS_DKG_CONFIG: ${label} has missing or unexpected fields`)
	}
}

function canonicalPath(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.startsWith(RUN_ROOT_PREFIX) || resolve(value) !== value
		|| value === '/' || value.endsWith('/') || value.includes('//')) {
		throw new Error(`DEMO_FIPS_DKG_PATH: ${label} must be a canonical path inside the fixed lab root`)
	}
	return value
}

function executablePath(value: string, label: string): string {
	if (!value.startsWith('/') || resolve(value) !== value || value === '/' || value.endsWith('/') || value.includes('//')) {
		throw new Error(`DEMO_FIPS_DKG_PATH: ${label} must be a canonical absolute executable path`)
	}
	return value
}

async function readConfig(path: string): Promise<ApplicationConfig> {
	const value = JSON.parse(await readFile(path, 'utf8')) as unknown
	exactKeys(value, [
		'schema', 'run_id', 'fips_ulas', 'comet_p2p_port', 'comet_rpc_port', 'signer_rpc_port',
		'mint_port', 'network_root', 'dkg_root', 'driver_result',
	], 'application config')
	if (value.schema !== APPLICATION_SCHEMA || typeof value.run_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.run_id)
		|| !Array.isArray(value.fips_ulas) || value.fips_ulas.length !== 4
		|| value.fips_ulas.some((entry) => typeof entry !== 'string' || !/^(?:fc|fd)[0-9a-f:]+$/i.test(entry))
		|| new Set(value.fips_ulas).size !== 4 || value.comet_p2p_port !== 26656 || value.comet_rpc_port !== 26657
		|| value.signer_rpc_port !== 39101 || value.mint_port !== 3338) {
		throw new Error('DEMO_FIPS_DKG_CONFIG: application identity, topology, or ports differ from the reviewed lab')
	}
	return {
		schema: APPLICATION_SCHEMA, run_id: value.run_id,
		fips_ulas: value.fips_ulas as ApplicationConfig['fips_ulas'], comet_p2p_port: 26656,
		comet_rpc_port: 26657, signer_rpc_port: 39101, mint_port: 3338,
		network_root: canonicalPath(value.network_root, 'network_root'),
		dkg_root: canonicalPath(value.dkg_root, 'dkg_root'),
		driver_result: canonicalPath(value.driver_result, 'driver_result'),
	}
}

function newSecret(): Uint8Array {
	for (;;) {
		const candidate = randomBytes(32)
		try { schnorr.getPublicKey(candidate); return candidate }
		catch { /* Generate another scalar in the negligible invalid case. */ }
	}
}

async function privateHex(path: string, secret: Uint8Array): Promise<string> {
	await writeFile(path, `${bytesToHex(secret)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
	return bytesToHex(schnorr.getPublicKey(secret))
}

async function publicJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
	await chmod(path, 0o600)
}

function parseArguments(): {
	config: string
	participantBinary: string
	inspectorBinary: string
	phaseJournal: string
	output: string
} {
	const argv = process.argv.slice(2)
	if (argv.length !== 11 || argv[0] !== 'provision' || argv[1] !== '--config'
		|| argv[3] !== '--participant-binary' || argv[5] !== '--inspector-binary'
		|| argv[7] !== '--phase-journal' || argv[9] !== '--output') {
		throw new Error('usage: plebeian-friday-frost-dkg provision --config PATH --participant-binary PATH --inspector-binary PATH --phase-journal PATH --output PATH')
	}
	return {
		config: canonicalPath(argv[2]!, 'config'), participantBinary: executablePath(argv[4]!, 'participant binary'),
		inspectorBinary: executablePath(argv[6]!, 'inspector binary'),
		phaseJournal: canonicalPath(argv[8]!, 'phase journal'), output: canonicalPath(argv[10]!, 'output'),
	}
}

const args = parseArguments()
const journal = await createDemoFipsDkgPhaseJournal(args.phaseJournal)
try {
	await journal.record('cli_start', 'ok')
	const config = await journal.run('config_validation', async () => {
		const value = await readConfig(args.config)
		const root = dirname(value.dkg_root)
		if (dirname(args.output) !== root || args.output === value.dkg_root
			|| dirname(args.phaseJournal) !== root || args.phaseJournal === args.output
			|| args.phaseJournal === value.dkg_root) {
			throw new Error('DEMO_FIPS_DKG_OUTPUT: result and phase journal must be distinct siblings of the dedicated DKG root')
		}
		return value
	})
	const dkg = await provisionEphemeralDemoThreshold3({
		root: config.dkg_root, participantBinaryPath: args.participantBinary, inspectorBinaryPath: args.inspectorBinary,
		dkgRunId: `${config.run_id}-dkg`, committeeKeysetId: `${config.run_id}-committee`, committeeKeysetVersion: '1',
		phaseJournal: journal,
	})
	const { coordinatorIdentity, participants } = await journal.run('rpc_identity_persistence', async () => {
		const coordinatorIdentity = await privateHex(join(dirname(config.dkg_root), 'node-1', 'coordinator-rpc-identity.key'), newSecret())
		const participants = []
		for (const participant of dkg.participants) {
			const nodeRoot = join(dirname(config.dkg_root), `node-${participant.participantId}`)
			await mkdir(join(nodeRoot, 'scratch'), { mode: 0o700 })
			await chmod(join(nodeRoot, 'scratch'), 0o700)
			const signerIdentity = await privateHex(
				join(nodeRoot, 'signer-rpc-identity.key'), newSecret(),
			)
			await publicJson(join(nodeRoot, 'terminal-enrollment-permit.json'), demoDispositionEnrollmentPermit({
				participantId: participant.participantId, dkgRunId: dkg.dkgRunId,
				publicKeyPackageSha256: dkg.publicKeyPackageSha256, signerRosterDigest: dkg.signerRosterDigest,
			}))
			participants.push({ ...participant, signerIdentity, signerEndpoint: `http://[${config.fips_ulas[participant.participantId - 1]}]:39101/v1/frost` })
		}
		return { coordinatorIdentity, participants }
	})
	await journal.run('result_persistence', async () => publicJson(args.output, {
		schema: RESULT_SCHEMA, runId: config.run_id, dkgRunId: dkg.dkgRunId,
		committeeKeysetId: dkg.committeeKeysetId, committeeKeysetVersion: dkg.committeeKeysetVersion,
		publicKeyPackagePath: dkg.publicKeyPackagePath, publicKeyPackageSha256: dkg.publicKeyPackageSha256,
		signerRosterDigest: dkg.signerRosterDigest, committeePublicKey: dkg.committeePublicKey,
		coordinatorIdentity, participants,
	}))
	await journal.record('cli_complete', 'ok')
} finally {
	await journal.close()
}
