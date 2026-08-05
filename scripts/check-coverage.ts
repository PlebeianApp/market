/**
 * scripts/check-coverage.ts — Diff-aware coverage gate.
 *
 * Runs `bun test --coverage`, parses the per-file text table, and cross-
 * references the "Uncovered Line #s" against the lines added/modified in the
 * current branch's git diff. Only MODIFIED lines are gated; pre-existing
 * untested code is never blocked.
 *
 *   exit 0  — all modified lines are covered (or no checkable files changed)
 *   exit 1  — at least one modified line is uncovered
 *   exit 2  — internal error (coverage data unparseable, etc.)
 *
 * Usage:
 *   bun run scripts/check-coverage.ts [--base <ref>]
 *
 * Env overrides:
 *   COVERAGE_TEST_PATHSPEC  space-separated dirs/globs passed to `bun test`
 *                           (default: "src contextvm" — product code only)
 *   COVERAGE_BUN            path to the bun binary (default: "bun")
 *   COVERAGE_LCOV_FILE      path to a pre-computed lcov.info to reuse instead
 *                           of spawning `bun test --coverage` (default: unset).
 *                           When set, the file is read directly and
 *                           COVERAGE_TEST_PATHSPEC/COVERAGE_BUN are ignored.
 *                           Lets CI run coverage once for both the gate and an
 *                           HTML report (see .github/workflows/coverage-gate.yml).
 *
 * Design: every parser is a pure function (unit-tested in
 * check-coverage.test.ts). Subprocess execution is isolated behind a
 * CoverageRunners interface so the orchestration can be tested with fakes.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Range = [number, number]

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/**
 * Parse a bun "Uncovered Line #s" cell ("8-11,260,265") into [start,end] pairs.
 * Whitespace is tolerated; unparseable tokens are silently skipped.
 */
export function parseRanges(input: string): Range[] {
	const out: Range[] = []
	if (!input) return out
	for (const raw of input.split(',')) {
		const tok = raw.trim()
		if (!tok) continue
		const dash = tok.indexOf('-')
		if (dash === -1) {
			const n = Number(tok)
			if (Number.isInteger(n)) out.push([n, n])
		} else {
			const a = Number(tok.slice(0, dash))
			const b = Number(tok.slice(dash + 1))
			if (Number.isInteger(a) && Number.isInteger(b)) out.push([a, b])
		}
	}
	return out
}

/** True if `line` falls within any [start,end] range (inclusive). */
export function lineInRanges(line: number, ranges: Range[]): boolean {
	for (const [a, b] of ranges) {
		if (line >= a && line <= b) return true
	}
	return false
}

/**
 * Parse `bun test --coverage` text-table output into a map of
 * repo-relative filepath -> uncovered line ranges.
 *
 * Table rows look like:
 *   src/lib/utils.ts | 0.00 | 10.34 | 10,14-15,19-24
 *
 * Separator (all-dashes) and header ("File ... % Funcs") rows are skipped.
 */
export function parseCoverageTable(output: string): Map<string, Range[]> {
	const result = new Map<string, Range[]>()
	if (!output) return result
	// Only keep rows whose first column is a real source file path. bun also
	// emits an "All files" summary row, and on a failing run stray log fragments
	// can land between pipes — both must be ignored.
	const sourceExt = /\.(ts|tsx|js|jsx|mjs|cjs|json|vue|svelte)$/
	for (const line of output.split('\n')) {
		const parts = line.split('|')
		if (parts.length < 4) continue
		const file = parts[0].trim()
		// skip separator rows ("----..."), the header row, the summary row,
		// and anything that isn't a plausible source path.
		if (!file || file === 'File' || file === 'All files' || /^-+$/.test(file)) continue
		if (!sourceExt.test(file)) continue
		const uncoveredCell = parts[parts.length - 1].trim()
		result.set(file, parseRanges(uncoveredCell))
	}
	return result
}

/**
 * Parse LCOV (.info) coverage output into a map of filepath -> uncovered line
 * ranges. LCOV records `DA:<line>,<hitCount>`; a hitCount of 0 means uncovered.
 * A third checksum field (`DA:<line>,<hits>,<checksum>`) is tolerated.
 *
 * This is the PREFERRED data source: `bun test --coverage-reporter=lcov` emits
 * precise per-line hit counts, whereas the text-table "Uncovered Line #s"
 * column can be truncated/omitted (observed empty for some files despite <100%
 * line coverage). Paths are normalized to repo-relative by the caller (see
 * toRepoRelative) so they match `git diff` output regardless of cwd.
 */
