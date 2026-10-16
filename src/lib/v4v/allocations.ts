/**
 * The allocation unit the V4V editor works in — declared by the call site, never
 * assumed by the component.
 *
 * The editor used to speak whole percentages, which is lossy for the one case that
 * matters on an auction: a validator announces its fee in basis points, and 0.5%
 * (50 bps) is not representable in whole percent. Rather than special-case that,
 * the component takes the unit as input:
 *
 * - `total` — what a full allocation is (10 000 bps = 100%).
 * - `step` — the smallest change a slider may make, in the unit.
 * - `format` — the bare value, for bars, rows and buttons (e.g. `0.50%`).
 * - `label` — a value with what it is a share *of*, for headings and totals.
 *
 * Nothing here is React or Nostr: pure functions, unit-tested directly.
 */

/** A full allocation: 10 000 basis points is 100%. */
export const ALLOCATION_TOTAL_BPS = 10_000

export interface AllocationUnit {
	/** What a full allocation is, in this unit (10 000 for bps). */
	readonly total: number
	/** The smallest change a control may make, in this unit. */
	readonly step: number
	/** The bare value, e.g. `0.50%`. */
	readonly format: (value: number) => string
	/** The value with its base, e.g. `0.50% of the settlement`. */
	readonly label: (value: number) => string
	/** The unit's name, for assistive text (e.g. `per cent`). */
	readonly name: string
}

/** Basis points of a settlement — the wire unit, exact for any announced fee. */
export const BPS_UNIT: AllocationUnit = Object.freeze({
	total: ALLOCATION_TOTAL_BPS,
	step: 1,
	format: formatBps,
	label: (value: number) => `${formatBps(value)} of the settlement`,
	name: 'basis points',
})

/** Percent of a sale — the sales/circular-economy unit, kept for that surface. */
export const PERCENT_UNIT: AllocationUnit = Object.freeze({
	total: 100,
	step: 1,
	format: (value: number) => `${value}%`,
	label: (value: number) => `${value}%`,
	name: 'per cent',
})

/**
 * Basis points as a percentage, at a precision that never rounds a real fee away:
 * whole values stay whole (`200` → `2%`), fractions keep two decimals
 * (`50` → `0.5%`, `325` → `3.25%`).
 */
export function formatBps(bps: number): string {
	const percent = bps / 100
	const whole = Number.isInteger(percent)
	return `${whole ? percent.toFixed(0) : percent.toFixed(2)}%`
}

/** Percent (0..100) to basis points, at the boundary where a percent is stored. */
export const percentToBps = (percent: number): number => Math.round(percent * 100)

/** Basis points to percent, for call sites that still store percentages. */
export const bpsToPercent = (bps: number): number => bps / 100

/**
 * A stored share fraction (0..1, what `V4VDTO.percentage` holds) to basis points.
 * Sales stores the recipient's share *of the V4V pool* as a fraction; the wire and
 * the auction editor need it as basis points of the settlement.
 */
export const fractionToBps = (fraction: number): number => Math.round(fraction * ALLOCATION_TOTAL_BPS)

/** Basis points back to the stored fraction, for the sales boundary. */
export const bpsToFraction = (bps: number): number => bps / ALLOCATION_TOTAL_BPS

/** Keep an allocation inside `[0, total]`; non-finite input is treated as zero. */
export function clampAllocation(value: number, total: number = ALLOCATION_TOTAL_BPS): number {
	if (!Number.isFinite(value)) return 0
	return Math.min(Math.max(Math.round(value), 0), total)
}

/** A bar/fill width in percent for any unit, so the component never divides by 100. */
export function allocationBarWidth(value: number, unit: AllocationUnit = BPS_UNIT): number {
	if (unit.total <= 0) return 0
	return (clampAllocation(value, unit.total) / unit.total) * 100
}

/** What the seller keeps: the part of the settlement nobody else was allocated. */
export const sellerRemainder = (totalAllocated: number, unit: AllocationUnit = BPS_UNIT): number =>
	clampAllocation(unit.total - clampAllocation(totalAllocated, unit.total), unit.total)

/**
 * Split a total allocation evenly across the rows that may still be changed,
 * leaving locked rows at their fixed value. Returns the new allocation per row id,
 * so the caller applies it to whatever shape it stores.
 */
export function equalizeAllocations(
	rows: readonly { readonly id: string; readonly bps: number; readonly locked?: boolean }[],
	total: number,
	unit: AllocationUnit = BPS_UNIT,
): Record<string, number> {
	const changeable = rows.filter((row) => !row.locked)
	const allocatedToLocked = rows.filter((row) => row.locked).reduce((sum, row) => sum + clampAllocation(row.bps, unit.total), 0)

	if (changeable.length === 0) return {}

	const pool = Math.max(clampAllocation(total, unit.total) - allocatedToLocked, 0)
	const each = Math.floor(pool / changeable.length)
	// The remainder goes to the first row, so the parts always sum to the pool.
	const remainder = pool - each * changeable.length

	const next: Record<string, number> = {}
	changeable.forEach((row, index) => {
		next[row.id] = each + (index === 0 ? remainder : 0)
	})
	return next
}

/** Whether every allocation fits in the total — the one arithmetic rule the unit owns. */
export const allocationFits = (values: readonly number[], unit: AllocationUnit = BPS_UNIT): boolean =>
	values.every((value) => clampAllocation(value, unit.total) === value) && values.reduce((sum, value) => sum + value, 0) <= unit.total
