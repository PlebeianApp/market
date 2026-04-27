import { ProductFormContent } from '@/components/sheet-contents/products/ProductFormContent'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { productFormActions } from '@/lib/stores/product'
import { resolveProductWorkflow } from '@/lib/workflow/productWorkflowResolver'
import { useProductCreateReadiness } from '@/lib/workflow/useProductCreateReadiness'
import { useEffect, useMemo, useRef, useState } from 'react'

type ProductCreateShellProps = {
	userPubkey?: string | null
	className?: string
	formClassName?: string
	showFooter?: boolean
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
	const readiness = useProductCreateReadiness(normalizedUserPubkey)
	const [isBootstrapped, setIsBootstrapped] = useState(false)
	const hasBootstrappedRef = useRef(false)

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

		productFormActions.startCreateProductSession()
		productFormActions.setActiveTab(workflow.initialTab)

		hasBootstrappedRef.current = true
		setIsBootstrapped(true)
	}, [workflow.initialTab, workflow.isBootstrapReady])

	const content =
		!workflow.isBootstrapReady || !isBootstrapped ? (
			<ProductCreateLoadingState />
		) : (
			<ProductFormContent className={formClassName} showFooter={showFooter} workflow={workflow} />
		)

	return className ? <div className={className}>{content}</div> : content
}