export function parseLcov(raw: string): Map<string, Range[]> {
	const result = new Map<string, Range[]>()
	if (!raw) return result
	let file: string | null = null
	let uncovered: Range[] = []
	const flush = () => {
		if (file) result.set(file, uncovered)
		file = null
		uncovered = []
	}
	for (const line of raw.split('\n')) {
		if (line.startsWith('SF:')) {
			file = line.slice(3).trim()
			uncovered = []
		} else if (line.startsWith('DA:')) {
			const parts = line.slice(3).split(',')
			const ln = Number(parts[0])
			const hits = parts.length > 1 ? Number(parts[1]) : NaN
			if (Number.isInteger(ln) && hits === 0) uncovered.push([ln, ln])
		} else if (line.startsWith('end_of_record')) {
			flush()
		}
	}
	flush() // tolerate a trailing record without end_of_record
	return result
}

/**
 * Normalize a coverage path to repo-relative form. bun emits repo-relative
 * paths in practice, but under some CI checkouts SF: paths can be absolute;
 * stripping the cwd prefix makes the lookup robust. Pure: takes cwd explicitly.
 */
export function toRepoRelative(p: string, cwd: string): string {
	if (!p) return p
	const norm = p.replace(/\\/g, '/')
	const base = cwd.replace(/\\/g, '/').replace(/\/$/, '')
	if (norm.startsWith(base + '/')) return norm.slice(base.length + 1)
	return norm
}

/**
 * Parse coverage data, auto-detecting the format:
 *  - LCOV (preferred; produced by `--coverage-reporter=lcov`) — precise per-line
 *  - bun text table (fallback; the "Uncovered Line #s" column)
 */
export function parseCoverage(raw: string): Map<string, Range[]> {
	if (!raw) return new Map()
	if (/^SF:/m.test(raw) || /^DA:/m.test(raw) || /^end_of_record/m.test(raw)) {
		return parseLcov(raw)
	}
	return parseCoverageTable(raw)
}

/**
 * Parse `git diff --unified=0` output into a map of repo-relative filepath ->
 * array of NEW-file line numbers for added/modified lines.
 *
 * Deleted files (+++ /dev/null) are skipped (no new lines to cover). New files
 * (--- /dev/null) are included.
 */
export function parseGitDiff(diff: string): Map<string, number[]> {
	const result = new Map<string, number[]>()
	if (!diff) return result

	let currentFile: string | null = null
	let newLine = 0
	const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ ')) {
			const content = line.slice(4).trim().split(/\s+/)[0] ?? ''
			if (!content || content === '/dev/null') {
				currentFile = null // deleted file
			} else {
				currentFile = content.startsWith('b/') ? content.slice(2) : content
			}
			continue
		}
		if (line.startsWith('--- ')) continue // old-file header; path comes from +++
		const hunk = line.match(hunkRe)
		if (hunk) {
			newLine = parseInt(hunk[1], 10)
			continue
		}
		if (currentFile && line.startsWith('+')) {
			const arr = result.get(currentFile)
			if (arr) arr.push(newLine)
			else result.set(currentFile, [newLine])
			newLine++
			continue
		}
		if (line.startsWith(' ')) {
			// context line (rare with --unified=0) advances the new-file cursor
			newLine++
			continue
		}
		// '-', 'diff --git', 'index ...', 'new file mode', etc. -> ignore
	}
	return result
}

/**
 * A .ts/.tsx source file that the gate should enforce coverage on.
 *
 * The gate protects PRODUCT code (src/, contextvm/). It deliberately excludes:
 *  - node_modules/ (third-party)
 *  - e2e/ (Playwright specs/fixtures — exercised by the e2e workflow, not unit)
 *  - scripts/ (CI/build tooling — has its own unit tests but entry-point glue
 *    like `import.meta.main` blocks and `gh` CLI subprocess calls are
 *    structurally uncoverable by import-based unit tests; gating them creates a
 *    bootstrapping paradox where the pipeline can never pass its own gate)
 *  - test/spec files (they ARE the coverage)
 */
export function isCheckableFile(path: string): boolean {
	if (!/\.(ts|tsx)$/.test(path)) return false
	if (path.startsWith('node_modules/')) return false
	if (path.startsWith('e2e/')) return false
	if (path.startsWith('scripts/')) return false
	if (/\.(test|spec)\.(ts|tsx)$/.test(path)) return false
	if (/\.integration\.test\.(ts|tsx)$/.test(path)) return false
	return true
}

