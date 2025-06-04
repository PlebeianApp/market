import { Button } from '@/components/ui/button'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES } from '@/lib/constants'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'

export function DetailTab() {
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
						{Array.isArray(CURRENCIES) &&
							CURRENCIES.map((curr: string) => (
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

export function CategoryTab() {
	const { categories, mainCategory } = useStore(productFormStore)

	// Available main categories
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

	const handleMainCategorySelect = (value: string) => {
		productFormActions.updateValues({ mainCategory: value })
	}

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

	const removeSubCategory = (index: number) => {
		productFormActions.updateCategories(categories.filter((_, i) => i !== index))
	}

	const updateCategoryName = (index: number, name: string) => {
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

export function ImagesTab() {
	const { images } = useStore(productFormStore)
	const [needsUploader, setNeedsUploader] = useState(true)

	const handleSaveImage = ({ url, index }: { url: string; index: number }) => {
		if (index >= 0) {
			const newImages = [...images]
			newImages[index] = { ...newImages[index], imageUrl: url }
			productFormActions.updateImages(newImages)
		} else {
			productFormActions.updateImages([
				...images,
				{
					imageUrl: url,
					imageOrder: images.length,
				},
			])
			setNeedsUploader(true)
		}
	}

	const handleDeleteImage = (index: number) => {
		productFormActions.updateImages(images.filter((_, i) => i !== index).map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handlePromoteImage = (index: number) => {
		if (index <= 0) return
		const newImages = [...images]
		const temp = newImages[index]
		newImages[index] = newImages[index - 1]
		newImages[index - 1] = temp
		productFormActions.updateImages(newImages.map((img, i) => ({ ...img, imageOrder: i })))
	}

	const handleDemoteImage = (index: number) => {
		if (index >= images.length - 1) return
		const newImages = [...images]
		const temp = newImages[index]
		newImages[index] = newImages[index + 1]
		newImages[index + 1] = temp
		productFormActions.updateImages(newImages.map((img, i) => ({ ...img, imageOrder: i })))
	}

	return (
		<div className="space-y-4">
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>

			<div className="flex flex-col gap-4">
				<Label>Image Upload</Label>

				{images.map((image, i) => (
					<ImageUploader
						key={i}
						src={image.imageUrl}
						index={i}
						imagesLength={images.length}
						onSave={handleSaveImage}
						onDelete={handleDeleteImage}
						onPromote={handlePromoteImage}
						onDemote={handleDemoteImage}
					/>
				))}

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

export function ShippingTab() {
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

export function SpecTab() {
	const { specs, weight, dimensions } = useStore(productFormStore)
	const [newSpecKey, setNewSpecKey] = useState('')
	const [newSpecValue, setNewSpecValue] = useState('')

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

			{/* Weight and dimensions sections would continue here... */}
		</div>
	)
} 