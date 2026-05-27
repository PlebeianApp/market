import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	AUCTION_MIN_DURATION_SECONDS,
	getAuctionPublishValidationIssues,
	validateAuctionPublishInput,
	type AuctionPublishValidationField,
	type AuctionPublishValidationIssue,
} from '@/lib/auctionPublishValidation'
import { syncMintSelection } from '@/lib/auctionMintSync'
import { DEFAULT_TRUSTED_MINTS, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { configStore } from '@/lib/stores/config'
import { isNip60WalletDevModeEnabled, NIP60_DEV_TEST_MINTS } from '@/lib/stores/nip60'
import { normalizeProductShippingSelections, type ProductShippingSelection } from '@/lib/utils/productShippingSelections'
import {
	AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES,
	AUCTION_MIN_BID_CURVE_PEAK_PRESETS,
	AUCTION_SETTLEMENT_GRACE_PRESETS,
	usePublishAuctionMutation,
	type AuctionAntiSnipeWindowMinutesPreset,
	type AuctionFormData,
	type AuctionMinBidCurvePeakPreset,
	type AuctionMinBidCurveShape,
	type AuctionSettlementGracePreset,
	type AuctionSpecEntry,
} from '@/publish/auctions'
import { AuctionOracleSelector } from './AuctionOracleSelector'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { CalendarIcon, ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Slider } from '@/components/ui/slider'

type AuctionImage = { imageUrl: string; imageOrder: number }

type AuctionTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping'
type ValidationMessages = Partial<Record<AuctionPublishValidationField, string>>

const INITIAL_FORM: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: '1',
	reserve: undefined,
	startAt: '',
	endAt: '',
	// Anti-snipe defaults: no window, no curve, 1h settlement grace.
	// Defaults are conservative — sellers must opt into the curve
	// explicitly. AUCTIONS.md §6.1.
	antiSnipeWindowMinutes: 0,
	minBidCurveShape: 'none',
	minBidCurvePeakMultiplier: 2,
	settlementGracePreset: '1h',
	mainCategory: '',
	categories: [],
	imageUrls: [],
	specs: [],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
	// `AuctionOracleSelector` populates this once the CEP-15 directory
	// query resolves; empty string means "fall back to app default" so
	// nothing breaks if the seller submits before discovery completes.
	pathIssuerPubkey: '',
}

function parseListInput(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean)
}

function toValidationMessages(issues: AuctionPublishValidationIssue[]): ValidationMessages {
	const messages: ValidationMessages = {}
	for (const issue of issues) {
		messages[issue.field] ??= issue.message
	}
	return messages
}

function toIndexedValidationMessages(
	issues: AuctionPublishValidationIssue[],
	field: AuctionPublishValidationField,
): Record<number, string> {
	const messages: Record<number, string> = {}
	for (const issue of issues) {
		if (issue.field === field && issue.index !== undefined) {
			messages[issue.index] ??= issue.message
		}
	}
	return messages
}

type TabProps = {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
}

function NameTab({ formData, setFormData }: TabProps) {
	return (
		<div className="flex flex-col gap-4">
			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-title">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Title</span>
				</Label>
				<Input
					id="auction-title"
					value={formData.title}
					onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
					placeholder="e.g. Rare print run #1"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-summary">Summary</Label>
				<Input
					id="auction-summary"
					value={formData.summary}
					onChange={(e) => setFormData((prev) => ({ ...prev, summary: e.target.value }))}
					placeholder="Short one-liner for list view"
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-description">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
				</Label>
				<textarea
					id="auction-description"
					value={formData.description}
					onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
					className="border-2 min-h-24 p-2 rounded-md"
					placeholder="Describe the item, condition, and shipping notes."
				/>
			</div>

			<div className="flex items-start space-x-3 p-3 border rounded-lg bg-amber-50/50 border-amber-200">
				<Checkbox
					id="auction-nsfw-content"
					checked={formData.isNSFW}
					onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isNSFW: checked === true }))}
					className="mt-0.5"
				/>
				<div className="space-y-1">
					<Label htmlFor="auction-nsfw-content" className="text-sm font-medium cursor-pointer">
						This auction contains adult/sensitive content
					</Label>
				</div>
			</div>
		</div>
	)
}

type StartMode = 'immediate' | 'scheduled'
type EndMode = 'duration' | 'absolute'

type AuctionDurationPreset = { label: string; seconds: number }

const DURATION_PRESETS: AuctionDurationPreset[] = [
	{ label: '1m', seconds: 1 * 60 },
	{ label: '2m', seconds: 2 * 60 },
	{ label: '3m', seconds: 3 * 60 },
	{ label: '4m', seconds: 4 * 60 },
	{ label: '5m', seconds: 5 * 60 },
	{ label: '10m', seconds: 10 * 60 },
	{ label: '15m', seconds: 15 * 60 },
	{ label: '30m', seconds: 30 * 60 },
	{ label: '45m', seconds: 45 * 60 },
	{ label: '1h', seconds: 3600 },
	{ label: '2h', seconds: 2 * 3600 },
	{ label: '3h', seconds: 3 * 3600 },
	{ label: '4h', seconds: 4 * 3600 },
	{ label: '5h', seconds: 5 * 3600 },
	{ label: '6h', seconds: 6 * 3600 },
	{ label: '7h', seconds: 7 * 3600 },
	{ label: '8h', seconds: 8 * 3600 },
	{ label: '9h', seconds: 9 * 3600 },
	{ label: '10h', seconds: 10 * 3600 },
	{ label: '12h', seconds: 12 * 3600 },
	{ label: '14h', seconds: 14 * 3600 },
	{ label: '16h', seconds: 16 * 3600 },
	{ label: '18h', seconds: 18 * 3600 },
	{ label: '20h', seconds: 20 * 3600 },
	{ label: '22h', seconds: 22 * 3600 },
	{ label: '1d', seconds: 86400 },
	{ label: '2d', seconds: 2 * 86400 },
	{ label: '3d', seconds: 3 * 86400 },
	{ label: '4d', seconds: 4 * 86400 },
	{ label: '5d', seconds: 5 * 86400 },
	{ label: '6d', seconds: 6 * 86400 },
	{ label: '7d', seconds: 7 * 86400 },
	{ label: '8d', seconds: 8 * 86400 },
	{ label: '9d', seconds: 9 * 86400 },
	{ label: '10d', seconds: 10 * 86400 },
	{ label: '11d', seconds: 11 * 86400 },
	{ label: '12d', seconds: 12 * 86400 },
	{ label: '13d', seconds: 13 * 86400 },
	{ label: '14d', seconds: 14 * 86400 },
	{ label: '15d', seconds: 15 * 86400 },
	{ label: '20d', seconds: 20 * 86400 },
	{ label: '25d', seconds: 25 * 86400 },
	{ label: '30d', seconds: 30 * 86400 },
]

const DURATION_PRESET_DEFAULT_INDEX = 25 // Index for 1 Day

const DURATION_PRESETS_SHORTCUT: AuctionDurationPreset[] = [
	DURATION_PRESETS[9], // 1 Hour
	DURATION_PRESETS[19], // 12 Hours
	DURATION_PRESETS[25], // 1 Day
	DURATION_PRESETS[31], // 7 Days
	DURATION_PRESETS[38], // 14 Days
	DURATION_PRESETS[42], // 30 Days
]

function pad2(n: number): string {
	return n.toString().padStart(2, '0')
}

