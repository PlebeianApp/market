/**
 * e2e-pr-comment.ts — Format and post an idempotent PR comment linking to the
 * published nsite E2E dashboard.
 *
 * Design:
 *   - `formatComment()` is a pure function (the TDD-tested unit). It produces a
 *     markdown body containing a hidden HTML marker tag, a pass/fail summary,
 *     the clickable dashboard URL, and metadata.
 *   - `parseResults()` reads Playwright's JSON reporter output for counts.
 *   - `main()` reads env vars, formats the body, and uses the GitHub CLI (`gh`)
 *     to find an existing comment bearing our marker (and update it) or create a
 *     new one — so re-runs never produce duplicate comments.
 *
 * Env vars consumed by main():
 *   NSITE_URL        — published dashboard URL (from publish-nsite action output)
 *   TEST_STATUS      — "passed" | "failed" (from the test step outcome)
 *   RESULTS_JSON     — path to Playwright results.json (optional)
 *   COMMIT_SHA       — git commit SHA
 *   BRANCH           — git branch name
 *   PR_NUMBER        — pull request number
 *   RUN_URL          — GitHub Actions workflow run URL (optional)
 *
 * Run:  bun scripts/e2e-pr-comment.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { $ } from 'bun'

export const COMMENT_MARKER = '<!-- pr-trust-pipeline:e2e-dashboard -->'

export interface CommentOptions {
	nsiteUrl: string
	status: 'passed' | 'failed'
	passed: number
	failed: number
	skipped: number
	durationMs: number
	commitSha: string
	branch: string
	runUrl?: string
}

export interface ParsedResults {
	passed: number
	failed: number
	skipped: number
	durationMs: number
}

/** Format a millisecond duration as "12.3s" or "2m 15s". */
export function formatDuration(ms: number): string {
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(1)}s`
	const m = Math.floor(s / 60)
	const sec = Math.round(s % 60)
	return `${m}m ${sec}s`
}

/** Build the markdown PR comment body. Pure — no I/O. */
export function formatComment(opts: CommentOptions): string {
	const emoji = opts.status === 'passed' ? '✅' : '❌'
	const headline = opts.status === 'passed' ? 'All tests passed' : 'Tests failed'

	const parts: string[] = [`${opts.passed} passed`, `${opts.failed} failed`]
	if (opts.skipped > 0) parts.push(`${opts.skipped} skipped`)

	const summary = parts.join(' · ')

	const lines: string[] = [
		COMMENT_MARKER,
		'',
		'## 🎬 E2E Test Dashboard',
		'',
		`${emoji} **${headline}** — ${summary} (${formatDuration(opts.durationMs)})`,
		'',
		`🔗 **[View interactive dashboard](${opts.nsiteUrl})** — screenshots & recorded videos for each test.`,
		'',
		'---',
	]

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

/** Walk a Playwright JSON report, counting per-result statuses and durations. */
export function parseResults(filePath: string): ParsedResults | null {
	if (!filePath || !existsSync(filePath)) return null

	let data: any
	try {
		data = JSON.parse(readFileSync(filePath, 'utf8'))
	} catch {
		return null
	}

	const counts: ParsedResults = { passed: 0, failed: 0, skipped: 0, durationMs: 0 }

	const walkSuite = (suite: any) => {
		for (const spec of suite?.specs ?? []) {
			for (const testEntry of spec?.tests ?? []) {
				for (const result of testEntry?.results ?? []) {
					const status = result?.status ?? 'unknown'
					if (status === 'passed') counts.passed++
					else if (status === 'failed' || status === 'timedOut' || status === 'interrupted') counts.failed++
					else counts.skipped++
					counts.durationMs += result?.duration ?? 0
				}
			}
		}
		for (const child of suite?.suites ?? []) walkSuite(child)
	}

	for (const suite of data?.suites ?? []) walkSuite(suite)
	return counts
}

/**
 * Find an existing PR comment ID bearing our marker (idempotency), or null.
 * Uses the GitHub REST API via `gh`.
 */
async function findCommentId(prNumber: string): Promise<string | null> {
	const repo = process.env.GITHUB_REPOSITORY
	if (!repo) return null
	try {
		const out =
			await $`gh api repos/${repo}/issues/${prNumber}/comments --paginate --jq '.[] | select(.body | contains("${COMMENT_MARKER}")) | .id'`
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
		console.log(`Updated existing comment ${existingId}`)
	} else {
		await $`gh pr comment ${prNumber} --body ${body}`.quiet()
		console.log(`Posted new comment on PR #${prNumber}`)
	}
}

async function main(): Promise<void> {
	const nsiteUrl = process.env.NSITE_URL ?? ''
	const prNumber = process.env.PR_NUMBER ?? ''

	if (!nsiteUrl) {
		console.log('No NSITE_URL set; skipping PR comment.')
		return
	}
	if (!prNumber) {
		console.log('No PR_NUMBER set; skipping PR comment.')
		return
	}

	const status = (process.env.TEST_STATUS === 'passed' ? 'passed' : 'failed') as 'passed' | 'failed'

	const parsed = parseResults(process.env.RESULTS_JSON ?? '') ?? {
		passed: 0,
		failed: 0,
		skipped: 0,
		durationMs: 0,
	}

	const body = formatComment({
		nsiteUrl,
		status,
		passed: parsed.passed,
		failed: parsed.failed,
		skipped: parsed.skipped,
		durationMs: parsed.durationMs,
		commitSha: process.env.COMMIT_SHA ?? '',
		branch: process.env.BRANCH ?? '',
		runUrl: process.env.RUN_URL || undefined,
	})

	await postOrUpdateComment(prNumber, body)
}

if (import.meta.main) main()
