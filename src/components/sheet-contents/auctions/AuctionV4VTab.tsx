import type { Dispatch, SetStateAction } from 'react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { AlertTriangle, Check, Plus, Search, Trash2 } from 'lucide-react'
import type { AuctionFormData } from '@/publish/auctions'
import { requiredVerdictMajority } from '@/lib/auction/verdictMajority'
import { AUCTION_RECOMMENDED_VALIDATOR_POOL, AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS } from '@/lib/auction/auctionValidatorPolicy'
import type { MultipartyPickableValidator } from '@/lib/auction/multipartyAnnouncements'
import { describeValidatorTerms } from '@/lib/auction/multipartyAnnouncements'
import { useMultipartyAnnouncements } from '@/queries/multiparty'
import type { AuctionWorkflowResolution } from '@/lib/workflow/auctionWorkflowResolver'

export interface AuctionV4VTabProps {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
	/** The validators the seller selected, and nobody else. */
	auditors: readonly string[]
	/** The app's configured default validator, offered only as a suggestion. */
	defaultValidator?: string
	resolution: AuctionWorkflowResolution
	/** Open the V4V editor for the recipient list (validators stay fixed there). */
	onEditRecipients: () => void
}

type ValidatorSort = 'name' | 'fee'

const shortPubkey = (pubkey: string): string => `${pubkey.slice(0, 10)}…${pubkey.slice(-4)}`
const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`
const PUBKEY_RE = /^[0-9a-f]{64}$/

/**
 * Step one of the V4V setup: **who validates this auction**.
 *
 * Validators are the corroborating parties whose verdicts decide whether a bid is
 * real, so they are chosen here, and their shares are then fixed in the V4V editor.
 * The list is a selection component in the same shape as the mint picker — chosen
 * entries on top, candidates to add below, with a search field — rather than a text
 * field, because a pubkey pasted by hand is the one thing a seller cannot check.
 *
 * Recipients who are not validators are deliberately not offered here: they belong
 * to the payout editor, which is where the shares are set.
 */
export function AuctionV4VTab({ formData, setFormData, auditors, defaultValidator, resolution, onEditRecipients }: AuctionV4VTabProps) {
	const announcements = useMultipartyAnnouncements()
	const [search, setSearch] = useState('')
	const [sort, setSort] = useState<ValidatorSort>('name')

	const candidates = useMemo(() => (announcements.data?.validators ?? []) as MultipartyPickableValidator[], [announcements.data])
	const selected = new Set(auditors.map((pubkey) => pubkey.toLowerCase()))

	const poolSize = auditors.length
	const majorityFloor = requiredVerdictMajority(poolSize)
	const chosenQuorum = formData.auditorQuorum ?? majorityFloor
	const quorum = Math.min(Math.max(chosenQuorum, majorityFloor), Math.max(poolSize, 1))
	// The choice only exists from four validators up: at two the majority is
	// unanimity and at three it is two of three, so a slider would have one position.
	const showQuorumSlider = poolSize >= 4

	const term = search.trim().toLowerCase()

	const addValidator = (pubkey: string) => {
		const normalized = pubkey.trim().toLowerCase()
		if (!PUBKEY_RE.test(normalized) || selected.has(normalized)) return
		setFormData((prev) => {
			const listed = (prev.auditorPubkeys ?? '')
				.split('\n')
				.map((entry) => entry.trim())
				.filter(Boolean)
			if (listed.includes(normalized)) return prev
			return { ...prev, auditorPubkeys: [...listed, normalized].join('\n') }
		})
	}

	const removeValidator = (pubkey: string) => {
		setFormData((prev) => {
			const listed = (prev.auditorPubkeys ?? '')
				.split('\n')
				.map((entry) => entry.trim())
				.filter(Boolean)
				.filter((entry) => entry !== pubkey)
			return { ...prev, auditorPubkeys: listed.join('\n') }
		})
	}

	const addable = candidates
		.filter(
			(candidate) =>
				!selected.has(candidate.pubkey.toLowerCase()) &&
				(term.length === 0 || (candidate.name ?? '').toLowerCase().includes(term) || candidate.pubkey.toLowerCase().includes(term)),
		)
		.sort((a, b) => (sort === 'fee' ? a.feeBps - b.feeBps : (a.name ?? a.pubkey).localeCompare(b.name ?? b.pubkey)))

	const selectedEntries = auditors.map((pubkey) => ({
		pubkey,
		announced: candidates.find((candidate) => candidate.pubkey.toLowerCase() === pubkey.toLowerCase()),
	}))

	return (
		<div className="space-y-6">
			{resolution.blockingMessages.length > 0 && (
				<div className="rounded-md border border-red-300 bg-red-50 p-3">
					<div className="flex items-center gap-2 text-sm font-semibold text-red-800">
						<AlertTriangle className="h-4 w-4" />
						This auction cannot be published yet
					</div>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-800">
						{resolution.blockingMessages.map((message) => (
							<li key={message}>{message}</li>
						))}
					</ul>
				</div>
			)}

			<div>
				<h3 className="text-sm font-semibold">Validators for this auction</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					We recommend picking {AUCTION_RECOMMENDED_VALIDATOR_POOL} or more: a pool of {AUCTION_RECOMMENDED_VALIDATOR_POOL} validators is
					the smallest that still tolerates one being offline, and the more validators you choose, the more resilient your auction can be.
				</p>
			</div>

			<div className="space-y-2">
				<Label className="text-xs uppercase text-muted-foreground">
					Selected ({poolSize}
					{poolSize > 0 ? ` of ${AUCTION_VALIDATOR_RULESET_MAX_VALIDATORS} max` : ''})
				</Label>
				{poolSize === 0 && (
					<>
						<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
							No validator selected yet. Without one there is nothing to corroborate a bid.
						</p>
						{defaultValidator && (
							<div className="flex items-center gap-3 rounded-md border border-dashed p-2">
								<div className="min-w-0 flex-1 text-xs text-muted-foreground">
									This app's own default validator, <span className="font-mono">{shortPubkey(defaultValidator)}</span>, will be used if you
									pick nobody. It is not an announcement, so it has no published terms.
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0 gap-1 text-xs"
									onClick={() => addValidator(defaultValidator)}
								>
									<Plus className="h-3 w-3" />
									Select
								</Button>
							</div>
						)}
					</>
				)}
				{selectedEntries.map(({ pubkey, announced }) => (
					<div key={pubkey} className="flex items-start gap-3 rounded-md border p-2">
						{announced?.picture ? (
							<img src={announced.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
						) : (
							<div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
						)}
						<div className="min-w-0 flex-1">
							<div className="text-sm font-medium">
								{announced?.name ?? <span className="font-mono">{shortPubkey(pubkey)} (no announcement found)</span>}
							</div>
							<div className="text-xs text-muted-foreground">
								{announced ? describeValidatorTerms(announced) : 'its share is set in the V4V editor'}
							</div>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-red-600"
							onClick={() => removeValidator(pubkey)}
						>
							<Trash2 className="h-3 w-3" />
							Remove
						</Button>
					</div>
				))}
			</div>

			<div className="space-y-2">
				<Label htmlFor="validator-search" className="text-xs uppercase text-muted-foreground">
					Add a validator
				</Label>
				<div className="flex gap-2">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
						<Input
							id="validator-search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search by name, or paste a pubkey"
							className="pl-8 text-xs"
						/>
					</div>
					{PUBKEY_RE.test(term) && !selected.has(term) && (
						<Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => addValidator(term)}>
							<Plus className="h-3 w-3" />
							Add pubkey
						</Button>
					)}
				</div>

				{announcements.isLoading && <p className="text-xs text-muted-foreground">Reading announcements…</p>}
				{announcements.isError && (
					<p className="text-xs text-muted-foreground">Could not read announcements. Paste a validator pubkey above to add it by hand.</p>
				)}
				{announcements.data && addable.length === 0 && term.length === 0 && (
					<p className="text-xs text-muted-foreground">
						{candidates.length === 0
							? 'No validator announcements found on the app relay yet.'
							: 'Every announced validator is already selected.'}
					</p>
				)}
				{term.length > 0 && addable.length === 0 && !PUBKEY_RE.test(term) && (
					<p className="text-xs text-muted-foreground">No announced validator matches that.</p>
				)}

				{candidates.length > 1 && (
					<div className="flex items-center justify-end gap-2 text-xs">
						<span className="text-muted-foreground">Sort by</span>
						<Button
							type="button"
							variant={sort === 'name' ? 'secondary' : 'ghost'}
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={() => setSort('name')}
						>
							Name
						</Button>
						<Button
							type="button"
							variant={sort === 'fee' ? 'secondary' : 'ghost'}
							size="sm"
							className="h-6 px-2 text-xs"
							onClick={() => setSort('fee')}
						>
							Percentage
						</Button>
					</div>
				)}

				{/* A large pool should scroll inside its own box rather than pushing
				    the rest of the step off screen. */}
				<div className="max-h-80 space-y-2 overflow-y-auto pr-1">
					{addable.map((candidate) => (
						<div key={candidate.pubkey} className="flex items-start gap-3 rounded-md border p-2">
							{candidate.picture ? (
								<img src={candidate.picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" loading="lazy" />
							) : (
								<div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
							)}
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium">{candidate.name ?? shortPubkey(candidate.pubkey)}</div>
								<div className="text-xs text-muted-foreground">{describeValidatorTerms(candidate)}</div>
								{candidate.about && <div className="mt-0.5 text-xs text-muted-foreground">{candidate.about}</div>}
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="shrink-0 gap-1 text-xs"
								onClick={() => addValidator(candidate.pubkey)}
							>
								<Plus className="h-3 w-3" />
								Add
							</Button>
						</div>
					))}
				</div>
			</div>

			{showQuorumSlider && (
				<div className="space-y-3 rounded-md border p-3">
					<div className="flex items-baseline justify-between">
						<Label className="text-xs uppercase text-muted-foreground">Quorum</Label>
						<span className={`text-xs font-medium ${quorum >= poolSize ? 'text-green-600' : 'text-amber-600'}`}>
							{quorum} of {poolSize} must agree
							{quorum >= poolSize ? ' · strongest' : ' · tolerates validators offline'}
						</span>
					</div>
					<Slider
						value={[quorum]}
						min={majorityFloor}
						max={Math.max(poolSize, majorityFloor)}
						step={1}
						onValueChange={([next]) =>
							setFormData((prev) => ({
								...prev,
								auditorQuorum: Math.min(Math.max(next ?? majorityFloor, majorityFloor), poolSize),
							}))
						}
					/>
					<div className="flex justify-between text-xs">
						<span className="text-amber-600">More available</span>
						<span className="text-green-600">More secure</span>
					</div>
					<p className="text-xs text-muted-foreground">
						The quorum can never fall below a strict majority ({majorityFloor} of {poolSize}), so two disjoint groups of validators can
						never both decide. Raising it above that trades availability for certainty.
					</p>
				</div>
			)}

			<div className="rounded-md border p-3">
				<div className="flex items-center justify-between gap-2">
					<div>
						<div className="text-sm font-medium">V4V recipients</div>
						<div className="text-xs text-muted-foreground">
							{resolution.recipients.length === 0
								? 'Nobody besides the seller is paid yet — the seller keeps the whole settlement.'
								: `${resolution.recipients.length} recipient(s) · the seller keeps ${
										resolution.preview ? formatBps(resolution.preview.sellerRemainderBps) : 'the remainder'
									}`}
						</div>
					</div>
					<Button type="button" variant="outline" size="sm" className="shrink-0 text-xs" onClick={onEditRecipients}>
						{resolution.recipients.length === 0 ? 'Set up V4V' : 'Edit V4V'}
					</Button>
				</div>
				{resolution.preview !== null && (
					<div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
						Recipients share {formatBps(resolution.preview.auxiliaryAllocationBps)} · schedule commitment{' '}
						<span className="font-mono">{resolution.preview.commitment.slice(0, 16)}…</span>
					</div>
				)}
			</div>

			{poolSize > 0 && poolSize < AUCTION_RECOMMENDED_VALIDATOR_POOL && (
				<div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<p>
						{poolSize === 1
							? 'With one validator this auction has no corroboration at all: that validator alone decides whether a bid is real, and its verdict cannot be checked against anyone else.'
							: 'With two validators an outcome needs both of them, so a single validator being offline or unreachable stalls the auction entirely.'}{' '}
						{AUCTION_RECOMMENDED_VALIDATOR_POOL} validators is the smallest pool that is both fork-proof and survives one being offline.
					</p>
				</div>
			)}

			{poolSize > 0 && resolution.validators.valid && (
				<div className="flex items-center gap-2 text-xs text-green-700">
					<Check className="h-4 w-4" />
					An outcome needs {quorum} of {poolSize} validators to agree.
				</div>
			)}
		</div>
	)
}
