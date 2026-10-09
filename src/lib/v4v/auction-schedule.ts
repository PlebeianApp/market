import { parseMultipartyRecipientLines } from '@/lib/auction/multipartyPublishSchedule'
import { ALLOCATION_TOTAL_BPS, BPS_UNIT, clampAllocation, equalizeAllocations, type AllocationUnit } from '@/lib/v4v/allocations'
import type { V4VShare } from '@/lib/v4v/share'

/**
 * The auction settlement's own model, as pure functions.
 *
 * The `V4VManager` component speaks `V4VShare[]` — neutral rows in a declared unit.
 * An auction schedule is richer than that: each row also carries the role it plays in
 * the wire format and the capability (and, for a validator, the offer) that authorises
 * it, and the validators are *fixed* participants because the auction's auditor list
 * already names them.
 *
 * So the auction keeps its own row type and converts at the boundary, exactly as the
 * sales adapter keeps `V4VDTO` and converts. Everything here is pure and unit-tested:
 * the hook that wraps it owns nothing but React state.
 */

/** The share the product flow gives the platform by default, in basis points. */
export const PLEBIAN_MARKET_DEFAULT_BPS = 1000

/** A validator the V4V step selected, with the terms it announced. */
export interface AuctionValidatorInput {
	readonly pubkey: string
	readonly name?: string | undefined
	/** The validator's announced fee, in basis points of the settlement. */
	readonly feeBps: number
	readonly capabilityEventId: string
	readonly offerEventId: string
}

/** An announced payout capability, which is what makes a recipient payable. */
export interface AuctionRecipientOption {
	readonly pubkey: string
	readonly name?: string | undefined
	readonly capabilityEventId: string
}

/** One row of the auction's settlement schedule. */
export interface AuctionScheduleRow {
	readonly id: string
	readonly role: 'validator' | 'v4v'
	readonly pubkey: string
	readonly name?: string | undefined
	readonly bps: number
	/** Empty when the recipient's capability is not known yet — the row is then unsaveable. */
	readonly capabilityEventId: string
	readonly offerEventId?: string | undefined
	/** Fixed by the auction's auditor list: cannot be removed or repriced. */
	readonly locked: boolean
	readonly lockedReason?: string | undefined
}

/** A row's identity: role plus pubkey, which is what the wire format keys on. */
export const auctionRowId = (role: AuctionScheduleRow['role'], pubkey: string): string => `${role}:${pubkey}`

/** The sum of what the schedule allocates, which is what leaves the seller. */
export const scheduleTotalBps = (rows: readonly AuctionScheduleRow[]): number =>
	clampAllocation(
		rows.reduce((sum, row) => sum + clampAllocation(row.bps, ALLOCATION_TOTAL_BPS), 0),
		ALLOCATION_TOTAL_BPS,
	)

/** What the validators' fixed fees already claim. */
export const lockedTotalBps = (rows: readonly AuctionScheduleRow[]): number =>
	rows.filter((row) => row.locked).reduce((sum, row) => sum + clampAllocation(row.bps, ALLOCATION_TOTAL_BPS), 0)

/**
 * Build the schedule from the draft's current lines plus the validators the V4V step
 * selected. Validators are injected when the lines do not mention them yet and are
 * marked locked either way: the auditor list is already committed, so the payout
 * editor must not be able to publish an auction that omits a validator's share.
 */
export function auctionRowsFromLines(
	lines: string,
	validators: readonly AuctionValidatorInput[],
	nameOf?: (pubkey: string) => string | undefined,
): AuctionScheduleRow[] {
	let parsed: ReturnType<typeof parseMultipartyRecipientLines> = []
	try {
		parsed = parseMultipartyRecipientLines(lines)
	} catch {
		// Unreadable lines are the resolver's business, not this projection's: it reports
		// the blocking issue and keeps the raw text. Here they simply yield no rows.
		parsed = []
	}

	const byId = new Map<string, AuctionScheduleRow>()

	for (const recipient of parsed) {
		const id = auctionRowId(recipient.role, recipient.recipient_pubkey)
		byId.set(id, {
			id,
			role: recipient.role,
			pubkey: recipient.recipient_pubkey,
			name: nameOf?.(recipient.recipient_pubkey),
			bps: clampAllocation(recipient.allocation_bps, ALLOCATION_TOTAL_BPS),
			capabilityEventId: recipient.payout_capability_event_id,
			...(recipient.validator_offer_event_id === undefined ? {} : { offerEventId: recipient.validator_offer_event_id }),
			locked: recipient.role === 'validator',
			lockedReason: recipient.role === 'validator' ? 'This validator is an auditor of the auction, so its share is fixed here.' : undefined,
		})
	}

	for (const validator of validators) {
		const id = auctionRowId('validator', validator.pubkey)
		const existing = byId.get(id)
		byId.set(id, {
			id,
			role: 'validator',
			pubkey: validator.pubkey,
			name: validator.name ?? existing?.name ?? nameOf?.(validator.pubkey),
			// A validator's share is the fee it announced; a hand-written line cannot
			// quietly pay it less.
			bps: clampAllocation(validator.feeBps, ALLOCATION_TOTAL_BPS),
			capabilityEventId: validator.capabilityEventId,
			offerEventId: validator.offerEventId,
			locked: true,
			lockedReason: `This validator announced a ${(validator.feeBps / 100).toFixed(2)}% fee and is an auditor of the auction.`,
		})
	}

	return Array.from(byId.values())
}

/** The neutral rows the editor renders. */
export const toV4VShares = (rows: readonly AuctionScheduleRow[]): V4VShare[] =>
	rows.map((row) => ({
		id: row.id,
		name: row.name ?? row.pubkey,
		pubkey: row.pubkey,
		bps: row.bps,
		locked: row.locked,
		...(row.lockedReason === undefined ? {} : { lockedReason: row.lockedReason }),
	}))

