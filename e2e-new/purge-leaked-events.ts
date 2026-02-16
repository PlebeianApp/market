/**
 * Purges all events published by fixture dev users from public relays.
 *
 * This sends NIP-09 deletion requests (Kind 5) for every event found
 * on each relay for each user. Relays may or may not honor the request,
 * but compliant relays will delete the events.
 *
 * Usage:
 *   bun e2e-new/purge-leaked-events.ts
 *   bun e2e-new/purge-leaked-events.ts --dry-run   # list events without deleting
 */
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'

const FIXTURE_USERS = [
	{
		name: 'devUser1',
		pk: '86a82cab18b293f53cbaaae8cdcbee3f7ec427fdf9f9c933db77800bb5ef38a0',
		sk: '5c81bffa8303bbd7726d6a5a1170f3ee46de2addabefd6a735845166af01f5c0',
	},
	{
		name: 'devUser2',
		pk: 'd943e96d62695b318a9c0658a3bd3fafaaf441a069d8bfd04dc9ff39c69cc782',
		sk: '08a475839723c79f2993ad000289670eb737d34bc9d72d43128f898713fc3fb3',
	},
	{
		name: 'devUser3',
		pk: '2edec1b799cd2f41f70a5ff0edc10d2260a57d62f39072aab4eb8174b7ca912a',
		sk: 'e61ae5a4f505026e3d2b5aeba82c748b6b799346a1e98e266d7252cddb8f502b',
	},
	{
		name: 'devUser4',
		pk: 'f47121cd783802e6d4879e63233b54aff54e6788ea9ef568cec0259cc60fe286',
		sk: 'beb8f6777d4379ac60b01d91fa84456bb23a2ef6b083f557b9ede311ae1ede53',
	},
	{
		name: 'devUser5',
		pk: '96c727f4d1ea18a80d03621520ebfe3c9be1387033009a4f5b65959d09222eec',
		sk: 'ee40a2dc441238f241d1728af9507147e9b5ed18c1c61d84876d4f2502c044b3',
	},
]

const PUBLIC_RELAYS = [
	'wss://relay.plebeian.market',
	'wss://relay.staging.plebeian.market',
	'wss://sendit.nosflare.com',
	'wss://nostr.mom',
	'wss://nos.lol',
	'wss://relay.nostr.net',
	'wss://relay.damus.io',
	'wss://relay.minibits.cash',
	'wss://bugs.plebeian.market',
	'wss://relay.coinos.io',
	'wss://relay.primal.net',
]

const dryRun = process.argv.includes('--dry-run')

async function queryEvents(relay: Relay, pubkey: string): Promise<{ id: string; kind: number; created_at: number }[]> {
	return new Promise((resolve) => {
		const events: { id: string; kind: number; created_at: number }[] = []
		const sub = relay.subscribe(
			[
				{
					authors: [pubkey],
				},
			],
			{
				onevent(event) {
					events.push({ id: event.id, kind: event.kind, created_at: event.created_at })
				},
				oneose() {
					sub.close()
					resolve(events)
				},
			},
		)

		// Timeout after 10 seconds
		setTimeout(() => {
			sub.close()
			resolve(events)
		}, 10_000)
	})
}

async function main() {
	if (dryRun) {
		console.log('\n=== DRY RUN — no events will be deleted ===\n')
	} else {
		console.log('\n=== PURGING leaked fixture events from public relays ===\n')
	}

	let totalFound = 0
	let totalDeleted = 0

	for (const user of FIXTURE_USERS) {
		console.log(`\n--- ${user.name} (${user.pk.slice(0, 16)}...) ---`)
		const skBytes = hexToBytes(user.sk)

		for (const relayUrl of PUBLIC_RELAYS) {
			let relay: Relay
			try {
				relay = await Relay.connect(relayUrl)
			} catch (err) {
				console.log(`  [SKIP] ${relayUrl} — connection failed`)
				continue
			}

			try {
				const events = await queryEvents(relay, user.pk)
				if (events.length === 0) {
					console.log(`  ${relayUrl} — no events`)
					relay.close()
					continue
				}

				totalFound += events.length
				console.log(`  ${relayUrl} — found ${events.length} event(s):`)
				for (const e of events) {
					const date = new Date(e.created_at * 1000).toISOString().slice(0, 19)
					console.log(`    Kind ${e.kind} | ${date} | ${e.id.slice(0, 16)}...`)
				}

				if (!dryRun) {
					// Send a single Kind 5 deletion event referencing all found event IDs
					const deletionTemplate: EventTemplate = {
						kind: 5,
						created_at: Math.floor(Date.now() / 1000),
						content: 'Purging leaked test/dev events',
						tags: events.map((e) => ['e', e.id]),
					}
					const deletionEvent = finalizeEvent(deletionTemplate, skBytes)
					try {
						await relay.publish(deletionEvent)
						totalDeleted += events.length
						console.log(`    -> Deletion request sent (${events.length} events)`)
					} catch (err) {
						console.log(`    -> Deletion publish failed: ${err}`)
					}
				}
			} catch (err) {
				console.log(`  [ERROR] ${relayUrl} — ${err}`)
			}

			relay.close()
		}
	}

	console.log('\n=== Summary ===')
	console.log(`  Events found:   ${totalFound}`)
	if (!dryRun) {
		console.log(`  Deletion sent:  ${totalDeleted}`)
	}
	console.log('')
}

main().catch((err) => {
	console.error('Purge failed:', err)
	process.exit(1)
})