function toDatetimeLocal(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function parseDatetimeLocalSeconds(value: string): number | null {
	if (!value) return null
	const ts = new Date(value).getTime()
	return Number.isNaN(ts) ? null : Math.floor(ts / 1000)
}

function formatDuration(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 minutes'
	const days = Math.floor(totalSeconds / 86400)
	const hours = Math.floor((totalSeconds % 86400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const parts: string[] = []
	if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
	if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
	if (days === 0 && minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
	return parts.length > 0 ? parts.join(' ') : '< 1 minute'
}

function formatAbsolute(tsSeconds: number): string {
	if (!tsSeconds) return '—'
	return new Date(tsSeconds * 1000).toLocaleString()
}

function DateTimePicker({
	value,
	onChange,
	placeholder = 'Pick a date & time',
}: {
	value: string
	onChange: (next: string) => void
	placeholder?: string
}) {
	const [open, setOpen] = useState(false)
	const seconds = parseDatetimeLocalSeconds(value)
	const date = seconds ? new Date(seconds * 1000) : undefined
	const timeValue = date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : '12:00'

	const handleDateSelect = (next: Date | undefined) => {
		if (!next) return
		const merged = new Date(next)
		if (date) {
			merged.setHours(date.getHours(), date.getMinutes(), 0, 0)
		} else {
			merged.setHours(12, 0, 0, 0)
		}
		onChange(toDatetimeLocal(merged))
	}

	const handleTimeChange = (time: string) => {
		const [hStr, mStr] = time.split(':')
		const h = parseInt(hStr ?? '', 10)
		const m = parseInt(mStr ?? '', 10)
		if (Number.isNaN(h) || Number.isNaN(m)) return
		const base = date ? new Date(date) : new Date()
		base.setHours(h, m, 0, 0)
		onChange(toDatetimeLocal(base))
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button type="button" variant="outline" className="w-full justify-start gap-2 font-normal">
					<CalendarIcon className="h-4 w-4 text-zinc-500 shrink-0" />
					<span className={date ? 'text-zinc-900' : 'text-zinc-500'}>{date ? date.toLocaleString() : placeholder}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar mode="single" selected={date} onSelect={handleDateSelect} captionLayout="dropdown" />
				<div className="border-t p-3 space-y-2">
					<Label htmlFor="datetime-picker-time" className="text-xs text-zinc-600">
						Time
					</Label>
					<Input id="datetime-picker-time" type="time" value={timeValue} onChange={(e) => handleTimeChange(e.target.value)} />
				</div>
			</PopoverContent>
		</Popover>
	)
}

/**
 * Bid-ladder preview — sats-only view of the price progression. The
 * companion timeline preview (which includes the anti-snipe curve)
 * now lives inside `AntiSnipeCurveSettings`, since that's the card
 * where its inputs are. Keeping the ladder lean lets sellers reason
 * about the bid-amount mechanics without the timing axis muddling it.
 */
function BidLadderViz({ startingBid, bidIncrement, reserve }: { startingBid: number; bidIncrement: number; reserve: number }) {
	const validStart = Number.isFinite(startingBid) && startingBid >= 0
	const validInc = Number.isFinite(bidIncrement) && bidIncrement > 0

	if (!validStart || !validInc) {
		return (
			<div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
				Enter a starting bid and bid increment to preview the bid ladder.
			</div>
		)
	}

	const hasReserve = Number.isFinite(reserve) && reserve > startingBid
	const bidsToReserve = hasReserve ? Math.ceil((reserve - startingBid) / bidIncrement) : 0
	const maxTicks = 24
	const tickCount = hasReserve ? Math.min(bidsToReserve, maxTicks) : 0

	return (
		<div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
			<p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bid ladder preview</p>

			<div className="relative mt-3 h-12 rounded-md bg-gradient-to-r from-emerald-100 via-amber-50 to-amber-100">
				{Array.from({ length: tickCount }).map((_, i) => (
					<div key={i} className="absolute top-2 bottom-2 w-px bg-zinc-400/70" style={{ left: `${((i + 1) / (tickCount + 1)) * 100}%` }} />
				))}
				<div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-md bg-emerald-500" />
				{hasReserve && <div className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-md bg-amber-500" />}
			</div>

			<div className="mt-3 flex items-end justify-between gap-4 text-xs">
				<div>
					<p className="font-semibold text-emerald-700">{startingBid.toLocaleString()} sats</p>
					<p className="text-zinc-500">Starting bid</p>
				</div>
				<div className="text-center">
					<p className="font-semibold text-zinc-900">+{bidIncrement.toLocaleString()}</p>
					<p className="text-zinc-500">per bid</p>
				</div>
				{hasReserve ? (
					<div className="text-right">
						<p className="font-semibold text-amber-700">{reserve.toLocaleString()} sats</p>
						<p className="text-zinc-500">Reserve</p>
					</div>
				) : (
					<div className="text-right">
						<p className="font-semibold text-zinc-600">No reserve</p>
						<p className="text-zinc-500">Highest bid wins</p>
					</div>
				)}
			</div>

			{hasReserve && (
				<p className="mt-3 text-xs text-zinc-600">
					<span className="font-semibold text-zinc-900">{bidsToReserve}</span> bid{bidsToReserve === 1 ? '' : 's'} of{' '}
					<span className="font-semibold text-zinc-900">{bidIncrement.toLocaleString()} sats</span> needed to clear the reserve.
				</p>
			)}
		</div>
	)
}

/**
 * Time-axis preview embedded in the anti-snipe card.
 *
 * **Symbolic, NOT proportional x-axis.** Realistic auctions have a
 * 24-hour bidding window and a 30-minute curve — a strictly
 * proportional chart squashes the curve into a sliver. We use fixed
 * segment widths:
 *   - flat phase `[start_at, end_at]`    → 35 % (or 60 % when no window)
 *   - curve phase `[end_at, max_end_at]` → 40 % (collapsed to 0 when window=0)
 *   - locktime phase `[max_end_at, locktime]` → 25 % (or 40 % when no window)
 *
 * The chart is for shape recognition ("there's a steep ramp at the
 * end"), not precise time-magnitude. Absolute times appear inline
 * above the chart at each tick.
 *
 * **Baseline pick** (AUCTIONS.md §6.1 — `top_bid + bid_increment`):
 * the form has no live top bid, so we substitute
 * `previewTopBid = max(reserve, starting_bid)`. Reserve is the
 * seller's own hint at where the auction is expected to land —
 * using it gives a realistic preview (a 10× of a 70 000-sat reserve
 * is 700 010 sats; a 10× of a 10-sat starting bid is a meaningless
 * 100 sats). Falls back to starting_bid when no reserve.
 */
function AuctionTimelinePreview({
	startingBid,
	bidIncrement,
	reserve,
	curveShape,
	curvePeakMultiplier,
	startAtSeconds,
	endAtSeconds,
	maxEndAtSeconds,
	settlementGraceSeconds,
	showCurve,
}: {
	startingBid: number
	bidIncrement: number
	reserve: number
	curveShape: 'none' | 'linear' | 'exponential'
	curvePeakMultiplier: number
	startAtSeconds: number
	endAtSeconds: number
	maxEndAtSeconds: number
	settlementGraceSeconds: number
	showCurve: boolean
}) {
	if (!endAtSeconds || !startAtSeconds) {
		return (
			<div className="mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500">
				Pick an end time to preview the bidding timeline.
			</div>
		)
	}

	// Baseline = (preview top + bid_increment) — see comment block above.
	const hasReserve = reserve > startingBid
	const previewTopBid = hasReserve ? reserve : startingBid
	const baseline = Math.max(1, previewTopBid + bidIncrement)
	const peakMultiplier = showCurve ? curvePeakMultiplier : 1
	const peakFloor = Math.ceil(baseline * peakMultiplier)

	const lockTimeSeconds = maxEndAtSeconds + settlementGraceSeconds
	const hasWindow = maxEndAtSeconds > endAtSeconds

	// Symbolic segment widths (percent of chart width). When no anti-snipe
	// window, the middle segment collapses and the other two grow to fill.
	const flatPct = hasWindow ? 35 : 60
	const curvePct = hasWindow ? 40 : 0
	const lockPct = hasWindow ? 25 : 40
	const endX = flatPct
	const maxEndX = flatPct + curvePct
	const lockX = flatPct + curvePct + lockPct

	// SVG geometry. y-axis: baseline at the bottom (multiplier=1 → y=H-4),
	// peak at the top (multiplier=peak → y=4). Bound denominator to avoid
	// div-by-zero when peak=1; the chart collapses to a single flat line
	// in that case, which is the correct visualisation.
	const W = 100
	const H = 36
	const yScaleMult = (mult: number) => {
		const denom = Math.max(peakMultiplier - 1, 0.0001)
		const t = (mult - 1) / denom
		return H - 4 - t * (H - 8)
	}
	const flatY = yScaleMult(1)
	const peakY = yScaleMult(peakMultiplier)

	// 32-sample curve in [end_at, max_end_at]. `tNorm` walks 0→1 across
	// the SYMBOLIC curve segment (not real time).
	const curveSamples = 32
	const curvePath = (() => {
		if (!showCurve || !hasWindow) return ''
		const segments: string[] = []
		for (let i = 0; i <= curveSamples; i++) {
			const tNorm = i / curveSamples
			let mult = 1
			if (curveShape === 'linear') mult = 1 + (peakMultiplier - 1) * tNorm
			else mult = Math.pow(peakMultiplier, tNorm)
			const x = endX + tNorm * curvePct
			const y = yScaleMult(mult)
			segments.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`)
		}
		return segments.join(' ')
	})()

	// Inline label config. Each tick: dashed vertical guide in the SVG +
	// two-line text label (bold name on top, mono compact time below)
	// positioned just above the chart and x-aligned by percentage.
	// Anchors are tweaked so edge labels don't overflow the card.
	const ticks: Array<{
		xPct: number
		color: string
		label: string
		sub: string
		anchor: 'start' | 'middle' | 'end'
	}> = [
		{ xPct: 0, color: '#10b981', label: 'start', sub: formatAbsoluteCompact(startAtSeconds), anchor: 'start' },
		{ xPct: endX, color: '#10b981', label: 'end', sub: formatAbsoluteCompact(endAtSeconds), anchor: 'middle' },
		...(hasWindow
			? [
					{
						xPct: maxEndX,
						color: '#f59e0b',
						label: 'abs. end',
						sub: formatAbsoluteCompact(maxEndAtSeconds),
						anchor: 'middle' as const,
					},
				]
			: []),
		{ xPct: lockX, color: '#6b7280', label: 'locktime', sub: formatAbsoluteCompact(lockTimeSeconds), anchor: 'end' },
	]

	return (
		<div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3">
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bidding timeline</p>
				<p className="text-[10px] text-zinc-500">
					Preview top bid <span className="font-mono text-zinc-700">{previewTopBid.toLocaleString()} sats</span>{' '}
					<span className="text-zinc-400">({hasReserve ? 'from reserve' : 'no reserve, using starting bid'})</span>
				</p>
			</div>

			{/* Label strip ABOVE the chart, x-aligned with the SVG below.
			    Two lines per tick: bold name on top, mono compact time
			    below. Anchored to keep edges in-card. */}
			<div className="relative mt-3 h-7 text-[9px]">
				{ticks.map((tick) => {
					const translate = tick.anchor === 'start' ? 'translate-x-0' : tick.anchor === 'end' ? '-translate-x-full' : '-translate-x-1/2'
					return (
						<div key={tick.label} className={`absolute top-0 ${translate} flex flex-col`} style={{ left: `${tick.xPct}%` }}>
							<span className="font-semibold leading-tight" style={{ color: tick.color }}>
								{tick.label}
							</span>
							<span className="font-mono text-[8px] text-zinc-500 leading-tight">{tick.sub}</span>
						</div>
					)
				})}
			</div>

			<svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" preserveAspectRatio="none" height={H * 2}>
				{/* dashed vertical guides at each checkpoint */}
				{ticks.map((tick) => (
					<line
						key={tick.label}
						x1={tick.xPct}
						y1={0}
						x2={tick.xPct}
						y2={H}
						stroke={tick.color}
						strokeWidth="0.3"
						strokeDasharray="0.6 0.6"
					/>
				))}

				{/* Phase 1: flat floor in [start_at, end_at] */}
				<line x1={0} y1={flatY} x2={endX} y2={flatY} stroke="#10b981" strokeWidth="1.4" />

				{/* Phase 2: curve in [end_at, max_end_at] when enabled */}
				{curvePath && <path d={curvePath} fill="none" stroke="#10b981" strokeWidth="1.4" />}
				{!curvePath && hasWindow && <line x1={endX} y1={flatY} x2={maxEndX} y2={flatY} stroke="#10b981" strokeWidth="1.4" />}

				{/* Phase 3: settlement window in [max_end_at, locktime] — dashed at
				    whatever floor was reached. No bids accepted here; only the
				    seller's kind-1024 publish and bidder timelock-refund. */}
				<line
					x1={maxEndX}
					y1={showCurve ? peakY : flatY}
					x2={lockX}
					y2={showCurve ? peakY : flatY}
					stroke="#9ca3af"
					strokeWidth="0.9"
					strokeDasharray="1.2 1.2"
				/>
			</svg>

			<div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-zinc-600">
				<p>
					Floor at <span className="font-semibold text-zinc-900">auction end</span>:{' '}
					<span className="font-semibold">{baseline.toLocaleString()} sats</span>
				</p>
				<p>
					Floor at <span className="font-semibold text-zinc-900">absolute end</span>:{' '}
					<span className={`font-semibold ${showCurve ? 'text-emerald-700' : 'text-zinc-700'}`}>{peakFloor.toLocaleString()} sats</span>{' '}
					{showCurve ? (
						<span className="text-zinc-400">
							({curvePeakMultiplier}×, {curveShape})
						</span>
					) : (
						<span className="text-zinc-400">(no curve)</span>
					)}
				</p>
			</div>
			<p className="mt-2 text-[10px] italic text-zinc-400">Times shown on the chart are symbolic — segments aren't to scale.</p>
		</div>
	)
}

/**
 * Compact absolute-time formatter for the inline tick labels. Returns
 * `HH:MM` when the checkpoint is on the seller's current day,
 * `MM/DD HH:MM` otherwise. The full locale-aware formatting still lives
 * on `formatAbsolute()` for any hover / copy contexts that need it.
 */
function formatAbsoluteCompact(tsSeconds: number): string {
	if (!tsSeconds) return ''
	const d = new Date(tsSeconds * 1000)
	const hh = String(d.getHours()).padStart(2, '0')
	const mm = String(d.getMinutes()).padStart(2, '0')
	const today = new Date()
	const sameDay = d.toDateString() === today.toDateString()
	if (sameDay) return `${hh}:${mm}`
	const month = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${month}/${day} ${hh}:${mm}`
}

/**
 * Anti-snipe window + curve picker. Single card on the auction form
 * with three rows of preset buttons:
 *
 *   1. Anti-snipe window (0 / 5 / 15 / 30 minutes added to end_at).
 *   2. Curve shape (none / linear / exponential).
 *   3. Peak multiplier (2× / 5× / 10×) — disabled when shape = none.
 *
 * Picking shape ≠ none with window = 0 surfaces a validation hint via
 * `getAuctionPublishValidationIssues` (the form's per-field message
 * map). AUCTIONS.md §6.1.
 */
function AntiSnipeCurveSettings({
	formData,
	setFormData,
	startAtSeconds,
	endAtSeconds,
	maxEndAtSeconds,
	settlementGraceSeconds,
	startingBid,
	bidIncrement,
	reserve,
}: {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** Resolved unix seconds derived by the parent form. */
	startAtSeconds: number
	endAtSeconds: number
	maxEndAtSeconds: number
	settlementGraceSeconds: number
	/** Parsed numeric form values for the timeline preview's baseline. */
	startingBid: number
	bidIncrement: number
	reserve: number
}) {
	const windowOptions: AuctionAntiSnipeWindowMinutesPreset[] = [...AUCTION_ANTI_SNIPE_WINDOW_PRESETS_MINUTES]
	const shapeOptions: Array<{ value: AuctionMinBidCurveShape; label: string; sub: string }> = [
		{ value: 'none', label: 'None', sub: 'flat floor' },
		{ value: 'linear', label: 'Linear', sub: 'straight ramp' },
		{ value: 'exponential', label: 'Exponential', sub: 'steep finish' },
	]
	const peakOptions: AuctionMinBidCurvePeakPreset[] = [...AUCTION_MIN_BID_CURVE_PEAK_PRESETS]

	// `windowDisabled = true` when the seller picked "No window" —
	// disables curve shape AND peak multiplier in one go. With no window,
	// `max_end_at = end_at`, the curve has zero duration, and a non-`none`
	// shape would have no effect anyway. Disabling the controls visually
	// reinforces "this section is gated on having a window".
	const windowDisabled = formData.antiSnipeWindowMinutes === 0
	const curveDisabled = windowDisabled || formData.minBidCurveShape === 'none'

	return (
		<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
			<div>
				<Label className="text-zinc-950">Anti-snipe</Label>
				<p className="mt-1 text-xs text-zinc-500">
					After the auction end, late bids can still land in an extra window — but the minimum bid ramps up to make sniping expensive. The
					absolute end is fixed at publish time.
				</p>
			</div>

			<div className="grid gap-1.5">
				<Label className="text-xs uppercase tracking-wide text-zinc-500">Window</Label>
				<div className="flex flex-wrap gap-2">
					{windowOptions.map((minutes) => {
						const isActive = formData.antiSnipeWindowMinutes === minutes
						return (
							<button
								key={minutes}
								type="button"
								onClick={() =>
									// Setting window=0 also resets curve to `none` —
									// keeps the form state coherent so a re-enable
									// doesn't surface a leftover shape the seller
									// can't see.
									setFormData((prev) =>
										minutes === 0
											? { ...prev, antiSnipeWindowMinutes: minutes, minBidCurveShape: 'none' }
											: { ...prev, antiSnipeWindowMinutes: minutes },
									)
								}
								className={`rounded-md border px-3 py-1.5 text-xs ${
									isActive
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
								}`}
							>
								{minutes === 0 ? 'No window' : `${minutes} min`}
							</button>
						)
					})}
				</div>
			</div>

			<div className="grid gap-1.5">
				<Label className={`text-xs uppercase tracking-wide ${windowDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>Curve shape</Label>
				<div className="flex flex-wrap gap-2">
					{shapeOptions.map((option) => {
						const isActive = formData.minBidCurveShape === option.value
						return (
							<button
								key={option.value}
								type="button"
								disabled={windowDisabled}
								onClick={() => setFormData((prev) => ({ ...prev, minBidCurveShape: option.value }))}
								className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
									isActive && !windowDisabled
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 disabled:hover:border-zinc-200'
								}`}
							>
								<span className="font-semibold">{option.label}</span>
								<span className="text-[10px] text-zinc-500">{option.sub}</span>
							</button>
						)
					})}
				</div>
				{windowDisabled && <p className="text-[11px] text-amber-700">Pick a window above to enable the curve.</p>}
			</div>

			<div className="grid gap-1.5">
				<Label className={`text-xs uppercase tracking-wide ${curveDisabled ? 'text-zinc-300' : 'text-zinc-500'}`}>Peak multiplier</Label>
				<div className="flex flex-wrap gap-2">
					{peakOptions.map((peak) => {
						const isActive = formData.minBidCurvePeakMultiplier === peak
						return (
							<button
								key={peak}
								type="button"
								disabled={curveDisabled}
								onClick={() => setFormData((prev) => ({ ...prev, minBidCurvePeakMultiplier: peak }))}
								className={`rounded-md border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
									isActive && !curveDisabled
										? 'border-emerald-500 bg-emerald-50 text-emerald-800'
										: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 disabled:hover:border-zinc-200'
								}`}
							>
								{peak}×
							</button>
						)
					})}
				</div>
				{!curveDisabled && (
					<p className="text-[11px] text-zinc-500">
						Floor at the absolute end will be {formData.minBidCurvePeakMultiplier}× the floor at auction end.
					</p>
				)}
			</div>

			{/* Timeline preview lives INSIDE this card now — the chart's
			    inputs (window, shape, multiplier) are all here, so the
			    feedback belongs alongside them rather than in the bid
			    ladder card. */}
			<AuctionTimelinePreview
				startingBid={startingBid}
				bidIncrement={bidIncrement}
				reserve={reserve}
				curveShape={formData.minBidCurveShape}
				curvePeakMultiplier={formData.minBidCurvePeakMultiplier}
				startAtSeconds={startAtSeconds}
				endAtSeconds={endAtSeconds}
				maxEndAtSeconds={maxEndAtSeconds}
				settlementGraceSeconds={settlementGraceSeconds}
				showCurve={
					formData.minBidCurveShape !== 'none' &&
					formData.minBidCurvePeakMultiplier > 1 &&
					maxEndAtSeconds > endAtSeconds &&
					endAtSeconds > 0
				}
			/>
		</div>
	)
}

/**
 * Settlement-grace picker — 5 min / 1 h / 3 h. AUCTIONS.md §4.1.
 *
 * The grace is the window the seller has between `max_end_at` and the
 * Cashu locktime to publish the kind-1024 settlement. Long enough that
 * a mint outage or relay flake doesn't cost the seller; short enough
 * that losing bidders aren't stranded for days.
 */
function SettlementGraceSettings({
	formData,
	setFormData,
}: {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
}) {
	const presets: Array<{ value: AuctionSettlementGracePreset; label: string; sub: string }> = [
		{ value: '5min', label: '5 min', sub: 'tight, mint must be reliable' },
		{ value: '1h', label: '1 hour', sub: 'recommended' },
		{ value: '3h', label: '3 hours', sub: 'safest for losers' },
	]

	return (
		<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
			<div>
				<Label className="text-zinc-950">Settlement grace</Label>
				<p className="mt-1 text-xs text-zinc-500">
					How long after the absolute end you have to publish the settlement before losing bidders can reclaim their funds. Bids carry the
					same locktime regardless of how many bids land.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				{presets.map((option) => {
					const isActive = formData.settlementGracePreset === option.value
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => setFormData((prev) => ({ ...prev, settlementGracePreset: option.value }))}
							className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left text-xs ${
								isActive
									? 'border-emerald-500 bg-emerald-50 text-emerald-800'
									: 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
							}`}
						>
							<span className="font-semibold">{option.label}</span>
							<span className="text-[10px] text-zinc-500">{option.sub}</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}

function useOpenOnVisible(onVisible: () => void) {
	const callbackRef = useRef(onVisible)
	callbackRef.current = onVisible
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					callbackRef.current()
					observer.disconnect()
				}
			},
			{ threshold: 0.15 },
		)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	return ref
}

function AuctionTabContent({
	formData,
	setFormData,
	availableMints,
	startMode,
	setStartMode,
	endMode,
	setEndMode,
	durationSeconds,
	setDurationSeconds,
	validationMessages,
	userRemovedMints,
	onUserRemovedMintsChange,
}: TabProps & {
	availableMints: readonly string[]
	startMode: StartMode
	setStartMode: Dispatch<SetStateAction<StartMode>>
	endMode: EndMode
	setEndMode: Dispatch<SetStateAction<EndMode>>
	durationSeconds: number
	setDurationSeconds: Dispatch<SetStateAction<number>>
	validationMessages: ValidationMessages
	userRemovedMints: Set<string>
	onUserRemovedMintsChange: (next: Set<string>) => void
}) {
	const [useReserve, setUseReserve] = useState(false)
	const [inputSliderValue, setInputSliderValue] = useState<number>(DURATION_PRESET_DEFAULT_INDEX)

	const selectedMints = formData.trustedMints
	const unselectedMints = availableMints.filter((mint) => !selectedMints.includes(mint))
	const canRemoveMint = selectedMints.length > 1

	const removeMint = (mint: string) => {
		if (!canRemoveMint) return
		setFormData((prev) => ({ ...prev, trustedMints: prev.trustedMints.filter((m) => m !== mint) }))
		onUserRemovedMintsChange(new Set(userRemovedMints).add(mint))
	}

	const addMint = (mint: string) => {
		if (selectedMints.includes(mint)) return
		setFormData((prev) => ({ ...prev, trustedMints: [...prev.trustedMints, mint] }))
		if (userRemovedMints.has(mint)) {
			const next = new Set(userRemovedMints)
			next.delete(mint)
			onUserRemovedMintsChange(next)
		}
	}

	type Section = 'bidLadder' | 'antiSnipe' | 'settlementGrace' | 'trustedMints' | 'oracle'
	const [openSection, setOpenSection] = useState<Section | null>(null)
	const open = (s: Section) => setOpenSection(s)
	const toggle = (s: Section) => (isOpen: boolean) => setOpenSection(isOpen ? s : null)

	const bidLadderRef = useOpenOnVisible(() => open('bidLadder'))
	const antiSnipeRef = useOpenOnVisible(() => open('antiSnipe'))
	const settlementGraceRef = useOpenOnVisible(() => open('settlementGrace'))
	const trustedMintsRef = useOpenOnVisible(() => open('trustedMints'))
	const oracleRef = useOpenOnVisible(() => open('oracle'))

	const startingBidNum = parseInt(formData.startingBid, 10)
	const bidIncrementNum = parseInt(formData.bidIncrement, 10)
	const reserveNum = parseInt(formData.reserve ?? '0', 10)
	const showBidLadder =
		formData.startingBid !== '' && startingBidNum > 0 && formData.bidIncrement !== '' && bidIncrementNum > 0 && !isNaN(reserveNum)
	const antiSnipeWindowSeconds = formData.antiSnipeWindowMinutes * 60
	const endTimeError = validationMessages.endAt ?? validationMessages.duration ?? validationMessages.startAt

	const effectiveStartSeconds = useMemo(() => {
		if (startMode === 'immediate') return Math.floor(Date.now() / 1000)
		const parsed = formData.startAt ? parseDatetimeLocalSeconds(formData.startAt) : null
		return parsed ?? Math.floor(Date.now() / 1000)
	}, [startMode, formData.startAt])

	const virtualEndSeconds = useMemo(() => {
		if (endMode === 'duration') return effectiveStartSeconds + durationSeconds
		return parseDatetimeLocalSeconds(formData.endAt) ?? 0
	}, [endMode, effectiveStartSeconds, durationSeconds, formData.endAt])

	const virtualDurationSeconds = useMemo(() => {
		if (endMode === 'duration') return durationSeconds
		if (!virtualEndSeconds) return 0
		return Math.max(0, virtualEndSeconds - effectiveStartSeconds)
	}, [endMode, durationSeconds, virtualEndSeconds, effectiveStartSeconds])

	// `max_end_at` preview — when no anti-snipe window is set this equals
	// `end_at` and the curve has zero duration. AUCTIONS.md §6.0.
	const curveMaxEndSeconds = useMemo(() => {
		if (!virtualEndSeconds) return 0
		if (antiSnipeWindowSeconds <= 0) return virtualEndSeconds
		return virtualEndSeconds + antiSnipeWindowSeconds
	}, [virtualEndSeconds, antiSnipeWindowSeconds])

	const handleStartImmediate = () => {
		setStartMode('immediate')
		setFormData((prev) => ({ ...prev, startAt: '' }))
	}

	const handleStartScheduled = () => {
		setStartMode('scheduled')
		setFormData((prev) => (prev.startAt ? prev : { ...prev, startAt: toDatetimeLocal(new Date(Date.now() + 15 * 60 * 1000)) }))
	}

	const handleEndAsDuration = () => {
		setEndMode('duration')
		setFormData((prev) => ({ ...prev, endAt: '' }))
	}

	const handleEndAsAbsolute = () => {
		setEndMode('absolute')
		setFormData((prev) => {
			if (prev.endAt) return prev
			const initial = new Date((effectiveStartSeconds + durationSeconds) * 1000)
			return { ...prev, endAt: toDatetimeLocal(initial) }
		})
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Section order: timing first (start + end), then bidding
			    mechanics (amounts + ladder), then auction-end policy
			    (anti-snipe curve + settlement grace). The curve preview
			    is embedded inside the anti-snipe card so its visual
			    feedback sits next to the inputs that drive it. */}

			<div className="grid w-full gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<div className="flex items-center justify-between gap-2">
					<Label>Start Time</Label>
					<div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
						<button
							type="button"
							onClick={handleStartImmediate}
							className={`px-3 py-1 rounded ${startMode === 'immediate' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Immediate
						</button>
						<button
							type="button"
							onClick={handleStartScheduled}
							className={`px-3 py-1 rounded ${startMode === 'scheduled' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Schedule
						</button>
					</div>
				</div>

				{startMode === 'immediate' ? (
					<p className="text-xs text-zinc-500">The auction goes live the moment you publish.</p>
				) : (
					<DateTimePicker
						value={formData.startAt ?? ''}
						onChange={(next) => setFormData((prev) => ({ ...prev, startAt: next }))}
						placeholder="Pick a start date & time"
					/>
				)}
			</div>

			<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<div className="flex items-center justify-between gap-2">
					<Label>
						<span className="after:content-['*'] after:ml-0.5 after:text-red-500">End Time</span>
					</Label>
					<div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5 text-xs">
						<button
							type="button"
							onClick={handleEndAsDuration}
							className={`px-3 py-1 rounded ${endMode === 'duration' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							Duration
						</button>
						<button
							type="button"
							onClick={handleEndAsAbsolute}
							className={`px-3 py-1 rounded ${endMode === 'absolute' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'}`}
						>
							End date
						</button>
					</div>
				</div>

				{endMode === 'duration' ? (
					<div className="space-y-3">
						<div className="flex flex-wrap gap-1.5">
							{DURATION_PRESETS_SHORTCUT.map((preset) => {
								const isActive = durationSeconds === preset.seconds
								return (
									<button
										key={preset.label}
										type="button"
										onClick={() => {
											const indexSlider = DURATION_PRESETS.findIndex((v) => v.seconds === preset.seconds)
											setInputSliderValue(indexSlider + 1)
											setDurationSeconds(preset.seconds)
										}}
										className={`rounded-full px-3 py-1 text-xs font-semibold border ${
											isActive
												? 'border-secondary bg-secondary text-white'
												: 'border-zinc-300 bg-white text-zinc-700 hover:border-secondary'
										}`}
									>
										{preset.label}
									</button>
								)
							})}
						</div>

						<div>
							<Slider
								min={1}
								max={DURATION_PRESETS.length}
								value={[inputSliderValue]}
								onValueChange={(val) => {
									const sliderValue = val?.at(0)
									if (sliderValue) {
										setInputSliderValue(sliderValue)

										const value = DURATION_PRESETS[sliderValue - 1]
										setDurationSeconds(value.seconds)
									}
								}}
								className="w-full accent-secondary"
							/>
							<div className="flex items-center justify-between text-[10px] text-zinc-500">
								<span>1m</span>
								<span>30d</span>
							</div>
						</div>

						<div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
							<p>
								<span className="font-semibold text-zinc-900">Runs for:</span> {formatDuration(durationSeconds)}
							</p>
							<p className="mt-0.5">
								<span className="font-semibold text-zinc-900">Ends:</span> {formatAbsolute(virtualEndSeconds)}
							</p>
						</div>
						{endTimeError && <p className="text-xs text-red-600">{endTimeError}</p>}
					</div>
				) : (
					<div className="space-y-2">
						<DateTimePicker
							value={formData.endAt}
							onChange={(next) => setFormData((prev) => ({ ...prev, endAt: next }))}
							placeholder="Pick an end date & time"
						/>
						{virtualEndSeconds > 0 && (
							<p className="text-xs text-zinc-500">Runs for approximately {formatDuration(virtualDurationSeconds)}.</p>
						)}
						{endTimeError && <p className="text-xs text-red-600">{endTimeError}</p>}
					</div>
				)}
			</div>

			<div className="grid sm:grid-cols-2 gap-4 items-start">
				<div className="grid w-full gap-1.5">
					<Label htmlFor="auction-starting-bid">
						<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Starting Bid (sats)</span>
					</Label>
					<Input
						id="auction-starting-bid"
						type="number"
						min="0"
						value={formData.startingBid}
						onChange={(e) => setFormData((prev) => ({ ...prev, startingBid: e.target.value }))}
					/>
					{validationMessages.startingBid && <p className="text-xs text-red-600">{validationMessages.startingBid}</p>}
				</div>
				<div className="grid w-full gap-1.5">
					<Label htmlFor="auction-bid-increment">
						<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Bid Increment (sats)</span>
					</Label>
					<Input
						id="auction-bid-increment"
						type="number"
						min="1"
						value={formData.bidIncrement}
						onFocus={(e) => e.target.select()}
						onChange={(e) => setFormData((prev) => ({ ...prev, bidIncrement: e.target.value.replace(/^0+(\d)/, '$1') }))}
					/>
					{validationMessages.bidIncrement && <p className="text-xs text-red-600">{validationMessages.bidIncrement}</p>}
				</div>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-reserve">Reserve (sats)</Label>
				<Input
					id="auction-reserve"
					type="number"
					min="0"
					value={formData.reserve}
					onFocus={(e) => e.target.select()}
					onChange={(e) => setFormData((prev) => ({ ...prev, reserve: e.target.value.replace(/^0+(\d)/, '$1') }))}
				/>
				{validationMessages.reserve && <p className="text-xs text-red-600">{validationMessages.reserve}</p>}
			</div>

			{showBidLadder && (
				<div ref={bidLadderRef}>
					<Collapsible open={openSection === 'bidLadder'} onOpenChange={toggle('bidLadder')}>
						<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
							Bid Ladder
							<ChevronDown className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'bidLadder' ? 'rotate-180' : ''}`} />
						</CollapsibleTrigger>
						<CollapsibleContent className="mt-2">
							<BidLadderViz startingBid={startingBidNum} bidIncrement={bidIncrementNum} reserve={reserveNum} />
						</CollapsibleContent>
					</Collapsible>
				</div>
			)}

			<div ref={antiSnipeRef}>
				<Collapsible open={openSection === 'antiSnipe'} onOpenChange={toggle('antiSnipe')}>
					<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
						Anti-snipe &amp; Curve Settings
						<ChevronDown className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'antiSnipe' ? 'rotate-180' : ''}`} />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<AntiSnipeCurveSettings
							formData={formData}
							setFormData={setFormData}
							startAtSeconds={effectiveStartSeconds}
							endAtSeconds={virtualEndSeconds}
							maxEndAtSeconds={curveMaxEndSeconds}
							settlementGraceSeconds={AUCTION_SETTLEMENT_GRACE_PRESETS[formData.settlementGracePreset]}
							startingBid={startingBidNum}
							bidIncrement={bidIncrementNum}
							reserve={reserveNum}
						/>
					</CollapsibleContent>
				</Collapsible>
			</div>

			<div ref={settlementGraceRef}>
				<Collapsible open={openSection === 'settlementGrace'} onOpenChange={toggle('settlementGrace')}>
					<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
						Settlement Grace
						<ChevronDown
							className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'settlementGrace' ? 'rotate-180' : ''}`}
						/>
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<SettlementGraceSettings formData={formData} setFormData={setFormData} />
					</CollapsibleContent>
				</Collapsible>
			</div>

			<div ref={trustedMintsRef}>
				<Collapsible open={openSection === 'trustedMints'} onOpenChange={toggle('trustedMints')}>
					<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
						Trusted Mints
						<ChevronDown className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'trustedMints' ? 'rotate-180' : ''}`} />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<div className="grid w-full gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-4">
							<p className="text-xs text-zinc-500">
								Bids will be rejected unless the token is minted by one of these mints. At least one is required.
							</p>
							{validationMessages.trustedMints && <p className="text-xs text-red-600">{validationMessages.trustedMints}</p>}

							<div className="space-y-2 mt-1">
								{selectedMints.map((mint) => (
									<div
										key={mint}
										className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
									>
										<span className="truncate text-sm text-zinc-900" title={mint}>
											{mint}
										</span>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => removeMint(mint)}
											disabled={!canRemoveMint}
											className="text-red-600 hover:text-red-700 disabled:opacity-40"
											title={canRemoveMint ? 'Remove mint' : 'At least one mint is required'}
										>
											<X className="w-4 h-4" />
										</Button>
									</div>
								))}
							</div>

							{unselectedMints.length > 0 && (
								<div className="space-y-2 mt-3">
									<p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Add a mint</p>
									{unselectedMints.map((mint) => (
										<button
											key={mint}
											type="button"
											onClick={() => addMint(mint)}
											className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-700 hover:border-secondary"
										>
											<span className="truncate" title={mint}>
												{mint}
											</span>
											<Plus className="w-4 h-4 text-zinc-500 shrink-0" />
										</button>
									))}
								</div>
							)}
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>

			<div ref={oracleRef}>
				<Collapsible open={openSection === 'oracle'} onOpenChange={toggle('oracle')}>
					<CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
						Auction Oracle
						<ChevronDown className={`w-4 h-4 text-zinc-700 transition-transform ${openSection === 'oracle' ? 'rotate-180' : ''}`} />
					</CollapsibleTrigger>
					<CollapsibleContent className="mt-2">
						<AuctionOracleSelector formData={formData} setFormData={setFormData} />
					</CollapsibleContent>
				</Collapsible>
			</div>
		</div>
	)
}

function CategoryTab({
	formData,
	setFormData,
	subCategoryInput,
	setSubCategoryInput,
}: TabProps & { subCategoryInput: string; setSubCategoryInput: Dispatch<SetStateAction<string>> }) {
	return (
		<div className="flex flex-col gap-4">
			<div className="grid w-full gap-1.5">
				<Label>Main Category</Label>
				<Select value={formData.mainCategory} onValueChange={(value) => setFormData((prev) => ({ ...prev, mainCategory: value }))}>
					<SelectTrigger>
						<SelectValue placeholder="Select category" />
					</SelectTrigger>
					<SelectContent>
						{PRODUCT_CATEGORIES.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-sub-categories">Sub Categories (comma or newline separated)</Label>
				<textarea
					id="auction-sub-categories"
					value={subCategoryInput}
					onChange={(e) => setSubCategoryInput(e.target.value)}
					className="border-2 min-h-20 p-2 rounded-md"
					placeholder="Collectibles, Art, Bitcoin"
				/>
			</div>
		</div>
	)
}

function SpecTab({ formData, setFormData }: TabProps) {
	const specs = formData.specs

	const updateSpec = (index: number, field: 'key' | 'value', value: string) => {
		setFormData((prev) => {
			const next = [...prev.specs]
			next[index] = { ...next[index], [field]: value }
			return { ...prev, specs: next }
		})
	}

	const addSpec = () => {
		setFormData((prev) => ({ ...prev, specs: [...prev.specs, { key: '', value: '' }] }))
	}

	const removeSpec = (index: number) => {
		setFormData((prev) => ({ ...prev, specs: prev.specs.filter((_, i) => i !== index) }))
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="space-y-1">
				<Label className="text-base font-medium">Item Specifications</Label>
				<p className="text-sm text-zinc-600">
					Key/value pairs describing the item (e.g. brand, model, condition). Shown on the auction detail page.
				</p>
			</div>

			<div className="space-y-3">
				{specs.map((spec, index) => (
					<div key={index} className="flex gap-2 items-start">
						<Input
							placeholder="Name (e.g. Brand)"
							value={spec.key}
							onChange={(e) => updateSpec(index, 'key', e.target.value)}
							className="flex-1"
						/>
						<Input
							placeholder="Value (e.g. Leica)"
							value={spec.value}
							onChange={(e) => updateSpec(index, 'value', e.target.value)}
							className="flex-1"
						/>
						<Button type="button" variant="outline" size="sm" onClick={() => removeSpec(index)} className="text-red-600 hover:text-red-700">
							<X className="w-4 h-4" />
						</Button>
					</div>
				))}

				<Button type="button" variant="outline" onClick={addSpec} className="w-full flex items-center gap-2">
					<Plus className="w-4 h-4" />
					Add Specification
				</Button>
			</div>
		</div>
	)
}

function ImagesTab({
	images,
	setImages,
	error,
}: {
	images: AuctionImage[]
	setImages: Dispatch<SetStateAction<AuctionImage[]>>
	error?: string
}) {
	const [needsUploader, setNeedsUploader] = useState(true)

	const handleSaveImage = ({ url, index }: { url: string; index: number }) => {
		if (index >= 0) {
			setImages((prev) => {
				const next = [...prev]
				next[index] = { ...next[index], imageUrl: url }
				return next
			})
		} else {
			setImages((prev) => [...prev, { imageUrl: url, imageOrder: prev.length }])
			setNeedsUploader(true)
		}
	}

	const handleDeleteImage = (index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index).map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handlePromoteImage = (index: number) => {
		if (index <= 0) return
		setImages((prev) => {
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index - 1]
			next[index - 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	const handleDemoteImage = (index: number) => {
		setImages((prev) => {
			if (index >= prev.length - 1) return prev
			const next = [...prev]
			const tmp = next[index]
			next[index] = next[index + 1]
			next[index + 1] = tmp
			return next.map((img, i) => ({ ...img, imageOrder: i }))
		})
	}

	return (
		<div className="space-y-4">
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>

			<div className="flex flex-col gap-4">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Image Upload</span>
					<span className="sr-only">required</span>
					{error && <span className="text-sm text-red-500 ml-2">({error})</span>}
				</Label>

				{images.map((image, i) => (
					<ImageUploader
						key={i}
						src={image.imageUrl}
						index={i}
						imagesLength={images.length}
						onSave={handleSaveImage}
						onDelete={handleDeleteImage}
						onPromote={handlePromoteImage}
						onDemote={handleDemoteImage}
					/>
				))}

				{needsUploader && (
					<ImageUploader
						src={null}
						index={-1}
						imagesLength={0}
						onSave={handleSaveImage}
						onDelete={() => setNeedsUploader(false)}
						initialUrl=""
					/>
				)}
			</div>
		</div>
	)
}

type AvailableShipping = {
	id: string
	name: string
	price: string
	currency: string
	service: string
	carrier: string | undefined
}

function ShippingTab({
	formData,
	setFormData,
	userPubkey,
	shippingExtraCostErrors,
}: TabProps & { userPubkey: string; shippingExtraCostErrors: Record<number, string> }) {
	const shippingOptionsQuery = useShippingOptionsByPubkey(userPubkey)

	const availableShippingOptions = useMemo<AvailableShipping[]>(() => {
		if (!shippingOptionsQuery.data || !userPubkey) return []
		return shippingOptionsQuery.data
			.filter((event) => {
				const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1]
				return dTag ? !isShippingDeleted(dTag, event.created_at) : true
			})
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || !info.id.trim()) return null
				return {
					id: createShippingReference(userPubkey, info.id),
					name: info.title,
					price: info.price.amount,
					currency: info.price.currency,
					service: info.service || '',
					carrier: info.carrier,
				}
			})
			.filter((opt): opt is AvailableShipping => opt !== null)
	}, [shippingOptionsQuery.data, userPubkey])

	const selections = useMemo<ProductShippingSelection[]>(() => normalizeProductShippingSelections(formData.shippings), [formData.shippings])

	const selectionsWithOption = useMemo(
		() =>
			selections.map((selection) => ({
				selection,
				option: availableShippingOptions.find((option) => option.id === selection.shippingRef) ?? null,
			})),
		[selections, availableShippingOptions],
	)

	const updateSelections = (next: ProductShippingSelection[]) => {
		setFormData((prev) => ({ ...prev, shippings: next }))
	}

	const addShipping = (option: AvailableShipping) => {
		if (selections.some((s) => s.shippingRef === option.id)) return
		updateSelections([...selections, { shippingRef: option.id, extraCost: '' }])
	}

	const removeShipping = (index: number) => {
		updateSelections(selections.filter((_, i) => i !== index))
	}

	const updateExtraCost = (index: number, extraCost: string) => {
		const next = [...selections]
		next[index] = { ...next[index], extraCost }
		updateSelections(next)
	}

	const unselectedOptions = availableShippingOptions.filter((option) => !selections.some((s) => s.shippingRef === option.id))

	return (
		<div className="flex flex-col gap-6">
			<div className="space-y-1">
				<Label className="text-base font-medium">Shipping Options</Label>
				<p className="text-sm text-zinc-600">Attach the shipping options buyers can choose from after winning this auction.</p>
			</div>

			{selections.length > 0 && (
				<div className="space-y-3">
					<h3 className="text-sm font-semibold">Attached</h3>
					{selectionsWithOption.map(({ selection, option }, index) => (
						<div key={`${selection.shippingRef}-${index}`} className="rounded-lg border border-zinc-200 bg-white p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<p className="font-medium text-zinc-900 truncate">{option?.name ?? 'Unknown shipping option'}</p>
									<p className="text-xs text-zinc-500 break-all">{selection.shippingRef}</p>
									{option && (
										<p className="text-xs text-zinc-600 mt-1">
											Base: {option.price} {option.currency}
											{option.service ? ` · ${option.service}` : ''}
											{option.carrier ? ` · ${option.carrier}` : ''}
										</p>
									)}
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => removeShipping(index)}
									className="text-red-600 hover:text-red-700"
								>
									<X className="w-4 h-4" />
								</Button>
							</div>
							<div className="mt-3 grid gap-1.5">
								<Label htmlFor={`auction-shipping-extra-${index}`} className="text-xs text-zinc-600">
									Extra cost (sats, optional)
								</Label>
								<Input
									id={`auction-shipping-extra-${index}`}
									type="number"
									min="0"
									placeholder="0"
									value={selection.extraCost}
									onChange={(e) => updateExtraCost(index, e.target.value)}
								/>
								{shippingExtraCostErrors[index] && <p className="text-xs text-red-600">{shippingExtraCostErrors[index]}</p>}
							</div>
						</div>
					))}
				</div>
			)}

			<div className="space-y-3">
				<h3 className="text-sm font-semibold">Available</h3>
				{!userPubkey ? (
					<p className="text-sm text-zinc-500">Connect your wallet to load your shipping options.</p>
				) : shippingOptionsQuery.isLoading ? (
					<p className="text-sm text-zinc-500">Loading shipping options...</p>
				) : availableShippingOptions.length === 0 ? (
					<div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
						You don&apos;t have any shipping options yet. Create some from the{' '}
						<a href="/dashboard/products/shipping-options" className="text-secondary underline">
							shipping options
						</a>{' '}
						page, then come back here.
					</div>
				) : unselectedOptions.length === 0 ? (
					<p className="text-sm text-zinc-500">All of your shipping options are already attached.</p>
				) : (
					<div className="space-y-2">
						{unselectedOptions.map((option) => (
							<button
								key={option.id}
								type="button"
								onClick={() => addShipping(option)}
								className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left hover:border-secondary"
							>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-zinc-900 truncate">{option.name}</p>
									<p className="text-xs text-zinc-600">
										{option.price} {option.currency}
										{option.service ? ` · ${option.service}` : ''}
										{option.carrier ? ` · ${option.carrier}` : ''}
									</p>
								</div>
								<Plus className="w-4 h-4 text-zinc-500" />
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export function AuctionFormContent() {
	const navigate = useNavigate()
	const publishMutation = usePublishAuctionMutation()
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''
	const appStage = useStore(configStore, (state) => state.config.stage)
	const walletDevMode = appStage === 'staging' || isNip60WalletDevModeEnabled()

	const availableMints = useMemo(
		() => Array.from(new Set([...DEFAULT_TRUSTED_MINTS, ...(walletDevMode ? NIP60_DEV_TEST_MINTS : [])])),
		[walletDevMode],
	)

	const prevAvailableMintsRef = useRef(availableMints)
	const userRemovedMintsRef = useRef<Set<string>>(new Set())

	const setUserRemovedMints = (next: Set<string>) => {
		userRemovedMintsRef.current = next
	}

	useEffect(() => {
		const prev = prevAvailableMintsRef.current
		if (prev === availableMints) return

		setFormData((prevForm) => ({
			...prevForm,
			trustedMints: syncMintSelection(prev, availableMints, prevForm.trustedMints, userRemovedMintsRef.current),
		}))

		prevAvailableMintsRef.current = availableMints
	}, [availableMints])

	const [formData, setFormData] = useState<AuctionFormData>(() => ({ ...INITIAL_FORM, trustedMints: [...availableMints] }))
	const [images, setImages] = useState<AuctionImage[]>([])
	const [activeTab, setActiveTab] = useState<AuctionTab>('name')
	const [subCategoryInput, setSubCategoryInput] = useState('')
	const [startMode, setStartMode] = useState<StartMode>('immediate')
	const [endMode, setEndMode] = useState<EndMode>('duration')
	const [durationSeconds, setDurationSeconds] = useState<number>(24 * 60 * 60)

	const buildPublishFormData = (nowSeconds: number): AuctionFormData => {
		const effectiveStartAt = startMode === 'immediate' ? '' : (formData.startAt ?? '')
		let effectiveEndAt = formData.endAt
		if (endMode === 'duration') {
			const parsedStart = formData.startAt ? parseDatetimeLocalSeconds(formData.startAt) : null
			const startSeconds = startMode === 'immediate' ? nowSeconds : (parsedStart ?? nowSeconds)
			effectiveEndAt = toDatetimeLocal(new Date((startSeconds + durationSeconds) * 1000))
		}

		return {
			...formData,
			startAt: effectiveStartAt,
			endAt: effectiveEndAt,
			imageUrls: images
				.slice()
				.sort((a, b) => a.imageOrder - b.imageOrder)
				.map((img) => img.imageUrl)
				.filter((url) => url.trim().length > 0),
			categories: parseListInput(subCategoryInput),
			specs: formData.specs.filter((spec: AuctionSpecEntry) => spec.key.trim() && spec.value.trim()),
		}
	}

	const validationNowSeconds = Math.floor(Date.now() / 1000)
	const validationIssues = getAuctionPublishValidationIssues(buildPublishFormData(validationNowSeconds), {
		nowSeconds: validationNowSeconds,
		minDurationSeconds: AUCTION_MIN_DURATION_SECONDS,
	})
	const validationMessages = toValidationMessages(validationIssues)
	const shippingExtraCostErrors = toIndexedValidationMessages(validationIssues, 'shippingExtraCost')

	const hasValidName = !validationMessages.title
	const hasValidDescription = !validationMessages.description
	const hasValidBidding =
		!validationMessages.startingBid &&
		!validationMessages.bidIncrement &&
		!validationMessages.reserve &&
		!validationMessages.startAt &&
		!validationMessages.endAt &&
		!validationMessages.duration &&
		!validationMessages.antiSnipeWindowMinutes &&
		!validationMessages.minBidCurveShape &&
		!validationMessages.minBidCurvePeakMultiplier &&
		!validationMessages.settlementGracePreset
	const hasValidImages = !validationMessages.imageUrls
	const hasValidMints = !validationMessages.trustedMints

	const canSubmit = validationIssues.length === 0

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		event.stopPropagation()

		const nowSeconds = Math.floor(Date.now() / 1000)
		const nextFormData = buildPublishFormData(nowSeconds)

		try {
			validateAuctionPublishInput(nextFormData, { nowSeconds, minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })
			const publishedEventId = await publishMutation.mutateAsync(nextFormData)
			if (!publishedEventId) return

			document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			navigate({ to: '/auctions' })
		} catch (error) {
			console.error('Failed to submit auction form:', error)
		}
	}

	const tabs: { value: AuctionTab; label: string; showAsterisk: boolean }[] = [
		{ value: 'name', label: 'Name', showAsterisk: !hasValidName || !hasValidDescription },
		{ value: 'auction', label: 'Auction', showAsterisk: !hasValidBidding || !hasValidMints },
		{ value: 'category', label: 'Category', showAsterisk: false },
		{ value: 'spec', label: 'Spec', showAsterisk: false },
		{ value: 'images', label: 'Images', showAsterisk: !hasValidImages },
		{ value: 'shipping', label: 'Shipping', showAsterisk: Object.keys(shippingExtraCostErrors).length > 0 },
	]

	return (
		<form onSubmit={handleSubmit} className="flex flex-col h-full mt-4">
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden max-h-[calc(100vh-200px)]">
				<Tabs
					value={activeTab}
					onValueChange={(value) => setActiveTab(value as AuctionTab)}
					className="w-full flex flex-col flex-1 min-h-0 overflow-hidden"
				>
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						{tabs.map((tab) => (
							<TabsTrigger
								key={tab.value}
								value={tab.value}
								className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							>
								{tab.label}
								{tab.showAsterisk && <span className="ml-1 text-red-500">*</span>}
							</TabsTrigger>
						))}
					</TabsList>

					<div className="flex-1 overflow-y-auto min-h-0 pr-1">
						<TabsContent value="name" className="mt-4">
							<NameTab formData={formData} setFormData={setFormData} />
						</TabsContent>
						<TabsContent value="auction" className="mt-4">
							<AuctionTabContent
								formData={formData}
								setFormData={setFormData}
								availableMints={availableMints}
								startMode={startMode}
								setStartMode={setStartMode}
								endMode={endMode}
								setEndMode={setEndMode}
								durationSeconds={durationSeconds}
								setDurationSeconds={setDurationSeconds}
								validationMessages={validationMessages}
								userRemovedMints={userRemovedMintsRef.current}
								onUserRemovedMintsChange={setUserRemovedMints}
							/>
						</TabsContent>
						<TabsContent value="category" className="mt-4">
							<CategoryTab
								formData={formData}
								setFormData={setFormData}
								subCategoryInput={subCategoryInput}
								setSubCategoryInput={setSubCategoryInput}
							/>
						</TabsContent>
						<TabsContent value="spec" className="mt-4">
							<SpecTab formData={formData} setFormData={setFormData} />
						</TabsContent>
						<TabsContent value="images" className="mt-4">
							<ImagesTab images={images} setImages={setImages} error={validationMessages.imageUrls} />
						</TabsContent>
						<TabsContent value="shipping" className="mt-4">
							<ShippingTab
								formData={formData}
								setFormData={setFormData}
								userPubkey={userPubkey}
								shippingExtraCostErrors={shippingExtraCostErrors}
							/>
						</TabsContent>
					</div>
				</Tabs>
			</div>

			<div className="bg-white border-t pt-4 pb-2 mt-2">
				<Button type="submit" variant="secondary" className="w-full uppercase" disabled={!canSubmit || publishMutation.isPending}>
					{publishMutation.isPending ? 'Publishing...' : 'Publish Auction'}
				</Button>
			</div>
		</form>
	)
}
