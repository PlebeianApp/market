import { test, expect } from 'bun:test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { REPORT_MARKER, formatDuration, parseReportResults, formatReport, type ReportOptions } from '../e2e-report-comment'

// ── helpers ─────────────────────────────────────────────────────────────────

/** Write a Playwright-shaped JSON object to a temp file and return the path. */
function writeResults(data: object): string {
	const dir = `/tmp/report-test-${Date.now()}`
	mkdirSync(dir, { recursive: true })
	const path = `${dir}/results.json`
	writeFileSync(path, JSON.stringify(data))
	return path
}

const baseOpts: ReportOptions = {
	passed: 0,
	failed: 0,
	skipped: 0,
	flaky: 0,
	durationMs: 0,
	details: [],
	commitSha: 'abcdef1234567890',
	branch: 'feat/pr-trust-pipeline',
	runUrl: 'https://github.com/felixfelix-bot/market/actions/runs/999',
	artifactNames: ['playwright-visual-proof-pricing', 'test-results-pricing'],
	artifactRetentionDays: 14,
}

// ── REPORT_MARKER ───────────────────────────────────────────────────────────

test('REPORT_MARKER: is the documented hidden HTML comment', () => {
	expect(REPORT_MARKER).toBe('<!-- pr-trust-pipeline-report -->')
})

// ── formatDuration ──────────────────────────────────────────────────────────

test('formatDuration: sub-minute durations render as seconds with one decimal', () => {
	expect(formatDuration(0)).toBe('0.0s')
	expect(formatDuration(12_340)).toBe('12.3s')
})

test('formatDuration: minute-plus durations render as Xm Ys', () => {
	expect(formatDuration(60_000)).toBe('1m 0s')
	expect(formatDuration(135_000)).toBe('2m 15s')
})

// ── parseReportResults ──────────────────────────────────────────────────────

test('parseReportResults: returns null for a missing file', () => {
	expect(parseReportResults('/nonexistent/results.json')).toBeNull()
})

test('parseReportResults: returns null for invalid JSON', () => {
	const dir = `/tmp/report-test-bad-${Date.now()}`
	mkdirSync(dir, { recursive: true })
	const path = `${dir}/results.json`
	writeFileSync(path, '{ not valid json')
	expect(parseReportResults(path)).toBeNull()
})

test('parseReportResults: counts test-level outcomes from the final result of each test', () => {
	const path = writeResults({
		config: {},
		suites: [
			{
				title: 'pricing.spec.ts',
				file: 'e2e/tests/pricing.spec.ts',
				specs: [
					{
						title: 'Product Page - View Only @happy-path',
						tests: [
							{
								results: [
									{ status: 'passed', duration: 10_000 },
									{ status: 'passed', duration: 5_000 },
								],
							},
						],
					},
					{
						title: 'Cart adds item',
						tests: [
							{
								results: [{ status: 'failed', duration: 8_000, errors: [{ message: 'timeout' }] }],
							},
						],
					},
				],
				suites: [],
			},
		],
	})

	const parsed = parseReportResults(path)!
	expect(parsed.passed).toBe(1)
	expect(parsed.failed).toBe(1)
	expect(parsed.skipped).toBe(0)
	expect(parsed.flaky).toBe(0)
	expect(parsed.details).toHaveLength(2)
	// duration sums ALL results (both retries)
	expect(parsed.durationMs).toBe(23_000)
})

test('parseReportResults: detects flaky tests (failed then passed on retry)', () => {
	const path = writeResults({
		suites: [
			{
				title: 'f.spec.ts',
				file: 'e2e/tests/f.spec.ts',
				specs: [
					{
						title: 'flaky test',
						tests: [
							{
								results: [
									{ status: 'failed', duration: 3_000 },
									{ status: 'passed', duration: 4_000 },
								],
							},
						],
					},
				],
				suites: [],
			},
		],
	})

	const parsed = parseReportResults(path)!
	expect(parsed.flaky).toBe(1)
	expect(parsed.passed).toBe(0) // flaky is separate from passed
	expect(parsed.failed).toBe(0)
	expect(parsed.details[0].status).toBe('flaky')
})

