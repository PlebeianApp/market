import { useState, type ReactNode } from 'react'
import type { ProductShippingOption } from '@sdk/commerce/products'
import { AlertTriangle, ArrowRightLeft, DownloadIcon, Loader2, PackageIcon, PlusIcon, TruckIcon, X } from 'lucide-react'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Input } from '../primitives/input'
import { Label } from '../primitives/label'
import { RadioGroup, RadioGroupItem } from '../primitives/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../primitives/select'

export type BitcoinUnit = 'SATS' | 'BTC'
export type CurrencyMode = 'sats' | 'fiat'
export type ProductStatus = 'hidden' | 'on-sale' | 'pre-order'

export function validateProductQuantity(value: string): string | undefined {
	if (!value) return 'Quantity is required'
	if (!/^[0-9]*$/.test(value)) return 'Please enter a valid number'
	return undefined
}

export interface ProductPricingViewProps {
	currencies: readonly string[]
	currency: string
	onCurrencyChange: (currency: string) => void
	fiatDisplayValue: string
	onFiatPriceChange: (value: string) => void
	bitcoinUnit: BitcoinUnit
	bitcoinDisplayValue: string
	onBitcoinPriceChange: (value: string) => void
	onToggleBitcoinUnit: () => void
	currencyMode: CurrencyMode
	onCurrencyModeChange: (mode: CurrencyMode) => void
	quantity: string
	onQuantityChange: (value: string) => void
	status: ProductStatus
	onStatusChange: (status: ProductStatus) => void
	isNSFW: boolean
	onNSFWChange: (isNSFW: boolean) => void
}

