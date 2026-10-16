import type { BidGroupStatus } from '@sdk/commerce/auctions/bidGroupStatus'

export interface BidStatusDisplayInput {
	status: BidGroupStatus
	reclaimableCount: number
	waitingForReclaim: boolean
	hasTrackedTokens: boolean
	latestLocktime: number
	/** Host-formatted countdown, e.g. "Reclaim opens in 4m 10s"; used while reclaim has not opened. */
	reclaimCountdownLabel: string
}

export interface BidStatusCopy {
	label: string
	helper: string
	toneClass: string
}

const NO_LOCAL_TOKEN = 'This device has no tracked reclaim token for the bid chain.'

const formatMaybeDate = (timestamp: number): string => (timestamp ? new Date(timestamp * 1000).toLocaleString() : 'N/A')

export function getBidStatusCopy(input: BidStatusDisplayInput): BidStatusCopy {
	const waitingOr = (otherwise: string) => (input.waitingForReclaim ? input.reclaimCountdownLabel : otherwise)

	switch (input.status) {
		case 'winning':
			return {
				label: 'Winning bid',
				helper: 'This bid won the auction. Submit your shipping address from the auction page.',
				toneClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			}
		case 'refund_received':
			return {
				label: 'Refund received',
				helper: 'The seller settlement refund has already been claimed into your wallet.',
				toneClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			}
		case 'reclaimed':
			return {
				label: 'Reclaimed',
				helper: 'You reclaimed this locked bid chain back into your wallet after locktime.',
				toneClass: 'border-sky-200 bg-sky-50 text-sky-700',
			}
		case 'reclaim_available': {
			const count = input.reclaimableCount
			return {
				label: 'Reclaim available',
				helper: `${count} locked bid ${count === 1 ? 'part is' : 'parts are'} past locktime and can be reclaimed now.`,
				toneClass: 'border-amber-200 bg-amber-50 text-amber-700',
			}
		}
		case 'outbid':
			return {
				label: 'Outbid',
				helper: waitingOr(input.hasTrackedTokens ? 'Your bid stays timelocked until reclaim opens after locktime.' : NO_LOCAL_TOKEN),
				toneClass: 'border-zinc-200 bg-zinc-50 text-zinc-700',
			}
		case 'reserve_not_met':
			return {
				label: 'Reserve not met',
				helper: waitingOr(input.hasTrackedTokens ? 'Reclaim opens automatically after the bid locktime.' : NO_LOCAL_TOKEN),
				toneClass: 'border-violet-200 bg-violet-50 text-violet-700',
			}
		case 'cancelled':
			return {
				label: 'Auction cancelled',
				helper: waitingOr(input.hasTrackedTokens ? 'Reclaim opens automatically after the bid locktime.' : NO_LOCAL_TOKEN),
				toneClass: 'border-rose-200 bg-rose-50 text-rose-700',
			}
		case 'locked':
			return {
				label: 'Locked',
				helper: waitingOr(`No settlement refund yet. Manual reclaim opens after ${formatMaybeDate(input.latestLocktime)}.`),
				toneClass: 'border-blue-200 bg-blue-50 text-blue-700',
			}
		case 'recorded':
			return {
				label: 'Bid recorded',
				helper: input.hasTrackedTokens
					? 'Waiting for settlement or for locktime reclaim to open.'
					: 'This device is missing the local reclaim token for this bid.',
				toneClass: 'border-zinc-200 bg-zinc-50 text-zinc-700',
			}
	}
}

export function BidStatusPill({ copy }: { copy: BidStatusCopy }) {
	return (
		<span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${copy.toneClass}`}>{copy.label}</span>
	)
}

export function BidStatusBanner({ copy }: { copy: BidStatusCopy }) {
	return (
		<div className={`rounded-lg border px-3 py-2 text-sm ${copy.toneClass}`}>
			<p className="font-semibold">{copy.label}</p>
			<p className="mt-1 text-xs">{copy.helper}</p>
		</div>
	)
}
