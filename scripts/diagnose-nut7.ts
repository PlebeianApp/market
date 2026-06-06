/**
 * NUT-7 diagnostic — for chasing down `nut7_unknown` validator verdicts.
 *
 * Given a bid event id, this script:
 *   1. Fetches the kind-1023 from the configured relay.
 *   2. Extracts every `proof_y` tag and the `mint` tag.
 *   3. Re-derives Y locally from each `lock_secret` (sanity check).
 *   4. Hits the mint's NUT-7 endpoint directly with our Ys.
 *   5. Prints a side-by-side: what's in the tag, what we recompute,
 *      and what the mint says about it.
 *
 * Usage:
 *
 *   bun run scripts/diagnose-nut7.ts <bid_event_id>
 *
 *   # or pass a raw secret to skip the relay fetch:
 *   bun run scripts/diagnose-nut7.ts --secret '["P2PK",{"nonce":"…","data":"…","tags":[…]}]' --mint https://nofees.testnut.cashu.space
 *
 * What the output tells you:
 *
 * - Tag Y vs. recomputed Y differ → bidder published a stale Y; bug in
 *   publishAuctionBid.
 * - Tag Y matches our recompute but mint says "unknown" → either the
 *   mint's NUT-7 index hasn't caught up (re-run in 30s), or the proof
 *   was minted via a path that doesn't write to the NUT-7 index (mint
 *   bug). Try checking a proof you just minted yourself.
 * - Tag Y matches our recompute and mint says "unspent" → the validator
 *   should be reporting valid_bid_placed; check the validator's poll
 *   loop / timing.
 */

import NDK, { NDKEvent } from '@nostr-dev-kit/ndk'
import { CashuMint } from '@cashu/cashu-ts'
import { hashToCurveHexFromString } from '@/lib/cashu/hashToCurve'

interface Args {
	bidEventId?: string
	secret?: string
	mint?: string
	relay?: string
}

const parseArgs = (argv: string[]): Args => {
	const args: Args = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--secret') args.secret = argv[++i]
		else if (a === '--mint') args.mint = argv[++i]
		else if (a === '--relay') args.relay = argv[++i]
		else if (!a.startsWith('--')) args.bidEventId = a
	}
	return args
}

const fetchBidEvent = async (eventId: string, relayUrl: string): Promise<NDKEvent | null> => {
	const ndk = new NDK({ explicitRelayUrls: [relayUrl] })
	await ndk.connect(3000)
	const event = await ndk.fetchEvent({ ids: [eventId] })
	return event
}

const tagValues = (event: NDKEvent, name: string): string[] =>
	event.tags
		.filter((t) => t[0] === name)
		.map((t) => t[1] ?? '')
		.filter(Boolean)

