import { ProductFormContent } from '@/components/sheet-contents/products/ProductFormContent'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_FORM_STATE, productFormActions, productFormStore, type ProductFormState } from '@/lib/stores/product'
import { resolveProductWorkflow } from '@/lib/workflow/productWorkflowResolver'
import { useProductCreateReadiness } from '@/lib/workflow/useProductCreateReadiness'
import { useStore } from '@tanstack/react-store'
import { useEffect, useMemo, useRef, useState } from 'react'

type ProductCreateShellProps = {
	userPubkey?: string | null
	className?: string
	formClassName?: string
	showFooter?: boolean
}

let lastCreateShellBootstrapIdentity: string | null = null

function hasStartedProductFormOrIsEditing(state: ProductFormState) {
	if (state.editingProductId) return true
	if (state.isDirty) return true

	return (
		state.name !== DEFAULT_FORM_STATE.name ||
		state.summary !== DEFAULT_FORM_STATE.summary ||
		state.description !== DEFAULT_FORM_STATE.description ||
		state.price !== DEFAULT_FORM_STATE.price ||
		state.fiatPrice !== DEFAULT_FORM_STATE.fiatPrice ||
		state.quantity !== DEFAULT_FORM_STATE.quantity ||
		state.status !== DEFAULT_FORM_STATE.status ||
		state.productType !== DEFAULT_FORM_STATE.productType ||
		state.mainCategory !== DEFAULT_FORM_STATE.mainCategory ||
		state.selectedCollection !== DEFAULT_FORM_STATE.selectedCollection ||
		state.specs.length > 0 ||
		state.categories.length > 0 ||
		state.images.length > 0 ||
		state.shippings.length > 0 ||
		state.weight !== DEFAULT_FORM_STATE.weight ||
		state.dimensions !== DEFAULT_FORM_STATE.dimensions ||
		state.isNSFW !== DEFAULT_FORM_STATE.isNSFW
	)
}

function ProductCreateLoadingState() {
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

export function ProductCreateShell({ userPubkey, className = '', formClassName, showFooter = true }: ProductCreateShellProps) {
	const normalizedUserPubkey = userPubkey ?? ''
	const formState = useStore(productFormStore)
	const readiness = useProductCreateReadiness(normalizedUserPubkey)
	const [isBootstrapped, setIsBootstrapped] = useState(false)
	const hasBootstrappedRef = useRef(false)
	const hasStartedCreateFormOrIsEditing = hasStartedProductFormOrIsEditing(formState)

	const workflow = useMemo(
		() =>
			resolveProductWorkflow({
				mode: 'create',
				shippingState: readiness.shippingState,
				v4vConfigurationState: readiness.v4vConfigurationState,
			}),
		[readiness.shippingState, readiness.v4vConfigurationState],
	)

	useEffect(() => {
		hasBootstrappedRef.current = false
		setIsBootstrapped(false)
	}, [normalizedUserPubkey])

	useEffect(() => {
		if (!workflow.isBootstrapReady || hasBootstrappedRef.current) return

		const hasKnownDifferentBootstrapIdentity =
			lastCreateShellBootstrapIdentity !== null && lastCreateShellBootstrapIdentity !== normalizedUserPubkey
		const shouldResumeExistingSession =
			Boolean(formState.editingProductId) || (hasStartedCreateFormOrIsEditing && !hasKnownDifferentBootstrapIdentity)

		if (!shouldResumeExistingSession) {
			productFormActions.startCreateProductSession()
			productFormActions.setActiveTab(workflow.initialTab)
		}

		lastCreateShellBootstrapIdentity = normalizedUserPubkey
		hasBootstrappedRef.current = true
		setIsBootstrapped(true)
	}, [formState.editingProductId, hasStartedCreateFormOrIsEditing, normalizedUserPubkey, workflow.initialTab, workflow.isBootstrapReady])

	const content =
		!workflow.isBootstrapReady || !isBootstrapped ? (
			<ProductCreateLoadingState />
		) : (
			<ProductFormContent className={formClassName} showFooter={showFooter} workflow={workflow} />
		)

	return className ? <div className={className}>{content}</div> : content
}
