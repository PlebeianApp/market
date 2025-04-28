import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@tanstack/react-store'
import { productFormStore, productFormActions } from '@/lib/stores/product'
import { CURRENCIES } from '@/queries/external'
import { ndkActions } from '@/lib/stores/ndk'
import { useNavigate } from '@tanstack/react-router'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'

// Helper function to check if form has been started
function hasStartedFillingForm(formState: typeof productFormStore.state) {
	// Check if any essential fields have been filled
	return !!(
		formState.name ||
		formState.description ||
		formState.price ||
		formState.quantity ||
		formState.spec ||
		formState.categories.length > 0 ||
		formState.images.length > 0
	)
}

function NameTab() {
	const { productType } = useStore(productFormStore)

	const form = useForm({
		defaultValues: {
			name: '',
			description: '',
			collection: '',
			productType: 'single',
		},
		onSubmit: async ({ value }) => {
			productFormActions.updateValues({
				name: value.name,
				description: value.description,
				productType: value.productType as 'single' | 'variable',
			})
		},
	})

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				{/* TODO: enumrate available collections */}
				<Label>Collection</Label>
				<Select value={'not-in-collection'} disabled>
					<SelectTrigger className="border-2">
						<SelectValue placeholder="Not In A Collection" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="not-in-collection">Not In A Collection</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Product Type</span>
				</Label>
				<Select
					value={productType}
					onValueChange={(value) => productFormActions.updateValues({ productType: value as 'single' | 'variable' })}
				>
					{/* TODO: add variants */}
					<SelectTrigger className="border-2" disabled>
						<SelectValue placeholder="Single Product" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="single">Single Product</SelectItem>
						<SelectItem value="variable">Product with variants</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<form.Field
				name="name"
				validators={{
					onChange: (field) => (!field.value ? 'Product name is required' : undefined),
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Title</span>
						</Label>
						<Input
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ name: e.target.value })
							}}
							className="border-2"
							placeholder="e.g Art Print"
							required
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>

			<form.Field
				name="description"
				validators={{
					onChange: (field) => (!field.value ? 'Description is required' : undefined),
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
						</Label>
						<textarea
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ description: e.target.value })
							}}
							className="border-2 min-h-24 p-2 rounded-md"
							placeholder="More information about your product to help your customers"
							required
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>
		</div>
	)
}

function DetailTab() {
	const { price, quantity, currency, status } = useStore(productFormStore)

	const form = useForm({
		defaultValues: {
			price: '',
			quantity: '',
			currency: 'SATS',
			status: 'hidden' as const,
		},
		onSubmit: async ({ value }) => {
			productFormActions.updateValues({
				price: value.price,
				quantity: value.quantity,
				currency: value.currency,
				status: value.status,
			})
		},
	})

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Currency</span>
				</Label>
				<Select value={currency} onValueChange={(value) => productFormActions.updateValues({ currency: value })}>
					<SelectTrigger className="border-2">
						<SelectValue placeholder="Select currency" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="SATS">SATS</SelectItem>
						{CURRENCIES.map((curr) => (
							<SelectItem key={curr} value={curr}>
								{curr}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<form.Field
				name="price"
				validators={{
					onChange: (field) => {
						if (!field.value) return 'Price is required'
						if (!/^[0-9]*$/.test(field.value)) return 'Please enter a valid number'
						return undefined
					},
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Price</span>
							<small className="font-light ml-1">(In {currency})</small>
						</Label>
						<Input
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ price: e.target.value })
							}}
							className="border-2"
							placeholder="e.g. 100000"
							required
							pattern="[0-9]*"
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>

			<form.Field
				name="quantity"
				validators={{
					onChange: (field) => {
						if (!field.value) return 'Quantity is required'
						if (!/^[0-9]*$/.test(field.value)) return 'Please enter a valid number'
						return undefined
					},
				}}
			>
				{(field) => (
					<div className="grid w-full gap-1.5">
						<Label htmlFor={field.name}>
							<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Quantity</span>
						</Label>
						<Input
							id={field.name}
							name={field.name}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(e) => {
								field.handleChange(e.target.value)
								productFormActions.updateValues({ quantity: e.target.value })
							}}
							className="border-2"
							placeholder="e.g. 100"
							required
							pattern="[0-9]*"
						/>
						{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
							<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
						)}
					</div>
				)}
			</form.Field>

			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Status</span>
				</Label>
				<Select
					value={status}
					onValueChange={(value) => productFormActions.updateValues({ status: value as 'hidden' | 'on-sale' | 'pre-order' })}
				>
					<SelectTrigger className="border-2">
						<SelectValue placeholder="Select status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="hidden">Hidden</SelectItem>
						<SelectItem value="on-sale">On Sale</SelectItem>
						<SelectItem value="pre-order">Pre-Order</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
	)
}

