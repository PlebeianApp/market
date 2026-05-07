import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useAuctionOracleDirectory, formatAuctionOracleLabel, type AuctionOracleRecord } from '@/queries/auctionOracles'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { AuctionFormData } from '@/publish/auctions'
import { Check, Copy, ExternalLink } from 'lucide-react'

/**
 * Auction-creation form's path-oracle picker.
 *
 * Lists every server we've discovered via CEP-15 announcement
 * (kind 11317 with `#k io.contextvm/common-schema` whose `i` tags cover
 * the `english_auction_path_oracle_v1` family), plus the app's
 * configured default oracle if it isn't already in the discovered set.
 *
 * Layout:
 *   - Header (label + explainer).
 *   - Compact trigger row: status dot + name + short pubkey. The
 *     `<button>`-level uppercase rule from `styles/globals.css` applies
 *     here — that's intentional, it matches the rest of the form's
 *     visual language.
 *   - Detail card below the trigger when a row is selected: status
 *     badge, about text, full pubkey with copy button, website link,
 *     announced-tools chips.
 *
 * The selected pubkey lives on `formData.pathIssuerPubkey`. Empty
 * string means "use the app default" — `getAuctionPathIssuerPubkeyOrThrow`
 * resolves that at publish time.
 */

type Props = {
	formData: AuctionFormData
	setFormData: Dispatch<SetStateAction<AuctionFormData>>
}

const ALL_AUCTION_TOOLS = ['request_path', 'submit_bid_token', 'request_settlement', 'get_auction_state'] as const

const truncatePubkey = (pubkey: string): string => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`

const StatusDot = ({ announced }: { announced: boolean }) => (
	<span
		aria-hidden
		className={`inline-block size-2 rounded-full shrink-0 ${announced ? 'bg-emerald-500' : 'bg-amber-500'}`}
	/>
)

const StatusBadge = ({ record }: { record: AuctionOracleRecord }) => {
	if (record.source === 'announced') {
		return (
			<Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700">
				<span className="size-1.5 rounded-full bg-emerald-500" /> Live
			</Badge>
		)
	}
	return (
		<Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-700">
			<span className="size-1.5 rounded-full bg-amber-500" /> Default fallback
		</Badge>
	)
}

const CopyButton = ({ value }: { value: string }) => {
	const [copied, setCopied] = useState(false)
	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			// Clipboard blocked (insecure context, permissions). The pubkey
			// is still visible in the input next to us — no fallback needed.
		}
	}
	return (
		<button
			type="button"
			onClick={onCopy}
			aria-label="Copy pubkey to clipboard"
			className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
		>
			{copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
		</button>
	)
}

const ToolsCoverage = ({ record }: { record: AuctionOracleRecord }) => {
	const announced = new Set(record.tools)
	return (
		<div className="flex flex-wrap items-center gap-1">
			{ALL_AUCTION_TOOLS.map((tool) => {
				const isAnnounced = announced.has(tool)
				return (
					<span
						key={tool}
						className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono ${
							isAnnounced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-zinc-50 text-zinc-400'
						}`}
						title={isAnnounced ? `${tool} announced` : `${tool} not in announcement`}
					>
						{tool}
					</span>
				)
			})}
		</div>
	)
}

