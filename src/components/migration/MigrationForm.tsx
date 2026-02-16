import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, useNDK } from '@/lib/stores/ndk'
import { publishMigratedProduct, type MigrationProgress } from '@/publish/migration'
import { parseNip15Event } from '@/queries/migration'
import { migrationKeys } from '@/queries/queryKeyFactory'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useCollectionsByPubkey } from '@/queries/collections'
import { MigrationProgressDialog, type MigrationStep, type RelayStatus } from './MigrationProgressDialog'
import type { RichShippingInfo } from '@/lib/stores/cart'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, X, PlusIcon, Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

interface MigrationFormProps {
	nip15Event: NDKEvent
	onBack: () => void
	onSuccess: () => void
}

const INITIAL_STEPS: MigrationStep[] = [
	{ id: 'preparing', label: 'Preparing product data...', status: 'pending' },
	{ id: 'signing', label: 'Waiting for signature...', status: 'pending' },
	{ id: 'publishing', label: 'Publishing to relays...', status: 'pending' },
	{ id: 'syncing', label: 'Syncing data from relays...', status: 'pending' },
	{ id: 'complete', label: 'Migration complete!', status: 'pending' },
]

export function MigrationForm({ nip15Event, onBack, onSuccess }: MigrationFormProps) {
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [isPublishing, setIsPublishing] = useState(false)
	const { user } = useStore(authStore)
	const { getUser } = useNDK()
	const [ndkUser, setNdkUser] = useState<any>(null)

	// Progress dialog state
	const [showProgress, setShowProgress] = useState(false)
	const [steps, setSteps] = useState<MigrationStep[]>(INITIAL_STEPS)
	const [relayStatuses, setRelayStatuses] = useState<RelayStatus[]>([])
	const [migrationError, setMigrationError] = useState<string | undefined>()

	const resetProgress = useCallback(() => {
		setSteps(INITIAL_STEPS)
		setRelayStatuses([])
		setMigrationError(undefined)
	}, [])

	const updateStepStatus = useCallback((stepId: string, status: MigrationStep['status']) => {
		setSteps((prev) =>
			prev.map((step) => {
				if (step.id === stepId) {
					return { ...step, status }
				}
				// Mark previous steps as complete when a new step becomes active
				if (status === 'active') {
					const stepIndex = prev.findIndex((s) => s.id === stepId)
					const currentIndex = prev.findIndex((s) => s.id === step.id)
					if (currentIndex < stepIndex && step.status === 'active') {
						return { ...step, status: 'complete' }
					}
				}
				return step
			}),
		)
	}, [])

	const handleProgress = useCallback(
		(progress: MigrationProgress) => {
			switch (progress.step) {
				case 'preparing':
					updateStepStatus('preparing', 'active')
					break
				case 'signing':
					updateStepStatus('preparing', 'complete')
					updateStepStatus('signing', 'active')
					break
				case 'publishing':
					updateStepStatus('signing', 'complete')
					updateStepStatus('publishing', 'active')
					// Initialize relay statuses when we get the relay list
					if (progress.relayUrls) {
						setRelayStatuses(progress.relayUrls.map((url) => ({ url, status: 'pending' })))
					}
					// Update individual relay status
					if (progress.relayUrl && progress.relayStatus) {
						setRelayStatuses((prev) => prev.map((r) => (r.url === progress.relayUrl ? { ...r, status: progress.relayStatus! } : r)))
					}
					break
				case 'done':
					updateStepStatus('publishing', 'complete')
					// Don't start syncing yet - that happens in handleSubmit
					break
			}
		},
		[updateStepStatus],
	)

	// Get user on mount for shipping/collection queries
	useEffect(() => {
		getUser().then(setNdkUser)
	}, [getUser])

	// Parse NIP-15 event
	const nip15Data = parseNip15Event(nip15Event)

	// Query shipping options for the user
	const { data: shippingOptionsData, isLoading: isLoadingShipping } = useShippingOptionsByPubkey(ndkUser?.pubkey || '')

	// Query collections for the user
	const { data: collectionsData, isLoading: isLoadingCollections } = useCollectionsByPubkey(ndkUser?.pubkey || '')

	// Process available shipping options
	const availableShippingOptions = useMemo(() => {
		if (!shippingOptionsData || !ndkUser?.pubkey) return []

		return shippingOptionsData
			.map((event) => {
				const info = getShippingInfo(event)
				if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) return null

				const id = createShippingReference(ndkUser.pubkey, info.id)

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
	}, [shippingOptionsData, ndkUser?.pubkey])

	// Process available collections
	const availableCollections = useMemo(() => {
		if (!collectionsData) return []

		return collectionsData.map((event) => {
			const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] || ''
			const titleTag = event.tags.find((t: string[]) => t[0] === 'title')?.[1] || ''
			return {
				id: dTag,
				name: titleTag || dTag,
				pubkey: event.pubkey,
			}
		})
	}, [collectionsData])

	// Initialize form state from NIP-15 data
	const [formData, setFormData] = useState({
		name: nip15Data.name,
		summary: '',
		description: nip15Data.description,
		price: nip15Data.price,
		currency: nip15Data.currency,
		quantity: nip15Data.quantity?.toString() || '1',
		status: 'on-sale' as 'hidden' | 'on-sale' | 'pre-order',
		productType: 'single' as 'single' | 'variable',
		mainCategory: '',
		images: nip15Data.images.map((url, index) => ({
			imageUrl: url,
			imageOrder: index,
		})),
		specs: nip15Data.specs.map((spec) => ({ key: spec[0], value: spec[1] })),
		categories: [] as Array<{ key: string; name: string; checked: boolean }>,
		shippings: [] as Array<{ shipping: { id: string; name: string } | null; extraCost: string }>,
		weight: null as { value: string; unit: string } | null,
		dimensions: null as { value: string; unit: string } | null,
		selectedCollection: null as string | null,
	})

	// Helper functions for managing form fields
	const addSubCategory = () => {
		if (formData.categories.length >= 3) {
			toast.error('You can only add up to 3 sub categories')
			return
		}
		setFormData({
			...formData,
			categories: [
				...formData.categories,
				{
					key: `category-${Date.now()}`,
					name: '',
					checked: true,
				},
			],
		})
	}

	const removeSubCategory = (index: number) => {
		setFormData({
			...formData,
			categories: formData.categories.filter((_, i) => i !== index),
		})
	}

	const updateSubCategory = (index: number, name: string) => {
		const newCategories = [...formData.categories]
		newCategories[index] = { ...newCategories[index], name }
		setFormData({ ...formData, categories: newCategories })
	}

	const addShippingOption = (option: RichShippingInfo) => {
		// Check if shipping option is already added
		const isAlreadyAdded = formData.shippings.some((s) => s.shipping?.id === option.id)
		if (isAlreadyAdded) {
			toast.error('This shipping option is already added')
			return
		}

		setFormData({
			...formData,
			shippings: [
				...formData.shippings,
				{
					shipping: {
						id: option.id,
						name: option.name || '',
					},
					extraCost: '',
				},
			],
		})
	}

	const removeShippingOption = (index: number) => {
		setFormData({
			...formData,
			shippings: formData.shippings.filter((_, i) => i !== index),
		})
	}

	const updateShippingExtraCost = (index: number, extraCost: string) => {
		const newShippings = [...formData.shippings]
		newShippings[index] = { ...newShippings[index], extraCost }
		setFormData({ ...formData, shippings: newShippings })
	}

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			toast.error('Product name is required')
			return
		}

		if (!formData.description.trim()) {
			toast.error('Product description is required')
			return
		}

		if (!formData.price || parseFloat(formData.price) <= 0) {
			toast.error('Valid product price is required')
			return
		}

		if (formData.images.length === 0) {
			toast.error('At least one product image is required')
			return
		}

		if (!formData.mainCategory) {
			toast.error('Main category is required')
			return
		}

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

		// Reset and show progress dialog
		resetProgress()
		setShowProgress(true)
		setIsPublishing(true)

		try {
			// Convert form data to ProductFormData format
			const productFormData = {
				name: formData.name,
				summary: formData.summary || '',
				description: formData.description,
				price: formData.price,
				quantity: formData.quantity,
				currency: formData.currency,
				status: formData.status,
				productType: formData.productType,
				mainCategory: formData.mainCategory,
				selectedCollection: formData.selectedCollection,
				categories: formData.categories,
				images: formData.images,
				specs: formData.specs,
				shippings: formData.shippings,
				weight: formData.weight,
				dimensions: formData.dimensions,
			}

			const newProductId = await publishMigratedProduct(productFormData, nip15Event.id, signer, ndk, handleProgress)

			// Start syncing step - invalidate queries (this is the slow part)
			updateStepStatus('syncing', 'active')
			if (user?.pubkey) {
				await queryClient.invalidateQueries({ queryKey: migrationKeys.all })
				await queryClient.invalidateQueries({ queryKey: migrationKeys.nip15Products(user.pubkey) })
				await queryClient.invalidateQueries({ queryKey: migrationKeys.migratedEvents(user.pubkey) })
			}
			updateStepStatus('syncing', 'complete')

			// Mark complete
			updateStepStatus('complete', 'complete')

			// Brief delay to show completion state before navigating
			await new Promise((resolve) => setTimeout(resolve, 500))

			setShowProgress(false)
			toast.success('Product migrated successfully!')
			onSuccess()

			// Navigate to the newly created product page
			navigate({ to: '/products/$productId', params: { productId: newProductId } })
		} catch (error) {
			console.error('Error migrating product:', error)
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Update step status to show error
			setSteps((prev) => prev.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)))
			setMigrationError(errorMessage)
		} finally {
			setIsPublishing(false)
		}
	}

	const handleRetry = () => {
		setShowProgress(false)
		// Small delay before retrying
		setTimeout(() => handleSubmit(), 100)
	}

	const handleCancel = () => {
		setShowProgress(false)
		resetProgress()
	}

	return (
		<div className="p-4 lg:p-6 space-y-6">
			<MigrationProgressDialog
				open={showProgress}
				steps={steps}
				relayStatuses={relayStatuses}
				error={migrationError}
				onRetry={handleRetry}
				onCancel={handleCancel}
			/>

			<Button variant="ghost" onClick={onBack} className="mb-4">
				<ArrowLeft className="w-4 h-4 mr-2" />
				Back to list
			</Button>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* NIP-15 Read-only Section */}
				<Card>
					<CardHeader>
						<CardTitle>NIP-15 Original</CardTitle>
						<CardDescription>Read-only view of the original NIP-15 product</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label>Name</Label>
							<Input value={nip15Data.name} readOnly className="bg-gray-50" />
						</div>
						<div>
							<Label>Description</Label>
							<Textarea value={nip15Data.description} readOnly className="bg-gray-50 min-h-[100px]" />
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Label>Price</Label>
								<Input value={`${nip15Data.price} ${nip15Data.currency}`} readOnly className="bg-gray-50" />
							</div>
							{nip15Data.quantity !== null && (
								<div>
									<Label>Quantity</Label>
									<Input value={nip15Data.quantity.toString()} readOnly className="bg-gray-50" />
								</div>
							)}
						</div>
						{nip15Data.images.length > 0 && (
							<div>
								<Label>Images</Label>
								<div className="grid grid-cols-2 gap-2 mt-2">
									{nip15Data.images.map((url, index) => (
										<img key={index} src={url} alt={`Product image ${index + 1}`} className="w-full h-32 object-cover rounded border" />
									))}
								</div>
							</div>
						)}
						{nip15Data.specs.length > 0 && (
							<div>
								<Label>Specifications</Label>
								<div className="space-y-2 mt-2">
									{nip15Data.specs.map((spec, index) => (
										<div key={index} className="text-sm">
											<strong>{spec[0]}:</strong> {spec[1]}
										</div>
									))}
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* NIP-99 Editable Form */}
				<Card>
					<CardHeader>
						<CardTitle>NIP-99 Enhanced Version</CardTitle>
						<CardDescription>Edit and enhance the product for NIP-99 format</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div>
							<Label htmlFor="name">
								<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Product Name</span>
							</Label>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								placeholder="Enter product name"
							/>
						</div>

						<div>
							<Label htmlFor="description">
								<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Description</span>
							</Label>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								placeholder="Enter product description"
								className="min-h-[100px]"
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div>
								<Label htmlFor="price">
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Price</span>
								</Label>
								<Input
									id="price"
									type="number"
									value={formData.price}
									onChange={(e) => setFormData({ ...formData, price: e.target.value })}
									placeholder="0.00"
								/>
							</div>
							<div>
								<Label htmlFor="currency">
									<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Currency</span>
								</Label>
								<Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
									<SelectTrigger id="currency">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{CURRENCIES.map((currency) => (
											<SelectItem key={currency} value={currency}>
												{currency}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div>
							<Label htmlFor="quantity">
								<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Quantity</span>
							</Label>
							<Input
								id="quantity"
								type="number"
								value={formData.quantity}
								onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
								placeholder="1"
							/>
						</div>

						<div>
							<Label htmlFor="mainCategory">
								<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Main Category</span>
							</Label>
							<Select value={formData.mainCategory} onValueChange={(value) => setFormData({ ...formData, mainCategory: value })}>
								<SelectTrigger id="mainCategory">
									<SelectValue placeholder="Select category" />
								</SelectTrigger>
								<SelectContent>
									{PRODUCT_CATEGORIES.map((category) => (
										<SelectItem key={category} value={category}>
											{category}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div>
							<Label>
								<span className="after:content-['*'] after:ml-0.5 after:text-red-500">Images</span>
							</Label>
							<div className="space-y-2 mt-2">
								{formData.images.map((image, index) => (
									<ImageUploader
										key={index}
										src={image.imageUrl}
										index={index}
										imagesLength={formData.images.length}
										onSave={({ url, index: imgIndex }) => {
											const newImages = [...formData.images]
											newImages[imgIndex] = { imageUrl: url, imageOrder: imgIndex }
											setFormData({ ...formData, images: newImages })
										}}
										onDelete={() => {
											const newImages = formData.images.filter((_, i) => i !== index)
											setFormData({ ...formData, images: newImages })
										}}
										onPromote={() => {
											if (index > 0) {
												const newImages = [...formData.images]
												;[newImages[index - 1], newImages[index]] = [newImages[index], newImages[index - 1]]
												setFormData({ ...formData, images: newImages })
											}
										}}
										onDemote={() => {
											if (index < formData.images.length - 1) {
												const newImages = [...formData.images]
												;[newImages[index], newImages[index + 1]] = [newImages[index + 1], newImages[index]]
												setFormData({ ...formData, images: newImages })
											}
										}}
									/>
								))}
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										setFormData({
											...formData,
											images: [...formData.images, { imageUrl: '', imageOrder: formData.images.length }],
										})
									}}
								>
									Add Image
								</Button>
							</div>
						</div>

						<div>
							<Label>Specifications</Label>
							<div className="space-y-2 mt-2">
								{formData.specs.map((spec, index) => (
									<div key={index} className="flex gap-2">
										<Input
											value={spec.key}
											onChange={(e) => {
												const newSpecs = [...formData.specs]
												newSpecs[index].key = e.target.value
												setFormData({ ...formData, specs: newSpecs })
											}}
											placeholder="Key"
										/>
										<Input
											value={spec.value}
											onChange={(e) => {
												const newSpecs = [...formData.specs]
												newSpecs[index].value = e.target.value
												setFormData({ ...formData, specs: newSpecs })
											}}
											placeholder="Value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => {
												setFormData({
													...formData,
													specs: formData.specs.filter((_, i) => i !== index),
												})
											}}
										>
											Remove
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										setFormData({
											...formData,
											specs: [...formData.specs, { key: '', value: '' }],
										})
									}}
								>
									Add Specification
								</Button>
							</div>
						</div>

						{/* Sub-categories */}
						{formData.mainCategory && (
							<div>
								<Label>Sub Categories (optional)</Label>
								<p className="text-sm text-gray-500 mt-1 mb-2">Add sub-categories to better describe your product</p>
								<div className="space-y-2">
									{formData.categories.map((category, index) => (
										<div key={category.key} className="flex gap-2">
											<Input
												value={category.name}
												onChange={(e) => updateSubCategory(index, e.target.value)}
												placeholder={`Sub category ${index + 1}`}
												className="flex-1"
											/>
											<Button type="button" variant="ghost" size="sm" onClick={() => removeSubCategory(index)}>
												<X className="w-4 h-4" />
											</Button>
										</div>
									))}
									<Button
										type="button"
										variant="outline"
										onClick={addSubCategory}
										disabled={formData.categories.length >= 3}
										className="w-full flex items-center gap-2"
									>
										<PlusIcon className="w-4 h-4" />
										Add Sub Category
									</Button>
								</div>
							</div>
						)}

						{/* Shipping Options */}
						<div>
							<Label>Shipping Options</Label>
							<p className="text-sm text-gray-500 mt-1 mb-2">Select shipping methods available for this product</p>
							{isLoadingShipping ? (
								<div className="flex items-center gap-2 text-gray-500">
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Loading shipping options...</span>
								</div>
							) : availableShippingOptions.length === 0 ? (
								<p className="text-sm text-gray-500">No shipping options configured. You can add them in Dashboard → Shipping Options</p>
							) : (
								<div className="space-y-2">
									{/* Selected shipping options */}
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
														onChange={(e) => updateShippingExtraCost(index, e.target.value)}
														placeholder="Extra cost"
														className="w-24 text-sm"
													/>
													<Button type="button" variant="ghost" size="sm" onClick={() => removeShippingOption(index)}>
														<X className="w-4 h-4" />
													</Button>
												</div>
											))}
										</div>
									)}
									{/* Available shipping options */}
									<div className="space-y-2">
										{availableShippingOptions.map((option) => {
											const isSelected = formData.shippings.some((s) => s.shipping?.id === option.id)
											return (
												<div
													key={option.id}
													className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-gray-50 ${isSelected ? 'opacity-50' : ''}`}
													onClick={() => !isSelected && addShippingOption(option)}
												>
													<div className="flex-1">
														<div className="font-medium">{option.name}</div>
														<div className="text-sm text-gray-500">
															{option.cost} {option.currency} •{' '}
															{option.countries && option.countries.length > 0
																? option.countries.length > 1
																	? `${option.countries.length} countries`
																	: option.countries[0]
																: 'Worldwide'}
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

						{/* Weight */}
						<div>
							<Label>Weight (optional)</Label>
							<div className="flex gap-2 mt-2">
								<Input
									type="number"
									step="0.01"
									min="0"
									placeholder="Weight value"
									value={formData.weight?.value || ''}
									onChange={(e) =>
										setFormData({
											...formData,
											weight: e.target.value ? { value: e.target.value, unit: formData.weight?.unit || 'kg' } : null,
										})
									}
									className="flex-1"
								/>
								<Select
									value={formData.weight?.unit || 'kg'}
									onValueChange={(value) =>
										setFormData({
											...formData,
											weight: formData.weight ? { ...formData.weight, unit: value } : { value: '', unit: value },
										})
									}
								>
									<SelectTrigger className="w-24">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="g">g</SelectItem>
										<SelectItem value="kg">kg</SelectItem>
										<SelectItem value="oz">oz</SelectItem>
										<SelectItem value="lb">lb</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Dimensions */}
						<div>
							<Label>Dimensions (optional)</Label>
							<p className="text-sm text-gray-500 mt-1 mb-2">Format: Length x Width x Height</p>
							<div className="flex gap-2">
								<Input
									placeholder="e.g., 10x5x3"
									value={formData.dimensions?.value || ''}
									onChange={(e) =>
										setFormData({
											...formData,
											dimensions: e.target.value ? { value: e.target.value, unit: formData.dimensions?.unit || 'cm' } : null,
										})
									}
									className="flex-1"
								/>
								<Select
									value={formData.dimensions?.unit || 'cm'}
									onValueChange={(value) =>
										setFormData({
											...formData,
											dimensions: formData.dimensions ? { ...formData.dimensions, unit: value } : { value: '', unit: value },
										})
									}
								>
									<SelectTrigger className="w-24">
										<SelectValue />
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
						</div>

						{/* Collection */}
						<div>
							<Label>Collection (optional)</Label>
							<p className="text-sm text-gray-500 mt-1 mb-2">Assign this product to a collection</p>
							{isLoadingCollections ? (
								<div className="flex items-center gap-2 text-gray-500">
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Loading collections...</span>
								</div>
							) : availableCollections.length === 0 ? (
								<p className="text-sm text-gray-500">No collections found. You can create collections in Dashboard → Collections</p>
							) : (
								<Select
									value={formData.selectedCollection || 'none'}
									onValueChange={(value) => setFormData({ ...formData, selectedCollection: value === 'none' ? null : value })}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select a collection" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										{availableCollections.map((collection) => (
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
							<Button type="button" variant="secondary" onClick={handleSubmit} disabled={isPublishing} className="flex-1">
								{isPublishing ? 'Migrating...' : 'Migrate Product'}
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