/**
 * Cross-reference modified line numbers against coverage data. FAILS CLOSED:
 *  - a modified line whose number is explicitly marked uncovered (hit 0) → violation
 *  - a modified file with NO coverage entry at all (no test ever imported it)
 *    → EVERY modified line is a violation (the file is entirely untested)
 *  - a modified file present in coverage with no uncovered ranges → no violations
 *
 * Treating "no coverage entry" as a violation (not "assume covered") is what
 * makes this a trustworthy hard gate: a brand-new orphan module that no test
 * loads cannot slip through.
 */
export function findUncoveredModified(
	diffLines: Map<string, number[]>,
	uncovered: Map<string, Range[]> | [string, Range[]][],
): Array<{ file: string; line: number }> {
	const lookup = uncovered instanceof Map ? uncovered : new Map(uncovered)
	const violations: Array<{ file: string; line: number }> = []
	for (const [file, lines] of diffLines) {
		if (!lookup.has(file)) {
			// fail closed: modified file has no coverage data → entirely untested
			for (const line of lines) violations.push({ file, line })
			continue
		}
		const ranges = lookup.get(file)!
		for (const line of lines) {
			if (lineInRanges(line, ranges)) violations.push({ file, line })
		}
	}
	return violations
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface CoverageRunners {
	runCoverage(): Promise<{ stdout: string; exitCode: number }>
	runDiff(baseRef: string): Promise<string>
}

export interface CheckOptions {
	baseRef?: string
}

export interface CheckResult {
	violations: Array<{ file: string; line: number }>
	modifiedFiles: string[]
	coverageExitCode: number | null
	exitCode: 0 | 1 | 2
}

/**
 * Run the full diff-aware coverage check. Subprocess execution is delegated to
 * `runners`, so this function is fully unit-testable with fakes.
 */
export async function checkCoverage(runners: CoverageRunners, opts: CheckOptions = {}): Promise<CheckResult> {
	const baseRef = opts.baseRef ?? process.env.COVERAGE_BASE_REF ?? 'origin/master'

	const diff = await runners.runDiff(baseRef)
	const allLines = parseGitDiff(diff)
	const modifiedFiles = [...allLines.keys()].filter(isCheckableFile)

	if (modifiedFiles.length === 0) {
		return { violations: [], modifiedFiles: [], coverageExitCode: null, exitCode: 0 }
	}

	const cov = await runners.runCoverage()
	const rawCoverage = parseCoverage(cov.stdout)

	// Normalize coverage paths to repo-relative so they match diff paths even if
	// bun emitted absolute SF: paths (e.g. under some CI checkouts).
	const uncovered = new Map<string, Range[]>()
	for (const [k, v] of rawCoverage) uncovered.set(toRepoRelative(k, process.cwd()), v)

	// Fail closed: if the coverage run produced NO instrumented files at all
	// (e.g. a compile error aborted the suite, or zero tests matched), we cannot
	// verify the modified lines — refuse to pass silently.
	if (uncovered.size === 0) {
		return {
			violations: [],
			modifiedFiles,
			coverageExitCode: cov.exitCode,
			exitCode: 2,
		}
	}

	const filteredDiff = new Map<string, number[]>()
	for (const f of modifiedFiles) filteredDiff.set(f, allLines.get(f) ?? [])

	const violations = findUncoveredModified(filteredDiff, uncovered)
	return {
		violations,
		modifiedFiles,
		coverageExitCode: cov.exitCode,
		exitCode: violations.length > 0 ? 1 : 0,
	}
}

// ---------------------------------------------------------------------------
// Real subprocess runners + CLI entrypoint
// ---------------------------------------------------------------------------

export function readStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	return stream ? new Response(stream).text() : Promise.resolve('')
}

export interface CapturedOutput {
	stdout: string
	stderr: string
	exitCode: number
}

/** Spawn a command and capture stdout/stderr + exit code. */
export async function capture(cmd: string[], opts: { stderr?: 'pipe' | 'inherit' } = {}): Promise<CapturedOutput> {
	const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: opts.stderr ?? 'pipe' })
	const [stdout, stderr] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr)])
	const exitCode = await proc.exited
	return { stdout, stderr, exitCode }
}

