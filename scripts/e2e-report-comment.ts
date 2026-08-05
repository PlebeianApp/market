/**
 * e2e-report-comment.ts — Generate a GitHub-artifacts-only Markdown E2E report
 * and post it as an idempotent (update-not-duplicate) PR comment.
 *
 * This is the Layer 2b "no-nsite" report: it links to GitHub Actions artifacts
 * (trace.zip, .webm video, .png screenshots) instead of an external nsite
 * dashboard. It coexists with the nsite dashboard comment (separate marker).
 *
 * Design (mirrors scripts/e2e-pr-comment.ts):
 *   - `parseReportResults()` reads Playwright's JSON reporter output, walking
 *     the suite tree to produce test-level outcomes (final status per test,
 *     flaky detection, per-test error messages, and totals).
 *   - `formatReport()` is a pure function that renders the Markdown body with
 *     a hidden marker tag, pass/fail/flaky summary, per-test table, collapsible
 *     failure details, artifact links, and a footer.
 *   - `main()` reads env vars, parses results, formats the body, and uses the
 *     GitHub CLI (`gh`) to find an existing comment bearing our marker (and
 *     update it) or create a new one — so re-runs never produce duplicates.
 *
 * Env vars consumed by main():
 *   RESULTS_JSON       — path to Playwright results.json (optional)
 *   COMMIT_SHA         — git commit SHA
 *   BRANCH             — git branch name
 *   PR_NUMBER          — pull request number (skips if absent)
 *   RUN_URL            — GitHub Actions workflow run URL (artifact download link)
 *   ARTIFACT_NAMES     — comma-separated artifact names to list (optional)
 *   ARTIFACT_RETENTION — retention days label (optional, default "14")
 *   E2E_JOB_OUTCOME    — 'success' | 'failure' (for the empty-results fallback)
 *
 * Run:  bun scripts/e2e-report-comment.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { $ } from 'bun'

export const REPORT_MARKER = '<!-- pr-trust-pipeline-report -->'

const MAX_ERROR_LEN = 600
const MAX_DETAILS_ROWS = 50

// ── types ───────────────────────────────────────────────────────────────────

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'flaky'

export interface TestDetail {
	title: string
	file: string
	status: TestStatus
	durationMs: number
	error?: string
}

export interface ReportResults {
	passed: number
	failed: number
	skipped: number
	flaky: number
	durationMs: number
	details: TestDetail[]
}

export interface ReportOptions extends Omit<ReportResults, 'details'> {
	details: TestDetail[]
	commitSha: string
	branch: string
	runUrl: string
	artifactNames: string[]
	artifactRetentionDays: number
	jobOutcome?: string
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** Format a millisecond duration as "12.3s" or "2m 15s". */
export function formatDuration(ms: number): string {
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(1)}s`
	const m = Math.floor(s / 60)
	const sec = Math.round(s % 60)
	return `${m}m ${sec}s`
}

const FAILURE_STATUSES = new Set(['failed', 'timedOut', 'interrupted'])

function statusEmoji(status: TestStatus): string {
	switch (status) {
		case 'passed':
			return '✅'
		case 'failed':
			return '❌'
		case 'flaky':
			return '⚠️'
		case 'skipped':
			return '⏭️'
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max)}…`
}

// ── parsing ─────────────────────────────────────────────────────────────────

function resolveStatus(results: any[]): TestStatus {
	if (results.length === 0) return 'skipped'
	const last = results[results.length - 1]
	const lastStatus = last?.status ?? 'unknown'

	if (FAILURE_STATUSES.has(lastStatus)) return 'failed'
	if (lastStatus === 'passed') {
		// Flaky: an earlier attempt failed but the final one passed.
		const hadEarlierFailure = results.slice(0, -1).some((r) => FAILURE_STATUSES.has(r?.status))
		return hadEarlierFailure ? 'flaky' : 'passed'
	}
	return 'skipped'
}

/**
 * Walk a Playwright JSON report, producing test-level outcomes and per-test
 * details (title, file, final status, total duration, error message).
 *
 * Unlike e2e-pr-comment's `parseResults` (which counts each result
 * individually), this counts at the TEST level — each test contributes exactly
 * one outcome based on its final result. Duration still sums all results.
 */
