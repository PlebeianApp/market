/**
 * Independent rollback anchor for the fake-money disposition signer path.
 *
 * Three stores participate in terminal safety: the signer metadata database,
 * the Rust nonce/operation journal tree, and the proof-use database. The
 * coordinator anchor lives outside all three and pins their independently
 * monotonic generations/revisions. A mismatch fails closed. A crash between a
 * safety-store commit and anchor update may quarantine the signer; it may not
 * silently adopt either side. Restoring every store and the independent anchor
 * to one coordinated old snapshot remains a disclosed demo limit.
 */
import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { assertDemoSignerStoreHeader, initializeDemoSignerAdmissionSchema } from './demo-signer-rpc-journal-v2'

export interface DemoDispositionSignerBindingV1 {
	schema: 'COCO_DEMO_DISPOSITION_SIGNER_BINDING_V1'
	participantId: 1 | 2 | 3 | 4
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	stateDirectoryIdentity: string
	journalGeneration: string
	restartEpoch: number
}

export interface DemoDispositionProofClaim {
	proofRef: string
	network: string
	chainId: string
	auctionId: string
	operationId: string
	policyDigest: string
}

export interface DemoDispositionEnrollmentPermitV1 {
	schema: 'COCO_DEMO_DISPOSITION_ENROLLMENT_PERMIT_V1'
	participant_id: 1 | 2 | 3 | 4
	dkg_run_id: string
	public_key_package_sha256: string
	signer_roster_digest: string
}

export interface DemoDispositionSignerAnchor {
	readonly binding: DemoDispositionSignerBindingV1
	assertRustStateCurrent(): void
	assertHealthCurrent(): void
	recordRustStateAdvance(): void
	claimProofs(claims: readonly DemoDispositionProofClaim[]): void
	claimAdmissionProofs(claims: readonly Omit<DemoDispositionProofClaim, 'policyDigest'>[]): void
	assertAdmissionJournalCurrent(): void
	recordAdmissionJournalAdvance(): void
	captureNoEffectWitness(): string
	assertNoEffectWitness(witness: string): void
	recordRpcJournalAdvance(witness: string, table: string, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>): void
	close(): void
}

interface ProofSnapshot { generation: string; revision: number; digest: string }
interface AdmissionSnapshot { generation: string; revision: number; digest: string }
interface SafetyAnchorRow {
	stable_identity: string
	maximum_restart_epoch: number
	rust_state_revision: number
	rust_state_digest: string
	proof_generation: string
	proof_revision: number
	proof_digest: string
}

const HEX_32 = /^[0-9a-f]{64}$/
const PROOF_REF = /^(?:02|03)[0-9a-f]{64}$/

function sha256(bytes: Uint8Array | string): string {
	return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}

function directoryIdentity(path: string): string {
	const exact = realpathSync(path)
	const stat = statSync(exact)
	if (!stat.isDirectory()) throw new Error('DEMO_DISPOSITION_ANCHOR_PATH: signer state is not a directory')
	return sha256(JSON.stringify(['COCO_DEMO_DISPOSITION_STATE_DIRECTORY_V1', exact, stat.dev, stat.ino]))
}

function stable(value: DemoDispositionSignerBindingV1): string {
	return JSON.stringify({
		safetySchema: 2, schema: value.schema, participantId: value.participantId, dkgRunId: value.dkgRunId,
		publicKeyPackageSha256: value.publicKeyPackageSha256, signerRosterDigest: value.signerRosterDigest,
		stateDirectoryIdentity: value.stateDirectoryIdentity, journalGeneration: value.journalGeneration,
	})
}

export function demoDispositionEnrollmentPermit(options: {
	participantId: 1 | 2 | 3 | 4
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
}): DemoDispositionEnrollmentPermitV1 {
	if (![1, 2, 3, 4].includes(options.participantId) || options.dkgRunId.length === 0
		|| !HEX_32.test(options.publicKeyPackageSha256) || !HEX_32.test(options.signerRosterDigest)) {
		throw new Error('DEMO_DISPOSITION_ENROLLMENT: invalid exact signer identity')
	}
	return {
		schema: 'COCO_DEMO_DISPOSITION_ENROLLMENT_PERMIT_V1', participant_id: options.participantId,
		dkg_run_id: options.dkgRunId, public_key_package_sha256: options.publicKeyPackageSha256,
		signer_roster_digest: options.signerRosterDigest,
	}
}

