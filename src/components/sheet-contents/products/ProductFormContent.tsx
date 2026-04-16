import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductFormState, type ProductFormTab } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { hasProductFormDraft } from '@/lib/utils/productFormStorage'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey, isShippingDeleted } from '@/queries/shipping'
import { useV4VConfiguration } from '@/queries/v4v'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NameTab } from './NameTab'
import { CategoryTab, DetailTab, ImagesTab, ShippingTab, SpecTab } from './tabs'
import { shouldRequireV4VSetup } from './v4vSetup'

const PRODUCT_FORM_TAB_ORDER: ProductFormTab[] = ['name', 'detail', 'spec', 'category', 'images', 'shipping']

const PRODUCT_FORM_TAB_LABELS: Record<ProductFormTab, string> = {
	name: 'Name',
	detail: 'Detail',
	spec: 'Spec',
	category: 'Category',
	images: 'Images',
	shipping: 'Shipping',
}

type ProductFormWorkflowState = Pick<
	ProductFormState,
	'name' | 'description' | 'price' | 'quantity' | 'mainCategory' | 'images' | 'shippings'
>

function isValidNumberString(value: string): boolean {
	return value.trim().length > 0 && !isNaN(Number(value))
}

function getTabValidationIssues(state: ProductFormWorkflowState, tab: ProductFormTab): string[] {
	switch (tab) {
		case 'name': {
			const issues: string[] = []
			if (state.name.trim().length === 0) issues.push('Product name is required')
			if (state.description.trim().length === 0) issues.push('Description is required')
			return issues
		}
		case 'detail': {
			const issues: string[] = []
			if (!isValidNumberString(state.price)) issues.push('Valid product price is required')
			if (!isValidNumberString(state.quantity)) issues.push('Valid product quantity is required')
			return issues
		}
		case 'category':
			return state.mainCategory ? [] : ['Main category is required']
		case 'images':
			return state.images.length > 0 ? [] : ['At least one image is required']
		case 'shipping':
			return state.shippings.some((shipping) => !!shipping.shippingRef) ? [] : ['At least one shipping option is required']
		case 'spec':
			return []
	}
}

function getFormValidationIssues(state: ProductFormWorkflowState): string[] {
	return PRODUCT_FORM_TAB_ORDER.flatMap((tab) => getTabValidationIssues(state, tab))
}

function getFirstBlockingTab(state: ProductFormWorkflowState, targetTab: ProductFormTab): ProductFormTab | null {
	const targetIndex = PRODUCT_FORM_TAB_ORDER.indexOf(targetTab)

	if (targetIndex <= 0) return null

	for (const tab of PRODUCT_FORM_TAB_ORDER.slice(0, targetIndex)) {
		if (getTabValidationIssues(state, tab).length > 0) {
			return tab
		}
	}

	return null
}

function getAdjacentTab(currentTab: ProductFormTab, direction: 'next' | 'previous'): ProductFormTab | null {
	const currentIndex = PRODUCT_FORM_TAB_ORDER.indexOf(currentTab)
	const offset = direction === 'next' ? 1 : -1
	return PRODUCT_FORM_TAB_ORDER[currentIndex + offset] ?? null
}