function CategoryTab() {
	const { categories, mainCategory } = useStore(productFormStore)

	// Available main categories
	// TODO: define this somewhere globally
	const mainCategories = [
		'Bitcoin',
		'Art',
		'Clothing',
		'Food & Drink',
		'Home & Technology',
		'Health & Beauty',
		'Sports & Outside',
		'Services',
		'Other',
	]

	// Handle main category selection
	const handleMainCategorySelect = (value: string) => {
		productFormActions.updateValues({ mainCategory: value })
	}

	// Handle adding a new sub category
	const addSubCategory = () => {
		productFormActions.updateCategories([
			...categories,
			{
				key: `category-${Date.now()}`,
				name: '',
				checked: true,
			},
		])
	}

	// Handle removing a sub category
	const removeSubCategory = (index: number) => {
		productFormActions.updateCategories(categories.filter((_, i) => i !== index))
	}

	// Update category name
	const updateCategoryName = (index: number, name: string) => {
		const newCategories = [...categories]
		newCategories[index] = { ...newCategories[index], name }
		productFormActions.updateCategories(newCategories)
	}

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Main Category</span>
				</Label>
				<Select value={mainCategory || ''} onValueChange={handleMainCategorySelect}>
					<SelectTrigger className="border-2">
						<SelectValue placeholder="Select a Main Category" />
					</SelectTrigger>
					<SelectContent>
						{mainCategories.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{mainCategory && (
				<>
					<p className="text-gray-600">Pick a sub category that better represents the nature of your product</p>

					{categories.length > 0 && (
						<div className="space-y-2">
							{categories.map((category, index) => (
								<div key={category.key} className="grid w-full gap-1.5">
									<Label>{index === 0 ? 'Sub Category 1' : `Sub Category ${index + 1}`}</Label>
									<div className="relative">
										<Input
											value={category.name}
											onChange={(e) => updateCategoryName(index, e.target.value)}
											className="flex-1 border-2 pr-10"
											placeholder="e.g Bitcoin Miners"
										/>
										<Button
											type="button"
											variant="ghost"
											className="absolute right-0 top-0 h-full px-2 text-black"
											onClick={() => removeSubCategory(index)}
										>
											<span className="i-delete w-5 h-5"></span>
										</Button>
									</div>
								</div>
							))}
						</div>
					)}

					{categories.length === 0 && (
						<div className="grid w-full gap-1.5">
							<Label>Sub Category 1</Label>
							<Input
								className="flex-1 border-2"
								placeholder="e.g Bitcoin Miners"
								value=""
								onChange={(e) => {
									// If there are no categories yet, add one when user starts typing
									if (e.target.value) {
										productFormActions.updateCategories([
											{
												key: `category-${Date.now()}`,
												name: e.target.value,
												checked: true,
											},
										])
									}
								}}
							/>
						</div>
					)}

					<Button type="button" variant="outline" className="w-full flex gap-2 justify-center mt-4" onClick={addSubCategory}>
						<span className="i-plus w-5 h-5"></span>
						New Sub Category
					</Button>
				</>
			)}
		</div>
	)
}