test('parseReportResults: captures test title, file, and error for failed tests', () => {
	const path = writeResults({
		suites: [
			{
				title: 'checkout.spec.ts',
				file: 'e2e/tests/checkout.spec.ts',
				specs: [
					{
						title: 'checkout completes',
						tests: [
							{
								results: [
									{
										status: 'timedOut',
										duration: 30_000,
										errors: [{ message: 'expect(locator).toBeVisible() timed out' }],
									},
								],
							},
						],
					},
				],
				suites: [],
			},
		],
	})

	const parsed = parseReportResults(path)!
	expect(parsed.details[0].title).toBe('checkout completes')
	expect(parsed.details[0].file).toBe('checkout.spec.ts')
	expect(parsed.details[0].status).toBe('failed') // timedOut maps to failed
	expect(parsed.details[0].error).toContain('timed out')
})

test('parseReportResults: handles skipped and didNotRun as skipped', () => {
	const path = writeResults({
		suites: [
			{
				title: 's.spec.ts',
				specs: [
					{ title: 'a', tests: [{ results: [{ status: 'skipped', duration: 0 }] }] },
					{ title: 'b', tests: [{ results: [{ status: 'didNotRun', duration: 0 }] }] },
				],
				suites: [],
			},
		],
	})

	const parsed = parseReportResults(path)!
	expect(parsed.skipped).toBe(2)
	expect(parsed.details.every((d) => d.status === 'skipped')).toBe(true)
})

test('parseReportResults: walks nested suites (describe blocks)', () => {
	const path = writeResults({
		suites: [
			{
				title: 'nested.spec.ts',
				file: 'e2e/tests/nested.spec.ts',
				specs: [],
				suites: [
					{
						title: 'describe group',
						specs: [{ title: 'inner test', tests: [{ results: [{ status: 'passed', duration: 2_000 }] }] }],
						suites: [],
					},
				],
			},
		],
	})

	const parsed = parseReportResults(path)!
	expect(parsed.passed).toBe(1)
	expect(parsed.details[0].title).toBe('inner test')
	// file inherited from parent suite
	expect(parsed.details[0].file).toBe('nested.spec.ts')
})

test('parseReportResults: returns null counts and empty details for empty suites', () => {
	const path = writeResults({ suites: [] })
	const parsed = parseReportResults(path)!
	expect(parsed.passed).toBe(0)
	expect(parsed.failed).toBe(0)
	expect(parsed.details).toHaveLength(0)
})

// ── formatReport ────────────────────────────────────────────────────────────

test('formatReport: always emits the idempotency marker on the first line', () => {
	const body = formatReport({ ...baseOpts, passed: 2, failed: 0, durationMs: 10_000 })
	expect(body.split('\n')[0]).toBe(REPORT_MARKER)
})

test('formatReport: all-passed report shows check emoji and pass summary', () => {
	const body = formatReport({
		...baseOpts,
		passed: 3,
		failed: 0,
		durationMs: 15_000,
		details: [
			{ title: 'test a', file: 'a.spec.ts', status: 'passed', durationMs: 5_000 },
			{ title: 'test b', file: 'b.spec.ts', status: 'passed', durationMs: 10_000 },
		],
	})
	expect(body).toContain('✅')
	expect(body).toContain('3 passed')
	expect(body).toContain('0 failed')
	expect(body).not.toContain('0 skipped') // omitted when zero
	expect(body).toContain('15.0s')
})

test('formatReport: failed report shows cross emoji and fail count', () => {
	const body = formatReport({
		...baseOpts,
		passed: 2,
		failed: 1,
		durationMs: 20_000,
	})
	expect(body).toContain('❌')
	expect(body).toContain('2 passed')
	expect(body).toContain('1 failed')
})

