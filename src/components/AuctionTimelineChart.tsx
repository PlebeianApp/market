import React, { useEffect, useState } from 'react'
import {
	ScatterChart,
	Scatter,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ReferenceLine,
	ReferenceArea,
	ResponsiveContainer,
	Label,
	type ScatterShapeProps,
} from 'recharts'
import type { LabelPosition } from 'recharts/types/component/Label'
import { UserCard } from './UserCard'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { getBidAmount } from '@/queries/auctions'
import {
	getAuctionStartAt,
	getAuctionEndAt,
	getAuctionStartingBid,
	getAuctionReserve,
	getAuctionMaxEndAt,
	getAuctionSettlementGrace,
} from '@/queries/auctions'

// Function to generate color from pubkey
const getPubkeyColor = (pubkey: string) => {
	if (!pubkey) return '#3b82f6' // default blue
	return '#' + pubkey.slice(0, 6)
}

// ============================================
// CUSTOM SHAPE COMPONENT: "LOLLIPOP BAR"
// Draws a thick vertical line (bar) + a circle (dot) at the top.
// ============================================
type CustomBarShapeProps = ScatterShapeProps & {
	payload?: {
		pubkey?: string
	}
	isGhost: boolean
	containerHeight: number
}

const CustomBarShape = (props: CustomBarShapeProps) => {
	if (props.isGhost) {
		return <g></g>
	}

	const { cx, cy } = props
	const pubkey = props.payload?.pubkey
	const fill = getPubkeyColor(pubkey)

	if (!cx || !cy) return null

	// Calculate bottomY based on the actual chart height
	const bottomY = props.containerHeight - cy + (props.y ?? 0) - 52 // Formula to get exact bottom of chart regardless of containerHeight (don't ask why)

	return (
		<g>
			{/* The Stem */}
			<line x1={cx} y1={cy} x2={cx} y2={bottomY} stroke={fill || '#3b82f6'} strokeWidth={14} strokeLinecap="round" opacity={0.9} />
			{/* The Dot */}
			<circle cx={cx} cy={cy} r={6} fill={fill || '#3b82f6'} stroke="#ffffff" strokeWidth={2} />
		</g>
	)
}

// ============================================
// TOOLTIP
// ============================================

const CustomTooltip = ({ active, payload }: any) => {
	if (!active || !payload?.length) return null
	const data = payload[0].payload
	if (!data) return null

	const dateStr = new Date(data.x).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

	return (
		<div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-40 z-50">
			{data.pubkey && (
				<div className="mb-2">
					<UserCard pubkey={data.pubkey} size="sm" subtitle="none" onPress="profile" />
				</div>
			)}
			<p className="text-xs text-foreground mb-1">{dateStr}</p>
			<p className="font-semibold text-secondary">{data.y.toLocaleString()} sats</p>
		</div>
	)
}

// ============================================
// CUSTOM TICK FORMATTERS
// ============================================

// Function to round to nearest number with 2 significant figures
const roundToSignificantFigures = (num: number): number => {
	if (num === 0) return 0

	const magnitude = Math.floor(Math.log10(Math.abs(num)))
	const factor = Math.pow(10, 2 - magnitude - 1)
	return Math.round(num * factor) / factor
}