const main = async () => {
	const args = parseArgs(process.argv.slice(2))
	const relay = args.relay ?? process.env.APP_RELAY_URL ?? 'ws://localhost:10547'

	let lockSecrets: string[]
	let proofYsFromTags: string[]
	let mintUrl: string

	if (args.secret) {
		if (!args.mint) {
			console.error('--secret requires --mint <url>')
			process.exit(1)
		}
		lockSecrets = [args.secret]
		proofYsFromTags = []
		mintUrl = args.mint
	} else {
		if (!args.bidEventId) {
			console.error('Usage: bun run scripts/diagnose-nut7.ts <bid_event_id> [--relay <url>]')
			console.error('       bun run scripts/diagnose-nut7.ts --secret <secret> --mint <url>')
			process.exit(1)
		}
		console.log(`Fetching bid ${args.bidEventId.slice(0, 12)}… from ${relay}`)
		const event = await fetchBidEvent(args.bidEventId, relay)
		if (!event) {
			console.error(`Bid event ${args.bidEventId} not found on ${relay}`)
			process.exit(1)
		}
		console.log(`✓ Bid event found. kind=${event.kind} pubkey=${event.pubkey.slice(0, 12)}…`)
		lockSecrets = tagValues(event, 'lock_secret')
		proofYsFromTags = tagValues(event, 'proof_y')
		mintUrl = tagValues(event, 'mint')[0] ?? ''
		if (!mintUrl) {
			console.error('Bid event has no `mint` tag')
			process.exit(1)
		}
		if (lockSecrets.length === 0) {
			console.error('Bid event has no `lock_secret` tags')
			process.exit(1)
		}
		if (lockSecrets.length !== proofYsFromTags.length) {
			console.warn(`! lock_secret count (${lockSecrets.length}) != proof_y count (${proofYsFromTags.length})`)
		}
	}

	console.log(`\nMint: ${mintUrl}`)
	console.log(`Proofs: ${lockSecrets.length}\n`)

	// Recompute Y from each secret.
	const recomputed: Array<{ tagY: string | null; ourY: string; secret: string }> = lockSecrets.map((secret, i) => ({
		tagY: proofYsFromTags[i] ?? null,
		ourY: hashToCurveHexFromString(secret).toLowerCase(),
		secret,
	}))

	// Tag-vs-recompute sanity.
	const mismatched = recomputed.filter((r) => r.tagY && r.tagY.toLowerCase() !== r.ourY)
	if (mismatched.length > 0) {
		console.log(`! ${mismatched.length}/${recomputed.length} proof_y tag values disagree with our recompute. Listing:`)
		for (const m of mismatched) {
			console.log(`  tag:   ${m.tagY}`)
			console.log(`  ours:  ${m.ourY}`)
		}
	} else if (proofYsFromTags.length > 0) {
		console.log(`✓ All proof_y tags match our recompute (${recomputed.length}/${recomputed.length})`)
	}

	// Hit the mint.
	console.log(`\nQuerying mint NUT-7 with ${recomputed.length} Y(s)…`)
	const mint = new CashuMint(mintUrl)
	const ourYs = recomputed.map((r) => r.ourY)
	let response: Awaited<ReturnType<typeof mint.check>>
	try {
		response = await mint.check({ Ys: ourYs })
	} catch (err) {
		console.error('Mint NUT-7 request failed:', err instanceof Error ? err.message : err)
		process.exit(1)
	}

	console.log(`\nMint replied with ${response.states.length} state entry(ies):`)
	const stateByY = new Map<string, string>()
	for (const s of response.states) {
		stateByY.set(s.Y.toLowerCase(), s.state)
	}

	console.log(`\n${'Y (first 16)'.padEnd(22)} ${'state'.padEnd(12)} note`)
	console.log('-'.repeat(60))
	for (const r of recomputed) {
		const state = stateByY.get(r.ourY) ?? 'NOT IN RESPONSE'
		const note =
			state === 'NOT IN RESPONSE'
				? 'mint did not return this Y'
				: state === 'UNSPENT'
					? 'all good — validator should see valid_bid_placed soon'
					: state === 'SPENT'
						? 'pre-settlement spent — bidder controlled lock & drained (fraudulent_bid)'
						: state === 'PENDING'
							? 'mint is still processing the swap — bid_pending_review until next poll'
							: ''
		console.log(`${r.ourY.slice(0, 16).padEnd(22)} ${state.padEnd(12)} ${note}`)
	}

	const allUnspent = recomputed.every((r) => stateByY.get(r.ourY) === 'UNSPENT')
	const anyMissing = recomputed.some((r) => !stateByY.has(r.ourY))
	console.log('\n' + '='.repeat(60))
	if (allUnspent) {
		console.log('VERDICT: Mint says UNSPENT for every Y. The validator should be reporting')
		console.log("         valid_bid_placed on the next poll. If it isn't, the bug is in the")
		console.log('         validator polling loop (src/server/auction-validator/nut7Poller.ts)')
		console.log('         or the validator state-aggregation (aggregateProofStates).')
	} else if (anyMissing) {
		console.log('VERDICT: Mint omitted at least one Y from its response. NUT-7 spec says every')
		console.log('         queried Y should get an entry; this is either a mint bug or the')
		console.log("         mint genuinely doesn't know that Y (proof was never minted, or our")
		console.log('         secret string differs from what was sent to the mint at swap time).')
	} else {
		console.log('VERDICT: Mint returned non-UNSPENT for some Ys. See per-line notes above.')
	}
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
