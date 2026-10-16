import type { ReactNode } from 'react'
import { ArrowLeft, Loader2, PlusIcon, X } from 'lucide-react'
import type { Nip15ProductData } from '@sdk/commerce/products/nip15Migration'
import { Button } from '../../primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../primitives/card'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../primitives/select'
import { Textarea } from '../../primitives/textarea'
import { Media } from '../Media'

export interface MigrationFormData {
	name: string
	summary: string
	description: string
	price: string
	currency: string
	quantity: string
	status: 'hidden' | 'on-sale' | 'pre-order'
	productType: 'single' | 'variable'
	mainCategory: string
	images: Array<{ imageUrl: string; imageOrder: number }>
	specs: Array<{ key: string; value: string }>
	categories: Array<{ key: string; name: string; checked: boolean }>
	shippings: Array<{ shipping: { id: string; name: string } | null; extraCost: string }>
	weight: { value: string; unit: string } | null
	dimensions: { value: string; unit: string } | null
	selectedCollection: string | null
}

export interface MigrationShippingOption {
	id: string
	name?: string
	cost?: number
	currency?: string
	countries?: string[]
}

export interface MigrationCollectionOption {
	id: string
	name: string
	pubkey: string
}

export interface MigrationFormViewProps {
	original: Nip15ProductData
	formData: MigrationFormData
	onChange: (patch: Partial<MigrationFormData>) => void
	currencies: readonly string[]
	categories: readonly string[]
	/** Host image uploader for the image at `index`. */
	renderImageUploader: (index: number) => ReactNode
	shippingOptions: readonly MigrationShippingOption[]
	isLoadingShipping: boolean
	collections: readonly MigrationCollectionOption[]
	isLoadingCollections: boolean
	onAddSubCategory: () => void
	onAddShipping: (option: MigrationShippingOption) => void
	isPublishing: boolean
	onSubmit: () => void
	onBack: () => void
	/** Progress dialog shown while publishing. */
	progressDialog: ReactNode
}

function RequiredLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
	return (
		<Label htmlFor={htmlFor}>
			<span className="after:content-['*'] after:ml-0.5 after:text-red-500">{children}</span>
		</Label>
	)
}

function LoadingRow({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 text-gray-500">
			<Loader2 className="w-4 h-4 animate-spin" />
			<span>{label}</span>
		</div>
	)
}

function describeCountries(countries: string[] | undefined): string {
	if (!countries || countries.length === 0) return 'Worldwide'
	return countries.length > 1 ? `${countries.length} countries` : countries[0]
}

