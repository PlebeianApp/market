/**
 * scripts/stryker-changed-files.ts — Diff-aware mutation testing scope + scoring.
 *
 * Stryker (https://stryker-mutator.io) mutates production code and checks whether
 * the test suite catches each mutation. Unlike line/branch coverage, a mutant
 * only counts as "killed" when an assertion actually fails — so a test that
 * merely calls a function without asserting anything yields 0% mutation score.
 * This is the only coverage metric that resists the "touch the test" gaming
 * attack that defeats line/AST coverage.
 *
 * Because there is NO native Stryker test runner for `bun test`, we use
 * Stryker's built-in `command` test runner, which wraps an arbitrary shell
 * command and infers pass/fail from the exit code (0 = killed, non-zero =
 * survived). Consequence: `coverageAnalysis` must be `"off"` (the command
 * runner reports no per-test coverage, so `perTest` is unavailable). Mutation
 * testing still runs the full unit suite for each mutant — slower, but correct.
 *
 * Flow (see runMutationCheck):
 *   1. `git diff --name-only <base>` → changed file paths
 *   2. selectMutableFiles() → filter to mutable .ts/.tsx source files
 *   3. if none → exit 0 (nothing to mutate, nothing to gate)
 *   4. buildStrykerRunConfig() → merge base stryker.config.json + dynamic `mutate`
 *   5. `stryker run` → reports/mutation/mutation.json
 *   6. parseMutationReport() → aggregate score
 *   7. exit 0 always (warning-only gate); the score + comment are posted by CI
 *
 * Design: every parser/scope function is PURE (unit-tested in
 * stryker-changed-files.test.ts). Subprocess execution (git, stryker) is
 * isolated behind a MutationRunners interface so orchestration is testable
 * with fakes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { capture } from './check-coverage'

/** A Stryker mutant status (see MutationStatus in @stryker-mutator/api). */
export type MutationStatus = 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'RuntimeError' | 'CompileError' | 'Ignored'

export interface Mutant {
	id: string
	status: MutationStatus
	mutatorName: string
	replacement: string
	location: { start: { line: number; column: number }; end: { line: number; column: number } }
}

/** Minimal subset of Stryker's mutation.json report we depend on. */
export interface MutationReportJson {
	schemaVersion: string
	thresholds: { high: number; low: number; break: number }
	files: Record<string, { language: string; source: string; mutants: Mutant[] }>
}

export interface MutationScore {
	/** 0–100, or null when there are no scoring mutants (nothing mutated). */
	score: number | null
	killed: number
	survived: number
	noCoverage: number
	timeout: number
	/** RuntimeError + CompileError — excluded from the score denominator. */
	runtimeErrors: number
	/** killed + survived + noCoverage + timeout (the scoring population). */
	total: number
	thresholds: { high: number; low: number; break: number }
}

export interface CommentOpts {
	sha: string
	runUrl: string
	files: string[]
}

