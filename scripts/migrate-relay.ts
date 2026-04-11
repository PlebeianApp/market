import { SimplePool, type Event, type Filter } from 'nostr-tools'

const sourceRelays = splitCsv(process.env.SOURCE_RELAYS)
const targetRelays = splitCsv(process.env.TARGET_RELAYS)
const filter = buildFilter()
const maxWait = Number(process.env.MAX_WAIT_MS || 15000)
const dryRun = process.env.DRY_RUN === 'true'

if (sourceRelays.length === 0 || targetRelays.length === 0) {
	console.error('SOURCE_RELAYS and TARGET_RELAYS are required')
	process.exit(1)
}

const pool = new SimplePool()
const seen = new Set<string>()
const events: Event[] = []

console.log('Migrating relay data')
console.log(`Sources: ${sourceRelays.join(', ')}`)
console.log(`Targets: ${targetRelays.join(', ')}`)
console.log(`Filter: ${JSON.stringify(filter)}`)
console.log(`Dry run: ${dryRun}`)

await new Promise<void>((resolve, reject) => {
	pool.subscribeManyEose(sourceRelays, filter, {
		maxWait,
		onevent(event) {
			if (seen.has(event.id)) return
			seen.add(event.id)
			events.push(event)
		},
		onclose(reasons) {
			console.log(`Source subscription closed: ${reasons.join(' | ')}`)
			resolve()
		},
	})
})

console.log(`Collected ${events.length} unique events`)
if (dryRun || events.length === 0) {
	process.exit(0)
}

let migrated = 0
let failed = 0

for (const event of events.sort((a, b) => a.created_at - b.created_at)) {
	try {
		await Promise.all(pool.publish(targetRelays, event))
		migrated += 1
		if (migrated % 100 === 0) {
			console.log(`Published ${migrated}/${events.length}`)
		}
	} catch (error) {
		failed += 1
		console.error(`Failed to publish ${event.id}:`, error)
	}
}

console.log(`Relay migration complete: ${migrated} published, ${failed} failed`)
if (failed > 0) {
	process.exit(1)
}

function buildFilter(): Filter {
	const filter: Filter = {}
	const authors = splitCsv(process.env.AUTHORS)
	const kinds = splitCsv(process.env.KINDS).map(Number).filter(Number.isFinite)
	const tags = splitCsv(process.env.TAG_T)
	const since = toNumber(process.env.SINCE)
	const until = toNumber(process.env.UNTIL)
	const limit = toNumber(process.env.LIMIT)

	if (authors.length > 0) filter.authors = authors
	if (kinds.length > 0) filter.kinds = kinds
	if (tags.length > 0) filter['#t'] = tags
	if (typeof since === 'number') filter.since = since
	if (typeof until === 'number') filter.until = until
	if (typeof limit === 'number') filter.limit = limit

	return filter
}

function splitCsv(value: string | undefined): string[] {
	return (value || '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
}

function toNumber(value: string | undefined): number | undefined {
	if (!value) return undefined
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}
