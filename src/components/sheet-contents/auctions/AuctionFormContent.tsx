import { Button } from '@ui/primitives/button'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ui/primitives/tabs'
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
import { normalizeProductShippingSelections, type ProductShippingSelection } from '@sdk/commerce/products'
import { usePublishAuctionMutation, type AuctionFormData, type AuctionSpecEntry } from '@/publish/auctions'
import { AUCTION_MIN_BID_LEG_SATS } from '@/lib/auction/constants'
import { createShippingReference, getShippingInfo, isShippingOptionDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { clearAuctionFormDraft, getAuctionFormDraft, saveAuctionFormDraft } from '@/lib/utils/auctionFormStorage'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
	AuctionShippingView,
	AuctionTabContent,
	CategoryTab,
	ImagesTab,
	NameTab,
	parseDatetimeLocalSeconds,
	SpecTab,
	toDatetimeLocal,
	type AuctionImage,
	type AuctionShippingOptionSummary,
	type AuctionValidationMessages as ValidationMessages,
	type EndMode,
	type StartMode,
	type TabProps,
} from '@ui/components/auction-editor/AuctionEditorTabs'

type AuctionTab = 'name' | 'auction' | 'category' | 'spec' | 'images' | 'shipping'

const INITIAL_FORM: AuctionFormData = {
	title: '',
	summary: '',
	description: '',
	startingBid: '',
	bidIncrement: String(AUCTION_MIN_BID_LEG_SATS),
	reserve: undefined,
	startAt: '',
	endAt: '',
	// Default anti-snipe to off; enabling applies the 5-min linear 2x preset.
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
	enableLiveChat: true,
	// Empty string defers auditor selection to the app's configured
	// default (`config.cvmServerPubkey`). The auction publish path
	// resolves this via `getAuctionAuditorsOrThrow` — the seller never
	// has to pick an auditor manually for the minimal demo flow. A
	// future Phase 7 reputation UI may surface a multi-select here.
	auditorPubkey: '',
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

type AvailableShipping = AuctionShippingOptionSummary

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
			.filter((event) => !isShippingOptionDeleted(event))
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
		<AuctionShippingView
			attached={selectionsWithOption.map(({ selection, option }) => ({ ...selection, option }))}
			unselected={unselectedOptions}
			hasUser={!!userPubkey}
			isLoading={shippingOptionsQuery.isLoading}
			hasAnyOptions={availableShippingOptions.length > 0}
			extraCostErrors={shippingExtraCostErrors}
			onAdd={addShipping}
			onRemove={removeShipping}
			onExtraCostChange={updateExtraCost}
		/>
	)
}

const TAB_ORDER: AuctionTab[] = ['name', 'auction', 'category', 'spec', 'images', 'shipping']

const VALIDATION_FIELD_LABELS: Record<AuctionPublishValidationField, string> = {
	title: 'Title',
	description: 'Description',
	startingBid: 'Starting Bid',
	bidIncrement: 'Bid Increment',
	reserve: 'Reserve',
	startAt: 'Start Time',
	endAt: 'End Time',
	duration: 'Duration',
	antiSnipeWindowMinutes: 'Anti-snipe Window',
	minBidCurveShape: 'Curve Shape',
	minBidCurvePeakMultiplier: 'Peak Multiplier',
	settlementGracePreset: 'Settlement Grace',
	trustedMints: 'Trusted Mints',
	imageUrls: 'Image',
	shippingExtraCost: 'Shipping Extra Cost',
}

function isMeaningfulDraft(formData: AuctionFormData, baselineMints: string[]): boolean {
	if (formData.title.trim().length > 0) return true

	const baseline = new Set(baselineMints)
	const current = formData.trustedMints
	if (baseline.size !== current.length) return true
	return current.some((mint) => !baseline.has(mint))
}

