/**
 * Tests for scripts/stryker-changed-files.ts
 *
 * Diff-aware mutation testing scope + scoring. These tests exercise the pure
 * logic with crafted fixtures (no real `stryker` or `git diff` subprocesses):
 *   - selectMutableFiles  : changed-file list -> mutable source files
 *   - buildStrykerRunConfig : merge base stryker config with a dynamic mutate list
 *   - parseMutationReport  : Stryker mutation.json -> aggregate score
 *   - formatMutationComment: score -> idempotent PR-comment markdown
 *   - runMutationCheck     : end-to-end orchestration with FAKE runners
 */
import { describe, expect, it } from 'bun:test'
import {
	selectMutableFiles,
	buildStrykerRunConfig,
	parseMutationReport,
	formatMutationComment,
	runMutationCheck,
} from './stryker-changed-files'
import type { MutationReportJson, MutationRunners } from './stryker-changed-files'

// ---------------------------------------------------------------------------
// selectMutableFiles — git-diff changed paths -> files Stryker should mutate
// ---------------------------------------------------------------------------

describe('selectMutableFiles', () => {
	it('keeps ordinary source files', () => {
		const changed = ['src/lib/utils.ts', 'contextvm/client.ts', 'scripts/foo.ts']
		expect(selectMutableFiles(changed)).toEqual(
			['contextvm/client.ts', 'scripts/foo.ts', 'src/lib/utils.ts'], // sorted
		)
	})

	it('keeps .tsx files', () => {
		expect(selectMutableFiles(['src/components/Card.tsx'])).toEqual(['src/components/Card.tsx'])
	})

	it('drops test files', () => {
		const changed = [
			'src/lib/utils.ts',
			'src/lib/__tests__/utils.test.ts',
			'src/lib/__tests__/pay.spec.ts',
			'src/lib/__tests__/io.integration.test.ts',
			'scripts/check-coverage.test.ts',
		]
		expect(selectMutableFiles(changed)).toEqual(['src/lib/utils.ts'])
	})

	it('drops e2e, generated, and type-declaration files', () => {
		const changed = ['src/lib/utils.ts', 'e2e/pricing.spec.ts', 'e2e/helpers.ts', 'src/generated/api.ts', 'src/types.d.ts']
		expect(selectMutableFiles(changed)).toEqual(['src/lib/utils.ts'])
	})

	it('drops non-source paths (json, yaml, md, lockfile)', () => {
		const changed = ['src/lib/utils.ts', 'package.json', '.github/workflows/mutation.yml', 'README.md', 'bun.lock']
		expect(selectMutableFiles(changed)).toEqual(['src/lib/utils.ts'])
	})

	it('drops node_modules paths', () => {
		const changed = ['src/lib/utils.ts', 'node_modules/stryker/x.ts']
		expect(selectMutableFiles(changed)).toEqual(['src/lib/utils.ts'])
	})

	it('deduplicates and sorts', () => {
		const changed = ['src/b.ts', 'src/a.ts', 'src/a.ts']
		expect(selectMutableFiles(changed)).toEqual(['src/a.ts', 'src/b.ts'])
	})

	it('returns empty array when nothing is mutable', () => {
		expect(selectMutableFiles(['README.md', 'e2e/x.ts'])).toEqual([])
	})

	it('handles empty input', () => {
		expect(selectMutableFiles([])).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// buildStrykerRunConfig — merge base config with a dynamic mutate list
// ---------------------------------------------------------------------------

describe('buildStrykerRunConfig', () => {
	const base = {
		testRunner: 'command',
		commandRunner: { command: 'bun test' },
		coverageAnalysis: 'off',
		thresholds: { high: 80, low: 60, break: 50 },
		reporters: ['json', 'clear-text'],
	}

	it('injects the mutate array', () => {
		const cfg = buildStrykerRunConfig(base, ['src/a.ts', 'src/b.ts'])
		expect(cfg['mutate']).toEqual(['src/a.ts', 'src/b.ts'])
	})

	it('preserves base options', () => {
		const cfg = buildStrykerRunConfig(base, ['src/a.ts'])
		expect(cfg['testRunner']).toBe('command')
		expect(cfg['thresholds']).toEqual({ high: 80, low: 60, break: 50 })
		expect(cfg['reporters']).toEqual(['json', 'clear-text'])
	})

	it('overrides a pre-existing mutate array in the base', () => {
		const cfg = buildStrykerRunConfig({ ...base, mutate: ['old.ts'] }, ['new.ts'])
		expect(cfg['mutate']).toEqual(['new.ts'])
	})

	it('does not mutate the input base object', () => {
		const baseCopy = { ...base, mutate: ['old.ts'] }
		buildStrykerRunConfig(baseCopy, ['new.ts'])
		expect(baseCopy['mutate']).toEqual(['old.ts'])
	})

	it('produces an empty mutate array when no files', () => {
		const cfg = buildStrykerRunConfig(base, [])
		expect(cfg['mutate']).toEqual([])
	})
})

// ---------------------------------------------------------------------------
// parseMutationReport — Stryker mutation.json -> aggregate score
// ---------------------------------------------------------------------------

/** Build a minimal Stryker report with the given mutant statuses. */
function report(statuses: string[], thresholds = { high: 80, low: 60, break: 50 }): MutationReportJson {
	return {
		schemaVersion: '1.0',
		thresholds,
		files: {
			'src/lib/x.ts': {
				language: 'typescript',
				source: '',
				mutants: statuses.map((status, i) => ({
					id: String(i),
					status,
					location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
					mutatorName: 'ArithmeticOperator',
					replacement: 'x',
				})),
			},
		},
	}
}

describe('parseMutationReport', () => {
	it('counts killed mutants', () => {
		const s = parseMutationReport(report(['Killed', 'Killed', 'Killed']))
		expect(s.killed).toBe(3)
		expect(s.survived).toBe(0)
		expect(s.score).toBe(100)
	})

	it('scores killed+timeout over detected+undetected', () => {
		// 3 killed, 1 timeout, 2 survived, 2 noCoverage => 4/8 = 50
		const s = parseMutationReport(report(['Killed', 'Killed', 'Killed', 'Timeout', 'Survived', 'Survived', 'NoCoverage', 'NoCoverage']))
		expect(s.killed).toBe(3)
		expect(s.timeout).toBe(1)
		expect(s.survived).toBe(2)
		expect(s.noCoverage).toBe(2) // NoCoverage counted separately, contributes to undetected
		expect(s.score).toBe(50)
	})

	it('treats NoCoverage as undetected (lowers score)', () => {
		// 1 killed, 2 NoCoverage => 1/3
		const s = parseMutationReport(report(['Killed', 'NoCoverage', 'NoCoverage']))
		expect(s.score).toBeCloseTo(33.33, 1)
	})

	it('excludes RuntimeError and CompileError from the denominator', () => {
		// 2 killed, 1 survived, 2 RuntimeError => 2/3 (errors don't count)
		const s = parseMutationReport(report(['Killed', 'Killed', 'Survived', 'RuntimeError', 'CompileError']))
		expect(s.runtimeErrors).toBe(2)
		expect(s.score).toBeCloseTo(66.67, 1)
	})

	it('excludes Ignored mutants entirely', () => {
		const s = parseMutationReport(report(['Killed', 'Ignored', 'Ignored']))
		expect(s.killed).toBe(1)
		expect(s.total).toBe(1)
		expect(s.score).toBe(100)
	})

	it('aggregates across multiple files', () => {
		const r: MutationReportJson = {
			schemaVersion: '1.0',
			thresholds: { high: 80, low: 60, break: 50 },
			files: {
				'a.ts': {
					language: 'typescript',
					source: '',
					mutants: [
						{
							id: '0',
							status: 'Killed',
							location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
							mutatorName: 'X',
							replacement: 'x',
						},
					],
				},
				'b.ts': {
					language: 'typescript',
					source: '',
					mutants: [
						{
							id: '1',
							status: 'Survived',
							location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
							mutatorName: 'X',
							replacement: 'x',
						},
						{
							id: '2',
							status: 'Killed',
							location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
							mutatorName: 'X',
							replacement: 'x',
						},
					],
				},
			},
		}
		const s = parseMutationReport(r)
		expect(s.killed).toBe(2)
		expect(s.survived).toBe(1)
		expect(s.total).toBe(3)
		expect(s.score).toBeCloseTo(66.67, 1)
	})

	it('carries through thresholds', () => {
		const s = parseMutationReport(report(['Killed'], { high: 90, low: 70, break: 40 }))
		expect(s.thresholds).toEqual({ high: 90, low: 70, break: 40 })
	})

	it('returns score null when there are no mutants', () => {
		const s = parseMutationReport(report([]))
		expect(s.score).toBeNull()
		expect(s.total).toBe(0)
	})

	it('handles a report with no files at all', () => {
		const s = parseMutationReport({ schemaVersion: '1.0', thresholds: { high: 80, low: 60, break: 50 }, files: {} })
		expect(s.score).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// formatMutationComment — score -> idempotent PR-comment markdown
// ---------------------------------------------------------------------------

describe('formatMutationComment', () => {
	const opts = { sha: 'abc1234', runUrl: 'https://gh/run/1', files: ['src/a.ts', 'src/b.ts'] }

	it('starts with the marker tag (for idempotent updates)', () => {
		const body = formatMutationComment(
			{
				score: 100,
				killed: 5,
				survived: 0,
				noCoverage: 0,
				timeout: 0,
				runtimeErrors: 0,
				total: 5,
				thresholds: { high: 80, low: 60, break: 50 },
			},
			opts,
		)
		expect(body.startsWith('<!-- pr-mutation-report -->')).toBe(true)
	})

	it('includes the numeric score', () => {
		const body = formatMutationComment(
			{
				score: 74.12,
				killed: 169,
				survived: 59,
				noCoverage: 0,
				timeout: 0,
				runtimeErrors: 0,
				total: 228,
				thresholds: { high: 80, low: 60, break: 50 },
			},
			opts,
		)
		expect(body).toContain('74.12%')
	})

	it('uses a warning indicator when below the break threshold', () => {
		const body = formatMutationComment(
			{
				score: 40,
				killed: 2,
				survived: 3,
				noCoverage: 0,
				timeout: 0,
				runtimeErrors: 0,
				total: 5,
				thresholds: { high: 80, low: 60, break: 50 },
			},
			opts,
		)
		expect(body).toMatch(/warning|⚠️|🟡|🔴/i)
	})

	it('lists the mutated files', () => {
		const body = formatMutationComment(
			{
				score: 80,
				killed: 4,
				survived: 1,
				noCoverage: 0,
				timeout: 0,
				runtimeErrors: 0,
				total: 5,
				thresholds: { high: 80, low: 60, break: 50 },
			},
			opts,
		)
		expect(body).toContain('src/a.ts')
		expect(body).toContain('src/b.ts')
	})

	it('handles a null score (no mutants)', () => {
		const body = formatMutationComment(
			{
				score: null,
				killed: 0,
				survived: 0,
				noCoverage: 0,
				timeout: 0,
				runtimeErrors: 0,
				total: 0,
				thresholds: { high: 80, low: 60, break: 50 },
			},
			opts,
		)
		expect(body).toContain('No mutants')
	})
})

// ---------------------------------------------------------------------------
// runMutationCheck — orchestration with FAKE runners (no real stryker/git)
// ---------------------------------------------------------------------------

/** A fake runner that records calls and returns canned outputs. */
function fakeRunners(
	overrides: Partial<{
		diff: string
		baseConfig: string
		report: string
		strykerExit: number
		throwOnReadReport: boolean
	}>,
): { runners: MutationRunners; calls: Record<string, unknown[]> } {
	const calls: Record<string, unknown[]> = { runDiff: [], readText: [], writeText: [], runStryker: [] }
	const baseConfig =
		overrides.baseConfig ??
		JSON.stringify({
			testRunner: 'command',
			thresholds: { high: 80, low: 60, break: 50 },
		})
	const report =
		overrides.report ??
		JSON.stringify({
			schemaVersion: '1.0',
			thresholds: { high: 80, low: 60, break: 50 },
			files: {
				'src/lib/x.ts': {
					language: 'typescript',
					source: '',
					mutants: [
						{
							id: '0',
							status: 'Killed',
							location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
							mutatorName: 'X',
							replacement: 'x',
						},
						{
							id: '1',
							status: 'Survived',
							location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
							mutatorName: 'X',
							replacement: 'x',
						},
					],
				},
			},
		})
	const runners: MutationRunners = {
		async runDiff(baseRef: string) {
			calls.runDiff.push([baseRef])
			return overrides.diff ?? ''
		},
		async readText(path: string) {
			calls.readText.push([path])
			if (overrides.throwOnReadReport && path.includes('mutation.json')) throw new Error('no report')
			if (path.endsWith('.json') && path.includes('mutation')) return report
			return baseConfig
		},
		async writeText(path: string, content: string) {
			calls.writeText.push([path, content])
		},
		async runStryker(configPath: string) {
			calls.runStryker.push([configPath])
			return { exitCode: overrides.strykerExit ?? 0, stdout: '', stderr: '' }
		},
	}
	return { runners, calls }
}

describe('runMutationCheck', () => {
	it('returns exit 0 + null score when no mutable source files changed', async () => {
		const { runners, calls } = fakeRunners({ diff: 'README.md\npackage.json' })
		const result = await runMutationCheck(runners)
		expect(result.exitCode).toBe(0)
		expect(result.score).toBeNull()
		expect(result.mutableFiles).toEqual([])
		expect(calls.runStryker).toHaveLength(0) // stryker NOT spawned when nothing to mutate
	})

	it('scopes to mutable files and parses the score', async () => {
		const { runners, calls } = fakeRunners({ diff: 'src/lib/utils.ts\nsrc/lib/__tests__/utils.test.ts\nREADME.md' })
		const result = await runMutationCheck(runners)
		expect(result.exitCode).toBe(0)
		expect(result.mutableFiles).toEqual(['src/lib/utils.ts'])
		expect(result.score).not.toBeNull()
		expect(result.score!.score).toBe(50) // 1 killed, 1 survived
		expect(calls.runStryker).toHaveLength(1)
		// the runtime config written must include the dynamic mutate array
		const written = calls.writeText[0][1] as string
		expect(JSON.parse(written).mutate).toEqual(['src/lib/utils.ts'])
	})

	it('never blocks: exitCode stays 0 even when score is below the break floor', async () => {
		const { runners } = fakeRunners({
			diff: 'src/a.ts',
			report: JSON.stringify({
				schemaVersion: '1.0',
				thresholds: { high: 80, low: 60, break: 50 },
				files: {
					'src/a.ts': {
						language: 'typescript',
						source: '',
						mutants: [
							{
								id: '0',
								status: 'Survived',
								location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
								mutatorName: 'X',
								replacement: 'x',
							},
						],
					},
				},
			}),
		})
		const result = await runMutationCheck(runners)
		expect(result.score!.score).toBe(0) // all survived -> 0%
		expect(result.exitCode).toBe(0) // WARNING-ONLY: still passes
	})

	it('returns exit 2 when the base config is invalid JSON', async () => {
		const { runners } = fakeRunners({ diff: 'src/a.ts', baseConfig: '{ not json' })
		const result = await runMutationCheck(runners)
		expect(result.exitCode).toBe(2)
	})

	it('returns exit 2 when the report cannot be read', async () => {
		const { runners } = fakeRunners({ diff: 'src/a.ts', throwOnReadReport: true })
		const result = await runMutationCheck(runners)
		expect(result.exitCode).toBe(2)
	})

	it('does not propagate stryker non-zero exit (break threshold) as a failure', async () => {
		const { runners } = fakeRunners({ diff: 'src/a.ts', strykerExit: 1 })
		const result = await runMutationCheck(runners)
		expect(result.exitCode).toBe(0) // we read the report, not the exit code
	})
})
