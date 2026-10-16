import { describe, expect, test } from 'bun:test'
import { buildBugReportsFilter, parseBugReport, parseBugReports } from './bugReportRead'

describe('bugReportRead', () => {
	test('builds the tagged kind 1 filter and omits a falsy until', () => {
		expect(buildBugReportsFilter(20)).toEqual({ kinds: [1], '#t': ['plebian2beta'], limit: 20 })
		expect(buildBugReportsFilter(5, 0)).toEqual({ kinds: [1], '#t': ['plebian2beta'], limit: 5 })
		expect(buildBugReportsFilter(5, 100)).toEqual({ kinds: [1], '#t': ['plebian2beta'], limit: 5, until: 100 })
	})

	test('keeps the raw event and stamps a missing created_at with now', () => {
		const event = { id: 'a', pubkey: 'pk', content: 'bug' }
		const before = Math.floor(Date.now() / 1000)
		const report = parseBugReport(event)
		expect(report.event).toBe(event)
		expect(report.createdAt).toBeGreaterThanOrEqual(before)
	})

	test('sorts newest first', () => {
		const reports = parseBugReports([
			{ id: 'old', pubkey: 'pk', content: '', created_at: 1 },
			{ id: 'new', pubkey: 'pk', content: '', created_at: 3 },
			{ id: 'mid', pubkey: 'pk', content: '', created_at: 2 },
		])
		expect(reports.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
	})
})
