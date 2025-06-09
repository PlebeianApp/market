import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { collectionFormActions, collectionFormStore } from '@/lib/stores/collection'
import { usePublishCollectionMutation, useUpdateCollectionMutation, type CollectionFormData } from '@/publish/collections'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { InfoTab } from './InfoTab'
import { ProductsTab } from './ProductsTab'
import { ShippingTab } from './ShippingTab'

export function CollectionFormContent({ className = '', showFooter = true }: { className?: string; showFooter?: boolean }) {
	const navigate = useNavigate()
	const [activeTab, setActiveTab] = useState<'info' | 'products' | 'shipping'>('info')

	// Get form state from store
	const formState = useStore(collectionFormStore)
	const { isEditing, editingCollectionId, name, description, headerImageUrl, selectedProducts, shippings } = formState

	// Get mutation hooks
	const publishMutation = usePublishCollectionMutation()
	const updateMutation = useUpdateCollectionMutation()

	const isPublishing = publishMutation.isPending || updateMutation.isPending

	const form = useForm({
		defaultValues: {},
		onSubmit: async () => {
			try {
				// Prepare form data
				const formData: CollectionFormData = {
					name,
					description,
					headerImageUrl: headerImageUrl || undefined,
					products: selectedProducts,
					shippings,
				}

				let result: string | null = null

				if (isEditing && editingCollectionId) {
					// Update existing collection
					result = await updateMutation.mutateAsync({ collectionId: editingCollectionId, formData })
				} else {
					// Create new collection
					result = await publishMutation.mutateAsync(formData)
				}

				if (result) {
					collectionFormActions.reset()

					// Close the sheet and navigate
					document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
					navigate({ to: '/dashboard/products/collections' })
				}
			} catch (error) {
				// Error handling is done by the mutation hooks
				console.error(isEditing ? 'Error updating collection:' : 'Error creating collection:', error)
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
				<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'info' | 'products' | 'shipping')} className="w-full">
					<TabsList className="w-full rounded-none bg-transparent h-auto p-0 flex">
						<TabsTrigger
							value="info"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Info
						</TabsTrigger>
						<TabsTrigger
							value="products"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Products
						</TabsTrigger>
						<TabsTrigger
							value="shipping"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Shipping
						</TabsTrigger>
					</TabsList>

					<TabsContent value="info" className="mt-4">
						<InfoTab />
					</TabsContent>

					<TabsContent value="products" className="mt-4">
						<ProductsTab />
					</TabsContent>

					<TabsContent value="shipping" className="mt-4">
						<ShippingTab />
					</TabsContent>
				</Tabs>
			</div>

			{showFooter && (
				<div className="p-6 mt-auto sticky bottom-0 bg-white border-t">
					<div className="flex gap-2 w-full">
						{(activeTab === 'products' || activeTab === 'shipping') && (
							<Button 
								type="button" 
								variant="outline" 
								className="flex-1 gap-2 uppercase" 
								onClick={() => {
									if (activeTab === 'products') {
										setActiveTab('info')
									} else if (activeTab === 'shipping') {
										setActiveTab('products')
									}
								}}
							>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{activeTab === 'shipping' || isEditing ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([canSubmit, isSubmitting]) => (
									<Button
										type="submit"
										variant="secondary"
										className="flex-1 uppercase"
										disabled={isSubmitting || isPublishing || !canSubmit || !name || !description}
									>
										{isSubmitting || isPublishing
											? isEditing
												? 'Updating...'
												: 'Creating...'
											: isEditing
												? 'Update Collection'
												: 'Create Collection'}
									</Button>
								)}
							/>
						) : (
							<Button
								type="button"
								variant="secondary"
								className="flex-1 uppercase"
								onClick={() => {
									if (activeTab === 'info') {
										setActiveTab('products')
									} else if (activeTab === 'products') {
										setActiveTab('shipping')
									}
								}}
								disabled={!name || !description}
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