function UnitValueField({
	label,
	hint,
	placeholder,
	value,
	units,
	defaultUnit,
	numeric,
	onChange,
}: {
	label: string
	hint?: string
	placeholder: string
	value: { value: string; unit: string } | null
	units: readonly string[]
	defaultUnit: string
	numeric?: boolean
	onChange: (value: { value: string; unit: string } | null) => void
}) {
	return (
		<div>
			<Label>{label}</Label>
			{hint && <p className="text-sm text-gray-500 mt-1 mb-2">{hint}</p>}
			<div className={hint ? 'flex gap-2' : 'flex gap-2 mt-2'}>
				<Input
					{...(numeric ? { type: 'number', step: '0.01', min: '0' } : {})}
					placeholder={placeholder}
					value={value?.value || ''}
					onChange={(e) => onChange(e.target.value ? { value: e.target.value, unit: value?.unit || defaultUnit } : null)}
					className="flex-1"
				/>
				<Select value={value?.unit || defaultUnit} onValueChange={(unit) => onChange(value ? { ...value, unit } : { value: '', unit })}>
					<SelectTrigger className="w-24">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{units.map((unit) => (
							<SelectItem key={unit} value={unit}>
								{unit}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	)
}

export function MigrationFormView({
	original,
	formData,
	onChange,
	currencies,
	categories,
	renderImageUploader,
	shippingOptions,
	isLoadingShipping,
	collections,
	isLoadingCollections,
	onAddSubCategory,
	onAddShipping,
	isPublishing,
	onSubmit,
	onBack,
	progressDialog,
}: MigrationFormViewProps) {
	return (
		<div className="p-4 lg:p-6 space-y-6">
			{progressDialog}

			<Button variant="ghost" onClick={onBack} className="mb-4">
				<ArrowLeft className="w-4 h-4 mr-2" />
				Back to list
			</Button>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<Card>
					<CardHeader>
						<CardTitle>NIP-15 Original</CardTitle>
						<CardDescription>Read-only view of the original NIP-15 product</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label>Name</Label>
							<Input value={original.name} readOnly className="bg-gray-50" />
						</div>
						<div>
							<Label>Description</Label>
							<Textarea value={original.description} readOnly className="bg-gray-50 min-h-[100px]" />
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Label>Price</Label>
								<Input value={`${original.price} ${original.currency}`} readOnly className="bg-gray-50" />
							</div>
							{original.quantity !== null && (
								<div>
									<Label>Quantity</Label>
									<Input value={original.quantity.toString()} readOnly className="bg-gray-50" />
								</div>
							)}
						</div>
						{original.images.length > 0 && (
							<div>
								<Label>Images</Label>
								<div className="grid grid-cols-2 gap-2 mt-2">
									{original.images.map((url, index) => (
										<Media key={index} src={url} alt={`Product image ${index + 1}`} className="w-full h-32 object-cover rounded border" />
									))}
								</div>
							</div>
						)}
						{original.specs.length > 0 && (
							<div>
								<Label>Specifications</Label>
								<div className="space-y-2 mt-2">
									{original.specs.map((spec, index) => (
										<div key={index} className="text-sm">
											<strong>{spec[0]}:</strong> {spec[1]}
										</div>
									))}
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>NIP-99 Enhanced Version</CardTitle>
						<CardDescription>Edit and enhance the product for NIP-99 format</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<RequiredLabel htmlFor="name">Product Name</RequiredLabel>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => onChange({ name: e.target.value })}
								placeholder="Enter product name"
							/>
						</div>

						<div>
							<RequiredLabel htmlFor="description">Description</RequiredLabel>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => onChange({ description: e.target.value })}
								placeholder="Enter product description"
								className="min-h-[100px]"
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<RequiredLabel htmlFor="price">Price</RequiredLabel>
								<Input
									id="price"
									type="number"
									value={formData.price}
									onChange={(e) => onChange({ price: e.target.value })}
									placeholder="0.00"
								/>
							</div>
							<div>
								<RequiredLabel htmlFor="currency">Currency</RequiredLabel>
								<Select value={formData.currency} onValueChange={(value) => onChange({ currency: value })}>
									<SelectTrigger id="currency">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{currencies.map((currency) => (
											<SelectItem key={currency} value={currency}>
												{currency}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div>
							<RequiredLabel htmlFor="quantity">Quantity</RequiredLabel>
							<Input
								id="quantity"
								type="number"
								value={formData.quantity}
								onChange={(e) => onChange({ quantity: e.target.value })}
								placeholder="1"
							/>
						</div>

						<div>
							<RequiredLabel htmlFor="mainCategory">Main Category</RequiredLabel>
							<Select value={formData.mainCategory} onValueChange={(value) => onChange({ mainCategory: value })}>
								<SelectTrigger id="mainCategory">
									<SelectValue placeholder="Select category" />
								</SelectTrigger>
								<SelectContent>
									{categories.map((category) => (
										<SelectItem key={category} value={category}>
											{category}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div>
							<RequiredLabel>Images</RequiredLabel>
							<div className="space-y-2 mt-2">
								{formData.images.map((_, index) => renderImageUploader(index))}
								<Button
									type="button"
									variant="outline"
									onClick={() => onChange({ images: [...formData.images, { imageUrl: '', imageOrder: formData.images.length }] })}
								>
									Add Image
								</Button>
							</div>
						</div>

						<div>
							<Label>Specifications</Label>
							<div className="space-y-2 mt-2">
								{formData.specs.map((spec, index) => {
									const updateSpec = (patch: Partial<{ key: string; value: string }>) =>
										onChange({ specs: formData.specs.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
									return (
										<div key={index} className="flex gap-2">
											<Input value={spec.key} onChange={(e) => updateSpec({ key: e.target.value })} placeholder="Key" />
											<Input value={spec.value} onChange={(e) => updateSpec({ value: e.target.value })} placeholder="Value" />
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => onChange({ specs: formData.specs.filter((_, i) => i !== index) })}
											>
												Remove
											</Button>
										</div>
									)
								})}
								<Button type="button" variant="outline" onClick={() => onChange({ specs: [...formData.specs, { key: '', value: '' }] })}>
									Add Specification
								</Button>
							</div>
						</div>

						{formData.mainCategory && (
							<div>
								<Label>Sub Categories (optional)</Label>
								<p className="text-sm text-gray-500 mt-1 mb-2">Add sub-categories to better describe your product</p>
								<div className="space-y-2">
									{formData.categories.map((category, index) => (
										<div key={category.key} className="flex gap-2">
											<Input
												value={category.name}
												onChange={(e) =>
													onChange({ categories: formData.categories.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)) })
												}
												placeholder={`Sub category ${index + 1}`}
												className="flex-1"
											/>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => onChange({ categories: formData.categories.filter((_, i) => i !== index) })}
											>
												<X className="w-4 h-4" />
											</Button>
										</div>
									))}
									<Button
										type="button"
										variant="outline"
										onClick={onAddSubCategory}
										disabled={formData.categories.length >= 3}
										className="w-full flex items-center gap-2"
									>
										<PlusIcon className="w-4 h-4" />
										Add Sub Category
									</Button>
								</div>
							</div>
						)}

						<div>
							<Label>Shipping Options</Label>
							<p className="text-sm text-gray-500 mt-1 mb-2">Select shipping methods available for this product</p>
							{isLoadingShipping ? (
								<LoadingRow label="Loading shipping options..." />
							) : shippingOptions.length === 0 ? (
								<p className="text-sm text-gray-500">No shipping options configured. You can add them in Dashboard → Shipping Options</p>
							) : (
								<div className="space-y-2">
									{formData.shippings.length > 0 && (
										<div className="space-y-2 mb-3">
											<Label className="text-sm text-gray-600">Selected:</Label>
											{formData.shippings.map((shipping, index) => (
												<div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded border">
													<div className="flex-1">
														<span className="font-medium">{shipping.shipping?.name}</span>
													</div>
													<Input
														type="number"
														step="0.01"
														min="0"
														value={shipping.extraCost}
														onChange={(e) =>
															onChange({
																shippings: formData.shippings.map((s, i) => (i === index ? { ...s, extraCost: e.target.value } : s)),
															})
														}
														placeholder="Extra cost"
														className="w-24 text-sm"
													/>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														onClick={() => onChange({ shippings: formData.shippings.filter((_, i) => i !== index) })}
													>
														<X className="w-4 h-4" />
													</Button>
												</div>
											))}
										</div>
									)}
									<div className="space-y-2">
										{shippingOptions.map((option) => {
											const isSelected = formData.shippings.some((s) => s.shipping?.id === option.id)
											return (
												<div
													key={option.id}
													className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${isSelected ? 'opacity-50' : ''}`}
													onClick={() => !isSelected && onAddShipping(option)}
												>
													<div className="flex-1">
														<div className="font-medium">{option.name}</div>
														<div className="text-sm text-gray-500">
															{option.cost} {option.currency} • {describeCountries(option.countries)}
														</div>
													</div>
													<Button type="button" variant="outline" size="sm" disabled={isSelected}>
														{isSelected ? 'Added' : 'Add'}
													</Button>
												</div>
											)
										})}
									</div>
								</div>
							)}
						</div>

						<UnitValueField
							label="Weight (optional)"
							placeholder="Weight value"
							value={formData.weight}
							units={['g', 'kg', 'oz', 'lb']}
							defaultUnit="kg"
							numeric
							onChange={(weight) => onChange({ weight })}
						/>

						<UnitValueField
							label="Dimensions (optional)"
							hint="Format: Length x Width x Height"
							placeholder="e.g., 10x5x3"
							value={formData.dimensions}
							units={['mm', 'cm', 'm', 'in', 'ft']}
							defaultUnit="cm"
							onChange={(dimensions) => onChange({ dimensions })}
						/>

						<div>
							<Label>Collection (optional)</Label>
							<p className="text-sm text-gray-500 mt-1 mb-2">Assign this product to a collection</p>
							{isLoadingCollections ? (
								<LoadingRow label="Loading collections..." />
							) : collections.length === 0 ? (
								<p className="text-sm text-gray-500">No collections found. You can create collections in Dashboard → Collections</p>
							) : (
								<Select
									value={formData.selectedCollection || 'none'}
									onValueChange={(value) => onChange({ selectedCollection: value === 'none' ? null : value })}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a collection" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										{collections.map((collection) => (
											<SelectItem key={collection.id} value={`30405:${collection.pubkey}:${collection.id}`}>
												{collection.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>

						<div className="flex gap-2 pt-4">
							<Button type="button" variant="outline" onClick={onBack} className="flex-1">
								Cancel
							</Button>
							<Button type="button" variant="secondary" onClick={onSubmit} disabled={isPublishing} className="flex-1">
								{isPublishing ? 'Migrating...' : 'Migrate Product'}
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
