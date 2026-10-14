/**
 * auctions/validationDeclaration.ts — **this module's declaration**, the value the composition collects
 * (`design.md` §4.1). It names the kinds `auctions` OWNS, the demand each carries, what it routes to
 * another owner, and what it admits.
 *
 * `checks: []` on every kind is a **declared "owned and demands nothing"**, a fact rather than a silence
 * (`design.md` §4.6) — the rule inventory is a sibling increment's deliverable, and V3 is where the first
 * real rule (kind 30408) lands. The `source` citations are the repository's own texts (`AUCTIONS.md`),
 * never a NIP; the `parser` citations are the app's single definition of valid for each kind, **cited not
 * imported** (`src/lib/schemas/**` is outside `sdk/`, and `sdk/boundary.test.ts` forbids an import that
 * escapes `sdk/`).
 */
import type { CommerceValidationDeclaration } from '../../core/composition/ts/index'
import {
	AUCTION_BID_KIND,
	AUCTION_FALLBACK_OFFER_KIND,
	AUCTION_KIND,
	AUCTION_PATH_RELEASE_KIND,
	AUCTION_SETTLEMENT_KIND,
	BIDDER_AGGREGATE_REPUTATION_KIND,
	VALIDATOR_POLICY_KIND,
	VALIDATOR_VERDICT_KIND,
} from './constants'

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.auctions',
	kinds: [
		{
			kind: AUCTION_KIND,
			source: 'AUCTIONS.md §4.1',
			parser: 'src/lib/schemas/auction/auctionEvent.ts#parseAuctionEvent',
			checks: [],
		},
		{
			kind: AUCTION_BID_KIND,
			source: 'AUCTIONS.md §7.1',
			parser: 'src/lib/schemas/auction/bidEvent.ts#parseBidEvent',
			checks: [],
		},
		{
			kind: AUCTION_SETTLEMENT_KIND,
			source: 'AUCTIONS.md §6',
			parser: 'src/lib/schemas/auction/settlementEvents.ts#parseSettlementEvent',
			checks: [],
		},
		{
			kind: AUCTION_PATH_RELEASE_KIND,
			source: 'AUCTIONS.md §6',
			parser: 'src/lib/schemas/auction/settlementEvents.ts#parsePathReleaseEvent',
			checks: [],
		},
		{
			kind: AUCTION_FALLBACK_OFFER_KIND,
			source: 'AUCTIONS.md §6',
			checks: [],
		},
		{
			kind: VALIDATOR_VERDICT_KIND,
			source: 'AUCTIONS.md §7.1',
			parser: 'src/lib/schemas/auction/validatorEvents.ts#parseValidatorVerdictEvent',
			checks: [],
		},
		{
			kind: VALIDATOR_POLICY_KIND,
			source: 'AUCTIONS.md §7.1',
			parser: 'src/lib/schemas/auction/validatorEvents.ts#parseValidatorPolicyEvent',
			checks: [],
		},
		{
			kind: BIDDER_AGGREGATE_REPUTATION_KIND,
			source: 'AUCTIONS.md §7.1',
			parser: 'src/lib/schemas/auction/validatorEvents.ts#parseBidderAggregateEvent',
			checks: [],
		},
	],
	contributions: [],
	accepts: [],
}
