import { ProductFormContent } from '@/components/sheet-contents/NewProductContent'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { authStore } from '@/lib/stores/auth'
import { productFormActions } from '@/lib/stores/product'
import { hasProductFormDraft } from '@/lib/utils/productFormStorage'
import { getProductId, productsByPubkeyQueryOptions } from '@/queries/products'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useCallback, useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/products/$productId')({
	component: EditProductComponent,
})

type InitState = 'idle' | 'checking' | 'loading-draft' | 'loading-product' | 'ready'

function EditProductComponent() {
	const { productId } = Route.useParams()
	const { user } = useStore(authStore)
	const [initState, setInitState] = useState<InitState>('idle')

	// Simple lock to prevent concurrent initialization
	const lockRef = useRef(false)

	useDashboardTitle('Edit Product')

	// Fetch user's products to find the one being edited (including hidden products)
	const { data: products = [], isLoading: isLoadingProducts } = useQuery({
		...productsByPubkeyQueryOptions(user?.pubkey ?? '', true),
		enabled: !!user?.pubkey,
	})

	// Find the product being edited (productId is the event.id from the URL)
	const product = products.find((p) => p.id === productId)
	const productExists = !!product

	// Get the d tag value - this is what we use for draft storage (consistent with editingProductId)
	const productDTag = product ? getProductId(product) : null

	const initializeForm = useCallback(async () => {
		if (!productDTag) return
		if (lockRef.current) return
		lockRef.current = true

		try {
			setInitState('checking')

			// Use productDTag for draft lookup (same key used for saving)
			const hasDraft = await hasProductFormDraft(productDTag)

			if (hasDraft) {
				// Auto-load the draft instead of prompting
				setInitState('loading-draft')
				productFormActions.setEditingProductId(productDTag)
				await productFormActions.loadDraftForProduct(productDTag)
				setInitState('ready')
			} else {
				setInitState('loading-product')
				productFormActions.reset()
				productFormActions.setEditingProductId(productDTag)
				await productFormActions.loadProductForEdit(productId)
				setInitState('ready')
			}
		} finally {
			lockRef.current = false
		}
	}, [productId, productDTag])

	// Effect to reset state when productId changes
	useEffect(() => {
		setInitState('idle')
		lockRef.current = false
	}, [productId])

	// Effect to start initialization when ready
	const canInitialize = productExists && productDTag !== null && initState === 'idle'
	useEffect(() => {
		if (canInitialize) {
			initializeForm()
		}
	}, [canInitialize, initializeForm])

	// Loading products from query
	if (isLoadingProducts) {
		return (
			<Card>
				<CardContent className="p-8">
					<div className="space-y-4">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
					</div>
				</CardContent>
			</Card>
		)
	}

	// Product not found
	if (!product) {
		return (
			<Card>
				<CardContent className="p-8 text-center">
					<h1 className="text-2xl font-bold">Product Not Found</h1>
					<p className="text-gray-500 mt-2">The product you're looking for doesn't exist or you don't have access to it.</p>
				</CardContent>
			</Card>
		)
	}

	// Checking for draft or loading product
	if (initState === 'idle' || initState === 'checking' || initState === 'loading-draft' || initState === 'loading-product') {
		return (
			<Card>
				<CardContent className="p-8">
					<div className="space-y-4">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
					</div>
				</CardContent>
			</Card>
		)
	}

	// Ready to show the form - pass productDTag for draft checking and productId for reloading
	return <ProductFormContent showFooter={true} productDTag={productDTag} productEventId={productId} />
}