export function AuctionFormContent() {
	const navigate = useNavigate()
	const publishMutation = usePublishAuctionMutation()
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''
	const appStage = useStore(configStore, (state) => state.config.stage)
	const walletDevMode = appStage === 'staging' || isNip60WalletDevModeEnabled()
	// Instance-configured allowlist (ADR-018) takes precedence; DEFAULT_TRUSTED_MINTS
	// is only the shipped tier-3 fallback for before config loads or an instance
	// that hasn't set its own list.
	const configTrustedMints = useStore(configStore, (state) => state.config.trustedMints)

	const availableMints = useMemo(
		() =>
			Array.from(
				new Set([
					...(configTrustedMints?.length ? configTrustedMints : DEFAULT_TRUSTED_MINTS),
					...(walletDevMode ? NIP60_DEV_TEST_MINTS : []),
				]),
			),
		[configTrustedMints, walletDevMode],
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

	const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
	const draftLoadedRef = useRef(false)
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const draftGenerationRef = useRef(0)

	const hasDraft = draftSavedAt !== null

	useEffect(() => {
		if (!userPubkey || draftLoadedRef.current) return

		draftLoadedRef.current = true
		const draft = getAuctionFormDraft(userPubkey)
		if (!draft) return
		setDraftSavedAt(draft.savedAt)
		setFormData(draft.formData)
		setImages(draft.images)
		setStartMode(draft.startMode)
		setEndMode(draft.endMode)
		setDurationSeconds(draft.durationSeconds)
		setSubCategoryInput(draft.subCategoryInput)
	}, [userPubkey])

	useEffect(() => {
		if (!userPubkey || !draftLoadedRef.current) return

		const gen = draftGenerationRef.current
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

		saveTimerRef.current = setTimeout(() => {
			if (draftGenerationRef.current !== gen) return
			if (!isMeaningfulDraft(formData, availableMints)) return
			saveAuctionFormDraft(userPubkey, { formData, images, startMode, endMode, durationSeconds, subCategoryInput })
			if (draftGenerationRef.current === gen) setDraftSavedAt(Date.now())
		}, 1500)

		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
		}
	}, [formData, images, startMode, endMode, durationSeconds, subCategoryInput, userPubkey, availableMints])

	const buildPublishFormData = (nowSeconds: number): AuctionFormData => {
		const effectiveStartAt = startMode === 'immediate' ? '' : (formData.startAt ?? '')
		let resolvedEndAt = formData.endAt
		if (endMode === 'duration') {
			const parsedStart = formData.startAt ? parseDatetimeLocalSeconds(formData.startAt) : null
			const startSeconds = startMode === 'immediate' ? nowSeconds : (parsedStart ?? nowSeconds)
			resolvedEndAt = toDatetimeLocal(new Date((startSeconds + durationSeconds) * 1000))
		}

		return {
			...formData,
			startAt: effectiveStartAt,
			endAt: resolvedEndAt,
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

	const currentTabIndex = TAB_ORDER.indexOf(activeTab)
	const isLastTab = currentTabIndex === TAB_ORDER.length - 1

	const tabValid: Record<AuctionTab, boolean> = {
		name: hasValidName && hasValidDescription,
		auction: hasValidBidding && hasValidMints,
		category: true,
		spec: true,
		images: hasValidImages,
		shipping: Object.keys(shippingExtraCostErrors).length === 0,
	}

	// Tab at index i is reachable only if every tab before it is valid.
	const isTabReachable = (tabIndex: number): boolean => {
		for (let i = 0; i < tabIndex; i++) {
			if (!tabValid[TAB_ORDER[i]]) return false
		}
		return true
	}

	const handleNext = () => {
		const nextIndex = currentTabIndex + 1
		if (nextIndex < TAB_ORDER.length) setActiveTab(TAB_ORDER[nextIndex])
	}

	const handleBack = () => {
		const prevIndex = currentTabIndex - 1
		if (prevIndex >= 0) setActiveTab(TAB_ORDER[prevIndex])
	}

	const missingLabels = (fields: AuctionPublishValidationField[]): string[] => {
		const fieldsWithIssues = new Set(validationIssues.filter((i) => fields.includes(i.field)).map((i) => i.field))
		return [...fieldsWithIssues].map((f) => `Missing ${VALIDATION_FIELD_LABELS[f]}`)
	}

	const currentTabErrors: string[] = (() => {
		if (isLastTab) {
			const fieldsWithIssues = [...new Set(validationIssues.map((i) => i.field))]
			return fieldsWithIssues.map((f) => `Missing ${VALIDATION_FIELD_LABELS[f]}`)
		}
		switch (activeTab) {
			case 'name':
				return missingLabels(['title', 'description'])
			case 'auction':
				return missingLabels([
					'startingBid',
					'bidIncrement',
					'reserve',
					'startAt',
					'endAt',
					'duration',
					'antiSnipeWindowMinutes',
					'minBidCurveShape',
					'minBidCurvePeakMultiplier',
					'settlementGracePreset',
					'trustedMints',
				])
			case 'images':
				return missingLabels(['imageUrls'])
			case 'shipping':
				return missingLabels(['shippingExtraCost'])
			default:
				return []
		}
	})()

	const handleClearDraft = () => {
		draftGenerationRef.current++
		draftLoadedRef.current = true
		clearAuctionFormDraft(userPubkey)
		setDraftSavedAt(null)
		setFormData({ ...INITIAL_FORM, trustedMints: [...availableMints] })
		setImages([])
		setStartMode('immediate')
		setEndMode('duration')
		setDurationSeconds(24 * 60 * 60)
		setSubCategoryInput('')
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		event.stopPropagation()

		const nowSeconds = Math.floor(Date.now() / 1000)
		const nextFormData = buildPublishFormData(nowSeconds)

		try {
			validateAuctionPublishInput(nextFormData, { nowSeconds, minDurationSeconds: AUCTION_MIN_DURATION_SECONDS })
			const publishedEventId = await publishMutation.mutateAsync(nextFormData)
			if (!publishedEventId) return

			draftGenerationRef.current++
			clearAuctionFormDraft(userPubkey)
			setDraftSavedAt(null)

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
		<form onSubmit={handleSubmit} className="flex flex-col h-full mt-4 overflow-hidden">
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
				<Tabs
					value={activeTab}
					onValueChange={(value) => {
						const idx = TAB_ORDER.indexOf(value as AuctionTab)
						if (isTabReachable(idx)) setActiveTab(value as AuctionTab)
					}}
					className="w-full flex flex-col flex-1 min-h-0 overflow-hidden"
				>
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						{tabs.map((tab, index) => (
							<TabsTrigger
								key={tab.value}
								value={tab.value}
								disabled={!isTabReachable(index)}
								className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none disabled:opacity-40 disabled:cursor-not-allowed"
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
								mainCategories={PRODUCT_CATEGORIES}
							/>
						</TabsContent>
						<TabsContent value="spec" className="mt-4">
							<SpecTab formData={formData} setFormData={setFormData} />
						</TabsContent>
						<TabsContent value="images" className="mt-4">
							<ImagesTab
								images={images}
								setImages={setImages}
								error={validationMessages.imageUrls}
								renderUploader={(props) => <ImageUploader {...props} initialUrl={props.index < 0 ? '' : undefined} />}
							/>
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

			<div className="shrink-0 bg-white border-t pt-4 pb-2 mt-2 flex flex-col gap-2">
				{hasDraft && (
					<div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5">
						<p className="text-xs font-medium text-amber-700">Draft saved</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-red-600 px-2"
							onClick={handleClearDraft}
						>
							<Trash2 className="w-3 h-3" />
							Clear draft
						</Button>
					</div>
				)}
				{currentTabErrors.length > 0 && (
					<ul className="mb-3 max-h-28 overflow-y-auto space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2">
						{currentTabErrors.map((err, i) => (
							<li key={i} className="text-xs text-red-600 flex items-center gap-1">
								<span>•</span>
								{err}
							</li>
						))}
					</ul>
				)}
				<div className="flex gap-2">
					{currentTabIndex > 0 && (
						<Button
							type="button"
							variant="ghost"
							className="flex-1 uppercase border border-input bg-white hover:bg-white"
							onClick={handleBack}
						>
							<ArrowLeft className="w-4 h-4" />
							Back
						</Button>
					)}
					{isLastTab ? (
						<Button
							key="publish"
							type="submit"
							variant="secondary"
							className="flex-1 uppercase"
							disabled={!canSubmit || publishMutation.isPending}
						>
							{publishMutation.isPending ? 'Publishing...' : 'Publish Auction'}
						</Button>
					) : (
						<Button
							key="next"
							type="button"
							variant="secondary"
							className="flex-1 uppercase"
							onClick={handleNext}
							disabled={!tabValid[activeTab]}
						>
							Next
						</Button>
					)}
				</div>
			</div>
		</form>
	)
}