const formatXAxisTick = (timestamp: number, auctionStart: number, refundTime: number) => {
	// Only show times within the auction period
	if (timestamp < auctionStart || timestamp > refundTime) return ''

	const date = new Date(timestamp)

	return date.toLocaleTimeString('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	})
}

const formatYAxisTick = (value: number) => {
	// Round to 2 significant figures first
	const roundedValue = roundToSignificantFigures(value)

	// Format large numbers with K (thousands) or M (millions) suffixes
	if (roundedValue >= 1000000) {
		return `${(roundedValue / 1000000).toFixed(1)}M`
	}
	if (roundedValue >= 1000) {
		return `${(roundedValue / 1000).toFixed(1)}K`
	}

	// For small numbers round to 2 significant figures
	if (roundedValue < 100) {
		return roundToSignificantFigures(roundedValue).toString()
	}

	return roundedValue.toString()
}

// Function to generate nice rounded values for Y axis based on requirements:
// - Starting bid should be at ~5% from bottom
// - Max bid/reserve should be at ~70% of height
// - If no bids/reserve, starting bid should have ~60% above it
const generateYAxisConfig = (startingBid: number, reserve: number, bids: Array<{ y: number }>) => {
	const allBidValues = bids.map((b) => b.y)
	const hasBids = allBidValues.length > 0
	const maxBid = hasBids ? Math.max(...allBidValues) : 0
	const maxBidOrReserve = reserve > 0 ? Math.max(reserve, maxBid) : maxBid

	// Ensure we have a minimum range to prevent log10(0) issues
	const minRange = Math.max(5000, startingBid * 0.1) // At least 5000 or 10% of starting bid

	// If we have max bid or reserve, position starting bid at 5% from bottom and max at 70% height
	if (maxBidOrReserve > 0) {
		// Calculate the total range needed to position starting bid at 5% and max at 70%
		const rangeNeeded = Math.max((maxBidOrReserve - startingBid) / 0.65, minRange) // 65% between 5% and 70%
		const actualMin = minRange - rangeNeeded * 0.05 // 5% margin below starting bid
		const actualMax = actualMin + rangeNeeded

		return { yMin: actualMin, yMax: actualMax, hasDefinedRange: true }
	}

	// If no bids/reserve, position starting bid with 60% above it
	const rangeNeeded = Math.max(startingBid / 0.4, minRange) // 40% below to give 60% above, with minimum
	const actualMin = 0
	const actualMax = actualMin + rangeNeeded

	return { yMin: actualMin, yMax: actualMax, hasDefinedRange: false }
}
// Function to generate ticks with 2 significant figures, including below starting bid
const generateYTicks = (yMin: number, yMax: number, count: number = 12): number[] => {
	const ticks: number[] = []

	// Calculate tick spacing based on the full range
	const range = yMax - yMin
	const tickSpacing = range / (count - 1)

	// Round tick spacing to nice intervals with 2 significant figures
	const magnitude = Math.pow(10, Math.floor(Math.log10(tickSpacing)))
	let tickStep = tickSpacing / magnitude

	// Choose nice step sizes
	if (tickStep <= 1) tickStep = 1
	else if (tickStep <= 2) tickStep = 2
	else if (tickStep <= 5) tickStep = 5
	else tickStep = 10

	tickStep *= magnitude
	const roundedTickStep = roundToSignificantFigures(tickStep)

	// Generate ticks starting from the bottom
	let currentTick = Math.floor(yMin / roundedTickStep) * roundedTickStep

	// Generate ticks across the entire range
	while (currentTick <= yMax && ticks.length < count * 2) {
		// Only add if it's within our domain and not a duplicate
		if (currentTick >= yMin && currentTick <= yMax) {
			const roundedTick = roundToSignificantFigures(currentTick)
			if (!ticks.includes(roundedTick)) {
				ticks.push(roundedTick)
			}
		}
		currentTick += roundedTickStep
	}

	// Sort and limit to count
	return ticks
		.sort((a, b) => a - b)
		.filter((tick, index) => index < count)
		.filter((tick) => tick >= yMin && tick <= yMax)
}

// ============================================
// MAIN COMPONENT
// ============================================

interface AuctionTimelineChartProps {
	bids: NDKEvent[]
	auction: NDKEvent
}

interface VerticalLineMarker {
	label: string
	ts: number
	color: string
	position?: LabelPosition
}

interface HorizontalLineMarker {
	label: string
	val: number
	color: string
	position?: LabelPosition
}

export default function AuctionTimelineChart({ bids, auction }: AuctionTimelineChartProps) {
	// Extract auction data
	const startAt = getAuctionStartAt(auction)
	const endAt = getAuctionEndAt(auction)
	const startingBid = getAuctionStartingBid(auction)
	const reserve = getAuctionReserve(auction)
	const maxEndAt = getAuctionMaxEndAt(auction)
	const displayedMaxEndAt = maxEndAt >= endAt ? maxEndAt : endAt
	const refundTime = displayedMaxEndAt + getAuctionSettlementGrace(auction)

	// Transform bids to chart data format
	const chartBids = bids.map((bid) => ({
		x: (bid.created_at || 0) * 1000,
		y: getBidAmount(bid),
		pubkey: bid.pubkey,
		id: bid.id,
	}))

	const containerHeight = 500 // 500 px
	const containerMargin = 25 // 40 px

	const displayData =
		chartBids.length > 0
			? // Inject container height for context
				chartBids.map((data) => ({ ...data, containerHeight: containerHeight - containerMargin * 2 }))
			: [
					{
						x: startAt * 1000 + (refundTime * 1000 - startAt * 1000) / 2, // Center time
						y: startingBid,
						id: 'ghost',
						name: 'No Bids Yet',
						isGhost: true, // Custom flag
					},
				]

	// State for current time
	const [currentTime, setCurrentTime] = useState(Date.now())

	// Update current time every minute
	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentTime(Date.now())
		}, 60000) // Update every minute

		return () => clearInterval(timer)
	}, [])

	// Calculate 5% margin for x-axis
	const totalTimeSpan = refundTime * 1000 - startAt * 1000
	const margin = totalTimeSpan * 0.05

	const xMin = startAt * 1000 - margin
	const xMax = refundTime * 1000 + margin

	// Determine y-axis boundaries based on requirements
	const yAxisConfig = generateYAxisConfig(startingBid, reserve, chartBids)
	const { yMin, yMax } = yAxisConfig

	// Generate Y-axis ticks
	const yTicks = generateYTicks(yMin, yMax, 12)

	// Build vertical markers based on conditions
	const verticalMarkers: VerticalLineMarker[] = [
		{ label: 'Start', ts: startAt * 1000, color: '#94a3b8', position: 'insideTopRight' },
		{ label: 'Refund', ts: refundTime * 1000, color: '#22c55e' },
	]

	// Handle different end timing scenarios:
	// 1. When max_end_at > end_at, end_at starts the anti-snipe ramp and
	//    max_end_at is the fixed auction end.
	// 2. Otherwise, show only one "Auction End" at the bidding cutoff.

	const hasAntiSnipeWindow = maxEndAt > endAt

	if (hasAntiSnipeWindow) {
		verticalMarkers.push({ label: 'Anti-snipe begins', ts: endAt * 1000, color: '#ef4444', position: 'insideTopRight' })
		verticalMarkers.push({ label: 'Auction End', ts: maxEndAt * 1000, color: '#ef4444', position: 'insideTopRight' })
	} else if (displayedMaxEndAt > 0) {
		verticalMarkers.push({ label: 'Auction End', ts: displayedMaxEndAt * 1000, color: '#ef4444', position: 'insideTopRight' })
	}

	// Add current time marker if it's within the auction period
	const isCurrentTimeVisible = currentTime >= xMin && currentTime <= xMax
	if (isCurrentTimeVisible) {
		verticalMarkers.push({ label: 'Now', ts: currentTime, color: '#8b5cf6', position: 'insideLeft' })
	}

	// Build horizontal markers - always include starting bid
	const horizontalMarkers: HorizontalLineMarker[] = []

	if (startingBid > 0) {
		horizontalMarkers.push({
			label: `Starting Bid (${startingBid.toLocaleString()} sats)`,
			val: startingBid,
			color: '#f59e0b',
			position: 'insideBottomLeft',
		})
	}

	// Only add reserve if it exists and is greater than 0
	if (reserve > 0) {
		horizontalMarkers.push({
			label: `Reserve (${reserve.toLocaleString()} sats)`,
			val: reserve,
			color: '#ef4444',
			position: 'insideBottomLeft',
		})
	}

	const settlementStart = displayedMaxEndAt * 1000
	const settlementEnd = refundTime * 1000

	// Generate custom ticks for x-axis
	const generateXTicks = () => {
		const ticks = []
		const tickCount = 12 // Number of ticks to display
		const interval = (refundTime * 1000 - startAt * 1000) / (tickCount - 1)

		for (let i = 0; i < tickCount; i++) {
			ticks.push(startAt * 1000 + interval * i)
		}

		// Ensure the last tick is exactly the end time
		ticks[ticks.length - 1] = refundTime * 1000

		return ticks
	}

	return (
		<div className="w-full h-125">
			<ResponsiveContainer width="100%" height="100%">
				<ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

					<XAxis
						type="number"
						dataKey="x"
						domain={[xMin, xMax]}
						ticks={generateXTicks()}
						tickFormatter={(ts) => formatXAxisTick(ts, startAt * 1000, refundTime * 1000)}
						angle={-45}
						textAnchor="end"
						height={70}
						tick={{ fontSize: 11, fill: '#6b7280' }}
					/>

					<YAxis
						type="number"
						domain={[yMin, yMax]}
						ticks={yTicks}
						tickFormatter={formatYAxisTick}
						width={70}
						tick={{ fontSize: 11, fill: '#6b7280' }}
						unit=" sats"
					/>

					{/* SCATTER WITH CUSTOM SHAPE */}
					<Scatter
						name="Bids"
						data={displayData}
						dataKey="y"
						shape={<CustomBarShape />}
						fill="#3b82f6"
						isAnimationActive={false}
						animationDuration={800}
					/>

					{/* 2. Conditionally Render the "No bids yet" text */}
					{chartBids.length === 0 && <Label position="center">No bids yet</Label>}

					{/* Anti-snipe Window Area */}
					{hasAntiSnipeWindow && (
						<ReferenceArea
							x1={endAt * 1000}
							x2={maxEndAt * 1000}
							fill="#06b6d4"
							fillOpacity={0.15}
							stroke="#06b6d4"
							strokeDasharray="4 4"
							label={{ position: 'center', value: 'Anti-snipe Window', fill: '#06b6d4', fontSize: 11, fontWeight: 600, angle: 45 }}
						/>
					)}

					{/* Settlement Window Area */}
					<ReferenceArea
						x1={settlementStart}
						x2={settlementEnd}
						fill="#8b5cf6"
						fillOpacity={0.15}
						stroke="#8b5cf6"
						strokeDasharray="4 4"
						label={{
							position: 'center',
							value: 'Settlement Window',
							fill: '#7c3aed',
							fontSize: 11,
							fontWeight: 600,
							angle: 45,
						}}
					/>

					{/* Vertical Lines */}
					{verticalMarkers.map((m, i) => (
						<ReferenceLine
							key={`v-${i}`}
							x={m.ts}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'insideTopLeft', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					{/* Horizontal Lines */}
					{horizontalMarkers.map((m, i) => (
						<ReferenceLine
							key={`h-${i}`}
							y={m.val}
							stroke={m.color}
							strokeDasharray="4 4"
							label={{ position: m.position ?? 'left', value: m.label, fill: m.color, fontSize: 11, fontWeight: 600 }}
						/>
					))}

					<Tooltip
						content={<CustomTooltip />}
						cursor={{ stroke: '#9ca3af', strokeDasharray: '3 3' }}
						wrapperStyle={{ outline: 'none' }}
						isAnimationActive={false}
					/>
				</ScatterChart>
			</ResponsiveContainer>
		</div>
	)
}