export interface MutationRunners {
	/** `git diff --name-only <base>...HEAD` → newline-separated changed paths. */
	runDiff(baseRef: string): Promise<string>
	/** Read a text file (base config, or the Stryker JSON report). */
	readText(path: string): Promise<string>
	/** Write a text file (the generated runtime config). */
	writeText(path: string, content: string): Promise<void>
	/** Run `stryker run <configPath>`. Exit code is intentionally NOT propagated
	 *  (a low score makes Stryker exit non-zero; this gate warns, not blocks). */
	runStryker(configPath: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

// ---------------------------------------------------------------------------
// Pure: selectMutableFiles — which changed files Stryker should mutate
// ---------------------------------------------------------------------------

const SOURCE_EXT = /\.(ts|tsx)$/

/**
 * Filter a list of git-diff changed paths down to the mutable source files
 * Stryker should target. Mirrors the gate's `isCheckableFile` rules so the
 * mutation scope matches the coverage scope, plus an explicit `.d.ts` guard
 * (type declarations carry no runtime logic to mutate).
 *
 *   keep  : source .ts/.tsx under src, contextvm, scripts
 *   drop  : .test.ts, .spec.ts, .integration.test.ts, .d.ts,
 *           anything under e2e, generated, or node_modules,
 *           and non-source paths (json/yml/md/etc.)
 */
export function selectMutableFiles(changedFilePaths: string[]): string[] {
	const out = new Set<string>()
	for (const p of changedFilePaths) {
		if (!p) continue
		if (!SOURCE_EXT.test(p)) continue
		if (p.startsWith('node_modules/')) continue
		if (p.startsWith('e2e/')) continue
		if (/\.d\.ts$/.test(p)) continue
		if (/\/generated\/|\/__generated__\//.test(p)) continue
		if (/\.(test|spec)\.(ts|tsx)$/.test(p)) continue
		if (/\.integration\.test\.(ts|tsx)$/.test(p)) continue
		out.add(p)
	}
	return [...out].sort()
}

// ---------------------------------------------------------------------------
// Pure: buildStrykerRunConfig — merge base config + dynamic mutate list
// ---------------------------------------------------------------------------

/**
 * Produce a complete Stryker config object by shallow-cloning `baseConfig` and
 * injecting `mutateFiles` as the `mutate` array. Does NOT mutate the input.
 */
export function buildStrykerRunConfig(baseConfig: Record<string, unknown>, mutateFiles: string[]): Record<string, unknown> {
	return { ...baseConfig, mutate: [...mutateFiles] }
}

// ---------------------------------------------------------------------------
// Pure: parseMutationReport — mutation.json -> aggregate score
// ---------------------------------------------------------------------------

/**
 * Aggregate a Stryker mutation.json report into a single MutationScore.
 *
 * Scoring (matches Stryker's own formula):
 *   detected   = killed + timeout
 *   undetected = survived + noCoverage
 *   score      = detected / (detected + undetected) * 100
 * RuntimeError/CompileError are EXCLUDED from the denominator (a crash isn't a
 * survived mutant). Ignored mutants are excluded entirely. `score` is null when
 * there are no scoring mutants.
 */
export function parseMutationReport(report: MutationReportJson): MutationScore {
	let killed = 0
	let survived = 0
	let noCoverage = 0
	let timeout = 0
	let runtimeErrors = 0

	for (const file of Object.values(report.files ?? {})) {
		for (const m of file.mutants ?? []) {
			switch (m.status) {
				case 'Killed':
					killed++
					break
				case 'Survived':
					survived++
					break
				case 'NoCoverage':
					noCoverage++
					break
				case 'Timeout':
					timeout++
					break
				case 'RuntimeError':
				case 'CompileError':
					runtimeErrors++
					break
				case 'Ignored':
				default:
					// excluded entirely
					break
			}
		}
	}

	const detected = killed + timeout
	const undetected = survived + noCoverage
	const scoringPopulation = detected + undetected
	const score = scoringPopulation === 0 ? null : (detected / scoringPopulation) * 100

	return {
		score,
		killed,
		survived,
		noCoverage,
		timeout,
		runtimeErrors,
		total: scoringPopulation,
		thresholds: report.thresholds,
	}
}

// ---------------------------------------------------------------------------
// Pure: formatMutationComment — score -> idempotent PR-comment markdown
// ---------------------------------------------------------------------------

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

/**
 * Format the mutation-score PR comment. The leading marker tag lets CI find and
 * UPDATE the same comment on re-runs (idempotent) instead of posting duplicates.
 */
export function formatMutationComment(score: MutationScore, opts: CommentOpts): string {
	const marker = '<!-- pr-mutation-report -->'
	const breakThreshold = score.thresholds?.break ?? 50

	if (score.score === null) {
		return [
			marker,
			'🧬 **Mutation testing**: No mutants generated (no mutable source files changed).',
			'',
			`- Commit: \`${opts.sha}\``,
			`- Run: ${opts.runUrl}`,
		].join('\n')
	}

	const pct = `${round2(score.score)}%`
	const indicator = score.score < breakThreshold ? '🔴' : score.score < (score.thresholds?.low ?? 60) ? '🟡' : '🟢'
	const gateLine =
		score.score < breakThreshold
			? `⚠️ **Below the ${breakThreshold}% warning floor** — survived mutants indicate tests that touch code without asserting on it.`
			: `Mutation score ≥ ${breakThreshold}% warning floor.`

	const fileList = opts.files.map((f) => `  - \`${f}\``).join('\n')

	return [
		marker,
		`${indicator} **Mutation testing** (diff-scoped): ${pct} mutation score`,
		'',
		`- Killed: ${score.killed} / Survived: ${score.survived} / No coverage: ${score.noCoverage} / Timeout: ${score.timeout}${
			score.runtimeErrors ? ` / Errors: ${score.runtimeErrors}` : ''
		}`,
		`- Mutated files (${opts.files.length}):`,
		fileList,
		`- ${gateLine}`,
		`- Commit: \`${opts.sha}\``,
		`- Full report: ${opts.runUrl}`,
	].join('\n')
}

// ---------------------------------------------------------------------------
// Orchestration (subprocess glue — isolated behind MutationRunners)
// ---------------------------------------------------------------------------

export interface RunOptions {
	baseRef?: string
	/** Path to the committed base stryker config (read + merged with mutate). */
	configPath?: string
	/** Path to write the generated runtime config (stryker reads this). */
	runConfigPath?: string
	/** Path Stryker writes its JSON report to. */
	reportPath?: string
}

export interface RunResult {
	score: MutationScore | null
	mutableFiles: string[]
	/** 0 = ran (or nothing to mutate); 2 = internal error. NEVER 1: this gate
	 *  is warning-only by design (a low mutation score warns, it does not block). */
	exitCode: 0 | 2
}

/**
 * Run the diff-scoped mutation check. Subprocess execution is delegated to
 * `runners`, so this function is fully unit-testable with fakes (see
 * stryker-changed-files.test.ts > runMutationCheck).
 *
 * The gate is intentionally WARNING-ONLY: it always returns exitCode 0 when it
 * runs at all. The CI step reads `result.score` to post a PR comment and, if
 * the score is below the break threshold, emit a visible warning. Promotion to
 * a hard gate is a deliberate later step (see docs/plans/pr-trust-pipeline.md).
 */
export async function runMutationCheck(runners: MutationRunners, opts: RunOptions = {}): Promise<RunResult> {
	const baseRef = opts.baseRef ?? process.env.MUTATION_BASE_REF ?? 'origin/master'
	const configPath = opts.configPath ?? 'stryker.config.json'
	const runConfigPath = opts.runConfigPath ?? 'stryker.run.json'
	const reportPath = opts.reportPath ?? 'reports/mutation/mutation.json'

	// 1. Diff-scoped mutable files.
	const diffOut = await runners.runDiff(baseRef)
	const changedFiles = diffOut
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	const mutableFiles = selectMutableFiles(changedFiles)
	if (mutableFiles.length === 0) {
		return { score: null, mutableFiles: [], exitCode: 0 }
	}

	// 2. Build a runtime config = base config + dynamic mutate list.
	const baseText = await runners.readText(configPath)
	let baseConfig: Record<string, unknown>
	try {
		baseConfig = JSON.parse(baseText)
	} catch {
		// Unreadable/invalid base config is a hard internal error (exit 2).
		return { score: null, mutableFiles, exitCode: 2 }
	}
	const runConfig = buildStrykerRunConfig(baseConfig, mutableFiles)
	await runners.writeText(runConfigPath, JSON.stringify(runConfig, null, '	'))

	// 3. Run Stryker. We do NOT propagate its exit code: a low score makes
	//    Stryker exit non-zero (the `break` threshold), but this gate warns
	//    rather than blocks, so we read the score from the report instead.
	await runners.runStryker(runConfigPath)

	// 4. Parse the report.
	let score: MutationScore | null = null
	try {
		const reportText = await runners.readText(reportPath)
		score = parseMutationReport(JSON.parse(reportText) as MutationReportJson)
	} catch {
		// No report (e.g. Stryker crashed, or no mutants survived long enough to
		// write one) — surface as a soft failure, not a crash.
		return { score: null, mutableFiles, exitCode: 2 }
	}
	return { score, mutableFiles, exitCode: 0 }
}

export function formatReport(result: RunResult): string {
	const lines: string[] = []
	lines.push(`mutation-gate: scoped to ${result.mutableFiles.length} changed source file(s): ${result.mutableFiles.join(', ')}`)
	if (result.exitCode === 2) {
		lines.push('mutation-gate: ERROR — could not run Stryker or read its report (internal error).')
		return lines.join('\n')
	}
	const s = result.score
	if (!s || s.score === null) {
		lines.push('mutation-gate: no mutable source files changed — nothing to test (passing).')
		return lines.join('\n')
	}
	const verdict = s.score < s.thresholds.break ? `BELOW ${s.thresholds.break}% warning floor` : 'meets warning floor'
	lines.push(
		`mutation-gate: score ${s.score.toFixed(2)}% (${verdict}) — killed ${s.killed}, survived ${s.survived}, no-coverage ${s.noCoverage}, timeout ${s.timeout}, errors ${s.runtimeErrors}.`,
	)
	return lines.join('\n')
}

/** Concrete runners that shell out to `git` and `stryker`. Reuses the shared
 *  `capture()` subprocess helper from check-coverage.ts (no duplication). */
export function realRunners(): MutationRunners {
	return {
		async runDiff(baseRef: string) {
			const { stdout, exitCode } = await capture(['git', 'diff', '--name-only', `${baseRef}...HEAD`], {
				stderr: 'inherit',
			})
			if (exitCode !== 0) {
				throw new Error(`git diff --name-only failed (exit ${exitCode}) for base ref "${baseRef}" — is the ref fetched?`)
			}
			return stdout
		},
		async readText(path: string) {
			return Bun.file(path).text()
		},
		async writeText(path: string, content: string) {
			await Bun.write(path, content)
		},
		async runStryker(configPath: string) {
			// STRYKER_BIN lets CI/local override the launcher (default `npx stryker`
			// resolves node_modules/.bin/stryker after `bun install`). Stdio is
			// inherited so the Stryker progress table streams live; the score is
			// read from the JSON report, not from this command's stdout.
			const strykerBin = (process.env.STRYKER_BIN ?? 'npx stryker').split(/\s+/).filter(Boolean)
			const proc = Bun.spawn([...strykerBin, 'run', configPath], {
				stdout: 'inherit',
				stderr: 'inherit',
			})
			const exitCode = await proc.exited
			return { exitCode, stdout: '', stderr: '' }
		},
	}
}

export interface CliDeps {
	runners: MutationRunners
	log?: (msg: string) => void
	err?: (msg: string) => void
}

/** Parse argv, run the check, print a report. Returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
	const opts: RunOptions = {}
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base' && argv[i + 1]) opts.baseRef = argv[++i]
	}
	const log = deps.log ?? ((m: string) => console.log(m))
	const err = deps.err ?? ((m: string) => console.error(m))
	try {
		const result = await runMutationCheck(deps.runners, opts)
		log(formatReport(result))
		return result.exitCode
	} catch (e) {
		err(`mutation-gate: internal error: ${e}`)
		return 2
	}
}

if (import.meta.main) {
	const code = await runCli(process.argv.slice(2), { runners: realRunners() })
	process.exit(code)
}