/** Concrete runners that shell out to `git` and `bun`. */
export function realRunners(): CoverageRunners {
	const bunBin = process.env.COVERAGE_BUN ?? 'bun'
	// NOTE: pathspec is whitespace-split, so it cannot represent paths containing
	// spaces (none exist in this repo). Pass multiple dirs/globs space-separated.
	const pathspec = (process.env.COVERAGE_TEST_PATHSPEC ?? 'src contextvm').split(/\s+/).filter(Boolean)

	return {
		async runCoverage() {
			// Reuse a pre-computed LCOV file when the caller already ran
			// `bun test --coverage` (e.g. CI generates coverage once for both
			// the gate and an HTML report). Skips spawning a second bun
			// process; the file MUST already exist and be valid LCOV.
			const reuseFile = process.env.COVERAGE_LCOV_FILE
			if (reuseFile) {
				try {
					return { stdout: await Bun.file(reuseFile).text(), exitCode: 0 }
				} catch {
					throw new Error(
						`COVERAGE_LCOV_FILE is set but unreadable: ${reuseFile} — run \`bun test --coverage\` first, or unset it to spawn coverage here.`,
					)
				}
			}
			// LCOV reporter: precise per-line hit counts to a file. The text
			// table's "Uncovered Line #s" column is unreliable (observed empty
			// for some files despite <100% line coverage).
			const covDir = await mkdtemp(join(tmpdir(), 'cgate-'))
			const args = ['test', '--coverage', '--coverage-reporter=lcov', '--coverage-dir', covDir, ...pathspec]
			const { stdout, stderr, exitCode } = await capture([bunBin, ...args])
			let lcov = ''
			try {
				lcov = await Bun.file(join(covDir, 'lcov.info')).text()
			} catch {
				// no lcov file (e.g. zero tests) — fall back to merged streams
			}
			try {
				await rm(covDir, { recursive: true, force: true })
			} catch {
				// best-effort cleanup; ignore
			}
			return { stdout: lcov || stdout + '\n' + stderr, exitCode }
		},
		async runDiff(baseRef: string) {
			const { stdout, exitCode } = await capture(['git', 'diff', `${baseRef}...HEAD`, '--unified=0', '--', '*.ts', '*.tsx'], {
				stderr: 'inherit',
			})
			// Fail loud on a bad/unresolvable base ref instead of silently treating
			// the empty stdout as "no changes" (which would make the gate no-op).
			if (exitCode !== 0) {
				throw new Error(`git diff failed (exit ${exitCode}) for base ref "${baseRef}" — is the ref fetched?`)
			}
			return stdout
		},
	}
}

export function formatReport(result: CheckResult): string {
	const lines: string[] = []
	if (result.exitCode === 2) {
		// Coverage data was unavailable (e.g. compile error, no tests matched).
		lines.push(`coverage-gate: checked ${result.modifiedFiles.length} modified file(s): ${result.modifiedFiles.join(', ')}`)
		lines.push('coverage-gate: ERROR — coverage run produced no instrumented-file data; cannot verify modified lines.')
		lines.push('coverage-gate: failing — ensure the test suite compiles and runs (did COVERAGE_TEST_PATHSPEC match any tests?).')
		return lines.join('\n')
	}
	if (result.modifiedFiles.length === 0) {
		lines.push('coverage-gate: no checkable source files changed — passing.')
		return lines.join('\n')
	}
	lines.push(`coverage-gate: checked ${result.modifiedFiles.length} modified file(s): ${result.modifiedFiles.join(', ')}`)
	if (result.violations.length === 0) {
		lines.push('coverage-gate: all modified lines are covered — passing.')
	} else {
		lines.push(`coverage-gate: ${result.violations.length} uncovered modified line(s):`)
		const byFile = new Map<string, number[]>()
		for (const v of result.violations) {
			const arr = byFile.get(v.file)
			if (arr) arr.push(v.line)
			else byFile.set(v.file, [v.line])
		}
		for (const [file, lns] of byFile) {
			lines.push(`  ${file}: ${lns.sort((a: number, b: number) => a - b).join(', ')}`)
		}
		lines.push('coverage-gate: failing — add tests for the lines above.')
	}
	if (result.coverageExitCode && result.coverageExitCode !== 0) {
		lines.push(
			`coverage-gate: note — coverage test run exited ${result.coverageExitCode} (some tests failed; coverage data may be incomplete).`,
		)
	}
	return lines.join('\n')
}

export interface CliDeps {
	runners: CoverageRunners
	log?: (msg: string) => void
	err?: (msg: string) => void
}

/** Parse argv, run the check, print a report. Returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
	const opts: CheckOptions = {}
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base' && argv[i + 1]) {
			opts.baseRef = argv[++i]
		}
	}
	const log = deps.log ?? ((m: string) => console.log(m))
	const err = deps.err ?? ((m: string) => console.error(m))
	try {
		const result = await checkCoverage(deps.runners, opts)
		log(formatReport(result))
		return result.exitCode
	} catch (e) {
		err(`coverage-gate: internal error: ${e}`)
		return 2
	}
}

if (import.meta.main) {
	const code = await runCli(process.argv.slice(2), { runners: realRunners() })
	process.exit(code)
}
