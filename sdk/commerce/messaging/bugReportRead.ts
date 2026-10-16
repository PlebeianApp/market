export const BUG_REPORT_KIND = 1
export const BUG_REPORT_TAG = 'plebian2beta'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type BugReportsFilter = {
	kinds: number[]
	'#t': string[]
	limit: number
	until?: number
}

export interface BugReportEvent {
	id: string
	pubkey: string
	content: string
	created_at?: number
}

export interface BugReport<E = BugReportEvent> {
	id: string
	pubkey: string
	content: string
	createdAt: number
	event: E
}

/** A falsy `until` (including 0) is omitted. */
export function buildBugReportsFilter(limit: number, until?: number): BugReportsFilter {
	return {
		kinds: [BUG_REPORT_KIND],
		'#t': [BUG_REPORT_TAG],
		limit,
		...(until && { until }),
	}
}

/** Events without `created_at` are stamped with the current time. */
export function parseBugReport<E extends BugReportEvent>(event: E): BugReport<E> {
	return {
		id: event.id,
		pubkey: event.pubkey,
		content: event.content,
		createdAt: event.created_at ?? Math.floor(Date.now() / 1000),
		event,
	}
}

export function parseBugReports<E extends BugReportEvent>(events: Iterable<E>): BugReport<E>[] {
	return Array.from(events, (event) => parseBugReport(event)).sort((a, b) => b.createdAt - a.createdAt)
}
