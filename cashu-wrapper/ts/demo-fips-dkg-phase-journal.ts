import { open, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'

const JOURNAL_SCHEMA = 'PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1' as const
const RUN_ROOT_PREFIX = '/tmp/plebeian-friday-fips-lab.'

export const DEMO_FIPS_DKG_PHASES = [
	'cli_start',
	'config_validation',
	'dkg_root_creation',
	'dkg_identity_material',
	'dkg_round1',
	'dkg_agreement',
	'dkg_round2',
	'dkg_finalize',
	'dkg_public_validation',
	'dkg_public_inspection',
	'rpc_identity_persistence',
	'result_persistence',
	'cli_complete',
] as const

export type DemoFipsDkgPhase = typeof DEMO_FIPS_DKG_PHASES[number]
export type DemoFipsDkgPhaseStatus = 'begin' | 'ok' | 'failed'

const PHASES = new Set<string>(DEMO_FIPS_DKG_PHASES)
const STATUSES = new Set<string>(['begin', 'ok', 'failed'])

export interface DemoFipsDkgPhaseJournal {
	record(stage: DemoFipsDkgPhase, status: DemoFipsDkgPhaseStatus): Promise<void>
	run<T>(stage: DemoFipsDkgPhase, action: () => Promise<T>): Promise<T>
	close(): Promise<void>
}

function exactJournalPath(path: string): string {
	if (!path.startsWith(RUN_ROOT_PREFIX) || resolve(path) !== path || path === '/'
		|| path.endsWith('/') || path.includes('//') || !path.endsWith('/dkg-phase.jsonl')) {
		throw new Error('DEMO_FIPS_DKG_PHASE_PATH: journal must be the fixed file inside a dedicated /tmp lab root')
	}
	return path
}

async function appendRecord(
	handle: FileHandle,
	stage: DemoFipsDkgPhase,
	status: DemoFipsDkgPhaseStatus,
): Promise<void> {
	// Runtime validation prevents a caller from smuggling identifiers or error
	// text through a type cast. The journal vocabulary is deliberately fixed.
	if (!PHASES.has(stage) || !STATUSES.has(status)) {
		throw new Error('DEMO_FIPS_DKG_PHASE_VALUE: phase journal value is outside the fixed vocabulary')
	}
	const value = { schema: JOURNAL_SCHEMA, stage, status, unix_ms: Date.now() }
	await handle.appendFile(`${JSON.stringify(value)}\n`, 'utf8')
	await handle.sync()
}

export async function createDemoFipsDkgPhaseJournal(path: string): Promise<DemoFipsDkgPhaseJournal> {
	const handle = await open(exactJournalPath(path), 'wx', 0o600)
	await handle.chmod(0o600)
	let closed = false
	const record = async (stage: DemoFipsDkgPhase, status: DemoFipsDkgPhaseStatus): Promise<void> => {
		if (closed) throw new Error('DEMO_FIPS_DKG_PHASE_CLOSED: phase journal is closed')
		await appendRecord(handle, stage, status)
	}
	return {
		record,
		async run(stage, action) {
			await record(stage, 'begin')
			try {
				const value = await action()
				await record(stage, 'ok')
				return value
			} catch (error) {
				try {
					await record(stage, 'failed')
				} catch (journalError) {
					throw new AggregateError([error, journalError], 'DEMO_FIPS_DKG_PHASE_FAILURE: action and durable failure record both failed')
				}
				throw error
			}
		},
		async close() {
			if (closed) return
			closed = true
			await handle.close()
		},
	}
}
