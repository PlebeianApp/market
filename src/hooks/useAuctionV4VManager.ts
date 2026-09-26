import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { nip19 } from 'nostr-tools'
import { BPS_UNIT, clampAllocation } from '@/lib/v4v/allocations'
import {
	PLEBIAN_MARKET_DEFAULT_BPS,
	addAuctionRow,
	allocateTotal,
	auctionRowId,
	auctionRowsFromLines,
	equalizeAuctionRows,
	removeAuctionRow,
	scheduleTotalBps,
	serializeAuctionRows,
	toV4VShares,
	unpayableRows,
	updateAuctionRowAllocation,
	withPlatformDefault,
	type AuctionRecipientOption,
	type AuctionScheduleRow,
	type AuctionValidatorInput,
} from '@/lib/v4v/auction-schedule'

export interface UseAuctionV4VManagerInput {
	/** Whether the editor is open; opening re-seeds the rows from the draft. */
	open: boolean
	/** The draft's current payout lines, one recipient per line. */
	recipientLines: string
	/** The validators the V4V step selected — fixed participants here. */
	validators: readonly AuctionValidatorInput[]
	/** Announced payout capabilities the seller can pay. */
	recipients: readonly AuctionRecipientOption[]
	/** The platform's own pubkey, seeded at the product flow's default share. */
	platformPubkey?: string | undefined
	/** Persist the edited schedule — the dialog writes the line text into the draft. */
	onSave: (lines: string) => void
}

/**
 * The **auction settlement** adapter for the agnostic split editor.
 *
 * It owns everything specific to this surface, and nothing else:
 *
 * - **Basis points, not percentages.** A validator's announced fee is exact in bps
 *   (0.5% is 50), which whole per cent cannot express. `BPS_UNIT` is declared once
 *   and the component formats through it.
 * - **Draft-local, not published.** Saving writes the schedule back into the auction
 *   draft; the schedule is committed inside the auction root when the auction is
 *   published. Nothing here touches the seller's account-level V4V settings, which is
 *   what the sales adapter persists to kind 30078 — the two surfaces share the editor,
 *   not the storage.
 * - **Validators are fixed.** They come from the V4V step, are injected as rows if the
 *   draft does not mention them, and are repriced only by their own announcement.
 * - **A payout capability is required to be paid.** A recipient that has not announced
 *   one cannot be saved into a valid schedule; the editor names it instead of writing
 *   a line the wire format would reject.
 */
