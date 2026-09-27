/**
 * ONE-OFF EVIDENCE SCRIPT (deleted after running).
 *
 * Question: how does the existing `ProductListingSchema` behave against REAL live kind-30402 events,
 * compared with the new `parseListing`?
 *
 * This matters because the schema is a dead export — it is defined and never imported anywhere in the
 * application. If it cannot parse real relay data, that is a plausible explanation for why it was
 * never wired in, and it is the strongest argument for the parser's design (per-tag validation with
 * unknown-tag tolerance).
 *
 * Run: bun run scripts/evidence-real-listings.ts
 */
import { SimplePool } from 'nostr-tools/pool'

import { ProductListingSchema } from '@/lib/schemas/productListing'
import { parseListing } from '@plebeian/product-event'

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']

const pool = new SimplePool()
const events = await Promise.race([
	pool.querySync(RELAYS, { kinds: [30402], limit: 40 }),
	new Promise<never>((_, reject) => setTimeout(() => reject(new Error('relay query timed out')), 20_000)),
])

console.log(`fetched ${events.length} live kind-30402 events from ${RELAYS.length} relays\n`)

let oldOk = 0
let newOk = 0
let newOkWithProblems = 0
const oldReasons = new Map<string, number>()
const newReasons = new Map<string, number>()
const unknownTagNames = new Map<string, number>()

for (const event of events) {
	const oldResult = ProductListingSchema.safeParse(event)
	if (oldResult.success) {
		oldOk++
	} else {
		const issue = oldResult.error.issues[0]
		const key = `${issue?.code ?? '?'} @ ${JSON.stringify(issue?.path ?? [])}`
		oldReasons.set(key, (oldReasons.get(key) ?? 0) + 1)
	}

	const newResult = parseListing(event)
	if (newResult.ok) {
		newOk++
		if (newResult.problems.length > 0) newOkWithProblems++
	} else {
		const key = `${newResult.problems[0]?.code ?? '?'} (tag: ${newResult.problems[0]?.tag ?? '-'})`
		newReasons.set(key, (newReasons.get(key) ?? 0) + 1)
	}

	// Which tag names does real data carry that the schema has no clause for?
	const known = new Set([
		'd',
		'title',
		'price',
		'type',
		'visibility',
		'stock',
		'summary',
		'spec',
		'image',
		'weight',
		'dim',
		'location',
		'g',
		't',
		'a',
		'shipping_option',
		'content-warning',
	])
	for (const tag of event.tags) {
		const name = tag[0]
		if (name && !known.has(name)) unknownTagNames.set(name, (unknownTagNames.get(name) ?? 0) + 1)
	}
}

console.log(`OLD schema (src/lib/schemas/productListing.ts):  ${oldOk}/${events.length} parsed`)
console.log(
	`NEW parser (@plebeian/product-event):           ${newOk}/${events.length} parsed (${newOkWithProblems} with tolerated problems)\n`,
)

if (oldReasons.size) {
	console.log('Why the old schema rejected them:')
	for (const [reason, count] of [...oldReasons.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(count).padStart(3)}x  ${reason}`)
	}
	console.log()
}

console.log('Tag names present in real listings that the schema has no clause for:')
for (const [name, count] of [...unknownTagNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
	console.log(`  ${String(count).padStart(3)}x  ${name}`)
}

if (newReasons.size) {
	console.log('\nWhy the NEW parser rejected the rest (these should be spec-required failures, not noise):')
	for (const [reason, count] of [...newReasons.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(count).padStart(3)}x  ${reason}`)
	}
}

process.exit(0)
