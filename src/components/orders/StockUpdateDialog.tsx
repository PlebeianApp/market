import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchProductByATag, getProductId, getProductStock } from '@/queries/products'
import { useUpdateProductMutation, type ProductFormData } from '@/publish/products'
import type { OrderWithRelatedEvents } from '@/queries/orders'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ndkActions } from '@/lib/stores/ndk'
import type { NDKEvent } from '@nostr-dev-kit/ndk'
import {
	getProductTitle,
	getProductDescription,
	getProductPrice,
	getProductImages,
	getProductSpecs,
	getProductType,
	getProductVisibility,
	getProductWeight,
	getProductDimensions,
	getProductCategories,
	getProductCollection,
	getProductShippingOptions,
} from '@/queries/products'

interface ProductStockUpdate {
	productRef: string // Format: 30402:pubkey:dtag
	productName: string
	quantityOrdered: number
	currentStock: number
	newStock: number
	productEvent: NDKEvent | null
}

interface StockUpdateDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	order: OrderWithRelatedEvents
	onComplete: () => void
}

export function StockUpdateDialog({ open, onOpenChange, order, onComplete }: StockUpdateDialogProps) {
	const [products, setProducts] = useState<ProductStockUpdate[]>([])
	const [loading, setLoading] = useState(false)
	const updateProductMutation = useUpdateProductMutation()
	const ndk = ndkActions.getNDK()

	// Extract products from order and fetch their current stock
	useEffect(() => {
		if (!open || !ndk) return

		const fetchProductsData = async () => {
			setLoading(true)
			try {
				// Get all item tags from the order
				const itemTags = order.order.tags.filter((tag) => tag[0] === 'item')

				const productUpdates: ProductStockUpdate[] = []

				for (const itemTag of itemTags) {
					const productRef = itemTag[1] // Format: 30402:pubkey:dtag
					const quantity = parseInt(itemTag[2] || '1')

					// Parse the product reference
					const [kind, pubkey, dTag] = productRef.split(':')

					if (kind !== '30402' || !pubkey || !dTag) {
						console.warn('Invalid product reference:', productRef)
						continue
					}

					// Fetch the product event
					const productEvent = await fetchProductByATag(pubkey, dTag)

					if (!productEvent) {
						console.warn('Product not found:', productRef)
						continue
					}

					const productName = getProductTitle(productEvent)
					const stockTag = getProductStock(productEvent)
					const currentStock = stockTag ? parseInt(stockTag[1]) : 0
					const newStock = Math.max(0, currentStock - quantity)

					productUpdates.push({
						productRef,
						productName,
						quantityOrdered: quantity,
						currentStock,
						newStock,
						productEvent,
					})
				}

				setProducts(productUpdates)
			} catch (error) {
				console.error('Error fetching product data:', error)
				toast.error('Failed to load product information')
			} finally {
				setLoading(false)
			}
		}

		fetchProductsData()
	}, [open, order, ndk])

	const handleStockChange = (productRef: string, value: string) => {
		const newStock = parseInt(value) || 0
		setProducts((prev) => prev.map((p) => (p.productRef === productRef ? { ...p, newStock: Math.max(0, newStock) } : p)))
	}

	const handleUpdateStock = async () => {
		setLoading(true)
		try {
			const signer = ndkActions.getSigner()
			if (!signer) {
				toast.error('No signer available')
				return
			}

			// Update each product with new stock
			for (const product of products) {
				if (!product.productEvent) continue

				const [, , dTag] = product.productRef.split(':')

				// Build form data from existing product event
				const priceTag = getProductPrice(product.productEvent)
				const typeTag = getProductType(product.productEvent)
				const visibilityTag = getProductVisibility(product.productEvent)
				const weightTag = getProductWeight(product.productEvent)
				const dimensionsTag = getProductDimensions(product.productEvent)
				const images = getProductImages(product.productEvent)
				const specs = getProductSpecs(product.productEvent)
				const categories = getProductCategories(product.productEvent)
				const shippingOptions = getProductShippingOptions(product.productEvent)
				const collectionTag = getProductCollection(product.productEvent)

				const formData: ProductFormData = {
					name: product.productName,
					description: getProductDescription(product.productEvent),
					price: priceTag?.[1] || '0',
					quantity: product.newStock.toString(),
					currency: priceTag?.[2] || 'USD',
					status: (visibilityTag?.[1] || 'on-sale') as 'hidden' | 'on-sale' | 'pre-order',
					productType: typeTag?.[1] === 'simple' ? 'single' : 'variable',
					mainCategory: categories[0]?.[1] || '',
					selectedCollection: collectionTag,
					categories: categories.slice(1).map((cat) => ({
						key: cat[1],
						name: cat[1],
						checked: true,
					})),
					images: images.map((img, index) => ({
						imageUrl: img[1],
						imageOrder: parseInt(img[3] || index.toString()),
					})),
					specs: specs.map((spec) => ({
						key: spec[1],
						value: spec[2],
					})),
					shippings: shippingOptions.map((opt) => ({
						shipping: { id: opt[1], name: opt[1] },
						extraCost: opt[2] || '0',
					})),
					weight: weightTag
						? {
								value: weightTag[1],
								unit: weightTag[2],
							}
						: null,
					dimensions: dimensionsTag
						? {
								value: dimensionsTag[1],
								unit: dimensionsTag[2],
							}
						: null,
				}

				await updateProductMutation.mutateAsync({
					productDTag: dTag,
					formData,
				})
			}

			toast.success('All product stock levels updated successfully')
			onComplete()
			onOpenChange(false)
		} catch (error) {
			console.error('Error updating stock:', error)
			toast.error('Failed to update stock levels')
		} finally {
			setLoading(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Update Product Stock</DialogTitle>
					<DialogDescription>The order has been completed. Update the stock levels for the products in this order.</DialogDescription>
				</DialogHeader>

				{loading && products.length === 0 ? (
					<div className="py-8 text-center text-muted-foreground">Loading product information...</div>
				) : (
					<div className="space-y-4 py-4">
						{products.map((product) => (
							<div key={product.productRef} className="border rounded-lg p-4 space-y-3">
								<div className="font-medium">{product.productName}</div>
								<div className="grid grid-cols-3 gap-4 text-sm">
									<div>
										<Label className="text-muted-foreground">Ordered</Label>
										<div className="font-medium">{product.quantityOrdered}</div>
									</div>
									<div>
										<Label className="text-muted-foreground">Current Stock</Label>
										<div className="font-medium">{product.currentStock}</div>
									</div>
									<div>
										<Label htmlFor={`stock-${product.productRef}`}>New Stock</Label>
										<Input
											id={`stock-${product.productRef}`}
											type="number"
											min="0"
											value={product.newStock}
											onChange={(e) => handleStockChange(product.productRef, e.target.value)}
											className="mt-1"
										/>
									</div>
								</div>
							</div>
						))}
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
						Cancel
					</Button>
					<Button onClick={handleUpdateStock} disabled={loading || products.length === 0}>
						{loading ? 'Updating...' : 'Update Stock'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
