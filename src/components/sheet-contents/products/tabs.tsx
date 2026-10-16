import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import type { ProductShippingOption as RichShippingInfo } from '@sdk/commerce/products'
import { useNDK } from '@/lib/stores/ndk'
import { productFormActions, productFormStore, type ProductShippingForm } from '@/lib/stores/product'
import {
	attachShippingOptionByRef,
	resolveProductShippingSelections,
	applyFiatPriceEdit,
	deriveSatsPriceFromFiat,
} from '@sdk/commerce/products'
import { MempoolService } from '@/lib/utils/mempool'
import { useBtcExchangeRates, type SupportedCurrency } from '@/queries/external'
import { usePublishShippingOptionMutation, type ShippingFormData } from '@/publish/shipping'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
	MAX_SUB_CATEGORIES,
	ProductCategoryView,
	ProductImagesView,
	ProductPricingView,
	ProductShippingView,
	ProductSpecsView,
	type PickupAddressDraft,
} from '@ui/components/ProductEditorTabs'

export function DetailTab() {
	const {
		price,
		fiatPrice,
		quantity,
		currency,
		status,
		bitcoinUnit: storeBitcoinUnit,
		currencyMode: storeCurrencyMode,
		isNSFW,
	} = useStore(productFormStore)
	const { data: exchangeRates } = useBtcExchangeRates()
	// Initialize local state from store values (important for editing)
	const [bitcoinUnit, setBitcoinUnit] = useState<'SATS' | 'BTC'>(storeBitcoinUnit || 'SATS')
	const [currencyMode, setCurrencyMode] = useState<'sats' | 'fiat'>(storeCurrencyMode || 'fiat')
	const [fiatDisplayValue, setFiatDisplayValue] = useState(fiatPrice || '')

	const convertSatsToBtc = MempoolService.satoshisToBtc
	const convertBtcToSats = MempoolService.btcToSatoshis

	// Exchange rates are only usable once loaded and non-empty. When they are
	// missing, the converters below return 0, so every sats/fiat sync must be
	// guarded to avoid storing or publishing a 0-derived price.
	const hasExchangeRates = !!exchangeRates && Object.keys(exchangeRates).length > 0

	const convertSatsToCurrency = (sats: number, targetCurrency: string): number => {
		if (targetCurrency === 'SATS') return sats
		if (targetCurrency === 'BTC') return convertSatsToBtc(sats)
		if (!exchangeRates) return 0

		const btcAmount = sats / 100_000_000
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
		return Math.round(btcAmount * 100_000_000)
	}

	const handleBitcoinPriceChange = (value: string) => {
		const numValue = parseFloat(value) || 0

		// Sats are always stored as integers.
		const satsValue = bitcoinUnit === 'SATS' ? Math.round(numValue) : convertBtcToSats(numValue)

		// Without exchange rates convertSatsToCurrency returns 0, and a stored
		// fiatPrice of '0.00' would be published in fiat mode, so skip the sync.
		if (currency !== 'SATS' && currency !== 'BTC' && hasExchangeRates) {
			const fiatValueStr = convertSatsToCurrency(satsValue, currency).toFixed(2)
			setFiatDisplayValue(fiatValueStr)
			productFormActions.updateValues({ price: satsValue.toString(), fiatPrice: fiatValueStr })
		} else {
			productFormActions.updateValues({ price: satsValue.toString() })
		}
	}

	const handleFiatPriceChange = (value: string) => {
		setFiatDisplayValue(value)

		// Without rates the sats price stays unresolved until they arrive, since a stored 0 would publish as a real price.
		const outcome = applyFiatPriceEdit(value, convertCurrencyToSats, { currency, hasExchangeRates })
		if (outcome) {
			productFormActions.updateValues(outcome)
		}
	}

	const getBitcoinDisplayValue = (): string => {
		if (!price) return ''
		const satsValue = parseFloat(price) || 0
		return bitcoinUnit === 'SATS' ? satsValue.toString() : convertSatsToBtc(satsValue).toFixed(8)
	}

	const handleCurrencyChange = (newCurrency: string) => {
		const newCurrencyMode = newCurrency === 'BTC' || newCurrency === 'SATS' ? 'sats' : 'fiat'
		productFormActions.updateValues({ currency: newCurrency, currencyMode: newCurrencyMode })

		if (newCurrency === 'BTC') {
			setBitcoinUnit('BTC')
		} else if (newCurrency === 'SATS') {
			setBitcoinUnit('SATS')
		}
		setCurrencyMode(newCurrencyMode)
	}

	const toggleBitcoinUnit = () => {
		const newUnit = bitcoinUnit === 'SATS' ? 'BTC' : 'SATS'
		setBitcoinUnit(newUnit)
		productFormActions.updateValues({ bitcoinUnit: newUnit })
	}

	const showFiatField = currency !== 'SATS' && currency !== 'BTC'

	// Sync local state from store when store values change (for edit mode)
	useEffect(() => {
		setBitcoinUnit(storeBitcoinUnit || 'SATS')
		setCurrencyMode(storeCurrencyMode || 'fiat')
		if (fiatPrice) {
			setFiatDisplayValue(fiatPrice)
		}
	}, [storeBitcoinUnit, storeCurrencyMode, fiatPrice])

	// Derives sats from fiat once rates arrive, for products loaded for edit and fiat edits made without rates.
	useEffect(() => {
		const derivedSats = deriveSatsPriceFromFiat(
			{ currencyMode: storeCurrencyMode, fiatPrice, price, currency, hasExchangeRates },
			convertCurrencyToSats,
		)
		if (derivedSats !== null) {
			productFormActions.updateValues({ price: derivedSats })
		}
	}, [storeCurrencyMode, fiatPrice, price, currency, hasExchangeRates])

	// Update fiat display when currency or price changes (only for auto-conversion from sats)
	useEffect(() => {
		// Don't overwrite user input in fiat mode.
		if (storeCurrencyMode === 'fiat' && fiatPrice) {
			return
		}

		// Without rates the field would show a placeholder '0.00' that fiat-mode publishing would pick up.
		if (showFiatField && price && hasExchangeRates) {
			const satsValue = parseFloat(price) || 0
			if (satsValue > 0 && document.activeElement?.id !== 'fiat-price') {
				setFiatDisplayValue(convertSatsToCurrency(satsValue, currency).toFixed(2))
			}
		}
	}, [currency, price, showFiatField, storeCurrencyMode, fiatPrice, hasExchangeRates])

	return (
		<ProductPricingView
			currencies={CURRENCIES}
			currency={currency}
			onCurrencyChange={handleCurrencyChange}
			fiatDisplayValue={fiatDisplayValue}
			onFiatPriceChange={handleFiatPriceChange}
			bitcoinUnit={bitcoinUnit}
			bitcoinDisplayValue={getBitcoinDisplayValue()}
			onBitcoinPriceChange={handleBitcoinPriceChange}
			onToggleBitcoinUnit={toggleBitcoinUnit}
			currencyMode={currencyMode}
			onCurrencyModeChange={(value) => {
				setCurrencyMode(value)
				productFormActions.updateValues({ currencyMode: value })
			}}
			quantity={quantity}
			onQuantityChange={(value) => productFormActions.updateValues({ quantity: value })}
			status={status}
			onStatusChange={(value) => productFormActions.updateValues({ status: value })}
			isNSFW={isNSFW}
			onNSFWChange={(value) => productFormActions.updateValues({ isNSFW: value })}
		/>
	)
}