function consumeEnrollmentPermit(path: string, expected: DemoDispositionEnrollmentPermitV1): void {
	let parsed: unknown
	try { parsed = JSON.parse(readFileSync(path, 'utf8')) }
	catch { throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: missing or malformed first-enrollment permit') }
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
		|| JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([
			'dkg_run_id', 'participant_id', 'public_key_package_sha256', 'schema', 'signer_roster_digest',
		]) || JSON.stringify(parsed) !== JSON.stringify(expected)) {
		throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: first-enrollment permit belongs to another signer')
	}
	const stat = lstatSync(path)
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: enrollment permit is not a regular file')
	unlinkSync(path)
	const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY)
	try { fsyncSync(directory) } finally { closeSync(directory) }
}

function exactSafetyFile(path: string, label: string): { name: string; digest: string } {
	const stat = lstatSync(path)
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`DEMO_DISPOSITION_SIGNER_QUARANTINED: ${label} is not a regular file`)
	return { name: label, digest: sha256(readFileSync(path)) }
}

/** Missing stores are permitted before their first operation, never malformed stores. */
function optionalSafetyStat(path: string): ReturnType<typeof lstatSync> | undefined {
	try { return lstatSync(path) }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

/** Hashes the actual Rust DKG share, operation ownership, and nonce journals. */
function rustStateDigest(stateDirectory: string): string {
	const entries = [exactSafetyFile(join(stateDirectory, 'dkg-final.state'), 'dkg-final.state')]
	function operations(directory: string): void {
		const path = join(stateDirectory, directory)
		const stat = optionalSafetyStat(path)
		if (stat === undefined) return
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`DEMO_DISPOSITION_SIGNER_QUARANTINED: ${directory} is not a regular directory`)
		for (const name of readdirSync(path).sort()) {
			if (!/^[0-9a-f]{64}\.json$/.test(name)) throw new Error(`DEMO_DISPOSITION_SIGNER_QUARANTINED: unexpected ${directory} claim`)
			// An entry disappearing after enumeration is an error, not an absent store.
			entries.push(exactSafetyFile(join(path, name), `${directory}/${name}`))
		}
	}
	function durableBinding(name: string): void {
		if (optionalSafetyStat(join(stateDirectory, name)) !== undefined) {
			entries.push(exactSafetyFile(join(stateDirectory, name), name))
		}
	}
	operations('operations')
	operations('funding-abort-operations')
	durableBinding('funding-abort-durable-binding.json')
	const names = readdirSync(stateDirectory).sort()
	for (const prefix of ['sign-', 'funding-abort-sign-', 'admission-sign-']) {
		for (const name of names.filter((value) => value.startsWith(prefix))) {
			if (!new RegExp(`^${prefix}[0-9a-f]{64}\\.journal$`).test(name)) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: unexpected Rust nonce journal')
			}
			entries.push(exactSafetyFile(join(stateDirectory, name), name))
		}
	}
	// Keep the pre-existing digest ordering for a signer with no admission state.
	for (const name of names) {
		if ((name.startsWith('admission-sign') && !/^admission-sign-[0-9a-f]{64}\.journal$/.test(name))
			|| (name.startsWith('admission-operations') && name !== 'admission-operations')
			|| (name.startsWith('admission-durable-binding') && name !== 'admission-durable-binding.json')) {
			throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: unexpected admission safety entry')
		}
	}
	operations('admission-operations')
	durableBinding('admission-durable-binding.json')
	return sha256(JSON.stringify(['COCO_DEMO_RUST_SIGNER_SAFETY_STATE_V1', entries]))
}

function proofSnapshot(database: Database): ProofSnapshot {
	const metadata = database.query<{ store_generation: string; revision: number }, []>(
		'SELECT store_generation,revision FROM terminal_proof_metadata WHERE id=1',
	).get()
	if (metadata === null || !HEX_32.test(metadata.store_generation)
		|| !Number.isSafeInteger(metadata.revision) || metadata.revision < 0) {
		throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: proof-use metadata is invalid')
	}
	const rows = database.query<{
		proof_ref: string; network: string; chain_id: string; auction_id: string; operation_id: string; policy_digest: string
	}, []>('SELECT proof_ref,network,chain_id,auction_id,operation_id,policy_digest FROM terminal_proof_claims ORDER BY proof_ref').all()
	return {
		generation: metadata.store_generation, revision: metadata.revision,
		digest: sha256(JSON.stringify(['COCO_DEMO_TERMINAL_PROOF_USE_STATE_V1', rows])),
	}
}

