/**
 * ADR-0009 — Test-listing curation via NIP-32 labels.
 *
 * Label events (kind 1985, NIP-32) mark a product or auction as a "test"
 * listing. Items carrying an active `test` label are excluded from feeds and
 * detail views. Un-labeling is a NIP-09 deletion event (kind 5) signed by the
 * same labeler, referencing the label event's id in an `e` tag.
 *
 * See docs/adr/ADR-0009-test-listing-labels-via-nip-32.md for the full design.
 */

// --- Event kinds ---

/** NIP-32 labeling event kind */
export const LABEL_EVENT_KIND = 1985

/** NIP-09 event deletion request kind (used to un-label) */
export const LABEL_DELETION_KIND = 5

// --- Label namespace & value ---

/** Reverse-domain namespace for Plebeian Market labels (NIP-32 `L` tag) */
export const LABEL_NAMESPACE = 'com.plebeian.market'

/** Label value marking an item as a test listing (NIP-32 `l` tag) */
export const LABEL_VALUE_TEST = 'test'

// --- Tag names ---

/** NIP-32 label namespace tag */
export const L_TAG = 'L'

/** NIP-32 label value tag */
export const l_TAG = 'l'

/** Coordinate target tag (kind:pubkey:identifier) — the item being labeled */
export const A_TAG = 'a'

/** NIP-09 event id reference tag (deletion target) */
export const E_TAG = 'e'

/** NIP-09 kind tag (declares the kind being deleted) */
export const K_TAG = 'k'

// --- Item kinds that can carry a test label ---

/** NIP-99 product listing kind */
export const TEST_LABEL_PRODUCT_KIND = 30402

/** Auction listing kind (see AUCTION_KIND in src/lib/auction/constants.ts) */
export const TEST_LABEL_AUCTION_KIND = 30408
