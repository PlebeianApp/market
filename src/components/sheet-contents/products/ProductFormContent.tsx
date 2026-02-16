import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductFormTab } from '@/lib/stores/product'
import { uiActions } from '@/lib/stores/ui'
import {
	validateProduct,
	hasValidName as checkValidName,
	hasValidDescription as checkValidDescription,
	hasValidImages as checkValidImages,
	hasValidShipping as checkValidShipping,
} from '@/lib/utils/productValidator'
import { useProductFormNavigation } from '@/hooks/useProductFormNavigation'
import { useProductDraft } from '@/hooks/useProductDraft'
import { useV4VShares } from '@/queries/v4v'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
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
	const navigate = useNavigate()
	const queryClient = useQueryClient()

	// Get form state from store, including editingProductId
	const { activeTab, editingProductId, isDirty, shippings, formSessionId, name, description, images } = useStore(productFormStore)

	// Compute validation states
	const hasValidShipping = checkValidShipping(shippings)
	const hasValidName = checkValidName(name)
	const hasValidDescription = checkValidDescription(description)
	const hasValidImages = checkValidImages(images)

	// Compute validation message for tooltip
	const getValidationMessage = () => validateProduct({ name, description, images, shippings }).issues

	// Get user pubkey from auth store directly to avoid timing issues
	const authState = useStore(authStore)
	const userPubkey = authState.user?.pubkey || ''

	// Check V4V shares (only for new products)
	const { data: v4vShares, isLoading: isLoadingV4V } = useV4VShares(userPubkey)
	const hasV4VSetup = v4vShares && v4vShares.length > 0
	const needsV4VSetup = !editingProductId && !hasV4VSetup && !isLoadingV4V

	// Auto-manage tab navigation (shipping-first flow for new users)
	const { shouldShowShippingFirst } = useProductFormNavigation({
		userPubkey,
		editingProductId,
		activeTab,
		formSessionId,
		hasValidShipping,
	})

	// Draft persistence and "Discard Edits" header action
	useProductDraft({
		productDTag: productDTag ?? null,
		productEventId: productEventId ?? null,
		editingProductId,
		isDirty,
		activeTab,
	})

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
			className={`flex flex-col h-full ${className}`}
		>
			<div className="flex-1 flex flex-col min-h-0 overflow-hidden max-h-[calc(100vh-200px)]">
				{/* Single level tabs: Name, Detail, Spec, Category, Images, Shipping */}
				<Tabs
					value={activeTab}
					onValueChange={(value) => productFormActions.updateValues({ activeTab: value as ProductFormTab })}
					className="w-full flex flex-col flex-1 min-h-0 overflow-hidden"
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

					<div className="flex-1 overflow-y-auto min-h-0">
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

						{/* Show 'Next' button when shipping tab is shown first and user is on shipping tab */}
						{shouldShowShippingFirst && activeTab === 'shipping' && !hasValidShipping ? (
							<Button
								type="button"
								variant="secondary"
								className="flex-1 uppercase"
								onClick={() => productFormActions.updateValues({ activeTab: 'name' })}
								data-testid="product-next-button"
							>
								Next
							</Button>
						) : activeTab === 'shipping' || editingProductId ? (
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