function admissionSnapshot(database: Database, undo?: { table: string; id: string; prior: Record<string, unknown> | null }): AdmissionSnapshot {
	const metadata = database.query<{ store_generation: string; revision: number }, []>(
		'SELECT store_generation,revision FROM admission_safety_metadata WHERE id=1',
	).get()
	if (metadata === null || !HEX_32.test(metadata.store_generation)
		|| !Number.isSafeInteger(metadata.revision) || metadata.revision < 0) {
		throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission safety metadata is invalid')
	}
	const proofRows = database.query<{
		proof_ref: string; network: string; chain_id: string; auction_id: string; funding_operation_id: string
	}, []>('SELECT proof_ref,network,chain_id,auction_id,funding_operation_id FROM fips_admission_proof_claims ORDER BY proof_ref').all()
	const rpcRows = database.query<{
		request_id: string; request_digest: string; status: string; response_json: string | null
	}, []>('SELECT request_id,request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness FROM demo_fips_admission_rpc_journal ORDER BY request_id').all()
	const abortRpcRows = database.query<{
		request_id: string; request_digest: string; status: string; response_json: string | null
	}, []>('SELECT request_id,request_digest,status,response_json,rejection_reason,rejection_status,rejection_body,safety_witness FROM demo_fips_funding_abort_rpc_journal ORDER BY request_id').all()
	const revert = (table: string, rows: unknown[]) => {
		if (undo?.table !== table) return rows
		const reverted = (rows as Record<string, unknown>[]).filter((row) => row.request_id !== undo.id)
		if (undo.prior !== null) reverted.push(undo.prior)
		return reverted.sort((a, b) => String(a.request_id).localeCompare(String(b.request_id)))
	}
	return {
		generation: metadata.store_generation, revision: metadata.revision - (undo ? 1 : 0),
		digest: sha256(JSON.stringify(['COCO_DEMO_ADMISSION_SAFETY_STATE_V3_STORAGE2',
			database.query("SELECT name,type,sql FROM sqlite_master WHERE tbl_name IN ('admission_safety_metadata','fips_admission_proof_claims','demo_fips_admission_rpc_journal','demo_fips_funding_abort_rpc_journal') ORDER BY name").all(), proofRows, revert('demo_fips_admission_rpc_journal', rpcRows), revert('demo_fips_funding_abort_rpc_journal', abortRpcRows)])),
	}
}

