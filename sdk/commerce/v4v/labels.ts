/**
 * Externalized "how" for the agnostic V4V UI.
 *
 * `V4VManager` renders no copy and decides no feature on its own — the call
 * site (the sales route / dialog) supplies a `V4VLabels` for every string and a
 * `V4VConfig` for every feature flag. A future auction consumer would supply a
 * different `V4VLabels` + `V4VConfig` to the same component.
 *
 * Kept intentionally minimal and free of React/Nostr so it can be reused and
 * unit-tested independently of the component.
 */

/** All user-facing strings the V4V editor can render. */
export interface V4VLabels {
	/** Optional banner shown above the editor (sales: the "generosity" note). Omit to hide. */
	alertText?: string
	/** Heading for the seller-vs-V4V total split section. */
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
	/** Label shown next to the new-recipient share slider. */
	newRecipientShareLabel: (share: number) => string
	/** Seller-side label in the total split readout. */
	sellerLabel: (formatted: string) => string
	/** V4V-side label in the total split readout. */
	v4vLabel: (formatted: string) => string
	/** Save button label. */
	saveButtonText: string
	/** Save button label when a change indicator is on and nothing changed. */
	savedText: string
	/** Save button label while persisting. */
	savingText: string
	/** Cancel button label (when a cancel button is shown). */
	cancelButtonText: string
}

/** Feature flags that switch sales-only rendering on/off. */
export interface V4VConfig {
	/** Show the emoji wiggle/shake/glow widget (sales-only). */
	showEmoji: boolean
	/** Show the "total V4V %" slider that splits seller vs V4V (sales-only). */
	showTotalSlider: boolean
	/** Show the seller-vs-V4V split bar (sales-only). */
	showSellerBar: boolean
	/** Require recipients to be able to receive zaps (sales-only). */
	requireZapCapable: boolean
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
	newRecipientShareLabel: (share) => `Share percentage: ${share}%`,
	sellerLabel: (formatted) => `Seller: ${formatted}%`,
	v4vLabel: (formatted) => `V4V: ${formatted}%`,
	saveButtonText: 'Save Changes',
	savedText: 'Saved',
	savingText: 'Saving...',
	cancelButtonText: 'Cancel',
}

/** The sales / "all products" feature config — what the dashboard route injects. */
export const salesV4VConfig: V4VConfig = {
	showEmoji: true,
	showTotalSlider: true,
	showSellerBar: true,
	requireZapCapable: true,
	showSaveButton: true,
	showCancelButton: false,
	showChangesIndicator: false,
	saveButtonTestId: 'save-v4v-button',
}
