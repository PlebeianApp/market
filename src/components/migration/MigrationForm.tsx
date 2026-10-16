import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { ndkActions, useNDK } from '@/lib/stores/ndk'
import { publishMigratedProduct, type MigrationProgress } from '@/publish/migration'
import { migrationKeys } from '@/queries/queryKeyFactory'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useCollectionsByPubkey } from '@/queries/collections'
import { MigrationProgressDialog, type MigrationStep, type RelayStatus } from '@ui/components/MigrationProgressDialog'
import { MigrationFormView, type MigrationFormData, type MigrationShippingOption } from '@ui/components/migration/MigrationFormView'
import { parseNip15Product } from '@sdk/commerce/products/nip15Migration'
import type { RichShippingInfo } from '@/lib/stores/cart'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
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
	const nip15Data = parseNip15Product(nip15Event)

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
	const [formData, setFormData] = useState<MigrationFormData>({
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

	const addShippingOption = (option: MigrationShippingOption) => {
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
		<MigrationFormView
			original={nip15Data}
			formData={formData}
			onChange={(patch) => setFormData((prev) => ({ ...prev, ...patch }))}
			currencies={CURRENCIES}
			categories={PRODUCT_CATEGORIES}
			renderImageUploader={(index) => (
				<ImageUploader
					key={index}
					src={formData.images[index].imageUrl}
					index={index}
					imagesLength={formData.images.length}
					onSave={({ url, index: imgIndex }) => {
						const newImages = [...formData.images]
						newImages[imgIndex] = { imageUrl: url, imageOrder: imgIndex }
						setFormData({ ...formData, images: newImages })
					}}
					onDelete={() => setFormData({ ...formData, images: formData.images.filter((_, i) => i !== index) })}
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
			)}
			shippingOptions={availableShippingOptions}
			isLoadingShipping={isLoadingShipping}
			collections={availableCollections}
			isLoadingCollections={isLoadingCollections}
			onAddSubCategory={addSubCategory}
			onAddShipping={addShippingOption}
			isPublishing={isPublishing}
			onSubmit={handleSubmit}
			onBack={onBack}
			progressDialog={
				<MigrationProgressDialog
					open={showProgress}
					steps={steps}
					relayStatuses={relayStatuses}
					error={migrationError}
					onRetry={handleRetry}
					onCancel={handleCancel}
				/>
			}
		/>
	)
}