export function CategoryTab() {
	const { categories, mainCategory } = useStore(productFormStore)

	const addSubCategory = () => {
		if (categories.length >= MAX_SUB_CATEGORIES) {
			toast.error('You can only add up to 3 sub categories')
			return
		}
		productFormActions.updateCategories([...categories, { key: `category-${Date.now()}`, name: '', checked: true }])
	}

	const updateCategoryName = (index: number, name: string) => {
		if (index >= categories.length) {
			if (name.trim()) {
				productFormActions.updateCategories([...categories, { key: `category-${Date.now()}`, name, checked: true }])
			}
			return
		}

		const newCategories = [...categories]
		newCategories[index] = { ...newCategories[index], name }
		productFormActions.updateCategories(newCategories)
	}

	return (
		<ProductCategoryView
			mainCategories={PRODUCT_CATEGORIES}
			mainCategory={mainCategory || ''}
			onMainCategoryChange={(value) => productFormActions.updateValues({ mainCategory: value })}
			subCategories={categories}
			onSubCategoryNameChange={updateCategoryName}
			onRemoveSubCategory={(index) => productFormActions.updateCategories(categories.filter((_, i) => i !== index))}
			onAddSubCategory={addSubCategory}
		/>
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
			productFormActions.updateImages([...images, { imageUrl: url, imageOrder: images.length }])
			setNeedsUploader(true)
		}
	}

	const reorder = (from: number, to: number) => {
		const newImages = [...images]
		;[newImages[from], newImages[to]] = [newImages[to], newImages[from]]
		productFormActions.updateImages(newImages.map((img, i) => ({ ...img, imageOrder: i })))
	}

	return (
		<ProductImagesView hasImages={images.length > 0}>
			{images.map((image, i) => (
				<ImageUploader
					key={i}
					src={image.imageUrl}
					index={i}
					imagesLength={images.length}
					onSave={handleSaveImage}
					onDelete={(index) =>
						productFormActions.updateImages(images.filter((_, j) => j !== index).map((img, j) => ({ ...img, imageOrder: j })))
					}
					onPromote={(index) => index > 0 && reorder(index, index - 1)}
					onDemote={(index) => index < images.length - 1 && reorder(index, index + 1)}
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
		</ProductImagesView>
	)
}

// Quick-create shipping templates for new users
const QUICK_SHIPPING_TEMPLATES: Array<{
	name: string
	description: string
	service: ShippingFormData['service']
	icon: 'digital' | 'worldwide' | 'pickup'
}> = [
	{
		name: 'Digital Delivery',
		description: 'For digital products - instant delivery, no shipping cost',
		service: 'digital',
		icon: 'digital',
	},
	{
		name: 'Worldwide Standard',
		description: 'Ship anywhere in the world with standard delivery',
		service: 'standard',
		icon: 'worldwide',
	},
	{
		name: 'Local Pickup',
		description: 'Customer picks up the item at your location',
		service: 'pickup',
		icon: 'pickup',
	},
]

const EMPTY_PICKUP_ADDRESS: PickupAddressDraft = { street: '', city: '', state: '', postalCode: '', country: '' }

export function ShippingTab() {
	const { shippings } = useStore(productFormStore)
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)
	const [isCreatingShipping, setIsCreatingShipping] = useState(false)
	const [showPickupForm, setShowPickupForm] = useState(false)
	const [pickupAddress, setPickupAddress] = useState<PickupAddressDraft>(EMPTY_PICKUP_ADDRESS)
	const publishShippingMutation = usePublishShippingOptionMutation()

	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const shippingOptionsQuery = useShippingOptionsByPubkey(user?.pubkey || '')

	const publishAndAttach = async (formData: ShippingFormData, successMessage: string) => {
		setIsCreatingShipping(true)
		try {
			const publishedShipping = await publishShippingMutation.mutateAsync(formData)
			productFormActions.updateValues({
				shippings: attachShippingOptionByRef(productFormStore.state.shippings, publishedShipping.shippingRef),
			})
			toast.success(successMessage)
			return true
		} catch (error) {
			console.error('Failed to create shipping option:', error)
			toast.error('Failed to create shipping option')
			return false
		} finally {
			setIsCreatingShipping(false)
		}
	}

	const handleQuickCreate = async (name: string) => {
		const template = QUICK_SHIPPING_TEMPLATES.find((t) => t.name === name)
		if (!template || isCreatingShipping || !user?.pubkey) return

		// Pickup needs an address first.
		if (template.service === 'pickup') {
			setShowPickupForm(true)
			return
		}

		await publishAndAttach(
			{ title: template.name, description: template.description, price: '0', currency: 'USD', countries: [], service: template.service },
			`${template.name} shipping option created and added!`,
		)
	}

	const handlePickupSubmit = async () => {
		if (!user?.pubkey) return

		if (!pickupAddress.street.trim()) {
			toast.error('Street address is required')
			return
		}
		if (!pickupAddress.city.trim()) {
			toast.error('City is required')
			return
		}

		const created = await publishAndAttach(
			{
				title: 'Local Pickup',
				description: 'Customer picks up the item at your location',
				price: '0',
				currency: 'USD',
				countries: [],
				service: 'pickup',
				pickupAddress,
			},
			'Local Pickup shipping option created and added!',
		)
		if (created) {
			setShowPickupForm(false)
			setPickupAddress(EMPTY_PICKUP_ADDRESS)
		}
	}

	const availableShippingOptions = useMemo(() => {
		if (!shippingOptionsQuery.data || !user?.pubkey) return []

		return shippingOptionsQuery.data
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return null

				return {
					id: createShippingReference(user.pubkey, info.id),
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

	const addShippingOption = (optionId: string) => {
		if (shippings.some((s) => s.shippingRef === optionId)) {
			toast.error('This shipping option is already added')
			return
		}

		const newShipping: ProductShippingForm = { shippingRef: optionId, extraCost: '' }
		productFormActions.updateValues({ shippings: [...shippings, newShipping] })
	}

	const updateExtraCost = (index: number, extraCost: string) => {
		const updatedShippings = [...shippings]
		updatedShippings[index] = { ...updatedShippings[index], extraCost }
		productFormActions.updateValues({ shippings: updatedShippings })
	}

	const resolvedSelectedShippings = useMemo(
		() => resolveProductShippingSelections(shippings, availableShippingOptions),
		[shippings, availableShippingOptions],
	)

	const hasValidShipping = shippingOptionsQuery.isFetched
		? resolvedSelectedShippings.some((shipping) => shipping.isResolved)
		: shippings.some((shipping) => !!shipping.shippingRef)

	return (
		<ProductShippingView
			selected={shippings.length > 0 ? resolvedSelectedShippings : []}
			available={availableShippingOptions}
			hasValidShipping={hasValidShipping}
			isLoading={shippingOptionsQuery.isLoading}
			isFetched={shippingOptionsQuery.isFetched}
			onExtraCostChange={updateExtraCost}
			onRemove={(index) => productFormActions.updateValues({ shippings: shippings.filter((_, i) => i !== index) })}
			onAdd={(option) => addShippingOption(option.id)}
			templates={QUICK_SHIPPING_TEMPLATES}
			onQuickCreate={(template) => void handleQuickCreate(template.name)}
			isCreating={isCreatingShipping}
			showPickupForm={showPickupForm}
			pickupAddress={pickupAddress}
			onPickupAddressChange={(field, value) => setPickupAddress((prev) => ({ ...prev, [field]: value }))}
			onPickupCancel={() => {
				setShowPickupForm(false)
				setPickupAddress(EMPTY_PICKUP_ADDRESS)
			}}
			onPickupSubmit={() => void handlePickupSubmit()}
		/>
	)
}

export function SpecTab() {
	const { specs } = useStore(productFormStore)

	return (
		<ProductSpecsView
			specs={specs}
			onSpecChange={(index, field, value) => {
				const newSpecs = [...specs]
				newSpecs[index] = { ...newSpecs[index], [field]: value }
				productFormActions.updateValues({ specs: newSpecs })
			}}
			onAddSpec={() => productFormActions.updateValues({ specs: [...specs, { key: '', value: '' }] })}
			onRemoveSpec={(index) => productFormActions.updateValues({ specs: specs.filter((_, i) => i !== index) })}
		/>
	)
}
