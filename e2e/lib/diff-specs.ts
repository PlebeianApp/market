/**
 * e2e/lib/diff-specs.ts — Diff-aware recording-scope resolver.
 *
 * Determines which e2e specs capture a FULL Playwright recording (video +
 * screenshots) on a given run, by mapping the PR's source diff to the spec
 * files most likely to exercise the changed code. This is Layer 2a's
 * "diff-affected specs" selection criterion (see docs/plans/pr-trust-pipeline.md).
 *
 * The `@happy-path` baseline is ALWAYS included so curated visual-proof specs
 * keep recording regardless of the diff; diff-affected stems are ADDED on top
 * (union, never replacement), so this can never regress the existing behaviour.
 *
 * Resolution order (first match wins):
 *   1. `DIFF_AFFECTED_GREP`  env → use that grep verbatim (manual / Layer 1
 *      Codecov escape hatch — a future Layer 1 enhancement can emit the exact
 *      affected-spec grep here and bypass the heuristic entirely).
 *   2. `DIFF_AFFECTED_SPECS` env → comma-separated spec stems, unioned with
 *      `@happy-path`.
 *   3. `git diff <base>...HEAD` → changed `src/` files → spec stems via a
 *      path-token heuristic (reusing Layer 1's `isCheckableFile` eligibility
 *      predicate from scripts/check-coverage.ts).
 *   4. fallback → `@happy-path` only.
 *
 * Git is only invoked under `CI` (or when `DIFF_AWARE=1`). Locally the resolver
 * returns the static `@happy-path` pattern with NO side effects, which keeps
 * `bun test e2e/playwright.config.test.ts` hermetic.
 *
 * All pure helpers are exported and unit-tested in diff-specs.test.ts.
 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCheckableFile } from '../../scripts/check-coverage'

// Portable e2e/tests dir (works under both Bun and Node — Playwright loads the
// config under Node, where import.meta.dir is undefined). Mirrors the
// fileURLToPath(import.meta.url) pattern already used in playwright.config.ts.
const E2E_TESTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests')

export interface RecordingScope {
	/** RegExp used as the recording project's `grep` (and the default project's `grepInvert`). */
	pattern: RegExp
	/** Human-readable explanation of how the pattern was derived (logged in CI). */
	reason: string
	/** The matched spec stems (excluding the @happy-path baseline), for transparency. */
	diffStems: string[]
}

const HAPPY_PATH = 'happy-path' // without the sigil; see buildGrepPattern

export interface ResolveOptions {
	/** Override the git diff base ref (default: origin/master, same as Layer 1). */
	baseRef?: string
	/** Override the e2e tests directory (default: the tests dir beside this module). */
	testsDir?: string
	/** Inject changed files directly (testing). If set, git is not invoked. */
	changedFiles?: string[]
	/** Inject the list of spec stems (testing). If set, the dir is not read. */
	specStems?: string[]
	/** Force the diff-aware path even outside CI (testing). */
	forceDiffAware?: boolean
}

/**
 * Extract the canonical stem from a spec filename, e.g. "cart.spec.ts" → "cart",
 * "order-detail.spec.ts" → "order-detail", "community.progressive-loading.spec.ts"
 * → "community.progressive-loading".
 */
export function specStem(specFile: string): string {
	const base = specFile.split('/').pop() ?? specFile
	return base.replace(/\.spec\.ts$/, '')
}

/** First hyphen-separated token of a stem, lowercased: "order-detail" → "order". */
export function primaryKeyword(stem: string): string {
	return stem.split('-')[0]!.toLowerCase()
}

/**
 * Depluralized primary keyword for TITLE matching: "payments" → "payment",
 * "products" → "product". The singular form is a substring of the plural, so a
 * grep on the singular matches both "payment method" and "payments" titles.
 * Words ending in "ss" (e.g. "class") and very short words are left unchanged.
 */
export function titleKeyword(stem: string): string {
	const kw = primaryKeyword(stem)
	if (kw.length > 3 && kw.endsWith('s') && !kw.endsWith('ss')) {
		return kw.slice(0, -1)
	}
	return kw
}

/** Characters that have special meaning inside a RegExp. */
const REGEX_META = new Set(Array.from('\\^$.*+?()[]{}|/-'))

/** Escape a literal string for safe embedding in a RegExp source. */
export function escapeRegex(s: string): string {
	// Implemented as a character scan (not a regex literal) so the lexer never
	// has to parse a metacharacter-heavy character class at module load.
	let out = ''
	for (const ch of s) {
		out += REGEX_META.has(ch) ? '\\' + ch : ch
	}
	return out
}

