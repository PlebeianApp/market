import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useForm } from '@tanstack/react-form'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useStore } from '@tanstack/react-store'
import { productFormStore, productFormActions, DEFAULT_FORM_STATE } from '@/lib/stores/product'
import { CURRENCIES } from '@/queries/external'
import { ndkActions } from '@/lib/stores/ndk'
import { useNavigate } from '@tanstack/react-router'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { authStore, authActions } from '@/lib/stores/auth'

/**
 * IMPORTANT IMPLEMENTATION PATTERN:
 *
 * This form persists all user input to the product store in real-time.
 * For all field values:
 *
 * 1. ALWAYS read initial values from the store (not local state)
 * 2. ALWAYS update the store immediately on user input (don't wait for form submission)
 *
 * This ensures that if a user starts filling out the form, navigates away,
 * and returns later, all their progress is preserved.
 */

function NameTab() {
	const { productType, name, description } = useStore(productFormStore)

	const form = useForm({
		defaultValues: {
			name: name,
			description: description,
			collection: '',
			productType: productType,
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
			price: price,
			quantity: quantity,
			currency: currency,
			status: status,
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
		// If we're dealing with a non-existent category, create it
		if (index >= categories.length) {
			if (name.trim()) {
				productFormActions.updateCategories([
					...categories,
					{
						key: `category-${Date.now()}`,
						name,
						checked: true,
					},
				])
			}
			return
		}

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

					<div className="space-y-2">
						{/* First category input - always show */}
						<div className="grid w-full gap-1.5">
							<Label>Sub Category 1</Label>
							<div className="relative">
								<Input
									value={categories[0]?.name || ''}
									onChange={(e) => updateCategoryName(0, e.target.value)}
									className="flex-1 border-2 pr-10"
									placeholder="e.g Bitcoin Miners"
								/>
								{categories.length > 0 && (
									<Button
										type="button"
										variant="ghost"
										className="absolute right-0 top-0 h-full px-2 text-black"
										onClick={() => removeSubCategory(0)}
									>
										<span className="i-delete w-5 h-5"></span>
									</Button>
								)}
							</div>
						</div>

						{/* Additional categories */}
						{categories.slice(1).map((category, index) => (
							<div key={category.key} className="grid w-full gap-1.5">
								<Label>Sub Category {index + 2}</Label>
								<div className="relative">
									<Input
										value={category.name}
										onChange={(e) => updateCategoryName(index + 1, e.target.value)}
										className="flex-1 border-2 pr-10"
										placeholder="e.g Bitcoin Miners"
									/>
									<Button
										type="button"
										variant="ghost"
										className="absolute right-0 top-0 h-full px-2 text-black"
										onClick={() => removeSubCategory(index + 1)}
									>
										<span className="i-delete w-5 h-5"></span>
									</Button>
								</div>
							</div>
						))}
					</div>

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
	const { specs, weight, dimensions } = useStore(productFormStore)
	const [newSpecKey, setNewSpecKey] = useState('')
	const [newSpecValue, setNewSpecValue] = useState('')

	// Form for weight and dimensions
	const form = useForm({
		defaultValues: {
			weightValue: weight?.value || '',
			weightUnit: weight?.unit || 'kg',
			dimensionsValue: dimensions?.value || '',
			dimensionsUnit: dimensions?.unit || 'cm',
		},
		onSubmit: async ({ value }) => {
			// This is handled by the onChange handlers
		},
	})

	const addSpec = () => {
		if (newSpecKey.trim() && newSpecValue.trim()) {
			productFormActions.updateValues({
				specs: [...specs, { key: newSpecKey, value: newSpecValue }],
			})
			setNewSpecKey('')
			setNewSpecValue('')
		}
	}

	const removeSpec = (index: number) => {
		productFormActions.updateValues({
			specs: specs.filter((_, i) => i !== index),
		})
	}

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<h3 className="text-sm font-medium">Product Specifications</h3>

				{/* Display existing specs */}
				{specs.length > 0 && (
					<div className="space-y-2 mb-4">
						{specs.map((spec, index) => (
							<div key={index} className="flex items-center gap-2 p-2 border rounded-md">
								<div className="flex-1">
									<span className="font-medium">{spec.key}: </span>
									<span>{spec.value}</span>
								</div>
								<Button type="button" variant="ghost" className="h-8 w-8 p-0" onClick={() => removeSpec(index)}>
									<span className="i-delete w-5 h-5"></span>
								</Button>
							</div>
						))}
					</div>
				)}

				{/* Add new spec */}
				<div className="grid grid-cols-2 gap-3">
					<div className="grid w-full gap-1.5">
						<Label htmlFor="spec-key">Property</Label>
						<Input
							id="spec-key"
							value={newSpecKey}
							onChange={(e) => setNewSpecKey(e.target.value)}
							className="border-2"
							placeholder="e.g. Material"
						/>
					</div>

					<div className="grid w-full gap-1.5">
						<Label htmlFor="spec-value">Value</Label>
						<Input
							id="spec-value"
							value={newSpecValue}
							onChange={(e) => setNewSpecValue(e.target.value)}
							className="border-2"
							placeholder="e.g. Cotton"
						/>
					</div>
				</div>

				<Button
					type="button"
					variant="outline"
					className="w-full flex gap-2 justify-center"
					onClick={addSpec}
					disabled={!newSpecKey.trim() || !newSpecValue.trim()}
				>
					<span className="i-plus w-5 h-5"></span>
					Add Specification
				</Button>
			</div>

			{/* Weight section */}
			<div className="space-y-3 pt-4 border-t">
				<h3 className="text-sm font-medium">Product Weight</h3>
				<div className="grid grid-cols-5 gap-3">
					<form.Field
						name="weightValue"
						validators={{
							onChange: (field) => {
								if (field.value && !/^\d*\.?\d*$/.test(field.value)) {
									return 'Please enter a valid number'
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div className="col-span-3 grid w-full gap-1.5">
								<Label htmlFor={field.name}>Weight</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => {
										field.handleChange(e.target.value)
										// Update the store immediately
										if (e.target.value.trim()) {
											productFormActions.updateValues({
												weight: {
													value: e.target.value,
													unit: form.getFieldValue('weightUnit'),
												},
											})
										} else {
											productFormActions.updateValues({ weight: null })
										}
									}}
									className="border-2"
									placeholder="e.g. 1.5"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
							</div>
						)}
					</form.Field>

					<form.Field name="weightUnit">
						{(field) => (
							<div className="col-span-2 grid w-full gap-1.5">
								<Label htmlFor={field.name}>Unit</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) => {
										field.handleChange(value)
										// Update the store immediately
										const weightValue = form.getFieldValue('weightValue')
										if (weightValue.trim()) {
											productFormActions.updateValues({
												weight: {
													value: weightValue,
													unit: value,
												},
											})
										}
									}}
								>
									<SelectTrigger id={field.name} className="border-2 h-10">
										<SelectValue placeholder="Unit" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="g">g</SelectItem>
										<SelectItem value="kg">kg</SelectItem>
										<SelectItem value="oz">oz</SelectItem>
										<SelectItem value="lb">lb</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>
				</div>
			</div>

			{/* Dimensions section */}
			<div className="space-y-3 pt-4 border-t">
				<h3 className="text-sm font-medium">Product Dimensions</h3>
				<div className="grid grid-cols-5 gap-3">
					<form.Field
						name="dimensionsValue"
						validators={{
							onChange: (field) => {
								if (field.value && !/^\d+x\d+x\d+$/.test(field.value)) {
									return 'Format should be like 10x20x30'
								}
								return undefined
							},
						}}
					>
						{(field) => (
							<div className="col-span-3 grid w-full gap-1.5">
								<Label htmlFor={field.name}>Dimensions (L×W×H)</Label>
								<Input
									id={field.name}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => {
										field.handleChange(e.target.value)
										// Update the store immediately
										if (e.target.value.trim()) {
											productFormActions.updateValues({
												dimensions: {
													value: e.target.value,
													unit: form.getFieldValue('dimensionsUnit'),
												},
											})
										} else {
											productFormActions.updateValues({ dimensions: null })
										}
									}}
									className="border-2"
									placeholder="e.g. 10x20x30"
								/>
								{field.state.meta.errors?.length > 0 && field.state.meta.isTouched && (
									<div className="text-red-500 text-sm mt-1">{field.state.meta.errors.join(', ')}</div>
								)}
								<p className="text-xs text-gray-500">Format: Length × Width × Height</p>
							</div>
						)}
					</form.Field>

					<form.Field name="dimensionsUnit">
						{(field) => (
							<div className="col-span-2 grid w-full gap-1.5 self-start">
								<Label htmlFor={field.name}>Unit</Label>
								<Select
									value={field.state.value}
									onValueChange={(value) => {
										field.handleChange(value)
										// Update the store immediately
										const dimensionsValue = form.getFieldValue('dimensionsValue')
										if (dimensionsValue.trim()) {
											productFormActions.updateValues({
												dimensions: {
													value: dimensionsValue,
													unit: value,
												},
											})
										}
									}}
								>
									<SelectTrigger id={field.name} className="border-2 h-10">
										<SelectValue placeholder="Unit" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="mm">mm</SelectItem>
										<SelectItem value="cm">cm</SelectItem>
										<SelectItem value="m">m</SelectItem>
										<SelectItem value="in">in</SelectItem>
										<SelectItem value="ft">ft</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>
				</div>
			</div>
		</div>
	)
}

export function NewProductContent() {
	const [isPublishing, setIsPublishing] = useState(false)
	const navigate = useNavigate()
	const [hasProducts, setHasProducts] = useState(false)

	// Get form state from store
	const formState = useStore(productFormStore)
	const { mainTab, productSubTab } = formState

	// Get user and authentication status from auth store
	const { user, isAuthenticated } = useStore(authStore)

	// Function to check if the form has been modified from its default state
	const isFormModified = (currentState: typeof productFormStore.state) => {
		return (
			currentState.name !== DEFAULT_FORM_STATE.name ||
			currentState.description !== DEFAULT_FORM_STATE.description ||
			currentState.price !== DEFAULT_FORM_STATE.price ||
			currentState.quantity !== DEFAULT_FORM_STATE.quantity ||
			currentState.specs.length > 0 ||
			currentState.categories.length > 0 ||
			currentState.images.length > 0 ||
			currentState.weight !== DEFAULT_FORM_STATE.weight ||
			currentState.dimensions !== DEFAULT_FORM_STATE.dimensions
		)
	}

	// Check if the user has started filling in the form
	const hasStartedForm = isFormModified(formState)

	// Update showForm whenever hasStartedForm or hasProducts changes
	const [showForm, setShowForm] = useState(hasStartedForm)

	// Check if user has products when component mounts
	useEffect(() => {
		const checkUserProducts = async () => {
			if (isAuthenticated && user) {
				const hasUserProducts = await authActions.userHasProducts()
				setHasProducts(hasUserProducts)
			}
		}

		checkUserProducts()
	}, [isAuthenticated, user])

	// Update showForm whenever hasStartedForm or hasProducts changes
	useEffect(() => {
		if ((hasStartedForm || hasProducts) && !showForm) {
			setShowForm(true)
		}
	}, [hasStartedForm, hasProducts, showForm])

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