export function parseReportResults(filePath: string): ReportResults | null {
	if (!filePath || !existsSync(filePath)) return null

	let data: any
	try {
		data = JSON.parse(readFileSync(filePath, 'utf8'))
	} catch {
		return null
	}

	const details: TestDetail[] = []
	let durationMs = 0

	const walkSuite = (suite: any, inheritedFile?: string) => {
		// Prefer the explicit `file` attribute; for child suites (describe blocks)
		// that lack one, inherit from the parent before falling back to `title`.
		const file = suite?.file || inheritedFile || suite?.title || 'unknown'

		for (const spec of suite?.specs ?? []) {
			for (const testEntry of spec?.tests ?? []) {
				const results: any[] = testEntry?.results ?? []
				if (results.length === 0) continue

				const status = resolveStatus(results)
				const specDuration = results.reduce((sum, r) => sum + (r?.duration ?? 0), 0)
				durationMs += specDuration

				// Extract the first error message from any failed result.
				let error: string | undefined
				for (const r of results) {
					const errs = r?.errors ?? []
					for (const e of errs) {
						if (e?.message) {
							error = truncate(String(e.message).trim(), MAX_ERROR_LEN)
							break
						}
					}
					if (error) break
				}

				details.push({
					title: spec?.title ?? '(untitled)',
					file: file.split('/').pop() || file,
					status,
					durationMs: specDuration,
					error,
				})
			}
		}

		for (const child of suite?.suites ?? []) walkSuite(child, file)
	}

	for (const suite of data?.suites ?? []) walkSuite(suite)

	return {
		passed: details.filter((d) => d.status === 'passed').length,
		failed: details.filter((d) => d.status === 'failed').length,
		skipped: details.filter((d) => d.status === 'skipped').length,
		flaky: details.filter((d) => d.status === 'flaky').length,
		durationMs,
		details,
	}
}

// ── formatting ──────────────────────────────────────────────────────────────

function buildSummaryLine(opts: ReportOptions): string {
	const emoji = opts.failed > 0 ? '❌' : opts.passed > 0 || opts.flaky > 0 ? '✅' : '⚠️'
	const headline = opts.failed > 0 ? 'Tests failed' : opts.passed > 0 || opts.flaky > 0 ? 'All tests passed' : 'No test results'

	const parts: string[] = [`${opts.passed} passed`, `${opts.failed} failed`]
	if (opts.flaky > 0) parts.push(`${opts.flaky} flaky`)
	if (opts.skipped > 0) parts.push(`${opts.skipped} skipped`)

	const summary = parts.length > 0 ? parts.join(' · ') : 'no data'
	const dur = opts.durationMs > 0 ? ` (${formatDuration(opts.durationMs)})` : ''
	return `${emoji} **${headline}** — ${summary}${dur}`
}

function buildTestTable(details: TestDetail[]): string[] {
	if (details.length === 0) return []
	const rows = details.slice(0, MAX_DETAILS_ROWS)
	const lines: string[] = ['', '| # | Test | Status | Duration |', '|---|------|:------:|----------|']
	rows.forEach((d, i) => {
		lines.push(`| ${i + 1} | ${d.title} | ${statusEmoji(d.status)} | ${formatDuration(d.durationMs)} |`)
	})
	if (details.length > MAX_DETAILS_ROWS) {
		lines.push(`| | …and ${details.length - MAX_DETAILS_ROWS} more (see artifacts) | | |`)
	}
	return lines
}

function buildFailuresSection(details: TestDetail[]): string[] {
	const failures = details.filter((d) => d.status === 'failed')
	if (failures.length === 0) return []

	const lines: string[] = ['', `<details>`, `<summary>❌ Failures (${failures.length})</summary>`, '']
	for (const f of failures) {
		lines.push(`**${f.title}** (\`${f.file}\`)`)
		if (f.error) {
			lines.push('')
			lines.push('```')
			lines.push(f.error)
			lines.push('```')
		}
		lines.push('')
	}
	lines.push('</details>')
	return lines
}

