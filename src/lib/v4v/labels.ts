import { BPS_UNIT, PERCENT_UNIT, type AllocationUnit } from '@/lib/v4v/allocations'
import type { V4VRecipientRequirement } from '@/lib/v4v/share'

/**
 * Externalized "how" for the agnostic V4V UI.
 *
 * `V4VManager` renders no copy and decides no feature on its own — the call
 * site (the sales route / dialog, the auction editor) supplies a `V4VLabels` for
 * every string and a `V4VConfig` for every feature flag **and for the unit its
 * numbers are in**. Consumers supply a different pair to the same component;
 * nothing in the component assumes percentages, zaps, or persistence.
 *
 * Kept intentionally minimal and free of React/Nostr so it can be reused and
 * unit-tested independently of the component.
 */

/** All user-facing strings the V4V editor can render. */
export interface V4VLabels {
	/** Optional banner shown above the editor (sales: the "generosity" note). Omit to hide. */
	alertText?: string
	/** Heading for the payer-vs-recipients total split section. */
	totalSplitHeading: string
	/** Heading for the between-recipients section. */
	recipientsHeading: string
	/** Text shown when there are no recipients yet. */
	emptyRecipientsText: string
	/** Placeholder for the profile search input. */
	searchPlaceholder: string
	/** Add-recipient button label. */
	addRecipientButtonText: string
	/** "Equalize all" button label. */
	equalizeAllButtonText: string
	/** Confirm button label inside the add form. */
	addFormConfirmText: string
	/** Cancel button label inside the add form. */
	addFormCancelText: string
	/**
	 * Label shown next to the new-recipient allocation slider. Receives the value
	 * already formatted by the call site's unit, so the label appends no unit itself.
	 */
	newRecipientShareLabel: (formatted: string) => string
	/** Payer-side label in the total split readout. Receives a unit-formatted value. */
	sellerLabel: (formatted: string) => string
	/** Recipients-side label in the total split readout. Receives a unit-formatted value. */
	v4vLabel: (formatted: string) => string
	/** Save button label. */
	saveButtonText: string
	/** Save button label when a change indicator is on and nothing changed. */
	savedText: string
	/** Save button label while persisting. */
	savingText: string
	/** Cancel button label (when a cancel button is shown). */
	cancelButtonText: string
	/** Badge on a fixed participant's row. */
	lockedLabel: string
	/** Heading of the collapsed per-recipient adjuster. */
	adjustHint: string
}

/**
 * Feature flags and the unit, switched by the call site.
 *
 * `allocation` is where the input-agnosticism lives: the component never divides
 * by 100 or appends a `%` itself. Sales declares percentages; the auction editor
 * declares basis points, so a validator's announced 0.5% (50 bps) survives
 * instead of rounding to 1%.
 */
export interface V4VConfig {
	/** The unit every number in this editor is expressed in. */
	allocation: AllocationUnit
	/** Show the emoji wiggle/shake/glow widget (sales-only). */
	showEmoji: boolean
	/** Show the "total" slider that splits the payer vs the recipients. */
	showTotalSlider: boolean
	/** Show the payer-vs-recipients split bar. */
	showSellerBar: boolean
	/** What a new recipient must satisfy before it may be added. */
	recipientRequirement: V4VRecipientRequirement
	/** Show the save button. */
	showSaveButton: boolean
	/** Show a cancel button next to save. */
	showCancelButton: boolean
	/** Enable the "changed/saved" indicator on the save button. */
	showChangesIndicator: boolean
	/** testid for the save button. */
	saveButtonTestId: string
}

/** The sales / "all products" labels — what the dashboard route injects. */
export const salesV4VLabels: V4VLabels = {
	alertText:
		'PM (Beta) Is Powered By Your Generosity. Your Contribution Is The Only Thing That Enables Us To Continue Creating Free And Open Source Solutions 🙏',
	totalSplitHeading: 'Split of total sales',
	recipientsHeading: 'V4V split between recipients',
	emptyRecipientsText: 'No V4V recipients added yet',
	searchPlaceholder: 'Search profiles or paste npub...',
	addRecipientButtonText: 'Add Recipient',
	equalizeAllButtonText: 'Equal All',
	addFormConfirmText: 'Add',
	addFormCancelText: 'Cancel',
	newRecipientShareLabel: (formatted) => `Share percentage: ${formatted}`,
	sellerLabel: (formatted) => `Seller: ${formatted}`,
	v4vLabel: (formatted) => `V4V: ${formatted}`,
	saveButtonText: 'Save Changes',
	savedText: 'Saved',
	savingText: 'Saving...',
	cancelButtonText: 'Cancel',
	lockedLabel: 'Fixed',
	adjustHint: 'Adjust percentage',
}

/** The sales / "all products" feature config — what the dashboard route injects. */
export const salesV4VConfig: V4VConfig = {
	allocation: PERCENT_UNIT,
	showEmoji: true,
	showTotalSlider: true,
	showSellerBar: true,
	// Sales pay recipients by zap, so a recipient that cannot receive zaps cannot be
	// paid. The auction editor declares a different requirement (a mint payout
	// capability) without this component knowing either one.
	recipientRequirement: {
		required: true,
		checking: false,
		satisfied: undefined,
		checkingMessage: 'Checking zap capability...',
		unsatisfiedMessage: 'This user cannot receive zaps',
	},
	showSaveButton: true,
	showCancelButton: false,
	showChangesIndicator: false,
	saveButtonTestId: 'save-v4v-button',
}

/**
 * An auction settlement's labels — the same editor described in settlement terms:
 * no sales banner, no emoji, and validator rows called what they are.
 */
export const auctionV4VLabels: V4VLabels = {
	totalSplitHeading: 'Split of the settlement',
	recipientsHeading: 'V4V recipients',
	emptyRecipientsText: 'Nobody besides the seller is paid yet.',
	searchPlaceholder: 'Search profiles or paste npub...',
	addRecipientButtonText: 'Add recipient',
	equalizeAllButtonText: 'Equal up',
	addFormConfirmText: 'Add',
	addFormCancelText: 'Cancel',
	newRecipientShareLabel: (formatted) => `Share: ${formatted}`,
	sellerLabel: (formatted) => `Seller keeps ${formatted}`,
	v4vLabel: (formatted) => `V4V ${formatted}`,
	saveButtonText: 'Save payout',
	savedText: 'Saved',
	savingText: 'Saving...',
	cancelButtonText: 'Cancel',
	lockedLabel: 'Validator',
	adjustHint: 'Adjust share',
}

/** The auction settlement's config: basis points, no zap requirement, fixed validators. */
export const auctionV4VConfig: V4VConfig = {
	allocation: BPS_UNIT,
	showEmoji: false,
	showTotalSlider: true,
	showSellerBar: true,
	// An auction pays through mint payout paths, not zaps, so the sales zap
	// requirement does not apply. A payout capability is a property of the
	// validators' own announcements (kind 1027/1028), assessed by the V4V step
	// before this editor is reachable — not per keystroke here.
	recipientRequirement: {
		required: false,
		checking: false,
		satisfied: undefined,
		checkingMessage: 'Checking the payout capability...',
		unsatisfiedMessage: 'This recipient has no announced payout capability',
	},
	showSaveButton: true,
	showCancelButton: true,
	showChangesIndicator: true,
	saveButtonTestId: 'save-auction-v4v-button',
}