export function openDemoDispositionSignerAnchor(options: {
	participantId: 1 | 2 | 3 | 4
	dkgRunId: string
	publicKeyPackageSha256: string
	signerRosterDigest: string
	stateDirectory: string
	signerMetadataPath: string
	proofUsePath: string
	coordinatorAnchorPath: string
	initialEnrollmentPermitPath: string
	admissionSafetyPath?: string
}): DemoDispositionSignerAnchor {
	if (![1, 2, 3, 4].includes(options.participantId) || options.dkgRunId.length === 0
		|| !HEX_32.test(options.publicKeyPackageSha256) || !HEX_32.test(options.signerRosterDigest)
		|| !options.signerMetadataPath.startsWith(`${options.stateDirectory}/`)
		|| options.proofUsePath.startsWith(`${options.stateDirectory}/`)
		|| options.coordinatorAnchorPath.startsWith(`${options.stateDirectory}/`)
		|| options.proofUsePath === options.coordinatorAnchorPath
		|| (options.admissionSafetyPath !== undefined && (!options.admissionSafetyPath.startsWith('/')
			|| options.admissionSafetyPath.startsWith(`${options.stateDirectory}/`)
			|| [options.proofUsePath, options.coordinatorAnchorPath].includes(options.admissionSafetyPath)))
		|| [options.stateDirectory, options.signerMetadataPath, options.proofUsePath, options.coordinatorAnchorPath]
			.some((path) => options.initialEnrollmentPermitPath === path || options.initialEnrollmentPermitPath.startsWith(`${path}/`))
		|| !options.signerMetadataPath.startsWith('/') || !options.proofUsePath.startsWith('/')
		|| !options.coordinatorAnchorPath.startsWith('/') || !options.initialEnrollmentPermitPath.startsWith('/')) {
		throw new Error('DEMO_DISPOSITION_ANCHOR_CONFIG: exact independent signer, proof-use, and anchor paths are required')
	}
	const storePaths = [options.signerMetadataPath, options.proofUsePath, options.coordinatorAnchorPath,
		...(options.admissionSafetyPath === undefined ? [] : [options.admissionSafetyPath])]
	const existing = storePaths.map(assertDemoSignerStoreHeader)
	if (existing.some(Boolean) && existing.some((value) => !value)) {
		throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: independent anchor is missing after signer initialization or partial stores restored')
	}
	const freshStores = !existing.some(Boolean)
	const stateDirectoryIdentity = directoryIdentity(options.stateDirectory)
	const signer = new Database(options.signerMetadataPath, { create: true, strict: true })
	const proofUse = new Database(options.proofUsePath, { create: true, strict: true })
	const coordinator = new Database(options.coordinatorAnchorPath, { create: true, strict: true })
	const admission = options.admissionSafetyPath === undefined ? null
		: new Database(options.admissionSafetyPath, { create: true, strict: true })
	try {
		signer.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS disposition_signer_metadata (
				id INTEGER PRIMARY KEY CHECK(id=1), stable_json TEXT NOT NULL,
				journal_generation TEXT NOT NULL, restart_epoch INTEGER NOT NULL
			) STRICT;`)
		proofUse.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS terminal_proof_metadata (
				id INTEGER PRIMARY KEY CHECK(id=1), store_generation TEXT NOT NULL, revision INTEGER NOT NULL
			) STRICT;
			CREATE TABLE IF NOT EXISTS terminal_proof_claims (
				proof_ref TEXT PRIMARY KEY, network TEXT NOT NULL, chain_id TEXT NOT NULL,
				auction_id TEXT NOT NULL, operation_id TEXT NOT NULL, policy_digest TEXT NOT NULL
			) STRICT;`)
		proofUse.query('INSERT OR IGNORE INTO terminal_proof_metadata(id,store_generation,revision) VALUES(1,?,0)')
			.run(randomBytes(32).toString('hex'))
		if (admission !== null) initializeDemoSignerAdmissionSchema(admission)
		if (freshStores) {
			for (const database of [signer, proofUse, coordinator]) database.exec('PRAGMA user_version=2')
		}

		const advance = signer.transaction((): DemoDispositionSignerBindingV1 => {
			const row = signer.query<{ stable_json: string; journal_generation: string; restart_epoch: number }, []>(
				'SELECT stable_json,journal_generation,restart_epoch FROM disposition_signer_metadata WHERE id=1',
			).get()
			const identity = {
				participantId: options.participantId, dkgRunId: options.dkgRunId,
				publicKeyPackageSha256: options.publicKeyPackageSha256,
				signerRosterDigest: options.signerRosterDigest, stateDirectoryIdentity,
			}
			const storedIdentity = JSON.stringify({ ...identity, safetySchema: 2 })
			if (row === null) {
				const journalGeneration = randomBytes(32).toString('hex')
				signer.query('INSERT INTO disposition_signer_metadata(id,stable_json,journal_generation,restart_epoch) VALUES(1,?,?,1)')
					.run(storedIdentity, journalGeneration)
				return { schema: 'COCO_DEMO_DISPOSITION_SIGNER_BINDING_V1', ...identity, journalGeneration, restartEpoch: 1 }
			}
			if (row.stable_json !== storedIdentity || !HEX_32.test(row.journal_generation)
				|| !Number.isSafeInteger(row.restart_epoch) || row.restart_epoch < 1) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: signer metadata identity changed')
			}
			const restartEpoch = row.restart_epoch + 1
			if (!Number.isSafeInteger(restartEpoch)) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: restart epoch overflow')
			signer.query('UPDATE disposition_signer_metadata SET restart_epoch=? WHERE id=1 AND restart_epoch=?')
				.run(restartEpoch, row.restart_epoch)
			return {
				schema: 'COCO_DEMO_DISPOSITION_SIGNER_BINDING_V1', ...identity,
				journalGeneration: row.journal_generation, restartEpoch,
			}
		})
		const binding = advance.immediate()
		let expectedRustDigest = rustStateDigest(options.stateDirectory)
		let expectedProof = proofSnapshot(proofUse)
		let expectedAdmission = admission === null ? null : admissionSnapshot(admission)
		let expectedRustRevision = 0
		coordinator.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			CREATE TABLE IF NOT EXISTS disposition_signer_safety_anchor (
				participant_id INTEGER PRIMARY KEY, stable_identity TEXT NOT NULL,
				maximum_restart_epoch INTEGER NOT NULL, rust_state_revision INTEGER NOT NULL,
				rust_state_digest TEXT NOT NULL, proof_generation TEXT NOT NULL,
				proof_revision INTEGER NOT NULL, proof_digest TEXT NOT NULL
			) STRICT;`)
		const observe = coordinator.transaction(() => {
			const row = coordinator.query<SafetyAnchorRow, [number]>(
				`SELECT stable_identity,maximum_restart_epoch,rust_state_revision,rust_state_digest,
					proof_generation,proof_revision,proof_digest
				 FROM disposition_signer_safety_anchor WHERE participant_id=?`,
			).get(binding.participantId)
			const identity = stable(binding)
			if (row === null) {
				if (binding.restartEpoch !== 1) {
					throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: independent anchor is missing after signer initialization')
				}
				consumeEnrollmentPermit(options.initialEnrollmentPermitPath, demoDispositionEnrollmentPermit({
					participantId: binding.participantId, dkgRunId: binding.dkgRunId,
					publicKeyPackageSha256: binding.publicKeyPackageSha256,
					signerRosterDigest: binding.signerRosterDigest,
				}))
				coordinator.query(`INSERT INTO disposition_signer_safety_anchor(
					participant_id,stable_identity,maximum_restart_epoch,rust_state_revision,rust_state_digest,
					proof_generation,proof_revision,proof_digest) VALUES(?,?,?,?,?,?,?,?)`)
					.run(binding.participantId, identity, binding.restartEpoch, 0, expectedRustDigest,
						expectedProof.generation, expectedProof.revision, expectedProof.digest)
				return
			}
			if (row.stable_identity !== identity) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: signer generation, DKG, roster, or directory changed')
			}
			if (binding.restartEpoch <= row.maximum_restart_epoch) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: signer restart epoch regressed or was reused')
			}
			if (row.rust_state_digest !== expectedRustDigest) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: Rust nonce/operation journal was restored or replaced')
			}
			if (row.proof_generation !== expectedProof.generation || row.proof_revision !== expectedProof.revision
				|| row.proof_digest !== expectedProof.digest) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: proof-use store was restored or replaced')
			}
			expectedRustRevision = row.rust_state_revision
			const updated = coordinator.query('UPDATE disposition_signer_safety_anchor SET maximum_restart_epoch=? WHERE participant_id=? AND maximum_restart_epoch=?')
				.run(binding.restartEpoch, binding.participantId, row.maximum_restart_epoch)
			if (updated.changes !== 1) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: anchor changed concurrently')
		})
		observe.immediate()
		if (admission !== null && expectedAdmission !== null) {
			coordinator.exec(`CREATE TABLE IF NOT EXISTS disposition_admission_safety_anchor (
				participant_id INTEGER PRIMARY KEY, stable_identity TEXT NOT NULL,
				maximum_restart_epoch INTEGER NOT NULL, store_generation TEXT NOT NULL,
				revision INTEGER NOT NULL, state_digest TEXT NOT NULL
			) STRICT;`)
			const bindAdmission = coordinator.transaction(() => {
				const row = coordinator.query<{
					stable_identity: string; maximum_restart_epoch: number; store_generation: string;
					revision: number; state_digest: string
				}, [number]>('SELECT stable_identity,maximum_restart_epoch,store_generation,revision,state_digest FROM disposition_admission_safety_anchor WHERE participant_id=?')
					.get(binding.participantId)
				const identity = stable(binding)
				if (row === null) {
					if (binding.restartEpoch !== 1) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission anchor is missing after signer initialization')
					coordinator.query(`INSERT INTO disposition_admission_safety_anchor(
						participant_id,stable_identity,maximum_restart_epoch,store_generation,revision,state_digest)
						VALUES(?,?,?,?,?,?)`).run(binding.participantId, identity, binding.restartEpoch,
						expectedAdmission!.generation, expectedAdmission!.revision, expectedAdmission!.digest)
					return
				}
				if (row.stable_identity !== identity || binding.restartEpoch <= row.maximum_restart_epoch
					|| row.store_generation !== expectedAdmission!.generation || row.revision !== expectedAdmission!.revision
					|| row.state_digest !== expectedAdmission!.digest) {
					throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission RPC/proof state was restored or replaced')
				}
				const updated = coordinator.query('UPDATE disposition_admission_safety_anchor SET maximum_restart_epoch=? WHERE participant_id=? AND maximum_restart_epoch=?')
					.run(binding.restartEpoch, binding.participantId, row.maximum_restart_epoch)
				if (updated.changes !== 1) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission anchor changed concurrently')
			})
			bindAdmission.immediate()
		}

		function currentAnchor(): SafetyAnchorRow {
			const row = coordinator.query<SafetyAnchorRow, [number]>(
				`SELECT stable_identity,maximum_restart_epoch,rust_state_revision,rust_state_digest,
					proof_generation,proof_revision,proof_digest
				 FROM disposition_signer_safety_anchor WHERE participant_id=?`,
			).get(binding.participantId)
			if (row === null || row.stable_identity !== stable(binding) || row.maximum_restart_epoch !== binding.restartEpoch) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: independent anchor identity changed')
			}
			return row
		}
		function assertRustStateCurrent(): void {
			const row = currentAnchor()
			if (row.rust_state_revision !== expectedRustRevision || row.rust_state_digest !== expectedRustDigest
				|| rustStateDigest(options.stateDirectory) !== expectedRustDigest) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: Rust nonce/operation journal changed outside anchored transition')
			}
		}
		function recordRustStateAdvance(): void {
			const row = currentAnchor()
			if (row.rust_state_revision !== expectedRustRevision || row.rust_state_digest !== expectedRustDigest) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: Rust journal anchor changed concurrently')
			}
			const nextDigest = rustStateDigest(options.stateDirectory)
			if (nextDigest === expectedRustDigest) return
			const nextRevision = expectedRustRevision + 1
			const updated = coordinator.query(`UPDATE disposition_signer_safety_anchor
				SET rust_state_revision=?,rust_state_digest=?
				WHERE participant_id=? AND rust_state_revision=? AND rust_state_digest=?`)
				.run(nextRevision, nextDigest, binding.participantId, expectedRustRevision, expectedRustDigest)
			if (updated.changes !== 1) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: Rust journal anchor update raced')
			expectedRustRevision = nextRevision
			expectedRustDigest = nextDigest
		}
		function assertProofCurrent(): void {
			const row = currentAnchor()
			const actual = proofSnapshot(proofUse)
			if (row.proof_generation !== expectedProof.generation || row.proof_revision !== expectedProof.revision
				|| row.proof_digest !== expectedProof.digest || JSON.stringify(actual) !== JSON.stringify(expectedProof)) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: proof-use store changed outside anchored transition')
			}
		}
		function claimProofs(claims: readonly DemoDispositionProofClaim[]): void {
			if (claims.length === 0) throw new Error('DEMO_DISPOSITION_PROOF_USE: no proof claims supplied')
			for (const claim of claims) {
				if (!PROOF_REF.test(claim.proofRef) || !HEX_32.test(claim.policyDigest)
					|| [claim.network, claim.chainId, claim.auctionId, claim.operationId].some((value) => value.length === 0)) {
					throw new Error('DEMO_DISPOSITION_PROOF_USE: malformed exact proof claim')
				}
			}
			assertProofCurrent()
			const changed = proofUse.transaction(() => {
				let inserted = 0
				for (const claim of claims) {
					const prior = proofUse.query<{
						network: string; chain_id: string; auction_id: string; operation_id: string; policy_digest: string
					}, [string]>('SELECT network,chain_id,auction_id,operation_id,policy_digest FROM terminal_proof_claims WHERE proof_ref=?')
						.get(claim.proofRef)
					const exact = {
						network: claim.network, chain_id: claim.chainId, auction_id: claim.auctionId,
						operation_id: claim.operationId, policy_digest: claim.policyDigest,
					}
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(exact)) {
						throw new Error('DEMO_TERMINAL_WORKER_PROOF_USE: proof belongs to another terminal operation')
					}
					if (prior === null) {
						proofUse.query('INSERT INTO terminal_proof_claims(proof_ref,network,chain_id,auction_id,operation_id,policy_digest) VALUES(?,?,?,?,?,?)')
							.run(claim.proofRef, claim.network, claim.chainId, claim.auctionId, claim.operationId, claim.policyDigest)
						inserted += 1
					}
				}
				if (inserted > 0) proofUse.query('UPDATE terminal_proof_metadata SET revision=revision+1 WHERE id=1').run()
				return inserted > 0
			}).immediate()
			const next = proofSnapshot(proofUse)
			if (!changed && JSON.stringify(next) !== JSON.stringify(expectedProof)) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: idempotent proof claim changed store')
			}
			if (!changed) return
			const updated = coordinator.query(`UPDATE disposition_signer_safety_anchor
				SET proof_revision=?,proof_digest=? WHERE participant_id=?
				AND proof_generation=? AND proof_revision=? AND proof_digest=?`)
				.run(next.revision, next.digest, binding.participantId,
					expectedProof.generation, expectedProof.revision, expectedProof.digest)
			if (updated.changes !== 1) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: proof-use anchor update raced')
			expectedProof = next
		}
		function admissionAnchorRow(): { store_generation: string; revision: number; state_digest: string } {
			if (admission === null || expectedAdmission === null) throw new Error('DEMO_DISPOSITION_ADMISSION_ANCHOR: admission safety store is not configured')
			const row = coordinator.query<{
				stable_identity: string; maximum_restart_epoch: number; store_generation: string;
				revision: number; state_digest: string
			}, [number]>('SELECT stable_identity,maximum_restart_epoch,store_generation,revision,state_digest FROM disposition_admission_safety_anchor WHERE participant_id=?')
				.get(binding.participantId)
			if (row === null || row.stable_identity !== stable(binding) || row.maximum_restart_epoch !== binding.restartEpoch) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission anchor identity changed')
			}
			return row
		}
		function assertAdmissionJournalCurrent(): void {
			if (admission === null || expectedAdmission === null) return
			const row = admissionAnchorRow(); const actual = admissionSnapshot(admission)
			if (row.store_generation !== expectedAdmission.generation || row.revision !== expectedAdmission.revision
				|| row.state_digest !== expectedAdmission.digest || JSON.stringify(actual) !== JSON.stringify(expectedAdmission)) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission RPC/proof state changed outside anchored transition')
			}
		}
		function recordAdmissionJournalAdvance(): void {
			if (admission === null || expectedAdmission === null) return
			const row = admissionAnchorRow(); const next = admissionSnapshot(admission)
			if (JSON.stringify(next) === JSON.stringify(expectedAdmission)) return
			if (next.generation !== expectedAdmission.generation || next.revision <= expectedAdmission.revision) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission safety generation/revision did not advance')
			}
			const updated = coordinator.query(`UPDATE disposition_admission_safety_anchor
				SET revision=?,state_digest=? WHERE participant_id=? AND store_generation=? AND revision=? AND state_digest=?`)
				.run(next.revision, next.digest, binding.participantId, expectedAdmission.generation,
					expectedAdmission.revision, expectedAdmission.digest)
			if (updated.changes !== 1 || row.store_generation !== expectedAdmission.generation
				|| row.revision !== expectedAdmission.revision || row.state_digest !== expectedAdmission.digest) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: admission anchor update raced')
			}
			expectedAdmission = next
		}
		function claimAdmissionProofs(claims: readonly Omit<DemoDispositionProofClaim, 'policyDigest'>[]): void {
			if (admission === null) throw new Error('DEMO_DISPOSITION_ADMISSION_ANCHOR: admission safety store is not configured')
			if (claims.length === 0 || claims.some((claim) => !PROOF_REF.test(claim.proofRef)
				|| [claim.network, claim.chainId, claim.auctionId, claim.operationId].some((value) => value.length === 0))) {
				throw new Error('DEMO_DISPOSITION_ADMISSION_PROOF_USE: malformed exact proof claim')
			}
			assertAdmissionJournalCurrent()
			const changed = admission.transaction(() => {
				let inserted = 0
				for (const claim of claims) {
					const prior = admission.query<{ network: string; chain_id: string; auction_id: string; funding_operation_id: string }, [string]>(
						'SELECT network,chain_id,auction_id,funding_operation_id FROM fips_admission_proof_claims WHERE proof_ref=?',
					).get(claim.proofRef)
					const exact = { network: claim.network, chain_id: claim.chainId, auction_id: claim.auctionId, funding_operation_id: claim.operationId }
					if (prior !== null && JSON.stringify(prior) !== JSON.stringify(exact)) throw new Error('DEMO_FIPS_ADMISSION_PROOF_USE: proof belongs to another operation')
					if (prior === null) {
						admission.query('INSERT INTO fips_admission_proof_claims(proof_ref,network,chain_id,auction_id,funding_operation_id) VALUES(?,?,?,?,?)')
							.run(claim.proofRef, claim.network, claim.chainId, claim.auctionId, claim.operationId)
						inserted += 1
					}
				}
				if (inserted > 0) admission.query('UPDATE admission_safety_metadata SET revision=revision+1 WHERE id=1').run()
				return inserted > 0
			}).immediate()
			if (changed) recordAdmissionJournalAdvance(); else assertAdmissionJournalCurrent()
		}
		function witnessFor(snapshot: AdmissionSnapshot | null): string {
			return JSON.stringify(['COCO_SIGNER_NO_EFFECT_WITNESS_V2', stable(binding), binding.restartEpoch,
				expectedRustRevision, rustStateDigest(options.stateDirectory), proofSnapshot(proofUse), snapshot])
		}
		function captureNoEffectWitness(): string {
			assertRustStateCurrent(); assertProofCurrent(); assertAdmissionJournalCurrent()
			return witnessFor(admission === null ? null : admissionSnapshot(admission))
		}
		function assertNoEffectWitness(witness: string): void {
			if (witness !== captureNoEffectWitness()) throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: immutable no-effect witness changed')
		}
		function recordRpcJournalAdvance(witness: string, table: string, id: string, prior: Record<string, unknown> | null, next: Record<string, unknown>): void {
			if (admission === null || !['demo_fips_admission_rpc_journal', 'demo_fips_funding_abort_rpc_journal'].includes(table)) throw new Error('DEMO_SIGNER_RPC_TRANSITION_INVALID')
			assertRustStateCurrent(); assertProofCurrent()
			const keys = ['request_id','request_digest','status','response_json','rejection_reason','rejection_status','rejection_body','safety_witness']
			const actual = admission.query<Record<string, unknown>, [string]>(`SELECT ${keys.join(',')} FROM ${table} WHERE request_id=?`).get(id)
			if (actual === null || JSON.stringify(keys.map((key) => actual[key])) !== JSON.stringify(keys.map((key) => next[key]))
				|| (prior !== null && (prior.request_id !== id || prior.status !== 'pending'))
				|| witnessFor(admissionSnapshot(admission, { table, id, prior })) !== witness) {
				throw new Error('DEMO_DISPOSITION_SIGNER_QUARANTINED: RPC transition changed foreign state or revision')
			}
			recordAdmissionJournalAdvance()
		}
		return Object.freeze({
			binding: structuredClone(binding), assertRustStateCurrent, recordRustStateAdvance, claimProofs,
			assertHealthCurrent() { assertRustStateCurrent(); assertProofCurrent(); assertAdmissionJournalCurrent() },
			claimAdmissionProofs, assertAdmissionJournalCurrent, recordAdmissionJournalAdvance, captureNoEffectWitness, assertNoEffectWitness, recordRpcJournalAdvance,
			close() { signer.close(false); proofUse.close(false); admission?.close(false); coordinator.close(false) },
		})
	} catch (error) {
		signer.close(false); proofUse.close(false); admission?.close(false); coordinator.close(false); throw error
	}
}