function buildArtifactsSection(opts: ReportOptions): string[] {
	const lines: string[] = [
		'',
		`### 📦 Artifacts (${opts.artifactRetentionDays}-day retention)`,
		'',
		'| Name | Contents |',
		'|------|----------|',
	]
	for (const name of opts.artifactNames) {
		lines.push(`| \`${name}\` | trace.zip · video.webm · screenshot.png |`)
	}
	lines.push('')
	lines.push(
		`⬇️ [Download from workflow run](${opts.runUrl}) · 🔍 Open trace.zip in [trace.playwright.dev](https://trace.playwright.dev) (after download)`,
	)
	return lines
}

/** Build the markdown PR report body. Pure — no I/O. */
export function formatReport(opts: ReportOptions): string {
	const lines: string[] = [REPORT_MARKER, '', '## 🧪 E2E Results', '', buildSummaryLine(opts)]

	// Per-test table
	lines.push(...buildTestTable(opts.details))

	// Collapsible failures
	lines.push(...buildFailuresSection(opts.details))

	// Artifacts
	lines.push(...buildArtifactsSection(opts))

	// Footer
	lines.push('', '---')
	const footerParts: string[] = []
	if (opts.branch) footerParts.push(`\`${opts.branch}\``)
	if (opts.commitSha) footerParts.push(`@ \`${opts.commitSha.slice(0, 8)}\``)
	const footerBase = footerParts.join(' ')
	if (opts.runUrl) {
		lines.push(`${footerBase} · [workflow run](${opts.runUrl})`)
	} else if (footerBase) {
		lines.push(footerBase)
	}

	return lines.join('\n')
}

// ── GitHub CLI (idempotent comment) ─────────────────────────────────────────

/**
 * Find an existing PR comment ID bearing our marker (idempotency), or null.
 * Uses the GitHub REST API via `gh`.
 */
async function findCommentId(prNumber: string): Promise<string | null> {
	const repo = process.env.GITHUB_REPOSITORY
	if (!repo) return null
	try {
		const out =
			await $`gh api repos/${repo}/issues/${prNumber}/comments --paginate --jq '.[] | select(.body | contains("${REPORT_MARKER}")) | .id'`
				.text()
				.catch(() => '')
		return out.trim().split('\n')[0].trim() || null
	} catch {
		return null
	}
}

/**
 * Post a new comment or update the existing one (find-by-marker), so repeated
 * CI runs keep a single comment rather than spamming the PR.
 */
async function postOrUpdateComment(prNumber: string, body: string): Promise<void> {
	const repo = process.env.GITHUB_REPOSITORY
	if (!repo) {
		console.error('GITHUB_REPOSITORY not set; cannot post comment')
		process.exit(1)
	}
	const existingId = await findCommentId(prNumber)
	if (existingId) {
		await $`gh api repos/${repo}/issues/comments/${existingId} -X PATCH -f body=${body}`.quiet()
		console.log(`Updated existing report comment ${existingId}`)
	} else {
		await $`gh pr comment ${prNumber} --body ${body}`.quiet()
		console.log(`Posted new report comment on PR #${prNumber}`)
	}
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const prNumber = process.env.PR_NUMBER ?? ''
	if (!prNumber) {
		console.log('No PR_NUMBER set; skipping report comment.')
		return
	}

	const parsed = parseReportResults(process.env.RESULTS_JSON ?? '')

	const artifactNames = (process.env.ARTIFACT_NAMES ?? 'playwright-visual-proof-pricing,test-results-pricing')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)

	const opts: ReportOptions = {
		passed: parsed?.passed ?? 0,
		failed: parsed?.failed ?? 0,
		skipped: parsed?.skipped ?? 0,
		flaky: parsed?.flaky ?? 0,
		durationMs: parsed?.durationMs ?? 0,
		details: parsed?.details ?? [],
		commitSha: process.env.COMMIT_SHA ?? '',
		branch: process.env.BRANCH ?? '',
		runUrl: process.env.RUN_URL ?? '',
		artifactNames,
		artifactRetentionDays: parseInt(process.env.ARTIFACT_RETENTION ?? '14', 10),
		jobOutcome: process.env.E2E_JOB_OUTCOME,
	}

	const body = formatReport(opts)
	await postOrUpdateComment(prNumber, body)
}

if (import.meta.main) main()
