import { Button } from '@/components/ui/button'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import type { RichShippingInfo } from '@/lib/stores/cart'
import { useNDK } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductShippingForm } from '@/lib/stores/product'
import { uiStore, useUI } from '@/lib/stores/ui'
import { MempoolService } from '@/lib/utils/mempool'
import { useBtcExchangeRates, type SupportedCurrency } from '@/queries/external'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useForm } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-store'
import { CheckIcon, PackageIcon, PlusIcon, SettingsIcon, TruckIcon, X, Loader2, Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

export function DetailTab() {
	const { price, fiatPrice, quantity, currency, status, specs } = useStore(productFormStore)
	const { selectedCurrency } = useStore(uiStore)
	const { data: exchangeRates } = useBtcExchangeRates()
	const [bitcoinUnit, setBitcoinUnit] = useState<'SATS' | 'BTC'>('SATS')
	const [currencyMode, setCurrencyMode] = useState<'sats' | 'fiat'>('sats') // For fiat currencies only
	const [fiatDisplayValue, setFiatDisplayValue] = useState('')

	// Use existing conversion functions from MempoolService
	const convertSatsToBtc = MempoolService.satoshisToBtc
	const convertBtcToSats = MempoolService.btcToSatoshis

	const convertSatsToCurrency = (sats: number, targetCurrency: string): number => {
		if (targetCurrency === 'SATS') return sats
		if (targetCurrency === 'BTC') return convertSatsToBtc(sats)
		if (!exchangeRates) return 0

		const btcAmount = sats / 100_000_000 // Convert sats to BTC
		const rate = exchangeRates[targetCurrency as SupportedCurrency]
		return rate ? btcAmount * rate : 0
	}

	const convertCurrencyToSats = (amount: number, fromCurrency: string): number => {
		if (fromCurrency === 'SATS') return amount
		if (fromCurrency === 'BTC') return convertBtcToSats(amount)
		if (!exchangeRates) return 0

		const rate = exchangeRates[fromCurrency as SupportedCurrency]
		if (!rate) return 0

		const btcAmount = amount / rate
		return Math.round(btcAmount * 100_000_000) // Convert BTC to sats
	}

	const form = useForm({
		defaultValues: {
			price: price,
			fiatPrice: fiatPrice,
			quantity: quantity,
			currency: currency,
			status: status,
		},
		onSubmit: async ({ value }) => {
			productFormActions.updateValues({
				price: value.price,
				fiatPrice: value.fiatPrice,
				quantity: value.quantity,
				currency: value.currency,
				status: value.status,
				// Update currency system state
				bitcoinUnit: bitcoinUnit,
				currencyMode: currencyMode,
			})
		},
	})

	// Handle Bitcoin price changes (SATS/BTC field)
	const handleBitcoinPriceChange = (value: string) => {
		const numValue = parseFloat(value) || 0

		// Convert to SATS for storage
		const satsValue = bitcoinUnit === 'SATS' ? numValue : convertBtcToSats(numValue)

		productFormActions.updateValues({ price: satsValue.toString() })

		// Update fiat field if a fiat currency is selected and visible
		if (currency !== 'SATS' && currency !== 'BTC') {
			const fiatValue = convertSatsToCurrency(satsValue, currency)
			setFiatDisplayValue(fiatValue.toFixed(2))
		}
	}

	// Handle fiat price changes
	const handleFiatPriceChange = (value: string) => {
		// Store the raw input value without formatting
		setFiatDisplayValue(value)

		// Only convert to sats if we have a valid number
		const numValue = parseFloat(value)
		if (!isNaN(numValue) && numValue > 0) {
			const satsValue = convertCurrencyToSats(numValue, currency)
			productFormActions.updateValues({ price: satsValue.toString() })
		} else if (value === '' || value === '0') {
			// Clear the price if input is empty or zero
			productFormActions.updateValues({ price: '0' })
		}
	}

	// Get display value for Bitcoin field
	const getBitcoinDisplayValue = (): string => {
		if (!price) return ''
		const satsValue = parseFloat(price) || 0
		return bitcoinUnit === 'SATS' ? satsValue.toString() : convertSatsToBtc(satsValue).toFixed(8)
	}

	// Handle currency dropdown change
	const handleCurrencyChange = (newCurrency: string) => {
		productFormActions.updateValues({ currency: newCurrency })

		// Auto-switch Bitcoin unit based on currency
		if (newCurrency === 'BTC') {
			setBitcoinUnit('BTC')
		} else if (newCurrency === 'SATS') {
			setBitcoinUnit('SATS')
		}

		// Set currency mode based on selected currency
		setCurrencyMode(newCurrency === 'BTC' || newCurrency === 'SATS' ? 'sats' : 'fiat')
	}

	// Function to determine what gets published to the protocol
	const getPublishCurrency = (): { price: string; currency: string } => {
		if (currency === 'SATS' || currency === 'BTC') {
			// When Bitcoin currency is selected, always publish in SATS
			const bitcoinValue = parseFloat(price || '0')
			if (bitcoinUnit === 'BTC') {
				// Convert BTC to SATS for publishing
				const satsValue = bitcoinValue * 100000000
				return { price: satsValue.toString(), currency: 'SATS' }
			} else {
				// Already in SATS
				return { price: price || '0', currency: 'SATS' }
			}
		} else {
			// Fiat currency selected - check radio group selection
			if (currencyMode === 'fiat') {
				// Use fiat currency
				return { price: fiatDisplayValue, currency: currency }
			} else {
				// Use sats as currency (calculated on spot)
				const bitcoinValue = parseFloat(price || '0')
				const satsValue = bitcoinUnit === 'BTC' ? bitcoinValue * 100000000 : bitcoinValue
				return { price: satsValue.toString(), currency: 'SATS' }
			}
		}
	}

	// Toggle Bitcoin unit (SATS/BTC)
	const toggleBitcoinUnit = () => {
		setBitcoinUnit((prev) => (prev === 'SATS' ? 'BTC' : 'SATS'))
	}

	// Check if current currency is Bitcoin-based
	const isBitcoinCurrency = currency === 'SATS' || currency === 'BTC'

	// Check if fiat field should be visible
	const showFiatField = !isBitcoinCurrency

	// Check if radio group should be visible
	const showRadioGroup = showFiatField

	// Update fiat display when currency or price changes
	useEffect(() => {
		if (showFiatField && price) {
			const satsValue = parseFloat(price) || 0
			if (satsValue > 0) {
				const fiatValue = convertSatsToCurrency(satsValue, currency)
				// Only update if the field is not currently being edited
				// This prevents overwriting user input during typing
				if (document.activeElement?.id !== 'fiat-price') {
					setFiatDisplayValue(fiatValue.toFixed(2))
				}
			}
		}
	}, [currency, price, showFiatField])

	return (
		<div className="space-y-6">
			{/* Currency Dropdown */}
			<div className="space-y-2">
				<Label htmlFor="currency" className="text-sm font-medium">
					Currency <span className="text-red-500">*</span>
				</Label>
				<Select value={currency} onValueChange={handleCurrencyChange}>
					<SelectTrigger>
						<SelectValue placeholder="Select currency" />
					</SelectTrigger>
					<SelectContent>
						{CURRENCIES.map((curr) => (
							<SelectItem key={curr} value={curr}>
								{curr}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Bitcoin Price Field (always visible) */}
			<div className="space-y-2">
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
						value={getBitcoinDisplayValue()}
						onChange={(e) => handleBitcoinPriceChange(e.target.value)}
						className="pr-20"
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={toggleBitcoinUnit}
						className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-3 text-xs"
					>
						{bitcoinUnit}
					</Button>
				</div>
			</div>

			{/* Radio Group for Fiat Currencies */}
			{showRadioGroup && (
				<div className="space-y-3">
					<Label className="text-sm font-medium">Currency Mode</Label>
					<RadioGroup
						value={currencyMode}
						onValueChange={(value: 'sats' | 'fiat') => setCurrencyMode(value)}
						className="flex flex-col space-y-3"
					>
						<div className="space-y-1">
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="sats" id="sats-mode" />
								<Label htmlFor="sats-mode" className="text-sm">
									Use sats as currency (amount calculated on spot)
								</Label>
							</div>
							<div className="flex items-start space-x-2 ml-6">
								<Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
								<p className="text-xs text-muted-foreground">
									The product will be priced in sats, calculated from the current Bitcoin exchange rate. Buyers will pay the exact sats
									amount at purchase time.
								</p>
							</div>
						</div>
						<div className="space-y-1">
							<div className="flex items-center space-x-2">
								<RadioGroupItem value="fiat" id="fiat-mode" />
								<Label htmlFor="fiat-mode" className="text-sm">
									Use fiat as currency
								</Label>
							</div>
							<div className="flex items-start space-x-2 ml-6">
								<Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
								<p className="text-xs text-muted-foreground">
									The product will be priced in {currency}. Buyers will pay the equivalent sats amount based on the exchange rate at
									purchase time.
								</p>
							</div>
						</div>
					</RadioGroup>
				</div>
			)}

			{/* Fiat Price Field (conditional) */}
			{showFiatField && (
				<div className="space-y-2">
					<Label htmlFor="fiat-price" className="text-sm font-medium">
						Price <span className="text-red-500">*</span>
						<span className="text-xs text-muted-foreground ml-1">(In {currency})</span>
					</Label>
					<Input
						id="fiat-price"
						type="number"
						step="0.01"
						placeholder={`e.g., 25.00`}
						value={fiatDisplayValue}
						onChange={(e) => handleFiatPriceChange(e.target.value)}
						className="w-full"
					/>
				</div>
			)}

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
							data-testid="product-quantity-input"
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
		</div>
	)
}

export function CategoryTab() {
	const { categories, mainCategory } = useStore(productFormStore)

	// Available main categories from constants
	const mainCategories = [...PRODUCT_CATEGORIES]

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
	const { shippings } = useStore(productFormStore)
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)

	// Get user on mount
	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const shippingOptionsQuery = useShippingOptionsByPubkey(user?.pubkey || '')
	const availableShippingOptions = useMemo(() => {
		if (!shippingOptionsQuery.data || !user?.pubkey) return []

		return shippingOptionsQuery.data
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return null

				const id = createShippingReference(user.pubkey, info.id)

				return {
					id,
					name: info.title,
					cost: parseFloat(info.price.amount),
					currency: info.price.currency,
					countries: info.countries || [],
					service: info.service || '',
					carrier: info.carrier || '',
				}
			})
			.filter(Boolean) as RichShippingInfo[]
	}, [shippingOptionsQuery.data, user?.pubkey])

	const addShippingOption = (option: RichShippingInfo) => {
		// Check if shipping option is already added
		const isAlreadyAdded = shippings.some((s) => s.shipping?.id === option.id)
		if (isAlreadyAdded) {
			toast.error('This shipping option is already added')
			return
		}

		const newShipping: ProductShippingForm = {
			shipping: {
				id: option.id,
				name: option.name || '',
			},
			extraCost: '',
		}

		productFormActions.updateValues({
			shippings: [...shippings, newShipping],
		})
	}

	const removeShippingOption = (index: number) => {
		productFormActions.updateValues({
			shippings: shippings.filter((_, i) => i !== index),
		})
	}

	const updateExtraCost = (index: number, extraCost: string) => {
		const updatedShippings = [...shippings]
		updatedShippings[index] = {
			...updatedShippings[index],
			extraCost,
		}
		productFormActions.updateValues({
			shippings: updatedShippings,
		})
	}

	const ServiceIcon = ({ service }: { service: string }) => {
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

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<p className="text-gray-600">Select shipping options that will be available for this product</p>
			</div>

			{/* Selected Shipping Options */}
			{shippings.length > 0 && (
				<div className="space-y-4">
					<h3 className="font-medium">Selected Shipping Options</h3>
					<div className="space-y-3">
						{shippings.map((shipping, index) => {
							const option = availableShippingOptions.find((opt) => opt.id === shipping.shipping?.id)
							return (
								<div key={index} className="flex items-center gap-3 p-3 border rounded-md bg-gray-50">
									{option && option.service && <ServiceIcon service={option.service} />}
									<div className="flex-1">
										<div className="font-medium">{shipping.shipping?.name}</div>
										{option && (
											<div className="text-sm text-gray-500">
												{option.cost} {option.currency} •{' '}
												{option.countries && option.countries.length > 1
													? `${option.countries.length} countries`
													: option.countries?.[0] || 'No countries'}{' '}
												• {option.service || 'Unknown service'}
											</div>
										)}
									</div>
									<div className="flex items-center gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											value={shipping.extraCost}
											onChange={(e) => updateExtraCost(index, e.target.value)}
											placeholder="Extra cost"
											className="w-24 text-sm"
										/>
										<Button
											variant="outline"
											size="sm"
											onClick={() => removeShippingOption(index)}
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

			{/* Available Shipping Options */}
			<div className="space-y-4">
				<h3 className="font-medium">Available Shipping Options</h3>
				{shippingOptionsQuery.isLoading ? (
					<div className="flex items-center justify-center p-8">
						<Loader2 className="w-6 h-6 animate-spin" />
						<span className="ml-2">Loading shipping options...</span>
					</div>
				) : availableShippingOptions.length === 0 ? (
					<div className="text-center p-8 text-gray-500">
						<p>No shipping options available.</p>
						<p className="text-sm mt-2">Create shipping options in your dashboard first.</p>
					</div>
				) : (
					<div className="grid gap-3">
						{availableShippingOptions.map((option) => (
							<div key={option.id} className="flex items-center gap-3 p-3 border rounded-md hover:bg-gray-50">
								{option.service && <ServiceIcon service={option.service} />}
								<div className="flex-1">
									<div className="font-medium">{option.name}</div>
									<div className="text-sm text-gray-500">
										{option.cost} {option.currency} •{' '}
										{option.countries && option.countries.length > 1
											? `${option.countries.length} countries`
											: option.countries?.[0] || 'No countries'}{' '}
										• {option.service || 'Unknown service'}
									</div>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => addShippingOption(option)}
									disabled={shippings.some((s) => s.shipping?.id === option.id)}
								>
									{shippings.some((s) => s.shipping?.id === option.id) ? 'Added' : 'Add'}
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

export function SpecTab() {
	const { specs } = useStore(productFormStore)

	const updateSpec = (index: number, field: 'key' | 'value', value: string) => {
		const newSpecs = [...specs]
		newSpecs[index] = { ...newSpecs[index], [field]: value }
		productFormActions.updateValues({ specs: newSpecs })
	}

	const addSpec = () => {
		const newSpecs = [...specs, { key: '', value: '' }]
		productFormActions.updateValues({ specs: newSpecs })
	}

	const removeSpec = (index: number) => {
		const newSpecs = specs.filter((_, i) => i !== index)
		productFormActions.updateValues({ specs: newSpecs })
	}

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
								onChange={(e) => updateSpec(index, 'key', e.target.value)}
							/>
						</div>
						<div className="flex-1">
							<Input
								placeholder="Value (e.g., Cotton, Large, 2kg)"
								value={spec.value}
								onChange={(e) => updateSpec(index, 'value', e.target.value)}
							/>
						</div>
						<Button variant="outline" size="sm" onClick={() => removeSpec(index)} className="text-red-600 hover:text-red-700">
							<X className="w-4 h-4" />
						</Button>
					</div>
				))}

				<Button variant="outline" onClick={addSpec} className="w-full flex items-center gap-2">
					<PlusIcon className="w-4 h-4" />
					Add Specification
				</Button>
			</div>
		</div>
	)
}
