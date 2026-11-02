import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'

import { createDemoFipsDkgPhaseJournal } from './demo-fips-dkg-phase-journal'

const roots: string[] = []

async function root(): Promise<string> {
	const value = await mkdtemp('/tmp/plebeian-friday-fips-lab.phase-journal-test-')
	roots.push(value)
	return value
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('sanitized DKG phase journal', () => {
	test('persists only fixed phase, status, schema and timestamp fields', async () => {
		const directory = await root()
		const path = `${directory}/dkg-phase.jsonl`
		const journal = await createDemoFipsDkgPhaseJournal(path)
		await journal.record('cli_start', 'ok')
		await journal.run('config_validation', async () => 'validated')
		await journal.close()

		const records = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
		expect(records.map(({ stage, status }) => ({ stage, status }))).toEqual([
			{ stage: 'cli_start', status: 'ok' },
			{ stage: 'config_validation', status: 'begin' },
			{ stage: 'config_validation', status: 'ok' },
		])
		for (const record of records) {
			expect(Object.keys(record).sort()).toEqual(['schema', 'stage', 'status', 'unix_ms'])
			expect(record.schema).toBe('PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1')
			expect(typeof record.unix_ms).toBe('number')
		}
	})

	test('records a fixed failure marker without error text', async () => {
		const directory = await root()
		const path = `${directory}/dkg-phase.jsonl`
		const journal = await createDemoFipsDkgPhaseJournal(path)
		await expect(journal.run('dkg_round1', async () => {
			throw new Error('sensitive diagnostic that must not be journaled')
		})).rejects.toThrow('sensitive diagnostic')
		await journal.close()

		const journalText = await readFile(path, 'utf8')
		expect(journalText).not.toContain('sensitive')
		expect(journalText).not.toContain('diagnostic')
		expect(journalText.trim().split('\n').map((line) => {
			const { stage, status } = JSON.parse(line) as { stage: string; status: string }
			return { stage, status }
		})).toEqual([
			{ stage: 'dkg_round1', status: 'begin' },
			{ stage: 'dkg_round1', status: 'failed' },
		])
	})

	test('rejects caller-smuggled values and non-lab paths', async () => {
		await expect(createDemoFipsDkgPhaseJournal('/tmp/not-a-reviewed-lab/dkg-phase.jsonl')).rejects.toThrow(/fixed file/)
		const directory = await root()
		const journal = await createDemoFipsDkgPhaseJournal(`${directory}/dkg-phase.jsonl`)
		await expect(journal.record('auction-secret' as never, 'ok')).rejects.toThrow(/fixed vocabulary/)
		await expect(journal.record('cli_start', 'secret-status' as never)).rejects.toThrow(/fixed vocabulary/)
		await journal.close()
	})
})