export function useAuctionV4VManager({ open, recipientLines, validators, recipients, platformPubkey, onSave }: UseAuctionV4VManagerInput) {
	const [rows, setRows] = useState<AuctionScheduleRow[]>([])
	const [showAddForm, setShowAddForm] = useState(false)
	const [newRecipientNpub, setNewRecipientNpub] = useState('')
	const [newRecipientAllocation, setNewRecipientAllocation] = useState(PLEBIAN_MARKET_DEFAULT_BPS)
	const [isSaving, setIsSaving] = useState(false)
	const [dirty, setDirty] = useState(false)

	const validatorKey = validators.map((validator) => `${validator.pubkey}:${validator.feeBps}`).join('|')
	const recipientKey = recipients.map((recipient) => `${recipient.pubkey}:${recipient.capabilityEventId}`).join('|')

	const platformCapabilityEventId = useMemo(
		() => recipients.find((recipient) => recipient.pubkey === platformPubkey)?.capabilityEventId,
		[recipients, platformPubkey],
	)

	// Seed from the draft each time the editor opens (or the inputs it derives from
	// change), so a cancelled edit can never come back.
	useEffect(() => {
		if (!open) return
		const fromDraft = auctionRowsFromLines(
			recipientLines,
			validators,
			(pubkey) => recipients.find((recipient) => recipient.pubkey === pubkey)?.name,
		)
		setRows(withPlatformDefault(fromDraft, platformPubkey ?? '', platformCapabilityEventId))
		setDirty(false)
		setShowAddForm(false)
		setNewRecipientNpub('')
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, recipientLines, validatorKey, recipientKey, platformPubkey])

	const shares = useMemo(() => toV4VShares(rows), [rows])
	const totalAllocated = useMemo(() => scheduleTotalBps(rows), [rows])
	const blocking = useMemo(() => unpayableRows(rows), [rows])

	const normalizePubkey = useCallback((input: string): string => {
		if (input.startsWith('npub')) {
			try {
				const { data } = nip19.decode(input)
				if (typeof data === 'string') return data
			} catch {
				return input
			}
		}
		return input
	}, [])

	/** The option the typed recipient resolves to, if it announced a capability. */
	const pendingRecipient = useMemo(() => {
		if (!newRecipientNpub) return undefined
		const pubkey = normalizePubkey(newRecipientNpub)
		return recipients.find((recipient) => recipient.pubkey === pubkey)
	}, [newRecipientNpub, recipients, normalizePubkey])

	const handleTotalChange = (value: number[]) => {
		setRows((prev) => allocateTotal(prev, value[0], BPS_UNIT))
		setDirty(true)
	}

	const handleProfileSelect = (npub: string) => setNewRecipientNpub(npub)

	const handleAddRecipient = () => {
		if (!newRecipientNpub) {
			toast.error('Enter an npub or pick a profile')
			return
		}
		if (!pendingRecipient) {
			toast.error('That recipient has not announced a payout capability, so it cannot be paid. Pick one from the announced recipients.')
			return
		}
		if (rows.some((row) => row.id === auctionRowId('v4v', pendingRecipient.pubkey))) {
			toast.error('That recipient is already in the payout')
			return
		}
		setRows((prev) => addAuctionRow(prev, pendingRecipient, newRecipientAllocation, BPS_UNIT))
		setNewRecipientNpub('')
		setNewRecipientAllocation(PLEBIAN_MARKET_DEFAULT_BPS)
		setShowAddForm(false)
		setDirty(true)
	}

	const handleRemoveRecipient = (id: string) => {
		setRows((prev) => removeAuctionRow(prev, id))
		setDirty(true)
	}

	const handleUpdateAllocation = (id: string, allocation: number) => {
		setRows((prev) => updateAuctionRowAllocation(prev, id, allocation, BPS_UNIT))
		setDirty(true)
	}

	const handleEqualizeAll = () => {
		setRows((prev) => equalizeAuctionRows(prev, scheduleTotalBps(prev), BPS_UNIT))
		setDirty(true)
	}

	const handleSave = async () => {
		if (blocking.length > 0) {
			toast.error(blocking[0]?.reason ?? 'A recipient cannot be paid yet')
			return
		}
		setIsSaving(true)
		try {
			onSave(serializeAuctionRows(rows))
			setDirty(false)
		} finally {
			setIsSaving(false)
		}
	}

	return {
		// Rows the editor renders
		shares,
		totalAllocated,
		newRecipientNpub,
		newRecipientAllocation,
		showAddForm,
		isSaving,
		hasChanges: dirty,
		/** Rows that cannot be published yet, with the reason. */
		blocking,

		// Requirement state, composed from the announced capabilities
		recipientRequirementState: {
			checking: false,
			satisfied: newRecipientNpub ? pendingRecipient !== undefined : undefined,
		},

		// Handlers
		handleTotalChange,
		handleProfileSelect,
		handleAddRecipient,
		handleRemoveRecipient,
		handleUpdateAllocation,
		handleEqualizeAll,
		handleSetNewRecipientAllocation: setNewRecipientAllocation,
		handleToggleAddForm: setShowAddForm,
		handleSave,

		// Exposed for the dialog's own validation display
		rows,
		totalBps: clampAllocation(totalAllocated, BPS_UNIT.total),
	}
}
