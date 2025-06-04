import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ndkActions } from '@/lib/stores/ndk'
import { collectionFormStore, collectionFormActions } from '@/lib/stores/collection'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { toast } from 'sonner'
import { InfoTab } from './InfoTab'
import { ProductsTab } from './ProductsTab'

export function CollectionFormContent({ className = '', showFooter = true }: { className?: string; showFooter?: boolean }) {
	const [isPublishing, setIsPublishing] = useState(false)
	const navigate = useNavigate()
	const [activeTab, setActiveTab] = useState<'info' | 'products'>('info')

	// Get form state from store
	const formState = useStore(collectionFormStore)
	const { isEditing, name, description } = formState

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

				const result = await collectionFormActions.publishCollection(signer, ndk)

				if (result) {
					toast.success(isEditing ? 'Collection updated successfully!' : 'Collection created successfully!')
					collectionFormActions.reset()

					// Close the sheet and navigate
					document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
					navigate({ to: '/dashboard/products/collections' })
				} else {
					toast.error(isEditing ? 'Failed to update collection' : 'Failed to create collection')
				}
			} catch (error) {
				console.error(isEditing ? 'Error updating collection:' : 'Error creating collection:', error)
				toast.error(isEditing ? 'Failed to update collection' : 'Failed to create collection')
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
				<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'info' | 'products')} className="w-full">
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
					</TabsList>

					<TabsContent value="info" className="mt-4">
						<InfoTab />
					</TabsContent>

					<TabsContent value="products" className="mt-4">
						<ProductsTab />
					</TabsContent>
				</Tabs>
			</div>

			{showFooter && (
				<div className="p-6 mt-auto sticky bottom-0 bg-white border-t">
					<div className="flex gap-2 w-full">
						{activeTab === 'products' && (
							<Button type="button" variant="outline" className="flex-1 gap-2 uppercase" onClick={() => setActiveTab('info')}>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{activeTab === 'products' || isEditing ? (
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
								onClick={() => setActiveTab('products')}
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
