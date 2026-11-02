import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'

import type { DemoSignerDurableBindingV1, DemoSignerRpcJournal, DemoSignerRpcResponseV1 } from './demo-signer-rpc'

export type DemoSignerJournalIdentityV1 = Omit<
	DemoSignerDurableBindingV1,
	'schema' | 'restartEpoch' | 'journalGeneration' | 'stateDirectoryIdentity'
>
type DemoSignerStoredIdentityV1 = Omit<DemoSignerDurableBindingV1, 'schema' | 'restartEpoch' | 'journalGeneration'>

function stateDirectoryIdentity(path: string): string {
	const exact = realpathSync(path)
	const stat = statSync(exact)
	if (!stat.isDirectory()) throw new Error('DEMO_SIGNER_RPC_STATE_DIRECTORY: signer state path is not a directory')
	return createHash('sha256').update(JSON.stringify(['COCO_DEMO_SIGNER_STATE_DIRECTORY_V1', exact, stat.dev, stat.ino])).digest('hex')
}

function identityOf(value: DemoSignerDurableBindingV1): DemoSignerStoredIdentityV1 {
	return {
		participantId: value.participantId, keysetId: value.keysetId, keysetVersion: value.keysetVersion,
		dkgRunId: value.dkgRunId, publicKeyPackageSha256: value.publicKeyPackageSha256,
		signerRosterDigest: value.signerRosterDigest, stateDirectory: value.stateDirectory,
		stateDirectoryIdentity: value.stateDirectoryIdentity, processIdentity: value.processIdentity,
		verifyingShare: value.verifyingShare,
	}
}

function sameIdentity(left: DemoSignerStoredIdentityV1, right: DemoSignerStoredIdentityV1): boolean {
	return left.participantId === right.participantId && left.keysetId === right.keysetId
		&& left.keysetVersion === right.keysetVersion && left.dkgRunId === right.dkgRunId
		&& left.publicKeyPackageSha256 === right.publicKeyPackageSha256
		&& left.signerRosterDigest === right.signerRosterDigest
		&& left.stateDirectory === right.stateDirectory
		&& left.stateDirectoryIdentity === right.stateDirectoryIdentity
		&& left.processIdentity === right.processIdentity && left.verifyingShare === right.verifyingShare
}

export class DemoSignerRpcSqliteJournal implements DemoSignerRpcJournal {
	readonly #database: Database
	readonly #binding: DemoSignerDurableBindingV1
	readonly #claim: (requestId: string, requestDigest: string) =>
		| { status: 'created' }
		| { status: 'pending' }
		| { status: 'replay'; response: DemoSignerRpcResponseV1 }
	readonly #complete: (requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1) => void

