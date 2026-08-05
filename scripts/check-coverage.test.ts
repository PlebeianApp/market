/**
 * Tests for scripts/check-coverage.ts
 *
 * Diff-aware coverage gate. These tests exercise the pure parsing/cross-ref
 * logic with crafted fixture strings (no real `bun test` or `git diff`
 * subprocesses), plus the orchestrating checkCoverage() with fake runners.
 */
import { describe, expect, it } from 'bun:test'
import {
	parseRanges,
	lineInRanges,
	parseCoverageTable,
	parseLcov,
	parseCoverage,
	parseGitDiff,
	isCheckableFile,
	findUncoveredModified,
	checkCoverage,
	formatReport,
	runCli,
	capture,
	realRunners,
} from './check-coverage'
import type { CoverageRunners } from './check-coverage'

// ---------------------------------------------------------------------------
// parseRanges — bun "Uncovered Line #s" column -> [start,end] pairs
// ---------------------------------------------------------------------------

describe('parseRanges', () => {
	it('parses single numbers', () => {
		expect(parseRanges('10,14,260')).toEqual([
			[10, 10],
			[14, 14],
			[260, 260],
		])
	})

	it('parses dash ranges', () => {
		expect(parseRanges('8-11')).toEqual([[8, 11]])
	})

	it('parses a mix of singles and ranges', () => {
		expect(parseRanges('8-11,15-22,260,265')).toEqual([
			[8, 11],
			[15, 22],
			[260, 260],
			[265, 265],
		])
	})

	it('returns empty for blank string', () => {
		expect(parseRanges('')).toEqual([])
		expect(parseRanges('   ')).toEqual([])
	})

	it('ignores whitespace around tokens', () => {
		expect(parseRanges(' 10 , 12 - 14 ')).toEqual([
			[10, 10],
			[12, 14],
		])
	})

	it('ignores unparseable tokens', () => {
		// stray garbage does not crash; valid tokens still parse
		expect(parseRanges('10,abc,20-22')).toEqual([
			[10, 10],
			[20, 22],
		])
	})
})

// ---------------------------------------------------------------------------
// lineInRanges
// ---------------------------------------------------------------------------

