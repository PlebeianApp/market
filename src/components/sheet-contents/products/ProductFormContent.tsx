import { ProductAuthoringStageNavigator } from '@/components/product-authoring/ProductAuthoringStageNavigator'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProductWorkflowResolution } from '@/lib/workflow/productWorkflowResolver'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductFormTab } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { hasProductFormDraft } from '@/lib/utils/productFormStorage'
import {
	getNextProductAuthoringStage,
	getPreviousProductAuthoringStage,
	getPrimaryProductAuthoringTabForStage,
	getProductAuthoringStageForTab,
	getProductAuthoringTabsForStage,
	PRODUCT_AUTHORING_V4V_SETUP_ISSUE,
	resolveProductAuthoringStages,
	type ProductAuthoringStage,
	type ProductAuthoringStageResolution,
} from '@/lib/workflow/productAuthoringStages'
import { validateProductDraft } from '@/lib/workflow/productDraftValidation'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey, isShippingDeleted } from '@/queries/shipping'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NameTab } from './NameTab'
import { CategoryTab, DetailTab, ImagesTab, ShippingTab, SpecTab } from './tabs'

const LEGACY_PRODUCT_FORM_TABS: Array<{ tab: ProductFormTab; label: string; testId: string }> = [
	{ tab: 'name', label: 'Name', testId: 'product-tab-name' },
	{ tab: 'detail', label: 'Detail', testId: 'product-tab-detail' },
	{ tab: 'spec', label: 'Spec', testId: 'product-tab-spec' },
	{ tab: 'category', label: 'Category', testId: 'product-tab-category' },
	{ tab: 'images', label: 'Images', testId: 'product-tab-images' },
	{ tab: 'shipping', label: 'Shipping', testId: 'product-tab-shipping' },
]