	constructor(database: Database, identity: DemoSignerJournalIdentityV1) {
		this.#database = database
		const expectedIdentity = { ...structuredClone(identity), stateDirectoryIdentity: stateDirectoryIdentity(identity.stateDirectory) }
		database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA synchronous = FULL;
			CREATE TABLE IF NOT EXISTS demo_signer_rpc_journal (
				request_id TEXT PRIMARY KEY NOT NULL,
				request_digest TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('pending', 'complete')),
				response_json TEXT
			) STRICT;
			CREATE TABLE IF NOT EXISTS demo_signer_rpc_metadata (
				id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
				binding_json TEXT NOT NULL
			) STRICT;
		`)
		const open = database.transaction((expected: DemoSignerStoredIdentityV1) => {
			const found = database.query<{ binding_json: string }, []>(
				'SELECT binding_json FROM demo_signer_rpc_metadata WHERE id = 1',
			).get()
			if (found === null) {
				const binding: DemoSignerDurableBindingV1 = {
					schema: 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1', ...structuredClone(expected),
					restartEpoch: 1, journalGeneration: randomBytes(32).toString('hex'),
				}
				database.query('INSERT INTO demo_signer_rpc_metadata(id, binding_json) VALUES (1, ?)').run(JSON.stringify(binding))
				return binding
			}
			const prior = JSON.parse(found.binding_json) as DemoSignerDurableBindingV1
			const restartEpoch = prior.restartEpoch
			const journalGeneration = prior.journalGeneration
			const storedIdentity = identityOf(prior)
			if (prior.schema !== 'COCO_DEMO_SIGNER_DURABLE_BINDING_V1' || !Number.isSafeInteger(restartEpoch)
				|| restartEpoch < 1 || !/^[0-9a-f]{64}$/.test(journalGeneration)
				|| !sameIdentity(storedIdentity, expected)) {
				throw new Error('DEMO_SIGNER_RPC_METADATA_MISMATCH: signer state directory, DKG, keyset, or roster changed')
			}
			const binding = { ...prior, restartEpoch: restartEpoch + 1 }
			database.query('UPDATE demo_signer_rpc_metadata SET binding_json = ? WHERE id = 1').run(JSON.stringify(binding))
			return binding
		})
		this.#binding = open.immediate(expectedIdentity)
		const claim = database.transaction((requestId: string, requestDigest: string) => {
			const found = database.query<{
				request_digest: string
				status: 'pending' | 'complete'
				response_json: string | null
			}, [string]>('SELECT request_digest, status, response_json FROM demo_signer_rpc_journal WHERE request_id = ?').get(requestId)
			if (found === null) {
				database.query('INSERT INTO demo_signer_rpc_journal(request_id, request_digest, status) VALUES (?, ?, ?)')
					.run(requestId, requestDigest, 'pending')
				return { status: 'created' as const }
			}
			if (found.request_digest !== requestDigest) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CONFLICT: request id digest changed')
			if (found.status === 'pending') return { status: 'pending' as const }
			if (found.response_json === null) throw new Error('DEMO_SIGNER_RPC_JOURNAL_STATE: completed request is missing response')
			return { status: 'replay' as const, response: JSON.parse(found.response_json) as DemoSignerRpcResponseV1 }
		})
		this.#claim = claim.immediate.bind(claim)
		const complete = database.transaction((requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1) => {
			const found = database.query<{ request_digest: string; status: 'pending' | 'complete'; response_json: string | null }, [string]>(
				'SELECT request_digest, status, response_json FROM demo_signer_rpc_journal WHERE request_id = ?',
			).get(requestId)
			if (found === null || found.request_digest !== requestDigest) {
				throw new Error('DEMO_SIGNER_RPC_JOURNAL_STATE: request was not durably claimed')
			}
			const serialized = JSON.stringify(response)
			if (found.status === 'complete') {
				if (found.response_json !== serialized) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CONFLICT: terminal response changed')
				return
			}
			const result = database.query("UPDATE demo_signer_rpc_journal SET status = ?, response_json = ? WHERE request_id = ? AND request_digest = ? AND status = 'pending'")
				.run('complete', serialized, requestId, requestDigest)
			if (result.changes !== 1) throw new Error('DEMO_SIGNER_RPC_JOURNAL_CAS: request changed during completion')
		})
		this.#complete = complete.immediate.bind(complete)
	}

	async readBinding(): Promise<DemoSignerDurableBindingV1> {
		const found = this.#database.query<{ binding_json: string }, []>(
			'SELECT binding_json FROM demo_signer_rpc_metadata WHERE id = 1',
		).get()
		if (found === null) throw new Error('DEMO_SIGNER_RPC_METADATA_MISSING: signer durable identity is absent')
		const current = JSON.parse(found.binding_json) as DemoSignerDurableBindingV1
		if (JSON.stringify(current) !== JSON.stringify(this.#binding)) {
			throw new Error('DEMO_SIGNER_RPC_METADATA_REGRESSED: signer metadata changed after process startup')
		}
		return structuredClone(current)
	}

	async assertReady(): Promise<void> {
		const pending = this.#database.query<{ request_id: string }, []>(
			"SELECT request_id FROM demo_signer_rpc_journal WHERE status = 'pending' LIMIT 1",
		).get()
		if (pending !== null) {
			throw new Error('DEMO_SIGNER_RPC_QUARANTINED: signer journal contains an interrupted request')
		}
	}

	async claim(requestId: string, requestDigest: string): ReturnType<DemoSignerRpcJournal['claim']> {
		return this.#claim(requestId, requestDigest)
	}

	async complete(requestId: string, requestDigest: string, response: DemoSignerRpcResponseV1): Promise<void> {
		this.#complete(requestId, requestDigest, structuredClone(response))
	}
}