describe('lineInRanges', () => {
	const ranges: Array<[number, number]> = [
		[8, 11],
		[260, 265],
	]

	it('true inside a range', () => {
		expect(lineInRanges(8, ranges)).toBe(true)
		expect(lineInRanges(11, ranges)).toBe(true)
		expect(lineInRanges(263, ranges)).toBe(true)
	})

	it('false outside all ranges', () => {
		expect(lineInRanges(7, ranges)).toBe(false)
		expect(lineInRanges(12, ranges)).toBe(false)
		expect(lineInRanges(200, ranges)).toBe(false)
	})

	it('false when no ranges', () => {
		expect(lineInRanges(5, [])).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// parseCoverageTable — bun --coverage text table
// ---------------------------------------------------------------------------

describe('parseCoverageTable', () => {
	const sample = [
		'--------------------------------------------------|---------|---------|-------------------',
		'File                                              | % Funcs | % Lines | Uncovered Line #s',
		'--------------------------------------------------|---------|---------|-------------------',
		'src/lib/utils.ts                                 |    0.00 |   10.34 | 10,14-15,19-24',
		'src/lib/wallet/index.ts                          |  100.00 |  100.00 | ',
		'src/lib/stores/cart.ts                           |    7.81 |    9.13 | 154-159,161,188-193',
		'--------------------------------------------------|---------|---------|-------------------',
	].join('\n')

	it('returns a map keyed by repo-relative filepath', () => {
		const m = parseCoverageTable(sample)
		expect(m.has('src/lib/utils.ts')).toBe(true)
		expect(m.has('src/lib/wallet/index.ts')).toBe(true)
		expect(m.has('src/lib/stores/cart.ts')).toBe(true)
	})

	it('parses uncovered ranges correctly', () => {
		const m = parseCoverageTable(sample)
		expect(m.get('src/lib/utils.ts')).toEqual([
			[10, 10],
			[14, 15],
			[19, 24],
		])
		expect(m.get('src/lib/stores/cart.ts')).toEqual([
			[154, 159],
			[161, 161],
			[188, 193],
		])
	})

	it('returns empty ranges for fully covered files', () => {
		const m = parseCoverageTable(sample)
		expect(m.get('src/lib/wallet/index.ts')).toEqual([])
	})

	it('skips header and separator lines', () => {
		const m = parseCoverageTable(sample)
		expect(m.has('File')).toBe(false)
		expect(m.size).toBe(3)
	})

	it('returns empty map for blank / non-table input', () => {
		expect(parseCoverageTable('').size).toBe(0)
		expect(parseCoverageTable('some random log\nno pipes here').size).toBe(0)
	})

	it('handles files with 0% coverage and many ranges', () => {
		const row = 'src/lib/big.ts | 0.00 | 0.00 | 1-5,10,20-100'
		const m = parseCoverageTable(row)
		expect(m.get('src/lib/big.ts')).toEqual([
			[1, 5],
			[10, 10],
			[20, 100],
		])
	})

	it("excludes the 'All files' summary row and non-source junk rows", () => {
		// bun emits an "All files" summary and, on a failing run, stray log
		// fragments can land between pipes. Only real source files must remain.
		const sample = [
			'All files                                         |   27.83 |   43.76 | ',
			'7                                                 |    0.00 |    0.00 | 1-3',
			'src/lib/utils.ts                                 |    0.00 |   10.34 | 10-24',
			'some test progress | 1.5ms | extra | 5,6',
		].join('\n')
		const m = parseCoverageTable(sample)
		expect(m.has('All files')).toBe(false)
		expect(m.has('7')).toBe(false)
		expect(m.has('some test progress')).toBe(false)
		expect(m.size).toBe(1)
		expect(m.has('src/lib/utils.ts')).toBe(true)
	})

	it('keeps source files regardless of stream (stdout or stderr content)', () => {
		// bun writes the table to stderr in practice; the parser must not care
		// which stream the text came from.
		const sample = [
			'(pass) some test > did a thing [0.5ms]',
			'File | % Funcs | % Lines | Uncovered Line #s',
			'src/lib/x.ts | 50.00 | 50.00 | 10-20',
		].join('\n')
		const m = parseCoverageTable(sample)
		expect(m.get('src/lib/x.ts')).toEqual([[10, 20]])
	})
})

// ---------------------------------------------------------------------------
// parseLcov — LCOV .info (preferred coverage source)
// ---------------------------------------------------------------------------

describe('parseLcov', () => {
	it('extracts uncovered lines (hit count 0) per file', () => {
		const lcov = ['TN:', 'SF:src/lib/math.ts', 'FNF:2', 'FNH:1', 'DA:1,15', 'DA:2,13', 'DA:4,0', 'LF:3', 'LH:2', 'end_of_record'].join('\n')
		expect(parseLcov(lcov).get('src/lib/math.ts')).toEqual([[4, 4]])
	})

	it('marks nothing uncovered when every line has hits', () => {
		const lcov = ['SF:src/lib/covered.ts', 'DA:1,5', 'DA:2,3', 'end_of_record'].join('\n')
		expect(parseLcov(lcov).get('src/lib/covered.ts')).toEqual([])
	})

	it('handles multiple files', () => {
		const lcov = ['SF:src/a.ts', 'DA:3,0', 'DA:4,1', 'end_of_record', 'SF:src/b.ts', 'DA:10,0', 'DA:11,0', 'end_of_record'].join('\n')
		const m = parseLcov(lcov)
		expect(m.get('src/a.ts')).toEqual([[3, 3]])
		expect(m.get('src/b.ts')).toEqual([
			[10, 10],
			[11, 11],
		])
	})

	it('ignores non-integer DA records', () => {
		const lcov = ['SF:src/x.ts', 'DA:abc,0', 'DA:5,0', 'end_of_record'].join('\n')
		expect(parseLcov(lcov).get('src/x.ts')).toEqual([[5, 5]])
	})

	it('returns empty map for blank input', () => {
		expect(parseLcov('').size).toBe(0)
	})

	it('tolerates a trailing record without end_of_record', () => {
		const lcov = 'SF:src/y.ts\nDA:2,0\nDA:3,1\n'
		expect(parseLcov(lcov).get('src/y.ts')).toEqual([[2, 2]])
	})
})

// ---------------------------------------------------------------------------
// parseCoverage — unified format auto-detection
// ---------------------------------------------------------------------------

describe('parseCoverage', () => {
	it('routes LCOV input to parseLcov', () => {
		const lcov = 'SF:src/x.ts\nDA:5,0\nend_of_record\n'
		expect(parseCoverage(lcov).get('src/x.ts')).toEqual([[5, 5]])
	})

	it('routes text-table input to parseCoverageTable', () => {
		const table = 'src/x.ts | 50.00 | 50.00 | 5,6\n'
		expect(parseCoverage(table).get('src/x.ts')).toEqual([
			[5, 5],
			[6, 6],
		])
	})

	it('returns empty map for blank input', () => {
		expect(parseCoverage('').size).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// parseGitDiff — `git diff --unified=0` -> filepath -> added new line numbers
// ---------------------------------------------------------------------------

describe('parseGitDiff', () => {
	it('extracts added line numbers from a single hunk', () => {
		const diff = [
			'diff --git a/src/lib/utils.ts b/src/lib/utils.ts',
			'index aaa..bbb 100644',
			'--- a/src/lib/utils.ts',
			'+++ b/src/lib/utils.ts',
			'@@ -10,2 +12,5 @@',
			'-old line ten',
			'-old line eleven',
			'+new line twelve',
			'+new line thirteen',
			'+new line fourteen',
			'+new line fifteen',
			'+new line sixteen',
		].join('\n')
		const m = parseGitDiff(diff)
		expect(m.get('src/lib/utils.ts')).toEqual([12, 13, 14, 15, 16])
	})

	it('strips the b/ prefix to get repo-relative paths', () => {
		const diff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '+hello'].join('\n')
		expect([...parseGitDiff(diff).keys()]).toEqual(['src/a.ts'])
	})

	it('handles new files (--- /dev/null)', () => {
		const diff = [
			'diff --git a/src/new.ts b/src/new.ts',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/src/new.ts',
			'@@ -0,0 +1,3 @@',
			'+line one',
			'+line two',
			'+line three',
		].join('\n')
		expect(parseGitDiff(diff).get('src/new.ts')).toEqual([1, 2, 3])
	})

	it('ignores deleted files (+++ /dev/null)', () => {
		const diff = [
			'diff --git a/src/gone.ts b/src/gone.ts',
			'deleted file mode 100644',
			'--- a/src/gone.ts',
			'+++ /dev/null',
			'@@ -1,2 +0,0 @@',
			'-line one',
			'-line two',
		].join('\n')
		expect(parseGitDiff(diff).has('src/gone.ts')).toBe(false)
	})

	it('handles multiple hunks in one file', () => {
		const diff = [
			'diff --git a/src/multi.ts b/src/multi.ts',
			'--- a/src/multi.ts',
			'+++ b/src/multi.ts',
			'@@ -5,1 +5,2 @@',
			' context',
			'+added at 6',
			'@@ -20,1 +21,1 @@',
			'-old twenty',
			'+new twenty one',
		].join('\n')
		// hunk1: newStart=5; context -> newLine 5; +added -> record 6
		// hunk2: newStart=21; +new -> record 21
		expect(parseGitDiff(diff).get('src/multi.ts')).toEqual([6, 21])
	})

	it('handles multiple files', () => {
		const diff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1 +1 @@',
			'+a',
			'diff --git a/src/b.ts b/src/b.ts',
			'--- a/src/b.ts',
			'+++ b/src/b.ts',
			'@@ -1 +2 @@',
			'+b',
		].join('\n')
		const m = parseGitDiff(diff)
		expect(m.get('src/a.ts')).toEqual([1])
		expect(m.get('src/b.ts')).toEqual([2])
	})

	it('returns empty map for empty diff', () => {
		expect(parseGitDiff('').size).toBe(0)
	})

	it('handles hunk headers without length (single-line hunks)', () => {
		const diff = ['diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -3 +3 @@', '+changed three'].join('\n')
		expect(parseGitDiff(diff).get('src/x.ts')).toEqual([3])
	})

	it('counts added lines whose own content begins with ++ (not a file header)', () => {
		// An added line like "++counter;" is emitted by git as "+++counter;".
		// It must NOT be swallowed as a "+++ b/path" file header — otherwise the
		// modified line is silently dropped, producing a false-negative in a
		// merge-blocking gate. git always emits a trailing space after +++/---.
		const diff = [
			'diff --git a/src/x.ts b/src/x.ts',
			'--- a/src/x.ts',
			'+++ b/src/x.ts',
			'@@ -1,2 +1,3 @@',
			' unchanged',
			'+let counter = 0',
			'+++counter;',
		].join('\n')
		const m = parseGitDiff(diff)
		expect(m.get('src/x.ts')).toEqual([2, 3])
	})
})

// ---------------------------------------------------------------------------
// isCheckableFile
// ---------------------------------------------------------------------------

describe('isCheckableFile', () => {
	it('includes src .ts/.tsx files', () => {
		expect(isCheckableFile('src/lib/utils.ts')).toBe(true)
		expect(isCheckableFile('src/components/Foo.tsx')).toBe(true)
	})

	it('excludes test and spec files', () => {
		expect(isCheckableFile('src/lib/utils.test.ts')).toBe(false)
		expect(isCheckableFile('src/lib/utils.integration.test.ts')).toBe(false)
		expect(isCheckableFile('e2e/tests/product.spec.ts')).toBe(false)
	})

	it('excludes e2e directory', () => {
		expect(isCheckableFile('e2e/fixtures/index.ts')).toBe(false)
		expect(isCheckableFile('e2e/playwright.config.ts')).toBe(false)
	})

	it('excludes node_modules', () => {
		expect(isCheckableFile('node_modules/foo/bar.ts')).toBe(false)
	})

	it('excludes scripts (CI/build tooling)', () => {
		expect(isCheckableFile('scripts/check-coverage.ts')).toBe(false)
		expect(isCheckableFile('scripts/buzz-notify.sh')).toBe(false)
		expect(isCheckableFile('scripts/__tests__/foo.test.ts')).toBe(false)
	})

	it('excludes non-ts files', () => {
		expect(isCheckableFile('README.md')).toBe(false)
		expect(isCheckableFile('scripts/foo.sh')).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// findUncoveredModified
// ---------------------------------------------------------------------------

describe('findUncoveredModified', () => {
	it('flags modified lines that fall in uncovered ranges', () => {
		const diffLines = new Map([['src/lib/utils.ts', [10, 14, 19, 30]]])
		const uncovered = new Map([
			[
				'src/lib/utils.ts',
				[
					[10, 10],
					[14, 15],
					[19, 24],
				],
			],
		])
		expect(findUncoveredModified(diffLines, uncovered)).toEqual([
			{ file: 'src/lib/utils.ts', line: 10 },
			{ file: 'src/lib/utils.ts', line: 14 },
			{ file: 'src/lib/utils.ts', line: 19 },
		])
	})

	it('returns empty when all modified lines are covered (file present, no uncovered ranges)', () => {
		const diffLines = new Map([['src/lib/utils.ts', [30, 40, 50]]])
		// file IS in coverage data, with no uncovered ranges -> all covered
		const uncovered = new Map<string, Array<[number, number]>>([['src/lib/utils.ts', []]])
		expect(findUncoveredModified(diffLines, uncovered)).toEqual([])
	})

	it('fails closed when a modified file has NO coverage entry (entirely untested)', () => {
		// A brand-new orphan module that no test imports has no coverage record.
		// The hard gate must flag ALL its modified lines, not assume covered.
		const diffLines = new Map([['src/lib/brandnew.ts', [1, 2, 3]]])
		const uncovered = new Map<string, Array<[number, number]>>([])
		expect(findUncoveredModified(diffLines, uncovered)).toEqual([
			{ file: 'src/lib/brandnew.ts', line: 1 },
			{ file: 'src/lib/brandnew.ts', line: 2 },
			{ file: 'src/lib/brandnew.ts', line: 3 },
		])
	})

	it('handles multiple files', () => {
		const diffLines = new Map([
			['src/a.ts', [5, 6]],
			['src/b.ts', [100]],
		])
		const uncovered = new Map([
			['src/a.ts', [[5, 5]]],
			['src/b.ts', [[100, 100]]],
		])
		const result = findUncoveredModified(diffLines, uncovered)
		expect(result).toContainEqual({ file: 'src/a.ts', line: 5 })
		expect(result).toContainEqual({ file: 'src/b.ts', line: 100 })
		expect(result).toHaveLength(2)
	})
})

// ---------------------------------------------------------------------------
// checkCoverage — orchestration with fake runners
// ---------------------------------------------------------------------------

describe('checkCoverage', () => {
	it('exits 0 when all modified lines are covered', async () => {
		const result = await checkCoverage({
			runCoverage: async () => ({
				// utils.ts uncovered at 10-24; modified line is 30 -> covered
				stdout: ['File | % Funcs | % Lines | Uncovered Line #s', 'src/lib/utils.ts | 50.00 | 50.00 | 10-24'].join('\n'),
				exitCode: 0,
			}),
			runDiff: async () =>
				[
					'diff --git a/src/lib/utils.ts b/src/lib/utils.ts',
					'--- a/src/lib/utils.ts',
					'+++ b/src/lib/utils.ts',
					'@@ -30,1 +30,1 @@',
					'+covered change at line thirty',
				].join('\n'),
		})
		expect(result.exitCode).toBe(0)
		expect(result.violations).toEqual([])
		expect(result.modifiedFiles).toEqual(['src/lib/utils.ts'])
	})

	it('exits 1 when a modified line is uncovered', async () => {
		const result = await checkCoverage({
			runCoverage: async () => ({
				stdout: ['File | % Funcs | % Lines | Uncovered Line #s', 'src/lib/utils.ts | 50.00 | 50.00 | 10-24'].join('\n'),
				exitCode: 0,
			}),
			runDiff: async () =>
				[
					'diff --git a/src/lib/utils.ts b/src/lib/utils.ts',
					'--- a/src/lib/utils.ts',
					'+++ b/src/lib/utils.ts',
					'@@ -14,1 +14,1 @@',
					'+uncovered change at line fourteen',
				].join('\n'),
		})
		expect(result.exitCode).toBe(1)
		expect(result.violations).toEqual([{ file: 'src/lib/utils.ts', line: 14 }])
	})

	it('exits 1 using LCOV-format coverage input (precise per-line)', async () => {
		const result = await checkCoverage({
			runCoverage: async () => ({
				stdout: ['TN:', 'SF:src/lib/utils.ts', 'DA:14,0', 'DA:15,1', 'DA:30,0', 'end_of_record'].join('\n'),
				exitCode: 0,
			}),
			runDiff: async () =>
				[
					'diff --git a/src/lib/utils.ts b/src/lib/utils.ts',
					'--- a/src/lib/utils.ts',
					'+++ b/src/lib/utils.ts',
					'@@ -14,1 +14,1 @@',
					'+uncovered change at line fourteen',
				].join('\n'),
		})
		// line 14 modified & DA:14,0 uncovered -> violation; line 30 not modified
		expect(result.exitCode).toBe(1)
		expect(result.violations).toEqual([{ file: 'src/lib/utils.ts', line: 14 }])
	})

	it('ignores test and e2e files in the diff', async () => {
		const result = await checkCoverage({
			runCoverage: async () => ({ stdout: '', exitCode: 0 }),
			runDiff: async () =>
				[
					'diff --git a/src/lib/utils.test.ts b/src/lib/utils.test.ts',
					'--- a/src/lib/utils.test.ts',
					'+++ b/src/lib/utils.test.ts',
					'@@ -1 +1 @@',
					'+test change',
					'diff --git a/e2e/tests/x.spec.ts b/e2e/tests/x.spec.ts',
					'--- a/e2e/tests/x.spec.ts',
					'+++ b/e2e/tests/x.spec.ts',
					'@@ -1 +1 @@',
					'+e2e change',
				].join('\n'),
		})
		expect(result.exitCode).toBe(0)
		expect(result.modifiedFiles).toEqual([])
	})

	it('passes when diff is empty (no changes)', async () => {
		const result = await checkCoverage({
			runCoverage: async () => ({ stdout: '', exitCode: 0 }),
			runDiff: async () => '',
		})
		expect(result.exitCode).toBe(0)
		expect(result.violations).toEqual([])
	})

	it('exits 2 (fail-closed) when coverage produced zero instrumented files', async () => {
		// Safety net: if the coverage run yields no SF:/file data at all (compile
		// error, zero tests matched), the gate MUST refuse to pass silently.
		const result = await checkCoverage({
			runCoverage: async () => ({ stdout: '', exitCode: 0 }),
			runDiff: async () =>
				[
					'diff --git a/src/lib/orphan.ts b/src/lib/orphan.ts',
					'--- a/src/lib/orphan.ts',
					'+++ b/src/lib/orphan.ts',
					'@@ -1 +1 @@',
					'+changed',
				].join('\n'),
		})
		expect(result.exitCode).toBe(2)
		expect(result.violations).toEqual([])
		expect(result.modifiedFiles).toEqual(['src/lib/orphan.ts'])
	})
})

// ---------------------------------------------------------------------------
// formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
	it('reports no checkable files changed', () => {
		const out = formatReport({
			violations: [],
			modifiedFiles: [],
			coverageExitCode: null,
			exitCode: 0,
		})
		expect(out).toContain('no checkable source files changed')
	})

	it('reports all covered', () => {
		const out = formatReport({
			violations: [],
			modifiedFiles: ['src/a.ts'],
			coverageExitCode: 0,
			exitCode: 0,
		})
		expect(out).toContain('all modified lines are covered')
		expect(out).toContain('src/a.ts')
	})

	it('lists violations grouped + sorted by file', () => {
		const out = formatReport({
			violations: [
				{ file: 'src/a.ts', line: 5 },
				{ file: 'src/b.ts', line: 2 },
				{ file: 'src/a.ts', line: 3 },
			],
			modifiedFiles: ['src/a.ts', 'src/b.ts'],
			coverageExitCode: 0,
			exitCode: 1,
		})
		expect(out).toContain('3 uncovered modified line(s)')
		expect(out).toContain('failing')
		// src/a.ts lines sorted ascending
		expect(out).toContain('src/a.ts: 3, 5')
		expect(out).toContain('src/b.ts: 2')
	})

	it('notes a non-zero coverage exit code', () => {
		const out = formatReport({
			violations: [],
			modifiedFiles: ['src/a.ts'],
			coverageExitCode: 1,
			exitCode: 0,
		})
		expect(out).toContain('coverage test run exited 1')
	})

	it('reports coverage-data-unavailable on exit code 2', () => {
		const out = formatReport({
			violations: [],
			modifiedFiles: ['src/a.ts'],
			coverageExitCode: 0,
			exitCode: 2,
		})
		expect(out).toContain('src/a.ts')
		expect(out).toContain('cannot verify')
	})
})

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

describe('runCli', () => {
	it('parses --base and returns the exit code, logging the report', async () => {
		const logged: string[] = []
		const runners: CoverageRunners = {
			runCoverage: async () => ({
				stdout: 'SF:src/a.ts\nDA:5,0\nend_of_record\n',
				exitCode: 0,
			}),
			runDiff: async () =>
				['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -5,1 +5,1 @@', '+change'].join('\n'),
		}
		const code = await runCli(['--base', 'origin/dev'], {
			runners,
			log: (m) => logged.push(m),
		})
		expect(code).toBe(1)
		expect(logged.join('\n')).toContain('failing')
	})

	it('returns 2 and calls err when checkCoverage throws', async () => {
		const errored: string[] = []
		const runners: CoverageRunners = {
			runCoverage: async () => {
				throw new Error('boom')
			},
			runDiff: async () => 'diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n+x',
		}
		const code = await runCli([], { runners, err: (m) => errored.push(m) })
		expect(code).toBe(2)
		expect(errored.join('\n')).toContain('internal error')
	})
})

// ---------------------------------------------------------------------------
// capture — real subprocess
// ---------------------------------------------------------------------------

describe('capture', () => {
	it('captures stdout and exit code of a real command', async () => {
		const out = await capture(['echo', 'hello-cov'])
		expect(out.exitCode).toBe(0)
		expect(out.stdout.trim()).toBe('hello-cov')
	})

	it('captures a non-zero exit code', async () => {
		const out = await capture(['sh', '-c', 'exit 3'])
		expect(out.exitCode).toBe(3)
	})
})

// ---------------------------------------------------------------------------
// realRunners — real subprocess integration (git + bun)
// ---------------------------------------------------------------------------

describe('realRunners', () => {
	// These spawn real processes. runCoverage uses a trivial fixture test file
	// to stay fast (~tens of ms) and avoid re-importing this test file.
	const fixturePath = `${import.meta.dir}/.cgate-fixture.test.ts`

	it('runDiff returns a string from real git', async () => {
		const runners = realRunners()
		const diff = await runners.runDiff('HEAD') // empty diff against self
		expect(typeof diff).toBe('string')
	})

	it('runCoverage runs real bun test --coverage and returns non-empty output', async () => {
		const { unlink } = await import('node:fs/promises')
		await Bun.write(fixturePath, ['import { test, expect } from "bun:test";', 'test("noop", () => { expect(1 + 1).toBe(2); });'].join('\n'))
		process.env.COVERAGE_TEST_PATHSPEC = fixturePath
		process.env.COVERAGE_BUN = process.execPath
		try {
			const runners = realRunners()
			const cov = await runners.runCoverage()
			expect(typeof cov.stdout).toBe('string')
			// lcov (preferred) or merged streams — must be non-empty
			expect(cov.stdout.length).toBeGreaterThan(0)
		} finally {
			delete process.env.COVERAGE_TEST_PATHSPEC
			delete process.env.COVERAGE_BUN
			try {
				await unlink(fixturePath)
			} catch {
				// ignore
			}
		}
	})

	it('runCoverage reuses COVERAGE_LCOV_FILE instead of spawning bun', async () => {
		const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const dir = await mkdtemp(join(tmpdir(), 'cgate-reuse-'))
		const lcovPath = join(dir, 'lcov.info')
		// Minimal but valid LCOV record for a synthetic source file.
		const sentinel = 'TN:reuse\nSF:fake.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n'
		await writeFile(lcovPath, sentinel)
		process.env.COVERAGE_LCOV_FILE = lcovPath
		try {
			const runners = realRunners()
			const cov = await runners.runCoverage()
			// Reused verbatim — no bun subprocess ran.
			expect(cov.stdout).toBe(sentinel)
			expect(cov.exitCode).toBe(0)
		} finally {
			delete process.env.COVERAGE_LCOV_FILE
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('runCoverage throws a clear error when COVERAGE_LCOV_FILE is unreadable', async () => {
		process.env.COVERAGE_LCOV_FILE = `${import.meta.dir}/.does-not-exist-${Date.now()}.info`
		try {
			const runners = realRunners()
			await expect(runners.runCoverage()).rejects.toThrow(/COVERAGE_LCOV_FILE is set but unreadable/)
		} finally {
			delete process.env.COVERAGE_LCOV_FILE
		}
	})

	it('runDiff throws on an unresolvable base ref', async () => {
		const runners = realRunners()
		await expect(runners.runDiff('refs/heads/__cgate_nonexistent__')).rejects.toThrow(/git diff failed/)
	})
})