export function ProductFormContent({
	className = '',
	showFooter = true,
	productDTag,
	productEventId,
	workflow,
	stageResolution,
	onStageSelect,
	onStageBack,
	onStageNext,
}: {
	className?: string
	showFooter?: boolean
	productDTag?: string | null
	productEventId?: string | null
	workflow?: ProductWorkflowResolution
	stageResolution?: ProductAuthoringStageResolution
	onStageSelect?: (stage: ProductAuthoringStage) => void
	onStageBack?: () => void
	onStageNext?: () => void
}) {
	const [isPublishing, setIsPublishing] = useState(false)
	const [hasDraft, setHasDraft] = useState(false)
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	// Get form state from store, including editingProductId
	const formState = useStore(productFormStore)
	const { activeTab, editingProductId, isDirty } = formState
	const nextCompatibilityStage = getProductAuthoringStageForTab(activeTab)
	const [editCompatibilityStage, setEditCompatibilityStage] = useState<ProductAuthoringStage>(() => nextCompatibilityStage)
	const previousActiveTabRef = useRef(activeTab)
	const resolvedWorkflow: ProductWorkflowResolution = workflow ?? {
		mode: editingProductId ? 'edit' : 'create',
		isBootstrapReady: true,
		initialTab: activeTab,
		shouldStartAtShipping: false,
		requiresV4VSetup: false,
	}

	useEffect(() => {
		if (process.env.NODE_ENV === 'development' && !workflow && !editingProductId && resolvedWorkflow.mode === 'create') {
			console.warn(
				'ProductFormContent mounted in create mode without a canonical workflow prop. This fallback is temporary and unsupported.',
			)
		}
	}, [workflow, editingProductId, resolvedWorkflow.mode])

	useEffect(() => {
		const previousActiveTab = previousActiveTabRef.current
		previousActiveTabRef.current = activeTab

		if (stageResolution || resolvedWorkflow.mode !== 'edit') return
		if (previousActiveTab === activeTab) return
		if (nextCompatibilityStage === editCompatibilityStage) return

		setEditCompatibilityStage(nextCompatibilityStage)
	}, [activeTab, editCompatibilityStage, nextCompatibilityStage, resolvedWorkflow.mode, stageResolution])

	// Get user pubkey from auth store directly to avoid timing issues
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Resolve seller shipping references for draft validation.
	// Query is only enabled when userPubkey is available.
	const { data: userShippingOptions, isFetched: isShippingFetched } = useShippingOptionsByPubkey(userPubkey)

	const resolvedShippingRefs = useMemo(() => {
		if (!userShippingOptions) return new Set<string>()

		return new Set(
			userShippingOptions
				.filter((event) => {
					const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1]
					return dTag ? !isShippingDeleted(dTag, event.created_at) : true
				})
				.map((event) => {
					const info = getShippingInfo(event)
					return info ? createShippingReference(event.pubkey, info.id) : null
				})
				.filter((shippingRef): shippingRef is string => !!shippingRef),
		)
	}, [userShippingOptions])

	const draftValidation = useMemo(
		() =>
			validateProductDraft({
				state: formState,
				resolvedShippingRefs,
				isShippingFetched,
			}),
		[formState, isShippingFetched, resolvedShippingRefs],
	)
	const editCompatibilityStageResolution = useMemo(() => {
		if (stageResolution || resolvedWorkflow.mode !== 'edit') return null

		return resolveProductAuthoringStages({
			selectedStage: editCompatibilityStage,
			validation: draftValidation,
			workflow: resolvedWorkflow,
		})
	}, [draftValidation, editCompatibilityStage, resolvedWorkflow, stageResolution])
	const isMissingShellStageResolution = !stageResolution && !editCompatibilityStageResolution
	const resolvedStageResolution =
		stageResolution ??
		editCompatibilityStageResolution ??
		resolveProductAuthoringStages({
			selectedStage: 'basics',
			validation: draftValidation,
			workflow: resolvedWorkflow,
		})

	const selectedStage = resolvedStageResolution.selectedStage
	const stageValidation = resolvedStageResolution.validation
	const shouldHideLegacyTabs = resolvedWorkflow.mode === 'create'
	const renderedTabs = getProductAuthoringTabsForStage(selectedStage)
	const previousStage = getPreviousProductAuthoringStage(selectedStage)
	const nextStage = getNextProductAuthoringStage(selectedStage)
	const selectStage = useCallback(
		(stage: ProductAuthoringStage) => {
			if (onStageSelect) {
				onStageSelect(stage)
				return
			}

			setEditCompatibilityStage(stage)
			const primaryTab = getPrimaryProductAuthoringTabForStage(stage)
			if (primaryTab) {
				productFormActions.setActiveTab(primaryTab)
			}
		},
		[onStageSelect],
	)
	const handleLegacyTabSelect = useCallback(
		(tab: string) => {
			const legacyTab = tab as ProductFormTab

			selectStage(getProductAuthoringStageForTab(legacyTab))
			productFormActions.setActiveTab(legacyTab)
		},
		[selectStage],
	)
	const handleBack = useCallback(() => {
		if (onStageBack) {
			onStageBack()
			return
		}

		if (previousStage) selectStage(previousStage)
	}, [onStageBack, previousStage, selectStage])
	const handleNext = useCallback(() => {
		if (onStageNext) {
			onStageNext()
			return
		}

		if (nextStage) selectStage(nextStage)
	}, [nextStage, onStageNext, selectStage])

	// Check for persisted draft on mount (for drafts from previous sessions)
	const checkForPersistedDraft = useCallback(async () => {
		const draftKey = productDTag || editingProductId
		if (draftKey) {
			const exists = await hasProductFormDraft(draftKey)
			if (exists) {
				setHasDraft(true)
			}
		}
	}, [productDTag, editingProductId])

	// Update hasDraft when isDirty changes (for immediate feedback on current session changes)
	useEffect(() => {
		if (editingProductId && isDirty) {
			setHasDraft(true)
		}
	}, [editingProductId, isDirty])

	// Store the discard function in a ref to avoid stale closures in the header action
	const discardEditsRef = useRef<(() => Promise<void>) | null>(null)

	// Update the ref whenever dependencies change
	useEffect(() => {
		discardEditsRef.current = async () => {
			const draftKey = productDTag || editingProductId
			if (!draftKey) return

			// Preserve current tab state before reset
			const currentActiveTab = formState.activeTab

			await productFormActions.clearDraftForProduct(draftKey)

			// If we have a productEventId, reload the product from the network using the event ID
			// Pass the preserved tab state to avoid flicker
			if (productEventId && productDTag) {
				productFormActions.setEditingProductId(productDTag)
				await productFormActions.loadProductForEdit(productEventId, {
					preserveTabState: { activeTab: currentActiveTab },
				})
			} else {
				// No product to reload, just reset but restore tabs
				productFormActions.reset()
				productFormActions.setActiveTab(currentActiveTab)
			}

			setHasDraft(false)
			uiActions.clearDashboardHeaderAction()
		}
	}, [productDTag, editingProductId, productEventId, formState.activeTab])

	// Stable callback that reads from the ref
	const handleDiscardEdits = useCallback(() => {
		discardEditsRef.current?.()
	}, [])

	// Check for persisted draft on mount
	useEffect(() => {
		checkForPersistedDraft()
	}, [checkForPersistedDraft])

	// Update dashboard header action when draft state changes
	useEffect(() => {
		if (editingProductId && hasDraft) {
			uiActions.setDashboardHeaderAction({
				label: 'Discard Edits',
				onClick: handleDiscardEdits,
			})
		} else {
			uiActions.clearDashboardHeaderAction()
		}

		// Clean up on unmount
		return () => {
			uiActions.clearDashboardHeaderAction()
		}
	}, [editingProductId, hasDraft, handleDiscardEdits])

	const form = useForm({
		defaultValues: {},
		onSubmit: async () => {
			try {
				setIsPublishing(true)
				const ndk = ndkActions.getNDK()
				const signer = ndkActions.getSigner()

				if (!ndk) {
					toast.error('NDK not initialized')
					setIsPublishing(false)
					return
				}
				if (!signer) {
					toast.error('You need to connect your wallet first')
					setIsPublishing(false)
					return
				}

				const result = await productFormActions.publishProduct(signer, ndk, queryClient)

				if (result) {
					toast.success(editingProductId ? 'Product updated successfully!' : 'Product published successfully!')
					productFormActions.reset()

					if (typeof result === 'string') {
						document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

						// Navigate to product list when updating, to specific product when creating
						if (editingProductId) {
							navigate({ to: '/dashboard/products/products' })
						} else {
							navigate({ to: `/products/${result}` })
						}
					}
				} else {
					toast.error(editingProductId ? 'Failed to update product' : 'Failed to publish product')
				}
			} catch (error) {
				console.error(editingProductId ? 'Error updating product:' : 'Error creating product:', error)
				toast.error(editingProductId ? 'Failed to update product' : 'Failed to create product')
			} finally {
				setIsPublishing(false)
			}
		},
	})

	const selectedStageContent =
		selectedStage === 'publish' ? (
			<div className="mt-4 space-y-4 rounded-lg border bg-gray-50 p-4">
				<div>
					<h3 className="text-sm font-semibold">Ready to publish</h3>
					<p className="text-sm text-muted-foreground">
						Review the required checks below, then publish when the draft and seller setup are ready.
					</p>
				</div>
				{resolvedStageResolution.publishIssues.length > 0 ? (
					<ul className="list-disc list-inside space-y-1 text-sm text-red-600">
						{resolvedStageResolution.publishIssues.map((issue) => (
							<li key={issue}>{issue}</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-green-700">All required product details and seller setup checks are complete.</p>
				)}
			</div>
		) : (
			<div className="mt-4 space-y-6">
				{renderedTabs.includes('name') ? <NameTab /> : null}
				{renderedTabs.includes('detail') ? <DetailTab /> : null}
				{renderedTabs.includes('spec') ? <SpecTab /> : null}
				{renderedTabs.includes('category') ? <CategoryTab /> : null}
				{renderedTabs.includes('images') ? <ImagesTab /> : null}
				{renderedTabs.includes('shipping') ? <ShippingTab /> : null}
			</div>
		)

	if (isMissingShellStageResolution) {
		throw new Error('ProductFormContent requires shell-owned stageResolution in create mode')
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				e.stopPropagation()
				form.handleSubmit()
			}}
			className={`flex flex-col h-full ${className}`}
			data-testid="product-form"
			data-shipping-loaded={isShippingFetched || !!editingProductId}
		>
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden max-h-[calc(100vh-200px)]">
				<ProductAuthoringStageNavigator resolution={resolvedStageResolution} onStageSelect={selectStage} />
				<Tabs value={activeTab} onValueChange={handleLegacyTabSelect} className={shouldHideLegacyTabs ? 'sr-only' : 'w-full'}>
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						{LEGACY_PRODUCT_FORM_TABS.map(({ tab, label, testId }) => (
							<TabsTrigger
								key={tab}
								value={tab}
								className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								data-testid={testId}
							>
								{label}
								{stageValidation.issuesByTab[tab]?.length ? <span className="ml-1 text-red-500">*</span> : null}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>

				<div className="flex-1 overflow-y-auto min-h-0">{selectedStageContent}</div>
			</div>

			{showFooter && (
				<div className="bg-white border-t pt-4 pb-4 mt-4">
					<div className="flex gap-2 w-full">
						{previousStage && (
							<Button
								type="button"
								variant="outline"
								className="flex-1 gap-2 uppercase"
								onClick={handleBack}
								data-testid="product-back-button"
							>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{selectedStage === 'publish' ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([, isSubmitting]) => {
									const validationIssues = resolvedStageResolution.publishIssues
									const hasValidationErrors = !resolvedStageResolution.canPublish
									const hasV4VSetupBlocker = validationIssues.includes(PRODUCT_AUTHORING_V4V_SETUP_ISSUE)
									const hasNonV4VBlockers = validationIssues.some((issue) => issue !== PRODUCT_AUTHORING_V4V_SETUP_ISSUE)

									if (hasV4VSetupBlocker && !hasNonV4VBlockers && !editingProductId) {
										return (
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															type="button"
															variant="secondary"
															className="flex-1 uppercase"
															onClick={() => {
																const publishCallback = async () => {
																	// After V4V setup, trigger the form submission
																	form.handleSubmit()
																}
																uiActions.openDialog('v4v-setup', publishCallback)
															}}
															data-testid="product-setup-v4v-button"
														>
															Setup V4V First
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														<p>You need to configure Value for Value (V4V) settings before publishing your first product</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										)
									}

									const isDisabled = isSubmitting || isPublishing || hasValidationErrors

									return (
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="flex-1">
														<Button
															type="submit"
															variant="secondary"
															className="w-full uppercase"
															disabled={isDisabled}
															data-testid="product-publish-button"
														>
															{isSubmitting || isPublishing
																? editingProductId
																	? 'Updating...'
																	: 'Publishing...'
																: editingProductId
																	? 'Update Product'
																	: 'Publish Product'}
														</Button>
													</span>
												</TooltipTrigger>
												{hasValidationErrors && (
													<TooltipContent>
														<ul className="list-disc list-inside space-y-1">
															{validationIssues.map((issue, i) => (
																<li key={i}>{issue}</li>
															))}
														</ul>
													</TooltipContent>
												)}
											</Tooltip>
										</TooltipProvider>
									)
								}}
							/>
						) : (
							<Button
								type="button"
								variant="secondary"
								className="flex-1 uppercase"
								onClick={handleNext}
								disabled={!nextStage}
								data-testid="product-next-button"
							>
								Next
							</Button>
						)}
					</div>
				</div>
			)}
		</form>
	)
}
