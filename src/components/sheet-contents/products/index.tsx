import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { authActions, authStore } from '@/lib/stores/auth'
import type { ProductFormState } from '@/lib/stores/product'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore } from '@/lib/stores/product'
import { resolveProductWorkflow, type ShippingSetupState, type V4VSetupState } from '@/lib/workflow/productWorkflowResolver'
import { createShippingReference, getShippingInfo, isShippingDeleted, useShippingOptionsByPubkey } from '@/queries/shipping'
import { useV4VConfiguration } from '@/queries/v4v'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ProductFormContent } from './ProductFormContent'
import { ProductWelcomeScreen } from './ProductWelcomeScreen'

export function NewProductContent({
	title,
	description,
	showWelcome = true,
}: {
	title?: string
	description?: string
	showWelcome?: boolean
}) {
	const [hasProducts, setHasProducts] = useState(false)

	// Get form state from store, including editingProductId
	const formState = useStore(productFormStore)
	const { editingProductId } = formState

	// Get user and authentication status from auth store
	const { user, isAuthenticated } = useStore(authStore)
	const userPubkey = user?.pubkey ?? ''
	const hasBootstrappedRef = useRef(false)

	const shippingQuery = useShippingOptionsByPubkey(userPubkey)
	const v4vQuery = useV4VConfiguration(userPubkey)

	// Function to check if the form has been modified from its default state
	const isFormModified = (currentState: ProductFormState) => {
		// When editing, the form is pre-filled, so it will always appear "modified" compared to DEFAULT_FORM_STATE.
		// If we are editing, we consider the form as needing to be shown if an ID is present.
		if (currentState.editingProductId) return true

		return (
			currentState.name !== DEFAULT_FORM_STATE.name ||
			currentState.description !== DEFAULT_FORM_STATE.description ||
			currentState.price !== DEFAULT_FORM_STATE.price ||
			currentState.quantity !== DEFAULT_FORM_STATE.quantity ||
			currentState.specs.length > 0 ||
			currentState.categories.length > 0 ||
			currentState.images.length > 0 ||
			currentState.weight !== DEFAULT_FORM_STATE.weight ||
			currentState.dimensions !== DEFAULT_FORM_STATE.dimensions
		)
	}

	// Check if the user has started filling in the form or is editing
	const hasStartedFormOrIsEditing = isFormModified(formState)

	const [showForm, setShowForm] = useState(hasStartedFormOrIsEditing)

	const shippingState = useMemo<ShippingSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (!shippingQuery.isFetched) return shippingQuery.isLoading ? 'loading' : 'unknown'

		const activeShippingRefs = new Set(
			(shippingQuery.data ?? [])
				.filter((event) => {
					const dTag = event.tags?.find((tag: string[]) => tag[0] === 'd')?.[1]
					return dTag ? !isShippingDeleted(dTag, event.created_at) : true
				})
				.map((event) => {
					const info = getShippingInfo(event)
					return info ? createShippingReference(event.pubkey, info.id) : null
				})
				.filter((shippingRef): shippingRef is string => !!shippingRef),
		)

		return activeShippingRefs.size === 0 ? 'empty' : 'ready'
	}, [userPubkey, shippingQuery.data, shippingQuery.isFetched, shippingQuery.isLoading])

	const v4vState = useMemo<V4VSetupState>(() => {
		if (!userPubkey) return 'loading'
		if (v4vQuery.isLoading) return 'loading'

		return v4vQuery.data?.state ?? 'unknown'
	}, [userPubkey, v4vQuery.data?.state, v4vQuery.isLoading])

	const workflow = useMemo(
		() =>
			resolveProductWorkflow({
				mode: editingProductId ? 'edit' : 'create',
				editingProductId,
				shippingState,
				v4vConfigurationState: v4vState,
			}),
		[editingProductId, shippingState, v4vState],
	)

	// Check if user has products when component mounts or user changes
	useEffect(() => {
		const checkUserProducts = async () => {
			if (isAuthenticated && user) {
				const userHasExistingProducts = await authActions.userHasProducts()
				setHasProducts(userHasExistingProducts)
			}
		}
		checkUserProducts()
	}, [isAuthenticated, user])

	// Update showForm based on form modification, existing products, or if editing an existing product
	useEffect(() => {
		if (editingProductId) {
			// If editing, always show the form
			setShowForm(true)
		} else if ((hasStartedFormOrIsEditing || hasProducts) && !showForm) {
			setShowForm(true)
		}
	}, [hasStartedFormOrIsEditing, hasProducts, showForm, editingProductId])

	useEffect(() => {
		if (!showForm || editingProductId) {
			hasBootstrappedRef.current = false
			return
		}

		if (!workflow.isBootstrapReady || hasStartedFormOrIsEditing || hasBootstrappedRef.current) return

		productFormActions.startCreateProductSession()
		productFormActions.setActiveTab(workflow.initialTab)
		hasBootstrappedRef.current = true
	}, [showForm, editingProductId, workflow.isBootstrapReady, workflow.initialTab, hasStartedFormOrIsEditing])

	// Default titles
	const defaultTitle = editingProductId ? 'Edit Product' : 'Add A Product'
	const defaultDescription = editingProductId ? 'Modify the details of your product.' : 'Create a new product to sell in your shop'

	if (!showForm && showWelcome) {
		return (
			<SheetContent side="right" className="p-6">
				{/* This is for Accessibility but we don't need to show it */}
				<SheetHeader className="hidden">
					<SheetTitle>Welcome to Plebeian Market</SheetTitle>
					<SheetDescription>Start selling your products in just a few minutes</SheetDescription>
				</SheetHeader>
				<ProductWelcomeScreen onGetStarted={() => setShowForm(true)} />
			</SheetContent>
		)
	}

	return (
		<SheetContent
			side="right"
			className="flex flex-col max-h-screen overflow-hidden w-[100vw] sm:min-w-[85vw] md:min-w-[55vw] xl:min-w-[35vw] p-6"
		>
			<SheetHeader>
				<SheetTitle className="text-center">{title || defaultTitle}</SheetTitle>
				<SheetDescription className="hidden">{description || defaultDescription}</SheetDescription>
			</SheetHeader>

			<ProductFormContent workflow={workflow} />
		</SheetContent>
	)
}

// Export all components for reuse
export { NameTab } from './NameTab'
export { DetailTab, CategoryTab, ImagesTab, ShippingTab, SpecTab } from './tabs'
export { ProductWelcomeScreen } from './ProductWelcomeScreen'
export { ProductFormContent } from './ProductFormContent'