function ImagesTab() {
	const { images } = useStore(productFormStore)
	// Just tracking if we need an uploader, not URLs
	const [needsUploader, setNeedsUploader] = useState(true)

	const handleSaveImage = ({ url, index }: { url: string; index: number }) => {
		if (index >= 0) {
			// Update existing image
			const newImages = [...images]
			newImages[index] = { ...newImages[index], imageUrl: url }
			productFormActions.updateImages(newImages)
		} else {
			// Add new image from a pending URL
			productFormActions.updateImages([
				...images,
				{
					imageUrl: url,
					imageOrder: images.length,
				},
			])

			// We always need a fresh uploader after saving
			setNeedsUploader(true)
		}
	}

	const handleDeleteImage = (index: number) => {
		productFormActions.updateImages(images.filter((_, i) => i !== index).map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handlePromoteImage = (index: number) => {
		if (index <= 0) return

		const newImages = [...images]
		// Swap positions
		const temp = newImages[index]
		newImages[index] = newImages[index - 1]
		newImages[index - 1] = temp

		// Update orders
		productFormActions.updateImages(newImages.map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handleDemoteImage = (index: number) => {
		if (index >= images.length - 1) return

		const newImages = [...images]
		// Swap positions
		const temp = newImages[index]
		newImages[index] = newImages[index + 1]
		newImages[index + 1] = temp

		// Update orders
		productFormActions.updateImages(newImages.map((img, i) => ({ ...img, imageOrder: i })))
	}

	return (
		<div className="space-y-4">
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>

			<div className="flex flex-col gap-4">
				<Label>Image Upload</Label>

				{/* Display existing saved images */}
				{images.map((image, i) => (
					<ImageUploader
						src={image.imageUrl}
						index={i}
						imagesLength={images.length}
						onSave={handleSaveImage}
						onDelete={handleDeleteImage}
						onPromote={handlePromoteImage}
						onDemote={handleDemoteImage}
					/>
				))}

				{/* Empty image uploader - always just show one */}
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

function ShippingTab() {
	const { shippings } = useStore(productFormStore)

	return (
		<div className="space-y-4">
			<p className="text-gray-600">Add various shipping options you'd like to make available to customers</p>

			<Button type="button" variant="focus" className="w-full">
				Add a Shipping Option
			</Button>

			<Button type="button" variant="outline" className="w-full">
				Save & Set Up Shipping Later
			</Button>
		</div>
	)
}

function SpecTab() {
	const { spec } = useStore(productFormStore)

	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label>Specifications</Label>
				<textarea
					className="border-2 min-h-24 p-2 rounded-md"
					placeholder="e.g 10 Kg, 30x40cm"
					value={spec}
					onChange={(e) => productFormActions.updateValues({ spec: e.target.value })}
				/>
				<p className="text-xs text-gray-500">Enter product specifications like weight, dimensions, etc.</p>
			</div>
		</div>
	)
}

export function NewProductContent() {
	const [isPublishing, setIsPublishing] = useState(false)
	const navigate = useNavigate()

	// Get form state from store
	const formState = useStore(productFormStore)
	const { mainTab, productSubTab } = formState

	// Check if the user has started filling in the form
	const hasStartedForm = hasStartedFillingForm(formState)
	// For now, we only check if form has been started since we don't track user products yet
	const [showForm, setShowForm] = useState(hasStartedForm)

	const form = useForm({
		defaultValues: {},
		onSubmit: async () => {
			try {
				console.log('Submitting product data')
				setIsPublishing(true)

				// Get NDK instance and signer
				const ndk = ndkActions.getNDK()
				const signer = ndkActions.getSigner()

				if (!ndk) {
					toast.error('NDK not initialized')
					return
				}

				if (!signer) {
					toast.error('You need to connect your wallet first')
					return
				}

				// Publish product to Nostr
				const result = await productFormActions.publishProduct(signer, ndk)

				if (result) {
					toast.success('Product published successfully!')
					productFormActions.reset()
					setShowForm(false)

					// Navigate to the product page if we have an event ID
					if (typeof result === 'string') {
						// Close any open modal/sheet first
						document.body.dispatchEvent(
							new KeyboardEvent('keydown', {
								key: 'Escape',
								bubbles: true,
							}),
						)

						// Navigate to the product page
						navigate({ to: `/products/${result}` })
					}
				} else {
					toast.error('Failed to publish product')
				}
			} catch (error) {
				console.error('Error creating product:', error)
				toast.error('Failed to create product')
			} finally {
				setIsPublishing(false)
			}
		},
	})

	if (!showForm) {
		return (
			<SheetContent side="right">
				{/* This is for Accessibility but we don't need to show it */}
				<SheetHeader className="hidden">
					<SheetTitle>Welcome to Plebeian Market</SheetTitle>
					<SheetDescription>Start selling your products in just a few minutes</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col h-full justify-between items-center px-4 pb-12">
					{/* Spacer */}
					<div />
					<div className="flex flex-col justify-center items-center gap-4">
						<div className="flex justify-center mt-8">
							<img src="/images/logo.svg" alt="Plebeian Market Logo" className="w-16 h-16" />
						</div>

						<h1 className="text-2xl font-heading text-balance text-center">WELCOME TO</h1>
						<h1 className="text-2xl font-heading text-balance text-center">PLEBEIAN MARKET</h1>
						<h2 className="text-xl font-mono text-balance text-center text-gray-600">
							Start selling your products
							<br />
							in just a few minutes
						</h2>
					</div>
					{/* Spacer */}
					<div />
					<Button variant="secondary" className="w-full" onClick={() => setShowForm(true)}>
						LET'S GO
					</Button>
				</div>
			</SheetContent>
		)
	}

	return (
		<SheetContent side="right" className="flex flex-col max-h-screen overflow-hidden">
			<SheetHeader>
				<SheetTitle className="text-center">Add A Product</SheetTitle>
				<SheetDescription className="hidden">Create a new product to sell in your shop</SheetDescription>
			</SheetHeader>

			<form
				onSubmit={(e) => {
					e.preventDefault()
					e.stopPropagation()
					form.handleSubmit()
				}}
				className="flex flex-col h-full overflow-hidden"
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

				<SheetFooter className="p-6 mt-auto sticky bottom-0 bg-white">
					<div className="flex gap-2 w-full">
						{(productSubTab !== 'name' || mainTab === 'shipping') && (
							<Button type="button" variant="outline" className="flex-1 gap-2 uppercase" onClick={productFormActions.previousTab}>
								<span className="i-back w-6 h-6"></span>
								Back
							</Button>
						)}

						{mainTab === 'shipping' ? (
							<form.Subscribe
								selector={(state) => [state.canSubmit, state.isSubmitting]}
								children={([canSubmit, isSubmitting]) => (
									<Button
										type="submit"
										variant="secondary"
										className="flex-1 uppercase"
										disabled={isSubmitting || isPublishing || !canSubmit}
									>
										{isSubmitting || isPublishing ? 'Publishing...' : 'Save'}
									</Button>
								)}
							/>
						) : (
							<Button type="button" variant="secondary" className="flex-1 uppercase" onClick={productFormActions.nextTab}>
								Next
							</Button>
						)}
					</div>
				</SheetFooter>
			</form>
		</SheetContent>
	)
}
