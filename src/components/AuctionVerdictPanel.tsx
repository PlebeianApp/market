/**
 * Minimal display of kind-30440 validator verdicts for an auction.
 *
 * One row per `(validator, bidder)` tuple (kind-30440 is parameterised
 * replaceable on `<bidder_pk>:<auction_root_event_id>`, so the relay
 * returns at most one per such tuple). The panel is intentionally bare:
 * the validator's claim, the bidder it targets, the latest NUT-7 state
 * if known, and a timestamp. This is what compliant clients consume to
 * filter "fraudulent_bid" / "griefed" outcomes and to surface bid
 * verifiability — Phase 7 builds the reputation UX on top.
 */

import { useMemo } from 'react'
import { useAuctionVerdicts } from '@/queries/auctions'
import { parseValidatorVerdictEvent } from '@/lib/schemas/auction/validatorEvents'
import type { ParsedValidatorVerdictEvent } from '@/lib/auction/events'
import { AvatarUser } from '@/components/AvatarUser'

interface Props {
	auctionRootEventId: string
	auctionCoordinate: string
}

const claimToneClass = (claim: string): string => {
	if (claim.startsWith('settled')) return 'border-emerald-300 bg-emerald-50 text-emerald-900'
	if (claim === 'valid_bid_placed' || claim === 'won_pending_settlement') return 'border-sky-300 bg-sky-50 text-sky-900'
	if (claim === 'lost_pending_refund') return 'border-zinc-300 bg-zinc-50 text-zinc-800'
	if (claim === 'griefed' || claim === 'griefed_pending_fallback' || claim === 'fraudulent_bid' || claim === 'bid_invalid')
		return 'border-rose-300 bg-rose-50 text-rose-900'
	return 'border-zinc-200 bg-white text-zinc-800'
}

const formatTs = (ts: number): string => {
	if (!ts) return ''
	try {
		return new Date(ts * 1000).toLocaleString()
	} catch {
		return ''
	}
}

export const AuctionVerdictPanel = ({ auctionRootEventId, auctionCoordinate }: Props) => {
	const verdictsQuery = useAuctionVerdicts(auctionRootEventId, 500, auctionCoordinate)
	const rawVerdicts = verdictsQuery.data ?? []

	const verdicts = useMemo<ParsedValidatorVerdictEvent[]>(() => {
		const out: ParsedValidatorVerdictEvent[] = []
		for (const event of rawVerdicts) {
			const parsed = parseValidatorVerdictEvent(event)
			if (parsed.ok) out.push(parsed.value)
		}
		// Newest first, by validator's own observed_at (the authoritative
		// validator timestamp) falling back to the event created_at.
		return out.sort((a, b) => (b.observedAt || b.createdAt) - (a.observedAt || a.createdAt))
	}, [rawVerdicts])

	if (verdictsQuery.isLoading && !verdicts.length) {
		return <div className="text-xs text-zinc-500">Loading validator verdicts…</div>
	}
	if (!verdicts.length) {
		return (
			<div className="rounded-lg border border-dashed border-zinc-300 bg-white/50 p-3 text-xs text-zinc-500">
				No validator verdicts yet on this auction. The listed validators publish kind-30440 once they observe bid + mint state.
			</div>
		)
	}

	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between">
				<p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Validator verdicts</p>
				<p className="text-[10px] text-zinc-400">{verdicts.length} total</p>
			</div>
			<ul className="space-y-1.5">
				{verdicts.map((v) => (
					<li key={v.id} className={`rounded-lg border px-3 py-2 text-xs ${claimToneClass(v.claim)}`}>
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-semibold uppercase tracking-wide">{v.claim}</span>
							{v.reason && <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] text-zinc-700">reason: {v.reason}</span>}
							{v.nut7State && <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] text-zinc-700">nut7: {v.nut7State}</span>}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] opacity-80">
							<span className="inline-flex items-center gap-1">
								<span>validator</span>
								<AvatarUser pubkey={v.validatorPubkey} colored deterministicFallbackText />
							</span>
							<span className="inline-flex items-center gap-1">
								<span>bidder</span>
								<AvatarUser pubkey={v.bidderPubkey} colored deterministicFallbackText />
							</span>
							<span>observed {formatTs(v.observedAt)}</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	)
}