export function ProductPricingView(props: ProductPricingViewProps) {
	const { currency, bitcoinUnit, currencyMode } = props
	const [quantityTouched, setQuantityTouched] = useState(false)
	const showFiatField = currency !== 'SATS' && currency !== 'BTC'
	const quantityError = validateProductQuantity(props.quantity)

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label htmlFor="currency" className="text-sm font-medium">
					Choose your local currency <span className="text-red-500">*</span>
				</Label>
				<Select value={currency} onValueChange={props.onCurrencyChange}>
					<SelectTrigger>
						<SelectValue placeholder="Select currency" />
					</SelectTrigger>
					<SelectContent>
						{props.currencies.map((curr) => (
							<SelectItem key={curr} value={curr}>
								{curr}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-row w-full items-end">
				{showFiatField && (
					<div className="space-y-2 flex-1">
						<Label htmlFor="fiat-price" className="text-sm font-medium">
							Price <span className="text-red-500">*</span>
							<span className="text-xs text-muted-foreground ml-1">(In {currency})</span>
						</Label>
						<Input
							id="fiat-price"
							type="number"
							step="0.01"
							placeholder="e.g., 25.00"
							value={props.fiatDisplayValue}
							onChange={(e) => props.onFiatPriceChange(e.target.value)}
							className="w-full"
						/>
					</div>
				)}

				{showFiatField && <ArrowRightLeft className="m-2 w-6 h-6 flex-shrink-0" />}
				<div className="space-y-2 flex-1">
					<Label htmlFor="bitcoin-price" className="text-sm font-medium">
						Price in {bitcoinUnit} <span className="text-red-500">*</span>
						<span className="text-xs text-muted-foreground ml-1">(Bitcoin)</span>
					</Label>
					<div className="relative">
						<Input
							id="bitcoin-price"
							type="number"
							step="any"
							placeholder={bitcoinUnit === 'SATS' ? 'e.g., 10000' : 'e.g., 0.0001'}
							value={props.bitcoinDisplayValue}
							onChange={(e) => props.onBitcoinPriceChange(e.target.value)}
							className="pr-20"
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={props.onToggleBitcoinUnit}
							className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 text-xs"
						>
							{bitcoinUnit}
						</Button>
					</div>
				</div>
			</div>

			{showFiatField && (
				<div className="space-y-3">
					<Label className="text-sm font-medium">Currency Mode</Label>
					<RadioGroup
						value={currencyMode}
						onValueChange={(value) => props.onCurrencyModeChange(value as CurrencyMode)}
						className="flex flex-col space-y-3 mt-2"
					>
						<div className="space-y-1">
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="fiat" id="fiat-mode" />
								<Label htmlFor="fiat-mode" className="text-sm">
									Fix the price in fiat (sats price will fluctuate, recommended)
								</Label>
							</div>
						</div>
						<div className="space-y-1">
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="sats" id="sats-mode" />
								<Label htmlFor="sats-mode" className="text-sm">
									Fix the price in sats (fiat price will fluctuate)
								</Label>
							</div>
						</div>
					</RadioGroup>
				</div>
			)}

			<div className="grid w-full gap-1.5">
				<Label htmlFor="quantity">
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Quantity</span>
				</Label>
				<Input
					id="quantity"
					name="quantity"
					value={props.quantity}
					onBlur={() => setQuantityTouched(true)}
					onChange={(e) => {
						setQuantityTouched(true)
						props.onQuantityChange(e.target.value)
					}}
					className="border-2"
					placeholder="e.g. 100"
					data-testid="product-quantity-input"
					required
					pattern="[0-9]*"
					inputMode="numeric"
				/>
				{quantityError && quantityTouched && <div className="text-red-500 text-sm mt-1">{quantityError}</div>}
			</div>

			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Status</span>
				</Label>
				<Select value={props.status} onValueChange={(value) => props.onStatusChange(value as ProductStatus)}>
					<SelectTrigger className="border-2" data-testid="product-status-select">
						<SelectValue placeholder="Select status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="hidden" data-testid="status-option-hidden">
							Hidden
						</SelectItem>
						<SelectItem value="on-sale" data-testid="status-option-on-sale">
							On Sale
						</SelectItem>
						<SelectItem value="pre-order" data-testid="status-option-pre-order">
							Pre-Order
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="flex items-start space-x-3 p-4 border rounded-lg bg-amber-50/50 border-amber-200">
				<Checkbox
					id="nsfw-content"
					checked={props.isNSFW}
					onCheckedChange={(checked) => props.onNSFWChange(checked === true)}
					className="mt-0.5"
				/>
				<div className="space-y-1">
					<Label htmlFor="nsfw-content" className="text-sm font-medium cursor-pointer flex items-center gap-2">
						<AlertTriangle className="w-4 h-4 text-amber-600" />
						This product contains adult/sensitive content
					</Label>
					<p className="text-xs text-muted-foreground">
						Check this if your product contains NSFW material, alcohol, tobacco, weapons, or other age-restricted content. Products marked
						as NSFW will be hidden from users who haven't enabled adult content viewing.
					</p>
				</div>
			</div>
		</div>
	)
}

export const MAX_SUB_CATEGORIES = 3

export interface ProductCategoryViewProps {
	mainCategories: readonly string[]
	mainCategory: string
	onMainCategoryChange: (category: string) => void
	subCategories: readonly { key: string; name: string }[]
	onSubCategoryNameChange: (index: number, name: string) => void
	onRemoveSubCategory: (index: number) => void
	onAddSubCategory: () => void
}

function SubCategoryField({
	label,
	value,
	onChange,
	onRemove,
}: {
	label: string
	value: string
	onChange: (v: string) => void
	onRemove?: () => void
}) {
	return (
		<div className="grid w-full gap-1.5">
			<Label>{label}</Label>
			<div className="relative">
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className="flex-1 border-2 pr-10"
					placeholder="e.g Bitcoin Miners"
				/>
				{onRemove && (
					<Button type="button" variant="ghost" className="absolute right-0 top-0 h-full px-2 text-black" onClick={onRemove}>
						<span className="i-delete w-5 h-5"></span>
					</Button>
				)}
			</div>
		</div>
	)
}

export function ProductCategoryView({
	mainCategories,
	mainCategory,
	onMainCategoryChange,
	subCategories,
	onSubCategoryNameChange,
	onRemoveSubCategory,
	onAddSubCategory,
}: ProductCategoryViewProps) {
	return (
		<div className="space-y-4">
			<div className="grid w-full gap-1.5">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Main Category</span>
				</Label>
				<Select value={mainCategory} onValueChange={onMainCategoryChange}>
					<SelectTrigger className="border-2" data-testid="product-main-category-select">
						<SelectValue placeholder="Select a Main Category" />
					</SelectTrigger>
					<SelectContent>
						{mainCategories.map((category) => (
							<SelectItem key={category} value={category} data-testid={`main-category-${category.toLowerCase().replace(/\s+/g, '-')}`}>
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
						{/* The first field is always shown so a seller can type straight into it. */}
						<SubCategoryField
							label="Sub Category 1"
							value={subCategories[0]?.name || ''}
							onChange={(name) => onSubCategoryNameChange(0, name)}
							onRemove={subCategories.length > 0 ? () => onRemoveSubCategory(0) : undefined}
						/>
						{subCategories.slice(1).map((category, index) => (
							<SubCategoryField
								key={category.key}
								label={`Sub Category ${index + 2}`}
								value={category.name}
								onChange={(name) => onSubCategoryNameChange(index + 1, name)}
								onRemove={() => onRemoveSubCategory(index + 1)}
							/>
						))}
					</div>

					<Button
						type="button"
						variant="outline"
						className="w-full flex gap-2 justify-center mt-4"
						onClick={onAddSubCategory}
						disabled={subCategories.length >= MAX_SUB_CATEGORIES}
					>
						<span className="i-plus w-5 h-5"></span>
						New Sub Category
					</Button>
				</>
			)}
		</div>
	)
}

export function ProductImagesView({ hasImages, children }: { hasImages: boolean; children: ReactNode }) {
	return (
		<div className="space-y-4 overflow-visible" data-testid="product-images-tab-panel">
			<p className="text-gray-600">We recommend using square images of 1600x1600 and under 2mb.</p>
			<div className="flex flex-col gap-4">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Image Upload</span>
					<span className="sr-only">required</span>
					{!hasImages && <span className="text-sm text-red-500 ml-2">(At least one image required)</span>}
				</Label>
				{children}
			</div>
		</div>
	)
}

export type ShippingOptionSummary = ProductShippingOption

export interface SelectedShippingRow {
	shippingRef: string
	extraCost: string
	option?: ShippingOptionSummary | null
}

export interface QuickShippingTemplate {
	name: string
	description: string
	icon: 'digital' | 'worldwide' | 'pickup'
}

export interface PickupAddressDraft {
	street: string
	city: string
	state: string
	postalCode: string
	country: string
}

export interface ProductShippingViewProps {
	selected: readonly SelectedShippingRow[]
	available: readonly ShippingOptionSummary[]
	hasValidShipping: boolean
	isLoading: boolean
	/** Options have been fetched, so an unresolved reference is gone rather than pending. */
	isFetched: boolean
	onExtraCostChange: (index: number, extraCost: string) => void
	onRemove: (index: number) => void
	onAdd: (option: ShippingOptionSummary) => void
	templates: readonly QuickShippingTemplate[]
	onQuickCreate: (template: QuickShippingTemplate) => void
	isCreating: boolean
	showPickupForm: boolean
	pickupAddress: PickupAddressDraft
	onPickupAddressChange: (field: keyof PickupAddressDraft, value: string) => void
	onPickupCancel: () => void
	onPickupSubmit: () => void
}

function ServiceIcon({ service }: { service: string }) {
	switch (service) {
		case 'express':
		case 'overnight':
			return <TruckIcon className="w-4 h-4 text-orange-500" />
		case 'pickup':
			return <PackageIcon className="w-4 h-4 text-blue-500" />
		default:
			return <TruckIcon className="w-4 h-4" />
	}
}

function describeCountries(countries: string[] | undefined, fallback: string): string {
	return countries && countries.length > 1 ? `${countries.length} countries` : countries?.[0] || fallback
}

const PICKUP_FIELDS: Array<{ field: keyof PickupAddressDraft; id: string; label: string; placeholder: string; required?: boolean }> = [
	{ field: 'city', id: 'pickup-city', label: 'City', placeholder: 'New York', required: true },
	{ field: 'state', id: 'pickup-state', label: 'State/Province', placeholder: 'NY' },
	{ field: 'postalCode', id: 'pickup-postal', label: 'Postal Code', placeholder: '10001' },
	{ field: 'country', id: 'pickup-country', label: 'Country', placeholder: 'USA' },
]

function PickupAddressForm(
	props: Pick<ProductShippingViewProps, 'pickupAddress' | 'onPickupAddressChange' | 'onPickupCancel' | 'onPickupSubmit' | 'isCreating'>,
) {
	const { pickupAddress, onPickupAddressChange } = props
	const renderField = ({ field, id, label, placeholder, required }: (typeof PICKUP_FIELDS)[number]) => (
		<div key={id}>
			<Label htmlFor={id} className="text-sm">
				{label} {required && <span className="text-red-500">*</span>}
			</Label>
			<Input
				id={id}
				value={pickupAddress[field]}
				onChange={(e) => onPickupAddressChange(field, e.target.value)}
				placeholder={placeholder}
				className="mt-1"
			/>
		</div>
	)

	return (
		<div className="border rounded-md p-4 space-y-4 bg-gray-50">
			<div className="flex items-center gap-2">
				<PackageIcon className="w-5 h-5 text-green-500" />
				<h4 className="font-medium">Local Pickup Address</h4>
			</div>
			<p className="text-sm text-gray-500">Enter the address where customers can pick up their orders:</p>
			<div className="space-y-3">
				{renderField({ field: 'street', id: 'pickup-street', label: 'Street Address', placeholder: '123 Main Street', required: true })}
				<div className="grid grid-cols-2 gap-3">{PICKUP_FIELDS.slice(0, 2).map(renderField)}</div>
				<div className="grid grid-cols-2 gap-3">{PICKUP_FIELDS.slice(2).map(renderField)}</div>
			</div>
			<div className="flex gap-2 pt-2">
				<Button type="button" variant="outline" onClick={props.onPickupCancel} disabled={props.isCreating} className="flex-1">
					Cancel
				</Button>
				<Button type="button" onClick={props.onPickupSubmit} disabled={props.isCreating} className="flex-1">
					{props.isCreating ? (
						<>
							<Loader2 className="w-4 h-4 animate-spin mr-2" />
							Creating...
						</>
					) : (
						'Create Pickup Option'
					)}
				</Button>
			</div>
		</div>
	)
}

export function ProductShippingView(props: ProductShippingViewProps) {
	const { selected, available, isFetched } = props
	const unselected = available.filter((option) => !selected.some((s) => s.shippingRef === option.id))

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label>
					<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Shipping Options</span>
					<span className="sr-only">required</span>
					{!props.hasValidShipping && <span className="text-sm text-red-500 ml-2">(At least one shipping option required)</span>}
				</Label>
				<p className="text-gray-600">Select shipping options that will be available for this product</p>
			</div>

			{selected.length > 0 && (
				<div className="space-y-4">
					<h3 className="font-medium">Selected Shipping Options</h3>
					<div className="space-y-3">
						{selected.map((shipping, index) => {
							const option = shipping.option
							return (
								<div key={index} className="flex items-center gap-3 p-3 border rounded-md bg-gray-50">
									{option?.service ? <ServiceIcon service={option.service} /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
									<div className="flex-1">
										<div className="font-medium">
											{option?.name || (isFetched ? 'Unavailable shipping option' : 'Resolving shipping option...')}
										</div>
										{option ? (
											<div className="text-sm text-gray-500">
												{option.cost} {option.currency} • {describeCountries(option.countries, 'No countries')} •{' '}
												{option.service || 'Unknown service'}
											</div>
										) : isFetched ? (
											<div className="text-sm text-amber-600">This shipping reference is no longer available: {shipping.shippingRef}</div>
										) : (
											<div className="text-sm text-gray-500">Looking up current shipping metadata...</div>
										)}
									</div>
									<div className="flex items-center gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											value={shipping.extraCost}
											onChange={(e) => props.onExtraCostChange(index, e.target.value)}
											placeholder="Add cost specific to this product"
											className="w-40 sm:w-56 md:w-76 text-sm"
										/>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => props.onRemove(index)}
											className="text-red-600 hover:text-red-700"
										>
											<X className="w-4 h-4" />
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			)}

			<div className="space-y-4">
				<h3 className="font-medium">Available Shipping Options</h3>
				{props.isLoading ? (
					<div className="flex items-center justify-center p-8">
						<Loader2 className="w-6 h-6 animate-spin" />
						<span className="ml-2">Loading shipping options...</span>
					</div>
				) : available.length === 0 ? (
					<div className="space-y-4">
						<div className="text-center p-4 text-gray-500">
							<p>No shipping options available.</p>
							<p className="text-sm mt-2">Quick-create a shipping option to get started:</p>
						</div>
						{props.showPickupForm ? (
							<PickupAddressForm {...props} />
						) : (
							<div className="grid gap-3">
								{props.templates.map((template) => (
									<button
										key={template.name}
										type="button"
										onClick={() => props.onQuickCreate(template)}
										disabled={props.isCreating}
										className="flex items-center gap-3 p-4 border rounded-md hover:bg-gray-50 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{template.icon === 'digital' && <DownloadIcon className="w-5 h-5 text-purple-500 flex-shrink-0" />}
										{template.icon === 'worldwide' && <TruckIcon className="w-5 h-5 text-blue-500 flex-shrink-0" />}
										{template.icon === 'pickup' && <PackageIcon className="w-5 h-5 text-green-500 flex-shrink-0" />}
										<div className="flex-1 min-w-0">
											<div className="font-medium">{template.name}</div>
											<div className="text-sm text-gray-500">{template.description}</div>
										</div>
										{props.isCreating ? (
											<Loader2 className="w-5 h-5 animate-spin text-gray-400" />
										) : (
											<PlusIcon className="w-5 h-5 text-gray-400" />
										)}
									</button>
								))}
							</div>
						)}
						<p className="text-xs text-gray-400 text-center">You can customize these options later in Dashboard → Shipping Options</p>
					</div>
				) : (
					<div className="grid gap-3">
						{unselected.map((option) => (
							<div key={option.id} className="flex items-center gap-3 p-3 border rounded-md hover:bg-gray-50">
								{option.service && <ServiceIcon service={option.service} />}
								<div className="flex-1">
									<div className="font-medium">{option.name}</div>
									<div className="text-sm text-gray-500">
										{option.cost} {option.currency} • {describeCountries(option.countries, 'Worldwide')} •{' '}
										{option.service || 'Unknown service'}
									</div>
								</div>
								<Button type="button" variant="outline" size="sm" onClick={() => props.onAdd(option)}>
									Add
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export interface ProductSpecsViewProps {
	specs: readonly { key: string; value: string }[]
	onSpecChange: (index: number, field: 'key' | 'value', value: string) => void
	onAddSpec: () => void
	onRemoveSpec: (index: number) => void
}

export function ProductSpecsView({ specs, onSpecChange, onAddSpec, onRemoveSpec }: ProductSpecsViewProps) {
	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<Label className="text-base font-medium">Product Specifications</Label>
				<p className="text-gray-600">Add detailed specifications for your product</p>
			</div>

			<div className="space-y-4">
				{specs.map((spec, index) => (
					<div key={index} className="flex gap-3 items-start">
						<div className="flex-1">
							<Input
								placeholder="Specification name (e.g., Material, Size, Weight)"
								value={spec.key}
								onChange={(e) => onSpecChange(index, 'key', e.target.value)}
							/>
						</div>
						<div className="flex-1">
							<Input
								placeholder="Value (e.g., Cotton, Large, 2kg)"
								value={spec.value}
								onChange={(e) => onSpecChange(index, 'value', e.target.value)}
							/>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onRemoveSpec(index)}
							className="text-red-600 hover:text-red-700"
						>
							<X className="w-4 h-4" />
						</Button>
					</div>
				))}

				<Button type="button" variant="outline" onClick={onAddSpec} className="w-full flex items-center gap-2">
					<PlusIcon className="w-4 h-4" />
					Add Specification
				</Button>
			</div>
		</div>
	)
}