/**
 * Map a set of changed source files to the spec stems whose code paths they
 * most likely intersect, using a conservative path-token heuristic.
 *
 * A spec stem matches a changed file when the stem's primary keyword (first
 * hyphen-token, lowercased) appears as a substring of any path segment of the
 * changed file (also lowercased, extension stripped). This is deliberately
 * over-inclusive — recording an extra spec is harmless, while missing a
 * diff-affected spec would lose visual proof.
 *
 * Example: changed `src/components/CartButton.tsx` with stems ["cart", ...]
 * → segments ["src","components","cartbutton"] → "cart" ⊂ "cartbutton" → match.
 */
export function changedSourceToSpecStems(changedFiles: string[], stems: string[]): string[] {
	const keywords = new Set(stems.map(primaryKeyword))
	const matched = new Set<string>()
	for (const file of changedFiles) {
		const segments = file.split('/').map((s) => s.replace(/\.[^.]+$/, '').toLowerCase())
		for (const stem of stems) {
			const kw = primaryKeyword(stem)
			if (!kw) continue
			// Match if the keyword appears in any path segment. Whole-stem match
			// (for multi-word stems like "order-detail") is also honoured when a
			// single segment equals the full stem.
			const fullStem = stem.toLowerCase()
			const hit = segments.some((seg) => seg.includes(kw) || seg === fullStem)
			if (hit) matched.add(stem)
		}
		// Also surface any keyword that itself appears in the full path (covers
		// flat layouts like src/lib/payments.ts → "payments").
		const lowerPath = file.toLowerCase()
		for (const kw of keywords) {
			if (kw && lowerPath.includes(kw)) {
				const owner = stems.find((s) => primaryKeyword(s) === kw)
				if (owner) matched.add(owner)
			}
		}
	}
	return [...matched].sort()
}

/**
 * Build the recording grep RegExp from a set of spec stems plus the
 * `@happy-path` baseline. Uses the primary keyword of each stem (best
 * title-match) and the case-insensitive flag so e.g. "Cart" titles match.
 * Returns a RegExp; the result of `resolveRecordingScope().pattern` is what
 * the config assigns to project `grep` / `grepInvert`.
 */
export function buildGrepPattern(stems: string[]): RegExp {
	const keywords = new Set<string>()
	for (const s of stems) {
		const kw = titleKeyword(s)
		if (kw) keywords.add(kw)
	}
	// Always include the @happy-path baseline first.
	const parts = [`@${HAPPY_PATH}`, ...[...keywords].sort().map(escapeRegex)]
	return new RegExp(parts.join('|'), 'i')
}

/** List spec stems present in the e2e tests directory (sorted, unique). */
export function discoverSpecStems(testsDir: string): string[] {
	try {
		const files = readdirSync(testsDir)
		return files
			.filter((f) => f.endsWith('.spec.ts'))
			.map(specStem)
			.sort()
	} catch {
		return []
	}
}

