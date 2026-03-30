import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { usePublishAuctionMutation, type AuctionFormData } from '@/publish/auctions'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

const DEFAULT_MINT = 'https://nofees.testnut.cashu.space'

const INITIAL_FORM: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: '1',
	reserve: '0',
	startAt: '',
	endAt: '',
	mainCategory: '',
	categories: [],
	imageUrls: [],
	trustedMints: [DEFAULT_MINT],
	isNSFW: false,
}

function parseListInput(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean)
}

export function AuctionFormContent() {
	const navigate = useNavigate()
	const publishMutation = usePublishAuctionMutation()
	const [formData, setFormData] = useState<AuctionFormData>(INITIAL_FORM)
	const [subCategoryInput, setSubCategoryInput] = useState('')
	const [imagesInput, setImagesInput] = useState('')
	const [mintsInput, setMintsInput] = useState(DEFAULT_MINT)

	const canSubmit =
		formData.title.trim().length > 0 &&
		formData.description.trim().length > 0 &&
		formData.startingBid.trim().length > 0 &&
		formData.endAt.trim().length > 0 &&
		formData.bidIncrement.trim().length > 0 &&
		parseListInput(imagesInput).length > 0

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		event.stopPropagation()

		const nextFormData: AuctionFormData = {
			...formData,
			imageUrls: parseListInput(imagesInput),
			trustedMints: parseListInput(mintsInput),
			categories: parseListInput(subCategoryInput),
		}

		try {
			const publishedEventId = await publishMutation.mutateAsync(nextFormData)
			if (!publishedEventId) return

			document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			navigate({ to: '/auctions' })
		} catch (error) {
			console.error('Failed to submit auction form:', error)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4 overflow-y-auto pr-1">
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
				</div>
			</div>

			<div className="grid sm:grid-cols-2 gap-4">
				<div className="grid w-full gap-1.5">
					<Label htmlFor="auction-start-at">Start Time (optional)</Label>
					<Input
						id="auction-start-at"
						type="datetime-local"
						value={formData.startAt}
						onChange={(e) => setFormData((prev) => ({ ...prev, startAt: e.target.value }))}
					/>
				</div>
				<div className="grid w-full gap-1.5">
					<Label htmlFor="auction-end-at">
						<span className="after:content-['*'] after:ml-0.5 after:text-red-500">End Time</span>
					</Label>
					<Input
						id="auction-end-at"
						type="datetime-local"
						value={formData.endAt}
						onChange={(e) => setFormData((prev) => ({ ...prev, endAt: e.target.value }))}
					/>
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
			</div>

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

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-images">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Image URLs (comma or newline separated)</span>
				</Label>
				<textarea
					id="auction-images"
					value={imagesInput}
					onChange={(e) => setImagesInput(e.target.value)}
					className="border-2 min-h-20 p-2 rounded-md"
					placeholder="https://..."
				/>
			</div>

			<div className="grid w-full gap-1.5">
				<Label htmlFor="auction-mints">Trusted Mints (comma or newline separated)</Label>
				<textarea
					id="auction-mints"
					value={mintsInput}
					onChange={(e) => setMintsInput(e.target.value)}
					className="border-2 min-h-16 p-2 rounded-md"
					placeholder={DEFAULT_MINT}
				/>
			</div>

			<div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
				<p className="font-medium text-zinc-950">Lock key scheme: hd_p2pk</p>
				<p className="mt-1">The auction xpub is derived from your NIP-60 wallet automatically when you publish.</p>
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

			<div className="sticky bottom-0 bg-white border-t pt-4 pb-2 mt-2">
				<Button type="submit" variant="secondary" className="w-full uppercase" disabled={!canSubmit || publishMutation.isPending}>
					{publishMutation.isPending ? 'Publishing...' : 'Publish Auction'}
				</Button>
			</div>
		</form>
	)
}