/** The line text the draft stores, one recipient per line. */
export const serializeAuctionRows = (rows: readonly AuctionScheduleRow[]): string =>
	rows
		.map((row) =>
			[
				row.role,
				row.pubkey,
				String(clampAllocation(row.bps, ALLOCATION_TOTAL_BPS)),
				row.capabilityEventId,
				...(row.role === 'validator' && row.offerEventId !== undefined ? [row.offerEventId] : []),
			].join(', '),
		)
		.join('\n')

/**
 * Move the total to `targetBps` by rescaling the changeable rows, keeping their
 * proportions. Locked rows hold their value, so a target below the fixed fees is
 * clamped up to them rather than pretending the validators can be paid less.
 */
export function allocateTotal(
	rows: readonly AuctionScheduleRow[],
	targetBps: number,
	unit: AllocationUnit = BPS_UNIT,
): AuctionScheduleRow[] {
	const total = clampAllocation(targetBps, unit.total)
	const fixed = lockedTotalBps(rows)
	const changeable = rows.filter((row) => !row.locked)

	if (changeable.length === 0) return [...rows]

	const pool = Math.max(total - fixed, 0)
	const currentChangeableTotal = changeable.reduce((sum, row) => sum + row.bps, 0)

	const scaled = changeable.map((row, index) => {
		if (currentChangeableTotal <= 0) {
			// Nothing to preserve: split evenly, remainder on the first row.
			const each = Math.floor(pool / changeable.length)
			return { ...row, bps: each + (index === 0 ? pool - each * changeable.length : 0) }
		}
		const share = Math.floor((row.bps * pool) / currentChangeableTotal)
		return { ...row, bps: share }
	})

	// Give the rounding remainder to the largest row, so the parts sum to the pool.
	const assigned = scaled.reduce((sum, row) => sum + row.bps, 0)
	if (assigned !== pool && scaled.length > 0) {
		let largest = 0
		scaled.forEach((row, index) => {
			if (row.bps > (scaled[largest]?.bps ?? -1)) largest = index
		})
		scaled[largest] = { ...scaled[largest], bps: scaled[largest].bps + (pool - assigned) }
	}

	const byId = new Map(scaled.map((row) => [row.id, row]))
	return rows.map((row) => byId.get(row.id) ?? row)
}

/** Split the pool evenly across the changeable rows; locked fees stay put. */
export function equalizeAuctionRows(
	rows: readonly AuctionScheduleRow[],
	totalBps: number,
	unit: AllocationUnit = BPS_UNIT,
): AuctionScheduleRow[] {
	const allocations = equalizeAllocations(
		rows.map((row) => ({ id: row.id, bps: row.bps, locked: row.locked })),
		totalBps,
		unit,
	)
	return rows.map((row) => (row.id in allocations ? { ...row, bps: allocations[row.id] } : row))
}

/** Set one row's share, leaving the rest alone. Locked rows refuse. */
export function updateAuctionRowAllocation(
	rows: readonly AuctionScheduleRow[],
	id: string,
	bps: number,
	unit: AllocationUnit = BPS_UNIT,
): AuctionScheduleRow[] {
	return rows.map((row) => (row.id === id && !row.locked ? { ...row, bps: clampAllocation(bps, unit.total) } : row))
}

/** Drop a row. Locked rows are not removable. */
export const removeAuctionRow = (rows: readonly AuctionScheduleRow[], id: string): AuctionScheduleRow[] =>
	rows.filter((row) => row.id !== id || row.locked)

/** Add an announced recipient, at the given share. Existing rows are left alone. */
export function addAuctionRow(
	rows: readonly AuctionScheduleRow[],
	option: AuctionRecipientOption,
	bps: number,
	unit: AllocationUnit = BPS_UNIT,
): AuctionScheduleRow[] {
	const id = auctionRowId('v4v', option.pubkey)
	if (rows.some((row) => row.id === id)) return [...rows]
	return [
		...rows,
		{
			id,
			role: 'v4v',
			pubkey: option.pubkey,
			name: option.name,
			bps: clampAllocation(bps, unit.total),
			capabilityEventId: option.capabilityEventId,
			locked: false,
		},
	]
}

/**
 * Seed the platform's default share, the way the product flow does. The capability
 * may be unknown (this app has not announced one yet); the row is still created so
 * the intent is visible, and `unpayableRows` names what is missing rather than the
 * editor silently saving a schedule the wire format would reject.
 */
export function withPlatformDefault(
	rows: readonly AuctionScheduleRow[],
	platformPubkey: string,
	capabilityEventId: string | undefined,
	bps: number = PLEBIAN_MARKET_DEFAULT_BPS,
): AuctionScheduleRow[] {
	if (!platformPubkey) return [...rows]
	const id = auctionRowId('v4v', platformPubkey)
	if (rows.some((row) => row.id === id)) return [...rows]
	return [
		...rows,
		{
			id,
			role: 'v4v',
			pubkey: platformPubkey,
			name: 'Plebian Market',
			bps: clampAllocation(bps, ALLOCATION_TOTAL_BPS),
			capabilityEventId: capabilityEventId ?? '',
			locked: false,
		},
	]
}

/** Rows that cannot be published yet, with the reason — a missing capability. */
export const unpayableRows = (rows: readonly AuctionScheduleRow[]): { id: string; reason: string }[] =>
	rows
		.filter((row) => !/^[0-9a-f]{64}$/.test(row.capabilityEventId))
		.map((row) => ({
			id: row.id,
			reason: `${row.name ?? row.pubkey.slice(0, 10)} has no announced payout capability on this relay yet.`,
		}))