/** Run `git diff --name-only <base>...HEAD` and return checkable source files. */
export async function gitChangedFiles(baseRef: string): Promise<string[]> {
	const proc = Bun.spawn(['git', 'diff', '--name-only', `${baseRef}...HEAD`, '--', '*.ts', '*.tsx'], {
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const stdout = await new Response(proc.stdout).text()
	const exitCode = await proc.exited
	if (exitCode !== 0) {
		throw new Error(`git diff failed (exit ${exitCode}) for base ref "${baseRef}" — is the ref fetched?`)
	}
	return stdout
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.filter(isCheckableFile)
}

/**
 * Resolve the recording scope for the current run. Pure aside from an optional
 * git invocation (only under CI). See module doc for the resolution order.
 */
export async function resolveRecordingScope(opts: ResolveOptions = {}): Promise<RecordingScope> {
	const baseRef = opts.baseRef ?? process.env.COVERAGE_BASE_REF ?? 'origin/master'
	const testsDir = opts.testsDir ?? E2E_TESTS_DIR

	// (1) Explicit grep escape hatch (manual / future Layer 1 Codecov feed).
	const envGrep = process.env.DIFF_AFFECTED_GREP
	if (envGrep && envGrep.trim()) {
		return {
			pattern: new RegExp(envGrep.trim()),
			reason: `DIFF_AFFECTED_GREP env override: /${envGrep.trim()}/`,
			diffStems: [],
		}
	}

	// (2) Explicit spec-stem list escape hatch.
	const envSpecs = process.env.DIFF_AFFECTED_SPECS
	if (envSpecs && envSpecs.trim()) {
		const stems = envSpecs
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		const pattern = buildGrepPattern(stems)
		return {
			pattern,
			reason: `DIFF_AFFECTED_SPECS env override: ${stems.join(', ')} + @happy-path`,
			diffStems: stems,
		}
	}

	const ci = !!process.env.CI || opts.forceDiffAware === true
	if (!ci) {
		// Local / hermetic: static @happy-path, no git, no side effects.
		return {
			pattern: buildGrepPattern([]),
			reason: 'non-CI: @happy-path baseline only (no diff analysis)',
			diffStems: [],
		}
	}

	// (3) Diff-aware: changed src files → spec stems.
	const stems = opts.specStems ?? discoverSpecStems(testsDir)
	let changed: string[]
	try {
		changed = opts.changedFiles ?? (await gitChangedFiles(baseRef))
	} catch (e) {
		// Base ref missing / git unavailable in this checkout → fall back safely.
		return {
			pattern: buildGrepPattern([]),
			reason: `diff-aware: git diff unavailable (${(e as Error).message}); @happy-path fallback`,
			diffStems: [],
		}
	}

	const diffStems = changedSourceToSpecStems(changed, stems)
	if (diffStems.length === 0) {
		return {
			pattern: buildGrepPattern([]),
			reason: `diff-aware: ${changed.length} changed file(s), none mapped to a spec; @happy-path fallback`,
			diffStems: [],
		}
	}

	const pattern = buildGrepPattern(diffStems)
	return {
		pattern,
		reason: `diff-aware: ${changed.length} changed file(s) → ${diffStems.join(', ')} + @happy-path`,
		diffStems,
	}
}

/**
 * Synchronous variant used by playwright.config.ts at module load. The config
 * is evaluated synchronously, so it cannot `await` the async resolver. We
 * pre-compute the scope once and cache it.
 *
 * Because the only async step is the optional git invocation, and the config
 * needs the result before defining projects, we run git synchronously via
 * `Bun.spawnSync` when diff-awareness is active, and fall back to the static
 * @happy-path pattern otherwise (or on any error).
 */
let cachedScope: RecordingScope | null = null

/** Clear the cached recording scope. Intended for unit tests only. */
export function resetRecordingScopeCache(): void {
	cachedScope = null
}

export function getRecordingScopeSync(opts: ResolveOptions = {}): RecordingScope {
	if (cachedScope) return cachedScope

	// Env escape hatches and the non-CI path need no git.
	const baseRef = opts.baseRef ?? process.env.COVERAGE_BASE_REF ?? 'origin/master'
	// NOTE: use the portable module-level E2E_TESTS_DIR (fileURLToPath-based), NOT
	// `import.meta.dir` — the latter is Bun-only and is `undefined` under Node,
	// where Playwright actually loads this config (see comment at top of file).
	const testsDir = opts.testsDir ?? E2E_TESTS_DIR

	const envGrep = process.env.DIFF_AFFECTED_GREP
	if (envGrep && envGrep.trim()) {
		cachedScope = {
			pattern: new RegExp(envGrep.trim()),
			reason: `DIFF_AFFECTED_GREP env override: /${envGrep.trim()}/`,
			diffStems: [],
		}
		return cachedScope
	}

	const envSpecs = process.env.DIFF_AFFECTED_SPECS
	if (envSpecs && envSpecs.trim()) {
		const stems = envSpecs
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		cachedScope = {
			pattern: buildGrepPattern(stems),
			reason: `DIFF_AFFECTED_SPECS env override: ${stems.join(', ')} + @happy-path`,
			diffStems: stems,
		}
		return cachedScope
	}

	const ci = !!process.env.CI || opts.forceDiffAware === true
	if (!ci) {
		cachedScope = { pattern: buildGrepPattern([]), reason: 'non-CI: @happy-path baseline only (no diff analysis)', diffStems: [] }
		return cachedScope
	}

	// CI: attempt a synchronous git diff. Any failure → safe @happy-path fallback.
	let changed: string[] = []
	if (opts.changedFiles) {
		changed = opts.changedFiles
	} else {
		try {
			const res = Bun.spawnSync(['git', 'diff', '--name-only', `${baseRef}...HEAD`, '--', '*.ts', '*.tsx'])
			if (res.success) {
				changed = String(res.stdout)
					.split('\n')
					.map((l) => l.trim())
					.filter((l) => l.length > 0)
					.filter(isCheckableFile)
			}
		} catch {
			changed = []
		}
	}

	const stems = opts.specStems ?? discoverSpecStems(testsDir)
	const diffStems = changedSourceToSpecStems(changed, stems)
	cachedScope =
		diffStems.length === 0
			? {
					pattern: buildGrepPattern([]),
					reason: `diff-aware: ${changed.length} changed file(s), none mapped to a spec; @happy-path fallback`,
					diffStems: [],
				}
			: {
					pattern: buildGrepPattern(diffStems),
					reason: `diff-aware: ${changed.length} changed file(s) → ${diffStems.join(', ')} + @happy-path`,
					diffStems,
				}
	return cachedScope
}
