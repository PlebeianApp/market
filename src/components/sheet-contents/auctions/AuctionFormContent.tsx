import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DEFAULT_TRUSTED_MINTS, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { configStore } from '@/lib/stores/config'
import { isNip60WalletDevModeEnabled, NIP60_DEV_TEST_MINTS } from '@/lib/stores/nip60'
import { normalizeProductShippingSelections, type ProductShippingSelection } from '@/lib/utils/productShippingSelections'
import { usePublishAuctionMutation, type AuctionFormData, type AuctionSpecEntry } from '@/publish/auctions'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Plus, X } from 'lucide-react'
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'

type AuctionImage = { imageUrl: string; imageOrder: number }

type AuctionTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping'

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

function AuctionTabContent({ formData, setFormData, availableMints }: TabProps & { availableMints: readonly string[] }) {
	const selectedMints = formData.trustedMints
	const unselectedMints = availableMints.filter((mint) => !selectedMints.includes(mint))
	const canRemove = selectedMints.length > 1

	const removeMint = (mint: string) => {
		if (!canRemove) return
		setFormData((prev) => ({ ...prev, trustedMints: prev.trustedMints.filter((m) => m !== mint) }))
	}

	const addMint = (mint: string) => {
		if (selectedMints.includes(mint)) return
		setFormData((prev) => ({ ...prev, trustedMints: [...prev.trustedMints, mint] }))
	}

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
				<Label>Trusted Mints</Label>
				<p className="text-xs text-zinc-500">
					Bids will be rejected unless the token is minted by one of these mints. At least one is required.
				</p>

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
								disabled={!canRemove}
								className="text-red-600 hover:text-red-700 disabled:opacity-40"
								title={canRemove ? 'Remove mint' : 'At least one mint is required'}
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

function ImagesTab({ images, setImages }: { images: AuctionImage[]; setImages: Dispatch<SetStateAction<AuctionImage[]>> }) {
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
					{images.length === 0 && <span className="text-sm text-red-500 ml-2">(At least one image required)</span>}
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

function ShippingTab({ formData, setFormData, userPubkey }: TabProps & { userPubkey: string }) {
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

	const hasValidName = formData.title.trim().length > 0
	const hasValidDescription = formData.description.trim().length > 0
	const hasValidBidding =
		formData.startingBid.trim().length > 0 && formData.bidIncrement.trim().length > 0 && formData.endAt.trim().length > 0
	const hasValidImages = images.filter((img) => img.imageUrl.trim().length > 0).length > 0
	const hasValidMints = formData.trustedMints.length > 0

	const canSubmit = hasValidName && hasValidDescription && hasValidBidding && hasValidImages && hasValidMints

	const handleSubmit = async (event: React.BaseSyntheticEvent) => {
		event.preventDefault()
		event.stopPropagation()

		const nextFormData: AuctionFormData = {
			...formData,
			imageUrls: images
				.slice()
				.sort((a, b) => a.imageOrder - b.imageOrder)
				.map((img) => img.imageUrl)
				.filter((url) => url.trim().length > 0),
			categories: parseListInput(subCategoryInput),
			specs: formData.specs.filter((spec: AuctionSpecEntry) => spec.key.trim() && spec.value.trim()),
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

	const tabs: { value: AuctionTab; label: string; showAsterisk: boolean }[] = [
		{ value: 'name', label: 'Name', showAsterisk: !hasValidName || !hasValidDescription },
		{ value: 'auction', label: 'Auction', showAsterisk: !hasValidBidding || !hasValidMints },
		{ value: 'category', label: 'Category', showAsterisk: false },
		{ value: 'spec', label: 'Spec', showAsterisk: false },
		{ value: 'images', label: 'Images', showAsterisk: !hasValidImages },
		{ value: 'shipping', label: 'Shipping', showAsterisk: false },
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
							<AuctionTabContent formData={formData} setFormData={setFormData} availableMints={availableMints} />
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
							<ImagesTab images={images} setImages={setImages} />
						</TabsContent>
						<TabsContent value="shipping" className="mt-4">
							<ShippingTab formData={formData} setFormData={setFormData} userPubkey={userPubkey} />
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