test('formatReport: includes skipped count only when > 0', () => {
	const withSkipped = formatReport({ ...baseOpts, passed: 1, failed: 0, skipped: 2, durationMs: 1_000 })
	expect(withSkipped).toContain('2 skipped')

	const noSkipped = formatReport({ ...baseOpts, passed: 1, failed: 0, skipped: 0, durationMs: 1_000 })
	expect(noSkipped).not.toContain('skipped')
})

test('formatReport: includes flaky count only when > 0', () => {
	const withFlaky = formatReport({ ...baseOpts, passed: 1, failed: 0, flaky: 1, durationMs: 1_000 })
	expect(withFlaky).toContain('1 flaky')

	const noFlaky = formatReport({ ...baseOpts, passed: 1, failed: 0, flaky: 0, durationMs: 1_000 })
	expect(noFlaky).not.toContain('flaky')
})

test('formatReport: includes a per-test table with titles and status emojis', () => {
	const body = formatReport({
		...baseOpts,
		passed: 1,
		failed: 1,
		durationMs: 10_000,
		details: [
			{ title: 'passing test', file: 'a.spec.ts', status: 'passed', durationMs: 4_000 },
			{ title: 'failing test', file: 'b.spec.ts', status: 'failed', durationMs: 6_000 },
		],
	})
	expect(body).toContain('| Test')
	expect(body).toContain('passing test')
	expect(body).toContain('failing test')
})

test('formatReport: includes failed test error details in a collapsible section', () => {
	const body = formatReport({
		...baseOpts,
		passed: 0,
		failed: 1,
		durationMs: 5_000,
		details: [
			{
				title: 'broken test',
				file: 'broken.spec.ts',
				status: 'failed',
				durationMs: 5_000,
				error: 'expect(locator).toBeVisible() timed out after 5000ms',
			},
		],
	})
	expect(body).toContain('<details>')
	expect(body).toContain('broken test')
	expect(body).toContain('timed out after 5000ms')
})

test('formatReport: omits failures section when no failures', () => {
	const body = formatReport({
		...baseOpts,
		passed: 2,
		failed: 0,
		durationMs: 5_000,
		details: [{ title: 'ok', file: 'ok.spec.ts', status: 'passed', durationMs: 5_000 }],
	})
	expect(body).not.toContain('<details>')
})

test('formatReport: lists artifact names and retention in artifacts section', () => {
	const body = formatReport({ ...baseOpts, passed: 1, failed: 0, durationMs: 1_000 })
	expect(body).toContain('playwright-visual-proof-pricing')
	expect(body).toContain('test-results-pricing')
	expect(body).toContain('14-day retention') // artifactRetentionDays
})

test('formatReport: links to the workflow run for artifact download', () => {
	const runUrl = 'https://github.com/felixfelix-bot/market/actions/runs/42'
	const body = formatReport({ ...baseOpts, passed: 1, failed: 0, durationMs: 1_000, runUrl })
	expect(body).toContain(runUrl)
})

test('formatReport: mentions trace.playwright.dev for trace viewer', () => {
	const body = formatReport({ ...baseOpts, passed: 1, failed: 0, durationMs: 1_000 })
	expect(body).toContain('trace.playwright.dev')
})

test('formatReport: includes branch and short commit SHA in footer', () => {
	const body = formatReport({ ...baseOpts, passed: 1, failed: 0, durationMs: 1_000 })
	expect(body).toContain('feat/pr-trust-pipeline')
	expect(body).toContain('abcdef12') // first 8 chars
})

test('formatReport: produces a minimal report when results are empty (setup failure)', () => {
	const body = formatReport({
		...baseOpts,
		passed: 0,
		failed: 0,
		durationMs: 0,
		details: [],
		jobOutcome: 'failure',
	})
	// Should not crash; should still have marker + artifact links
	expect(body.split('\n')[0]).toBe(REPORT_MARKER)
	expect(body).toContain('No test results')
})