export function AuctionOracleSelector({ formData, setFormData }: Props) {
	const { data, isLoading, isError, defaultPubkey } = useAuctionOracleDirectory()
	const records = useMemo(() => data ?? [], [data])

	// Pre-select the configured default once the directory loads, unless
	// the user has already made a choice.
	useEffect(() => {
		if (formData.pathIssuerPubkey) return
		if (records.length === 0) return
		const preferred = defaultPubkey ? records.find((record) => record.pubkey === defaultPubkey) : undefined
		const fallback = preferred ?? records[0]
		setFormData((prev) =>
			prev.pathIssuerPubkey === fallback.pubkey ? prev : { ...prev, pathIssuerPubkey: fallback.pubkey },
		)
	}, [records, defaultPubkey, formData.pathIssuerPubkey, setFormData])

	const selected = records.find((record) => record.pubkey === formData.pathIssuerPubkey)
	const announcedCount = records.filter((record) => record.source === 'announced').length

	return (
		<div className="rounded-lg border border-zinc-200 bg-white p-4">
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex flex-col gap-0.5">
						<Label htmlFor="auction-path-oracle" className="text-zinc-950">
							Path oracle
						</Label>
						<p className="text-xs text-zinc-500">Server that allocates Cashu lock paths and validates winning bids.</p>
					</div>
					{!isLoading && (
						<span className="text-[11px] text-zinc-500 normal-case">
							{announcedCount === 0
								? 'No live announcements'
								: `${announcedCount} live ${announcedCount === 1 ? 'oracle' : 'oracles'}`}
						</span>
					)}
				</div>

				<Select
					value={formData.pathIssuerPubkey}
					onValueChange={(value) => setFormData((prev) => ({ ...prev, pathIssuerPubkey: value }))}
					disabled={isLoading || records.length === 0}
				>
					<SelectTrigger id="auction-path-oracle" className="h-auto py-2">
						<SelectValue
							placeholder={
								isLoading ? 'Discovering oracles…' : records.length === 0 ? 'No oracle announcing the auction tools' : 'Select an oracle'
							}
						>
							{selected && (
								<span className="flex min-w-0 items-center gap-2">
									<StatusDot announced={selected.source === 'announced'} />
									<span className="truncate text-zinc-950">{formatAuctionOracleLabel(selected)}</span>
									<span className="font-mono text-xs text-zinc-500">{truncatePubkey(selected.pubkey)}</span>
								</span>
							)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{records.map((record) => (
							<SelectItem key={record.pubkey} value={record.pubkey}>
								<span className="flex flex-col gap-0.5 py-0.5">
									<span className="flex items-center gap-2">
										<StatusDot announced={record.source === 'announced'} />
										<span className="font-medium text-zinc-950">{formatAuctionOracleLabel(record)}</span>
										<span className="font-mono text-[11px] text-zinc-500">{truncatePubkey(record.pubkey)}</span>
									</span>
									{record.about && (
										<span className="line-clamp-1 pl-4 text-[11px] text-zinc-500">{record.about}</span>
									)}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{isError && (
					<p className="text-xs text-red-600">
						Could not query the oracle directory from the relay. The default oracle is still usable — try the dropdown.
					</p>
				)}

				{selected && (
					<div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
						<div className="flex flex-col gap-3 text-xs text-zinc-700">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<StatusBadge record={selected} />
								<span className="text-[11px] text-zinc-500 normal-case">Schema family: english_auction_path_oracle_v1</span>
							</div>

							{selected.about && <p className="text-zinc-700 normal-case">{selected.about}</p>}

							<div className="flex flex-col gap-1.5">
								<span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Pubkey</span>
								<div className="flex items-center gap-2">
									<code className="min-w-0 flex-1 break-all rounded border border-zinc-200 bg-white p-2 font-mono text-[11px] text-zinc-700">
										{selected.pubkey}
									</code>
									<CopyButton value={selected.pubkey} />
								</div>
							</div>

							{selected.website && (
								<a
									href={selected.website}
									target="_blank"
									rel="noreferrer"
									className="inline-flex w-fit items-center gap-1 text-blue-600 hover:underline normal-case"
								>
									{selected.website}
									<ExternalLink className="size-3" />
								</a>
							)}

							<div className="flex flex-col gap-1.5">
								<span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
									Announced tools ({selected.tools.length}/{ALL_AUCTION_TOOLS.length})
								</span>
								<ToolsCoverage record={selected} />
							</div>

							{selected.source === 'configured' && (
								<p className="text-[11px] text-amber-700 normal-case">
									This oracle is the app's configured default — no live CEP-15 announcement has been observed on the relay yet. The
									pubkey is still routable; bids will simply hang if the server isn't actually online.
								</p>
							)}
						</div>
					</div>
				)}

				<p className="text-[11px] text-zinc-500 normal-case">Lock key scheme: hd_p2pk — auction xpub is derived from your NIP-60 wallet at publish time.</p>
			</div>
		</div>
	)
}
