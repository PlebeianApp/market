import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
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
import { DEFAULT_TRUSTED_MINTS, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { configStore } from '@/lib/stores/config'
import { isNip60WalletDevModeEnabled, NIP60_DEV_TEST_MINTS } from '@/lib/stores/nip60'
import { normalizeProductShippingSelections, type ProductShippingSelection } from '@/lib/utils/productShippingSelections'
import { usePublishAuctionMutation, type AuctionFormData, type AuctionSpecEntry } from '@/publish/auctions'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { CalendarIcon, Plus, X } from 'lucide-react'
import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

type AuctionImage = { imageUrl: string; imageOrder: number }

type AuctionTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping'
type ValidationMessages = Partial<Record<AuctionPublishValidationField, string>>

const INITIAL_FORM: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: '1',
	reserve: '0',
	startAt: '',
	endAt: '',
	antiSnipingEnabled: false,
	antiSnipingWindowSeconds: '300',
	antiSnipingExtensionSeconds: '300',
	antiSnipingMaxExtensions: '12',
	mainCategory: '',
	categories: [],
	imageUrls: [],
	specs: [],
	shippings: [],
	trustedMints: [],
	isNSFW: false,
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

const DURATION_PRESETS: { label: string; seconds: number }[] = [
	{ label: '1h', seconds: 3600 },
	{ label: '6h', seconds: 6 * 3600 },
	{ label: '1d', seconds: 86400 },
	{ label: '3d', seconds: 3 * 86400 },
	{ label: '7d', seconds: 7 * 86400 },
	{ label: '14d', seconds: 14 * 86400 },
	{ label: '30d', seconds: 30 * 86400 },
]

const MIN_DURATION_HOURS = 1
const MAX_DURATION_HOURS = 30 * 24

function pad2(n: number): string {
	return n.toString().padStart(2, '0')
}

function toDatetimeLocal(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
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
}: TabProps & {
	availableMints: readonly string[]
	startMode: StartMode
	setStartMode: Dispatch<SetStateAction<StartMode>>
	endMode: EndMode
	setEndMode: Dispatch<SetStateAction<EndMode>>
	durationSeconds: number
	setDurationSeconds: Dispatch<SetStateAction<number>>
	validationMessages: ValidationMessages
}) {
	const selectedMints = formData.trustedMints
	const unselectedMints = availableMints.filter((mint) => !selectedMints.includes(mint))
	const canRemoveMint = selectedMints.length > 1

	const removeMint = (mint: string) => {
		if (!canRemoveMint) return
		setFormData((prev) => ({ ...prev, trustedMints: prev.trustedMints.filter((m) => m !== mint) }))
	}

	const addMint = (mint: string) => {
		if (selectedMints.includes(mint)) return
		setFormData((prev) => ({ ...prev, trustedMints: [...prev.trustedMints, mint] }))
	}

	const startingBidNum = parseInt(formData.startingBid, 10)
	const bidIncrementNum = parseInt(formData.bidIncrement, 10)
	const reserveNum = parseInt(formData.reserve, 10)
	const antiSnipingWindowSeconds = parseInt(formData.antiSnipingWindowSeconds, 10)
	const antiSnipingExtensionSeconds = parseInt(formData.antiSnipingExtensionSeconds, 10)
	const antiSnipingMaxExtensions = parseInt(formData.antiSnipingMaxExtensions, 10)
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

	const antiSnipingHardStopSeconds = useMemo(() => {
		if (!formData.antiSnipingEnabled) return 0
		if (!virtualEndSeconds) return 0
		if (!Number.isFinite(antiSnipingExtensionSeconds) || antiSnipingExtensionSeconds <= 0) return 0
		if (!Number.isFinite(antiSnipingMaxExtensions) || antiSnipingMaxExtensions <= 0) return 0
		return virtualEndSeconds + antiSnipingExtensionSeconds * antiSnipingMaxExtensions
	}, [formData.antiSnipingEnabled, virtualEndSeconds, antiSnipingExtensionSeconds, antiSnipingMaxExtensions])

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

	const durationHours = Math.max(MIN_DURATION_HOURS, Math.round(durationSeconds / 3600))

	return (
		<div className="flex flex-col gap-4">
			<div className="grid sm:grid-cols-2 gap-4">
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
						onChange={(e) => setFormData((prev) => ({ ...prev, bidIncrement: e.target.value }))}
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
					onChange={(e) => setFormData((prev) => ({ ...prev, reserve: e.target.value }))}
				/>
				{validationMessages.reserve && <p className="text-xs text-red-600">{validationMessages.reserve}</p>}
			</div>

			<BidLadderViz startingBid={startingBidNum} bidIncrement={bidIncrementNum} reserve={reserveNum} />

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
							{DURATION_PRESETS.map((preset) => {
								const isActive = durationSeconds === preset.seconds
								return (
									<button
										key={preset.label}
										type="button"
										onClick={() => setDurationSeconds(preset.seconds)}
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
							<input
								type="range"
								min={MIN_DURATION_HOURS}
								max={MAX_DURATION_HOURS}
								step={1}
								value={durationHours}
								onChange={(e) => setDurationSeconds(parseInt(e.target.value, 10) * 3600)}
								className="w-full accent-secondary"
							/>
							<div className="flex items-center justify-between text-[10px] text-zinc-500">
								<span>1h</span>
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

			<div className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4">
				<div className="flex items-start gap-3">
					<Checkbox
						id="auction-anti-sniping"
						checked={formData.antiSnipingEnabled}
						onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, antiSnipingEnabled: checked === true }))}
						className="mt-0.5"
					/>
					<div className="space-y-1">
						<Label htmlFor="auction-anti-sniping" className="cursor-pointer">
							Bounded anti-sniping
						</Label>
						<p className="text-xs text-zinc-500">
							Extend the auction when a valid bid lands near the end, but cap the total extension so bidders know the worst-case lockup.
						</p>
					</div>
				</div>

				{formData.antiSnipingEnabled && (
					<>
						<div className="grid gap-3 sm:grid-cols-3">
							<div className="grid w-full gap-1.5">
								<Label htmlFor="auction-anti-sniping-window">Window (seconds)</Label>
								<Input
									id="auction-anti-sniping-window"
									type="number"
									min="1"
									value={formData.antiSnipingWindowSeconds}
									onChange={(e) => setFormData((prev) => ({ ...prev, antiSnipingWindowSeconds: e.target.value }))}
								/>
								{validationMessages.antiSnipingWindowSeconds && (
									<p className="text-xs text-red-600">{validationMessages.antiSnipingWindowSeconds}</p>
								)}
							</div>
							<div className="grid w-full gap-1.5">
								<Label htmlFor="auction-anti-sniping-extension">Extension (seconds)</Label>
								<Input
									id="auction-anti-sniping-extension"
									type="number"
									min="1"
									value={formData.antiSnipingExtensionSeconds}
									onChange={(e) => setFormData((prev) => ({ ...prev, antiSnipingExtensionSeconds: e.target.value }))}
								/>
								{validationMessages.antiSnipingExtensionSeconds && (
									<p className="text-xs text-red-600">{validationMessages.antiSnipingExtensionSeconds}</p>
								)}
							</div>
							<div className="grid w-full gap-1.5">
								<Label htmlFor="auction-anti-sniping-max-extensions">Max extensions</Label>
								<Input
									id="auction-anti-sniping-max-extensions"
									type="number"
									min="1"
									value={formData.antiSnipingMaxExtensions}
									onChange={(e) => setFormData((prev) => ({ ...prev, antiSnipingMaxExtensions: e.target.value }))}
								/>
								{validationMessages.antiSnipingMaxExtensions && (
									<p className="text-xs text-red-600">{validationMessages.antiSnipingMaxExtensions}</p>
								)}
							</div>
						</div>

						<div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
							<p>
								<span className="font-semibold text-zinc-900">Rule:</span>{' '}
								{Number.isFinite(antiSnipingWindowSeconds) && antiSnipingWindowSeconds > 0
									? `extend by ${antiSnipingExtensionSeconds || 0}s when a bid arrives in the last ${antiSnipingWindowSeconds}s.`
									: 'Enter a valid anti-sniping window.'}
							</p>
							<p className="mt-0.5">
								<span className="font-semibold text-zinc-900">Hard stop:</span>{' '}
								{antiSnipingHardStopSeconds
									? formatAbsolute(antiSnipingHardStopSeconds)
									: 'Waiting for a valid end time and extension policy.'}
							</p>
						</div>
					</>
				)}
			</div>

			<div className="grid w-full gap-1.5">
				<Label>Trusted Mints</Label>
				<p className="text-xs text-zinc-500">
					Bids will be rejected unless the token is minted by one of these mints. At least one is required.
				</p>
				{validationMessages.trustedMints && <p className="text-xs text-red-600">{validationMessages.trustedMints}</p>}

				<div className="space-y-2 mt-1">
					{selectedMints.map((mint) => (
						<div key={mint} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
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

			<div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
				<p className="font-medium text-zinc-950">Lock key scheme: hd_p2pk</p>
				<p className="mt-1">The auction xpub is derived from your NIP-60 wallet automatically when you publish.</p>
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
		!validationMessages.antiSnipingWindowSeconds &&
		!validationMessages.antiSnipingExtensionSeconds &&
		!validationMessages.antiSnipingMaxExtensions
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
