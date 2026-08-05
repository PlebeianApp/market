import { test, expect } from 'bun:test'
import { COMMENT_MARKER, formatComment, formatDuration, parseResults } from '../e2e-pr-comment'

// ── formatDuration ──────────────────────────────────────────────────────────

test('formatDuration: sub-minute durations render as seconds with one decimal', () => {
	expect(formatDuration(0)).toBe('0.0s')
	expect(formatDuration(12340)).toBe('12.3s')
})

test('formatDuration: minute-plus durations render as Xm Ys', () => {
	expect(formatDuration(60_000)).toBe('1m 0s')
	expect(formatDuration(135_000)).toBe('2m 15s')
})

// ── formatComment ───────────────────────────────────────────────────────────

const baseOpts = {
	nsiteUrl: 'https://npub1abc.nsite.orangesync.tech/',
	commitSha: 'abcdef1234567890',
	branch: 'feat/pr-trust-pipeline',
}

test('formatComment: always emits the idempotency marker on the first line', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 3, failed: 0, skipped: 0, durationMs: 12_000 })
	expect(body.split('\n')[0]).toBe(COMMENT_MARKER)
})

test('formatComment: passed status uses check emoji and "All tests passed"', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 3, failed: 0, skipped: 0, durationMs: 12_000 })
	expect(body).toContain('✅')
	expect(body).toContain('All tests passed')
	expect(body).toContain('3 passed')
	expect(body).toContain('0 failed')
})

test('formatComment: failed status uses cross emoji and "Tests failed"', () => {
	const body = formatComment({ ...baseOpts, status: 'failed', passed: 2, failed: 1, skipped: 0, durationMs: 18_400 })
	expect(body).toContain('❌')
	expect(body).toContain('Tests failed')
	expect(body).toContain('2 passed')
	expect(body).toContain('1 failed')
})

test('formatComment: includes the clickable dashboard URL as markdown link', () => {
	const url = 'https://npub1xyz.nsite.orangesync.tech/'
	const body = formatComment({ ...baseOpts, nsiteUrl: url, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 5_000 })
	// Must be a clickable markdown link containing the URL
	expect(body).toContain(`](${url})`)
})

test('formatComment: mentions screenshots and videos are viewable in the dashboard', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 5_000 })
	expect(body.toLowerCase()).toContain('video')
	expect(body.toLowerCase()).toContain('screenshot')
})

test('formatComment: includes skipped count when > 0', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 2, failed: 0, skipped: 1, durationMs: 5_000 })
	expect(body).toContain('1 skipped')
})

test('formatComment: omits skipped segment when 0 (keeps summary concise)', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 2, failed: 0, skipped: 0, durationMs: 5_000 })
	expect(body).not.toContain('skipped')
})

test('formatComment: includes formatted duration', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 90_000 })
	expect(body).toContain('1m 30s')
})

test('formatComment: includes branch and short commit SHA', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 5_000 })
	expect(body).toContain('feat/pr-trust-pipeline')
	expect(body).toContain('abcdef12') // first 8 chars
})

test('formatComment: includes workflow run link when runUrl is provided', () => {
	const runUrl = 'https://github.com/felixfelix-bot/market/actions/runs/123'
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 5_000, runUrl })
	expect(body).toContain(`[workflow run](${runUrl})`)
})

test('formatComment: omits workflow run link when runUrl absent', () => {
	const body = formatComment({ ...baseOpts, status: 'passed', passed: 1, failed: 0, skipped: 0, durationMs: 5_000 })
	expect(body).not.toContain('workflow run')
})

// ── parseResults ────────────────────────────────────────────────────────────

test('parseResults: returns null for a missing file', () => {
	expect(parseResults('/nonexistent/path/results.json')).toBeNull()
})

test('parseResults: walks Playwright JSON suite tree and counts statuses + duration', () => {
	const fixture = {
		config: {},
		suites: [
			{
				title: 'pricing.spec.ts',
				specs: [
					{
						title: 'Product Page - View Only',
						tests: [
							{
								results: [
									{ status: 'passed', duration: 10_000, attachments: [] },
									{ status: 'passed', duration: 5_000, attachments: [] },
								],
							},
						],
					},
					{
						title: 'Another spec',
						tests: [
							{
								results: [{ status: 'failed', duration: 8_000, attachments: [] }],
							},
							{
								results: [{ status: 'skipped', duration: 0, attachments: [] }],
							},
						],
					},
				],
				suites: [],
			},
		],
	}
	const tmp = `/tmp/test-results-${Date.now()}.json`
	require('node:fs').writeFileSync(tmp, JSON.stringify(fixture))
	const parsed = parseResults(tmp)
	expect(parsed).not.toBeNull()
	expect(parsed!.passed).toBe(2)
	expect(parsed!.failed).toBe(1)
	expect(parsed!.skipped).toBe(1)
	expect(parsed!.durationMs).toBe(23_000)
})
