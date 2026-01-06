import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductFormTab } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import { hasProductFormDraft } from '@/lib/utils/productFormStorage'
import { useShippingOptionsByPubkey, isShippingDeleted } from '@/queries/shipping'
import { useV4VShares } from '@/queries/v4v'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { NameTab } from './NameTab'
import { CategoryTab, DetailTab, ImagesTab, ShippingTab, SpecTab } from './tabs'

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
	const { activeTab, editingProductId, isDirty, shippings, formSessionId, name, description, images } = formState

	// Compute validation states
	const hasValidShipping = shippings.some((ship) => ship.shipping && ship.shipping.id)
	const hasValidName = name.trim().length > 0
	const hasValidDescription = description.trim().length > 0
	const hasValidImages = images.length > 0

	// Compute validation message for tooltip
	const getValidationMessage = () => {
		const issues: string[] = []
		if (!hasValidName) issues.push('Product name is required')
		if (!hasValidDescription) issues.push('Description is required')
		if (!hasValidImages) issues.push('At least one image is required')
		if (!hasValidShipping) issues.push('At least one shipping option is required')
		return issues
	}

	// Get user pubkey from auth store directly to avoid timing issues
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Check V4V shares (only for new products)
	const { data: v4vShares, isLoading: isLoadingV4V } = useV4VShares(userPubkey)
	const hasV4VSetup = v4vShares && v4vShares.length > 0
	const needsV4VSetup = !editingProductId && !hasV4VSetup && !isLoadingV4V

	// Check if user has any shipping options configured (for tab ordering)
	// Query is only enabled when userPubkey is available
	const {
		data: userShippingOptions,
		isLoading: isLoadingUserShipping,
		isFetched: isShippingFetched,
	} = useShippingOptionsByPubkey(userPubkey)

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

	// Set initial tab to Shipping when user has no shipping options
	// Track which formSessionId we've handled to avoid re-triggering on same session
	const handledSessionIdRef = useRef<number | null>(null)

	useEffect(() => {
		// Only auto-switch to shipping tab if:
		// 1. We haven't handled this session yet
		// 2. User should see shipping first (no shipping options)
		// 3. We're on the name tab (default initial state)
		if (handledSessionIdRef.current !== formSessionId && shouldShowShippingFirst && activeTab === 'name') {
			productFormActions.updateValues({ activeTab: 'shipping' })
			handledSessionIdRef.current = formSessionId
		}
	}, [shouldShowShippingFirst, activeTab, formSessionId])

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
				productFormActions.setTabState(currentActiveTab)
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

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault()
				e.stopPropagation()
				form.handleSubmit()
			}}
			className={`flex flex-col ${className}`}
		>
			<div>
				{/* Single level tabs: Name, Detail, Spec, Category, Images, Shipping */}
				<Tabs
					value={activeTab}
					onValueChange={(value) => productFormActions.updateValues({ activeTab: value as ProductFormTab })}
					className="w-full"
				>
					<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
						<TabsTrigger
							value="name"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-name"
						>
							Name
							{(!hasValidName || !hasValidDescription) && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="detail"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-detail"
						>
							Detail
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
						</TabsTrigger>
						<TabsTrigger
							value="images"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-images"
						>
							Images
							{!hasValidImages && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
						<TabsTrigger
							value="shipping"
							className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
							data-testid="product-tab-shipping"
						>
							Shipping
							{!hasValidShipping && <span className="ml-1 text-red-500">*</span>}
						</TabsTrigger>
					</TabsList>

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
				</Tabs>
			</div>

			{showFooter && (
				<div className="bg-white border-t pt-4 pb-4 mt-4">
					<div className="flex gap-2 w-full">
						{activeTab !== 'name' && (
							<Button
								type="button"
								variant="outline"
								className="flex-1 gap-2 uppercase"
								onClick={productFormActions.previousTab}
								data-testid="product-back-button"
							>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{activeTab === 'shipping' || editingProductId ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([canSubmit, isSubmitting]) => {
									// Check if we need V4V setup for new products
									if (needsV4VSetup && !editingProductId) {
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

									const validationIssues = getValidationMessage()
									const hasValidationErrors = validationIssues.length > 0
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
								onClick={productFormActions.nextTab}
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
