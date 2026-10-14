/**
 * auctions/validationDeclaration.ts — **this module's declaration**, the value the composition collects
 * (`design.md` §4.1). It names the kinds `auctions` OWNS, the demand each carries, what it routes to
 * another owner, and what it admits.
 *
 * **V3 is where the first real rule lands**: kind 30408 — the one kind the legacy doctrine ever gated, and
 * the kind the app is currently live-rendering **ungated** (`FINAL-composed.md` F3). The rule is the
 * *expressible* part of the cited inventory (`runs/2026-10-15-validation-contribution/inventory.md` §5)
 * in the engine's own closed rule language (`design.md` §4.2) — required tags and closed domains. What the
 * landed data-only engine **cannot** express is named below as `NOT_YET_GATED_30408`, never transcribed
 * (`design.md` §4.2b, §7.1): the honest retrofit posture is "declared and still unexecuted", not a second
 * definition of valid.
 *
 * The `source` citations are the repository's own texts (`AUCTIONS.md`), never a NIP; the `parser`
 * citation is the app's single definition of valid for the kind, **cited not imported**
 * (`src/lib/schemas/**` is outside `sdk/`, and `sdk/boundary.test.ts` forbids an import that escapes
 * `sdk/`).
 */
import type { CommerceValidationDeclaration, KindOwnership } from '../../core/composition/ts/index'
import type { ValidationCheck } from '../../core/validation/ts/index'
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

/**
 * The locked literals of `AUCTIONS.md` §4.1 (lines 148-169), transcribed **as the spec's own values** —
 * not re-derived from `parseAuctionEvent`, which is what a `FormatDomain` replacing a parser must not do.
 */
const AUCTION_TYPE_ENGLISH = 'english'
const AUCTION_CURRENCY_SAT = 'SAT'
const AUCTION_SETTLEMENT_POLICY = 'cashu_p2pk_bidder_path_v1'
const AUCTION_KEY_SCHEME = 'hd_p2pk'

/**
 * **The expressible demand for kind 30408** — inventory §5.2 (presence of `start_at` and `end_at`, the
 * gating requirement the motivating defect turned into a `?? 0` fallback), §5.3 (`starting_bid`),
 * §5.4/§5.6 (`d`, `title` non-empty — presence is the expressible half), §5.14/§5.15/§5.16 (at least one
 * `mint`, a `p2pk_xpub`, at least one `auditors`), and §5.7/§5.10/§5.12/§5.13 (the four locked literals as
 * closed domains).
 */
const AUCTION_LISTING_CHECKS: readonly ValidationCheck[] = [
	{
		kind: 'format',
		id: 'auction-required-tags',
		requires: [
			{ tag: 'd', atLeast: 1 },
			{ tag: 'title', atLeast: 1 },
			{ tag: 'start_at', atLeast: 1 },
			{ tag: 'end_at', atLeast: 1 },
			{ tag: 'starting_bid', atLeast: 1 },
			{ tag: 'p2pk_xpub', atLeast: 1 },
			{ tag: 'mint', atLeast: 1 },
			{ tag: 'auditors', atLeast: 1 },
		],
	},
	{
		kind: 'format',
		id: 'auction-locked-fields',
		domains: [
			{ tag: 'auction_type', values: [AUCTION_TYPE_ENGLISH] },
			{ tag: 'currency', values: [AUCTION_CURRENCY_SAT] },
			{ tag: 'settlement_policy', values: [AUCTION_SETTLEMENT_POLICY] },
			{ tag: 'key_scheme', values: [AUCTION_KEY_SCHEME] },
		],
	},
]

/**
 * **The cited 30408 rules the landed data-only engine cannot express — named, not transcribed**
 * (`design.md` §4.2b/§7.1). Each entry is `(rule, source)`, read off `inventory.md` §5, and each is a
 * genuine gap: closing it needs the §7.1 amendment (the owner's parser as the check) or §7.2 (the
 * multi-reference path), a later increment's or the maintainer's decision. A value a test reads, so the
 * gap is a fact rather than a silence.
 */
export const NOT_YET_GATED_30408: readonly { readonly rule: string; readonly source: string }[] = [
	{
		rule: 'a timing value must be a positive integer — `0` (the epoch) is refused (5.8)',
		source: 'inventory.md §5.8 / src/lib/schemas/auction/auctionEvent.ts:86-88',
	},
	{
		rule: '`end_at` must be ≥ `start_at` (5.18)',
		source: 'inventory.md §5.18 / src/lib/schemas/auction/auctionEvent.ts:108',
	},
	{
		rule: '`max_end_at` must be ≥ `end_at` (5.19)',
		source: 'inventory.md §5.19 / src/lib/schemas/auction/auctionEvent.ts:109',
	},
	{
		rule: '`auditor_quorum` may not exceed the number of `auditors` tags (5.17)',
		source: 'inventory.md §5.17 / src/lib/schemas/auction/auctionEvent.ts:110-113',
	},
	{
		rule: 'seller pubkey, root event id must be 64-hex; coordinate must be `kind:pubkey:d` (5.5)',
		source: 'inventory.md §5.5 / src/lib/schemas/auction/auctionEvent.ts:79-81',
	},
	{
		rule: '`settlement_grace`, `max_skew_sec`, `auditor_quorum`, `bid_increment` must be positive ints (5.9)',
		source: 'inventory.md §5.9 / src/lib/schemas/auction/auctionEvent.ts:89,93,102,103',
	},
	{
		rule: 'a raw parser failure must be translated to one tag-scoped, user-facing reason per failing field (5.21)',
		source: 'inventory.md §5.21 / src/lib/schemas/auction/auctionAdmission.ts:104-117',
	},
	{
		rule: 'settlement completeness needs the auction, the winning bid and the path release — more than one event (multi-event)',
		source: 'inventory.md §5 / sdk/commerce/auctions/validation.ts (validateSettlementCompleteness)',
	},
]

/** Kind 30408 — the auction listing, the increment's one real demand. */
const AUCTION_LISTING: KindOwnership = {
	kind: AUCTION_KIND,
	source: 'AUCTIONS.md §4.1',
	parser: 'src/lib/schemas/auction/auctionEvent.ts#parseAuctionEvent',
	checks: AUCTION_LISTING_CHECKS,
}

export const validationDeclaration: CommerceValidationDeclaration = {
	owner: 'commerce.auctions',
	kinds: [
		AUCTION_LISTING,
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