export function ProductFormContent({
	className = '',
	showFooter = true,
	productDTag,
	productEventId,
}: {
	className?: string
	showFooter?: boolean
	productDTag?: string | null
	productEventId?: string | null
}) {
	const [isPublishing, setIsPublishing] = useState(false)
	const [hasDraft, setHasDraft] = useState(false)
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	// Get form state from store, including editingProductId
	const formState = useStore(productFormStore)
	const { activeTab, editingProductId, isDirty } = formState

	const validationIssuesByTab = useMemo(
		() =>
			Object.fromEntries(PRODUCT_FORM_TAB_ORDER.map((tab) => [tab, getTabValidationIssues(formState, tab)])) as Record<
				ProductFormTab,
				string[]
			>,
		[formState],
	)
	const currentTabValidationIssues = validationIssuesByTab[activeTab]
	const formValidationIssues = useMemo(() => getFormValidationIssues(formState), [formState])

	// Get user pubkey from auth store directly to avoid timing issues
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Check semantic V4V setup state for new products.
	const { data: v4vConfiguration, isLoading: isLoadingV4V } = useV4VConfiguration(userPubkey)
	const needsV4VSetup = shouldRequireV4VSetup({
		editingProductId,
		isLoadingV4V,
		v4vConfigurationState: v4vConfiguration?.state ?? 'unknown',
	})

	// Check if user has any shipping options configured (for tab ordering)
	// Query is only enabled when userPubkey is available
	const {
		data: userShippingOptions,
		isLoading: isLoadingUserShipping,
		isFetched: isShippingFetched,
	} = useShippingOptionsByPubkey(userPubkey)

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

	// Determine if we should show shipping tab first (user has no shipping options)
	const shouldShowShippingFirst = useMemo(() => {
		// Don't redirect if editing an existing product
		if (editingProductId) return false
		// Don't redirect if pubkey not loaded yet (query is disabled)
		if (!userPubkey) return false
		// Don't redirect if we haven't fetched shipping data yet
		if (!isShippingFetched) return false
		// Don't redirect while loading
		if (isLoadingUserShipping) return false
		// Check if user has any non-deleted shipping options
		// (query data might be cached and include deleted items)
		if (!userShippingOptions || userShippingOptions.length === 0) return true
		// Filter out any deleted shipping options from cached data
		const activeShippingOptions = userShippingOptions.filter((event) => {
			const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1]
			return dTag ? !isShippingDeleted(dTag) : true
		})
		return activeShippingOptions.length === 0
	}, [editingProductId, userShippingOptions, isLoadingUserShipping, userPubkey, isShippingFetched])

	const hasValidShipping = useMemo(() => {
		return shippings.some((ship) => ship.shippingRef && (!isShippingFetched || resolvedShippingRefs.has(ship.shippingRef)))
	}, [shippings, isShippingFetched, resolvedShippingRefs])

	// Set initial tab to Shipping when user has no shipping options
	// Track which formSessionId we've handled to avoid re-triggering on same session
	const handledSessionIdRef = useRef<number | null>(null)

	useEffect(() => {
		// Only auto-switch to shipping tab if:
		// 1. We haven't handled this session yet
		// 2. User should see shipping first (no shipping options)
		// 3. We're NOT already on the shipping tab
		if (handledSessionIdRef.current !== formSessionId && shouldShowShippingFirst && activeTab !== 'shipping') {
			productFormActions.setActiveTab('shipping')
			handledSessionIdRef.current = formSessionId
		}
	}, [shouldShowShippingFirst, activeTab, formSessionId])

	// Track if we started with shipping first (no shipping options)
	// This is used to determine if we should auto-navigate to name tab after first shipping is added
	const startedWithShippingFirstRef = useRef<boolean>(false)

	// Track if we've started with shipping first in this session
	useEffect(() => {
		if (shouldShowShippingFirst && activeTab === 'shipping') {
			startedWithShippingFirstRef.current = true
		}
	}, [shouldShowShippingFirst, activeTab])

	// Auto-navigate to 'name' tab after first shipping option is added when we started with shipping first
	useEffect(() => {
		if (startedWithShippingFirstRef.current && hasValidShipping && activeTab === 'shipping') {
			// First shipping option added, navigate to name tab
			productFormActions.setActiveTab('name')
			// Reset the flag so we don't auto-navigate again
			startedWithShippingFirstRef.current = false
		}
	}, [hasValidShipping, activeTab])

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

	const handleTabChange = useCallback(
		(value: string) => {
			const targetTab = value as ProductFormTab
			if (targetTab === activeTab) return

			if (editingProductId) {
				productFormActions.setTabState(targetTab)
				return
			}

			const currentIndex = PRODUCT_FORM_TAB_ORDER.indexOf(activeTab)
			const targetIndex = PRODUCT_FORM_TAB_ORDER.indexOf(targetTab)

			if (targetIndex < currentIndex) {
				productFormActions.setTabState(targetTab)
				return
			}

			const blockingTab = getFirstBlockingTab(formState, targetTab)
			if (blockingTab) {
				toast.error(`Complete ${PRODUCT_FORM_TAB_LABELS[blockingTab]} before moving to ${PRODUCT_FORM_TAB_LABELS[targetTab]}`)
				return
			}

			productFormActions.setTabState(targetTab)
		},
		[activeTab, editingProductId, formState],
	)

	const handleNext = useCallback(() => {
		if (currentTabValidationIssues.length > 0) return

		const nextTab = getAdjacentTab(activeTab, 'next')
		if (nextTab) {
			productFormActions.setTabState(nextTab)
		}
	}, [activeTab, currentTabValidationIssues])

	const handleBack = useCallback(() => {
		const previousTab = getAdjacentTab(activeTab, 'previous')
		if (previousTab) {
			productFormActions.setTabState(previousTab)
		}
	}, [activeTab])

	const previousTab = getAdjacentTab(activeTab, 'previous')
	const isCurrentTabBlocked = currentTabValidationIssues.length > 0

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				e.stopPropagation()
				form.handleSubmit()
			}}
			className={`flex h-full min-h-0 flex-col overflow-hidden ${className}`}
			data-testid="product-form"
			data-shipping-loaded={isShippingFetched || !userPubkey || !!editingProductId}
		>
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden max-h-[calc(100vh-200px)]">
				{/* Single level tabs: Name, Detail, Spec, Category, Images, Shipping */}
				<Tabs value={activeTab} onValueChange={handleTabChange} className="w-full flex flex-col flex-1 min-h-0 overflow-hidden">
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						<TabsTrigger
							value="name"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-name"
						>
							Name
							{validationIssuesByTab.name.length > 0 && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="detail"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-detail"
						>
							Detail
							{validationIssuesByTab.detail.length > 0 && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="spec"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-spec"
						>
							Spec
						</TabsTrigger>
						<TabsTrigger
							value="category"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-category"
						>
							Category
							{validationIssuesByTab.category.length > 0 && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="images"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-images"
						>
							Images
							{validationIssuesByTab.images.length > 0 && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="shipping"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-shipping"
						>
							Shipping
							{validationIssuesByTab.shipping.length > 0 && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
					</TabsList>

					<div className="flex-1 overflow-y-auto min-h-0" data-testid="product-form-scroll-container">
						<TabsContent value="name" className="mt-4">
							<NameTab />
						</TabsContent>

						<TabsContent value="detail" className="mt-4">
							<DetailTab />
						</TabsContent>

						<TabsContent value="spec" className="mt-4">
							<SpecTab />
						</TabsContent>

						<TabsContent value="category" className="mt-4">
							<CategoryTab />
						</TabsContent>

						<TabsContent value="images" className="mt-4">
							<ImagesTab />
						</TabsContent>

						<TabsContent value="shipping" className="mt-4">
							<ShippingTab />
						</TabsContent>
					</div>
				</Tabs>
			</div>

			{showFooter && (
				<div className="bg-white border-t pt-4 pb-4 mt-4">
					<div className="flex gap-2 w-full">
						{previousTab && (
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

						{activeTab === 'shipping' || editingProductId ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([, isSubmitting]) => {
									const hasValidationErrors = formValidationIssues.length > 0
									const isDisabled = isSubmitting || isPublishing || hasValidationErrors

									// Check if we need V4V setup for new products
									if (needsV4VSetup && !editingProductId && !hasValidationErrors) {
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
															{formValidationIssues.map((issue, i) => (
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
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="flex-1">
											<Button
												type="button"
												variant="secondary"
												className="w-full uppercase"
												onClick={handleNext}
												disabled={isCurrentTabBlocked}
												data-testid="product-next-button"
											>
												Next
											</Button>
										</span>
									</TooltipTrigger>
									{isCurrentTabBlocked && (
										<TooltipContent>
											<ul className="list-disc list-inside space-y-1">
												{currentTabValidationIssues.map((issue, i) => (
													<li key={i}>{issue}</li>
												))}
											</ul>
										</TooltipContent>
									)}
								</Tooltip>
							</TooltipProvider>
						)}
					</div>
				</div>
			)}
		</form>
	)
}
