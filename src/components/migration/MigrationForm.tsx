import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CURRENCIES, PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { configStore } from '@/lib/stores/config'
import { publishMigratedProduct } from '@/publish/migration'
import { migrationKeys } from '@/queries/queryKeyFactory'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'

interface MigrationFormProps {
	nip15Event: NDKEvent
	onBack: () => void
	onSuccess: () => void
}

export function MigrationForm({ nip15Event, onBack, onSuccess }: MigrationFormProps) {
	const queryClient = useQueryClient()
	const [isPublishing, setIsPublishing] = useState(false)
	const { user } = useStore(authStore)

	// Parse NIP-15 event
	const nip15Data = parseNip15Event(nip15Event)

	// Initialize form state from NIP-15 data
	const [formData, setFormData] = useState({
		name: nip15Data.name,
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

		try {
			setIsPublishing(true)
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

			// Convert form data to ProductFormData format
			const productFormData = {
				name: formData.name,
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

			await publishMigratedProduct(productFormData, nip15Event.id, signer, ndk)

			// Invalidate queries
			if (user?.pubkey) {
				await queryClient.invalidateQueries({ queryKey: migrationKeys.all })
				await queryClient.invalidateQueries({ queryKey: migrationKeys.nip15Products(user.pubkey) })
				await queryClient.invalidateQueries({ queryKey: migrationKeys.migratedEvents(user.pubkey) })
			}

			toast.success('Product migrated successfully!')
			onSuccess()
		} catch (error) {
			console.error('Error migrating product:', error)
			toast.error(`Failed to migrate product: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			setIsPublishing(false)
		}
	}

	return (
		<div className="p-4 lg:p-6 space-y-6">
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
							<Label>Images</Label>
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

/**
 * Parses a NIP-15 event (kind 30018) into a readable format
 */
function parseNip15Event(event: NDKEvent) {
	let productData: {
		id: string
		name: string
		description: string
		price: string
		currency: string
		quantity: number | null
		images: string[]
		specs: Array<[string, string]>
		stall_id?: string
	} = {
		id: '',
		name: '',
		description: '',
		price: '0',
		currency: 'USD',
		quantity: null,
		images: [],
		specs: [],
	}

	try {
		const content = JSON.parse(event.content)
		productData = {
			id: content.id || '',
			name: content.name || '',
			description: content.description || '',
			price: content.price?.toString() || '0',
			currency: content.currency || 'USD',
			quantity: content.quantity ?? null,
			images: content.images || [],
			specs: content.specs || [],
			stall_id: content.stall_id,
		}
	} catch (error) {
		console.error('Failed to parse NIP-15 event content:', error)
		// Fallback: try to extract from tags
		const dTag = event.tags.find((tag) => tag[0] === 'd')
		if (dTag) {
			productData.id = dTag[1] || ''
		}
		productData.description = event.content || ''
	}

	return productData
}
