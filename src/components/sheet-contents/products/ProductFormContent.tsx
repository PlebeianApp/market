import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { toast } from 'sonner'
import { NameTab } from './NameTab'
import { DetailTab, CategoryTab, ImagesTab, ShippingTab, SpecTab } from './tabs'

export function ProductFormContent({ className = '', showFooter = true }: { className?: string; showFooter?: boolean }) {
	const [isPublishing, setIsPublishing] = useState(false)
	const navigate = useNavigate()

	// Get form state from store, including editingProductId
	const formState = useStore(productFormStore)
	const { mainTab, productSubTab, editingProductId } = formState

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

				const result = await productFormActions.publishProduct(signer, ndk)

				if (result) {
					toast.success(editingProductId ? 'Product updated successfully!' : 'Product published successfully!')
					productFormActions.reset()

					if (typeof result === 'string') {
						document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
						navigate({ to: `/products/${result}` })
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
			className={`flex flex-col h-full overflow-hidden ${className}`}
		>
			<div className="flex-1 overflow-y-auto py-4 px-6">
				{/* Main Tabs: Product and Shipping */}
				<Tabs
					value={mainTab}
					onValueChange={(value) => productFormActions.updateValues({ mainTab: value as 'product' | 'shipping' })}
					className="w-full"
				>
					<TabsList className="w-full rounded-none bg-transparent h-auto p-0 flex">
						<TabsTrigger
							value="product"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Product
						</TabsTrigger>
						<TabsTrigger
							value="shipping"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Shipping
						</TabsTrigger>
					</TabsList>

					{/* Product Tab Content */}
					<TabsContent value="product" className="mt-2">
						{/* Product Sub-Tabs */}
						<Tabs
							value={productSubTab}
							onValueChange={(value) =>
								productFormActions.updateValues({ productSubTab: value as 'name' | 'detail' | 'spec' | 'category' | 'images' })
							}
							className="w-full"
						>
							<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
								<TabsTrigger
									value="name"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Name
								</TabsTrigger>
								<TabsTrigger
									value="detail"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Detail
								</TabsTrigger>
								<TabsTrigger
									value="spec"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Spec
								</TabsTrigger>
								<TabsTrigger
									value="category"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Category
								</TabsTrigger>
								<TabsTrigger
									value="images"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Images
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
						</Tabs>
					</TabsContent>

					{/* Shipping Tab Content */}
					<TabsContent value="shipping" className="mt-4">
						<ShippingTab />
					</TabsContent>
				</Tabs>
			</div>

			{showFooter && (
				<div className="p-6 mt-auto sticky bottom-0 bg-white border-t">
					<div className="flex gap-2 w-full">
						{(productSubTab !== 'name' || mainTab === 'shipping') && (
							<Button type="button" variant="outline" className="flex-1 gap-2 uppercase" onClick={productFormActions.previousTab}>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{mainTab === 'shipping' || editingProductId ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([canSubmit, isSubmitting]) => (
									<Button
										type="submit"
										variant="secondary"
										className="flex-1 uppercase"
										disabled={isSubmitting || isPublishing || !canSubmit}
									>
										{isSubmitting || isPublishing
											? editingProductId
												? 'Updating...'
												: 'Publishing...'
											: editingProductId
												? 'Update Product'
												: 'Save'}
									</Button>
								)}
							/>
						) : (
							<Button type="button" variant="secondary" className="flex-1 uppercase" onClick={productFormActions.nextTab}>
								Next
							</Button>
						)}
					</div>
				</div>
			)}
		</form>
	)
}
