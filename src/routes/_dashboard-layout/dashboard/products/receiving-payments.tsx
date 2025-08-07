import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PAYMENT_DETAILS_METHOD, type PaymentDetailsMethod } from '@/lib/constants'
import { useNDK } from '@/lib/stores/ndk'
import { isValidNip05 } from '@/lib/utils'
import {
	checkAddress,
	deriveAddresses,
	isExtendedPublicKey,
	parsePaymentDetailsFromClipboard,
	paymentMethodLabels,
	validateExtendedPublicKey,
} from '@/lib/utils/paymentDetails'
import { getCollectionId, getCollectionTitle, useCollectionsByPubkey } from '@/queries/collections'
import {
	useDeletePaymentDetail,
	usePublishRichPaymentDetail,
	useRichUserPaymentDetails,
	useUpdatePaymentDetail,
	useWalletDetail,
	type PaymentScope,
	type RichPaymentDetail,
} from '@/queries/payment'
import { getProductId, getProductTitle, useProductsByPubkey } from '@/queries/products'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
	AnchorIcon,
	ChevronLeftIcon,
	ClipboardIcon,
	GlobeIcon,
	PackageIcon,
	PlusIcon,
	StarIcon,
	StoreIcon,
	TrashIcon,
	ZapIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DashboardListItem } from '@/components/layout/DashboardListItem'
import { useAutoAnimate } from '@formkit/auto-animate/react'

interface ScopeSelectorProps {
	value: PaymentScope
	scopeId?: string | null
	userPubkey: string
	onChange: (scope: PaymentScope, scopeId: string | null, scopeName: string) => void
}

function ScopeSelector({ value, scopeId, userPubkey, onChange }: ScopeSelectorProps) {
	const productsQuery = useProductsByPubkey(userPubkey)
	const collectionsQuery = useCollectionsByPubkey(userPubkey)

	const handleScopeChange = (newValue: string) => {
		if (newValue === 'global') {
			onChange('global', null, 'Global')
		} else if (newValue.startsWith('collection:')) {
			const collectionId = newValue.replace('collection:', '')
			const collection = collectionsQuery.data?.find((c) => getCollectionId(c) === collectionId)
			if (collection) {
				onChange('collection', collectionId, getCollectionTitle(collection))
			}
		} else if (newValue.startsWith('product:')) {
			const productId = newValue.replace('product:', '')
			const product = productsQuery.data?.find((p) => getProductId(p) === productId)
			if (product) {
				onChange('product', productId, getProductTitle(product))
			}
		}
	}

	const getCurrentValue = () => {
		if (value === 'global') return 'global'
		if (value === 'collection' && scopeId) return `collection:${scopeId}`
		if (value === 'product' && scopeId) return `product:${scopeId}`
		return 'global'
	}

	return (
		<Select value={getCurrentValue()} onValueChange={handleScopeChange}>
			<SelectTrigger>
				<SelectValue placeholder="Select scope" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="global">
					<div className="flex items-center gap-2">
						<GlobeIcon className="w-5 h-5" />
						Global
					</div>
				</SelectItem>

				{collectionsQuery.data && collectionsQuery.data.length > 0 && (
					<>
						<div className="px-2 py-1 text-xs font-medium text-muted-foreground">Collections</div>
						{collectionsQuery.data.map((collection) => (
							<SelectItem key={getCollectionId(collection)} value={`collection:${getCollectionId(collection)}`}>
								<div className="flex items-center gap-2">
									<StoreIcon className="w-5 h-5" />
									<span className="truncate max-w-[200px]">{getCollectionTitle(collection)}</span>
								</div>
							</SelectItem>
						))}
					</>
				)}

				{productsQuery.data && productsQuery.data.length > 0 && (
					<>
						<div className="px-2 py-1 text-xs font-medium text-muted-foreground">Products</div>
						{productsQuery.data.map((product) => (
							<SelectItem key={getProductId(product)} value={`product:${getProductId(product)}`}>
								<div className="flex items-center gap-2">
									<PackageIcon className="w-5 h-5" />
									<span className="truncate max-w-[200px]">{getProductTitle(product)}</span>
								</div>
							</SelectItem>
						))}
					</>
				)}
			</SelectContent>
		</Select>
	)
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/products/receiving-payments')({
	component: ReceivingPaymentsComponent,
})

type FormState = 'idle' | 'validating' | 'confirming' | 'submitting'
type OnChainConfirmationType = 'extended_public_key' | 'single_address'

interface PaymentDetailConfirmationProps {
	value: string
	type: OnChainConfirmationType
	onConfirm: () => void
	onCancel: () => void
}

function PaymentDetailConfirmationCard({ value, type, onConfirm, onCancel }: PaymentDetailConfirmationProps) {
	const numAddresses = 5

			return (
			<Card className="border-yellow-200 bg-yellow-50 fg-layer-overlay">
			<CardHeader>
				<CardTitle className="text-yellow-800">Confirm Payment Details</CardTitle>
				<CardDescription>
					{type === 'extended_public_key'
						? 'Extended Public Key detected. This will generate receiving addresses.'
						: 'Single Bitcoin address detected.'}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="p-3 fg-layer-elevated rounded border border-layer-subtle">
					<p className="text-sm font-mono break-all">{value}</p>
				</div>

				{type === 'extended_public_key' &&
					(() => {
						try {
							const derivedAddresses = deriveAddresses(value, numAddresses)

							if (!derivedAddresses || derivedAddresses.length === 0) {
								return (
									<div className="space-y-2">
										<Label className="text-sm font-medium text-red-700">Error:</Label>
										<div className="text-sm text-red-600 p-2 bg-red-50 rounded">
											Unable to derive addresses from this extended public key. Please check the format.
										</div>
									</div>
								)
							}

							return (
								<div className="space-y-2">
									<Label className="text-sm font-medium">Preview of derived addresses:</Label>
									<div className="space-y-1">
										{derivedAddresses.slice(0, numAddresses).map((address, index) => (
											<div key={index} className="text-xs font-mono p-2 bg-gray-50 rounded">
												{index}: {address}
											</div>
										))}
									</div>
								</div>
							)
						} catch (error) {
							console.error('Error previewing derived addresses:', error)
							return (
								<div className="space-y-2">
									<Label className="text-sm font-medium text-red-700">Error:</Label>
									<div className="text-sm text-red-600 p-2 bg-red-50 rounded">
										Invalid extended public key format. Please verify the key is correct.
									</div>
								</div>
							)
						}
					})()}
			</CardContent>
			<CardFooter className="flex justify-end gap-2">
				<Button variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button onClick={onConfirm}>Confirm</Button>
			</CardFooter>
		</Card>
	)
}

interface PaymentDetailFormProps {
	paymentDetail: RichPaymentDetail | null
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

function PaymentDetailForm({ paymentDetail, isOpen, onOpenChange, onSuccess }: PaymentDetailFormProps) {
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)
	const [formState, setFormState] = useState<FormState>('idle')
	const [validationMessage, setValidationMessage] = useState('')
	const [showConfirmation, setShowConfirmation] = useState(false)
	const [tempValidatedValue, setTempValidatedValue] = useState('')
	const [confirmationType, setConfirmationType] = useState<OnChainConfirmationType>('single_address')

	const publishMutation = usePublishRichPaymentDetail()
	const updateMutation = useUpdatePaymentDetail()
	const deleteMutation = useDeletePaymentDetail()

	const isEditing = !!paymentDetail

	const [editedPaymentDetail, setEditedPaymentDetail] = useState<RichPaymentDetail>(() => {
		if (paymentDetail) {
			return { ...paymentDetail }
		}
		return {
			id: '',
			userId: '',
			paymentMethod: PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK,
			paymentDetail: '',
			scope: 'global',
			scopeId: null,
			scopeName: 'Global',
			isDefault: false,
			createdAt: Date.now(),
		}
	})

	// Get user on mount
	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	// Update userId when user changes
	useEffect(() => {
		if (user?.pubkey && !isEditing) {
			setEditedPaymentDetail((prev) => ({ ...prev, userId: user.pubkey }))
		}
	}, [user, isEditing])

	// Reset validation message when dialog closes
	useEffect(() => {
		if (!isOpen) {
			setValidationMessage('')
			setFormState('idle')
			setShowConfirmation(false)
		}
	}, [isOpen])

	// Get wallet detail for on-chain extended public keys
	const walletDetailQuery = useWalletDetail(user?.pubkey || '', paymentDetail?.id || '')

	const resetForm = useCallback(() => {
		setEditedPaymentDetail({
			id: '',
			userId: user?.pubkey || '',
			paymentMethod: PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK,
			paymentDetail: '',
			scope: 'global',
			scopeId: null,
			scopeName: 'Global',
			isDefault: false,
			createdAt: Date.now(),
		})
		setFormState('idle')
		setValidationMessage('')
		setShowConfirmation(false)
	}, [user])

	const validatePaymentDetails = async (value: string, method: PaymentDetailsMethod): Promise<boolean | 'needsConfirmation'> => {
		switch (method) {
			case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK: {
				if (isValidNip05(value)) {
					// In a real implementation, you might validate the lightning address
					return true
				}
				return false
			}
			case PAYMENT_DETAILS_METHOD.ON_CHAIN: {
				if (isExtendedPublicKey(value)) {
					setConfirmationType('extended_public_key')
					const validation = validateExtendedPublicKey(value)
					if (!validation.isValid) {
						setValidationMessage(validation.error || 'Invalid extended public key')
						return false
					}
					return 'needsConfirmation'
				}
				if (value.startsWith('bc1')) {
					setConfirmationType('single_address')
					return checkAddress(value) ? 'needsConfirmation' : false
				}
				return false
			}
			default:
				return false
		}
	}

	const handleValidateAndConfirm = async (e?: React.FormEvent) => {
		if (e) e.preventDefault()

		if (!editedPaymentDetail.paymentDetail) {
			setValidationMessage('Please fill in the payment details')
			return
		}

		setFormState('validating')
		setValidationMessage('Validating...')

		try {
			const result = await validatePaymentDetails(editedPaymentDetail.paymentDetail, editedPaymentDetail.paymentMethod)

			if (result === 'needsConfirmation') {
				setFormState('confirming')
				setTempValidatedValue(editedPaymentDetail.paymentDetail)
				setShowConfirmation(true)
			} else if (result) {
				await handleSubmit()
			} else {
				setFormState('idle')
				setValidationMessage(`Invalid ${paymentMethodLabels[editedPaymentDetail.paymentMethod]}`)
			}
		} catch (error) {
			setFormState('idle')
			setValidationMessage('An error occurred during validation')
			console.error('Validation error:', error)
		}
	}

	const handleSubmit = async () => {
		setFormState('submitting')
		setValidationMessage('Saving...')

		try {
			// Generate coordinates for collection or product scope
			let coordinates: string | undefined
			if (editedPaymentDetail.scope === 'collection' && editedPaymentDetail.scopeId && user?.pubkey) {
				coordinates = `30405:${user.pubkey}:${editedPaymentDetail.scopeId}`
			} else if (editedPaymentDetail.scope === 'product' && editedPaymentDetail.scopeId && user?.pubkey) {
				coordinates = `30402:${user.pubkey}:${editedPaymentDetail.scopeId}`
			}

			const payload = {
				paymentMethod: editedPaymentDetail.paymentMethod,
				paymentDetail: editedPaymentDetail.paymentDetail,
				coordinates, // Add coordinates for scoped payment details
				scope: editedPaymentDetail.scope,
				scopeId: editedPaymentDetail.scopeId,
				scopeName: editedPaymentDetail.scopeName,
				isDefault: editedPaymentDetail.isDefault,
			}

			if (isEditing) {
				await updateMutation.mutateAsync({
					...payload,
					paymentDetailId: editedPaymentDetail.id,
				})
			} else {
				await publishMutation.mutateAsync(payload)
			}

			onOpenChange(false)
			if (!isEditing) resetForm()
			setValidationMessage('')
			onSuccess?.()
		} catch (error) {
			setValidationMessage('An error occurred while saving')
			console.error('Error saving payment method:', error)
		} finally {
			setFormState('idle')
		}
	}

	const handleConfirmation = () => {
		setShowConfirmation(false)
		handleSubmit()
	}

	const handleCancellation = () => {
		setShowConfirmation(false)
		setFormState('idle')
		setValidationMessage('Confirmation cancelled')
	}

	const handleDelete = () => {
		if (isEditing && editedPaymentDetail.id && user?.pubkey) {
			deleteMutation.mutate({
				paymentDetailId: editedPaymentDetail.id,
				userPubkey: user.pubkey,
			})
			onOpenChange(false)
		}
	}

	const handlePasteFromClipboard = async () => {
		try {
			const result = await parsePaymentDetailsFromClipboard()

			if (result.success && result.paymentDetails && result.method) {
				setEditedPaymentDetail((prev) => ({
					...prev,
					paymentDetail: result.paymentDetails!,
					paymentMethod: result.method!,
				}))
				toast.success(
					`${result.method === PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK ? 'Lightning Network' : 'On Chain'} payment details pasted`,
				)
			} else {
				toast.error(result.error || 'Unknown error')
			}
		} catch (error) {
			toast.error('Failed to read clipboard')
		}
	}

	const PaymentMethodIcon = ({ method }: { method: PaymentDetailsMethod }) => {
		switch (method) {
			case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK:
				return <ZapIcon className="w-5 h-5 text-black" />
			case PAYMENT_DETAILS_METHOD.ON_CHAIN:
				return <AnchorIcon className="w-5 h-5 text-black" />
			default:
				return null
		}
	}

	const triggerContent = isEditing ? (
		<div className="flex items-center gap-2 min-w-0 flex-1">
			<PaymentMethodIcon method={editedPaymentDetail.paymentMethod} />
			<span className="truncate">
				{editedPaymentDetail.paymentDetail.length > 30
					? editedPaymentDetail.paymentDetail.substring(0, 30) + '...'
					: editedPaymentDetail.paymentDetail}
			</span>
		</div>
	) : (
		<div className="flex items-center gap-2">
			<PlusIcon className="w-6 h-6" />
			<span>Add new payment method</span>
		</div>
	)

	const triggerActions = isEditing ? (
		<div className="flex items-center gap-2">
			{editedPaymentDetail.isDefault && <StarIcon className="w-6 h-6 text-yellow-400 fill-current" />}
			{editedPaymentDetail.scope === 'global' ? (
				<>
					<span className="font-bold">Global</span>
					<GlobeIcon className="w-6 h-6" />
				</>
			) : (
				<>
					<span className="font-bold">{editedPaymentDetail.scopeName}</span>
					{editedPaymentDetail.scope === 'collection' ? <StoreIcon className="w-6 h-6" /> : <PackageIcon className="w-6 h-6" />}
				</>
			)}
		</div>
	) : (
		<Button
			variant="ghost"
			size="icon"
			onClick={(e) => {
				e.stopPropagation()
				handlePasteFromClipboard()
			}}
			className="text-black"
		>
			<ClipboardIcon className="w-6 h-6" />
		</Button>
	)

	return (
		<div className="border-t pt-4">
			{showConfirmation ? (
				<PaymentDetailConfirmationCard
					value={tempValidatedValue}
					type={confirmationType}
					onConfirm={handleConfirmation}
					onCancel={handleCancellation}
				/>
			) : (
				<form onSubmit={handleValidateAndConfirm} className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="payment-method" className="font-medium">
								Payment Method
							</Label>
							<Select
								value={editedPaymentDetail.paymentMethod}
								onValueChange={(value: PaymentDetailsMethod) => setEditedPaymentDetail((prev) => ({ ...prev, paymentMethod: value }))}
							>
								<SelectTrigger data-testid="payment-method-selector">
									<SelectValue placeholder="Payment method" />
								</SelectTrigger>
								<SelectContent>
									{Object.values(PAYMENT_DETAILS_METHOD).map((method) => (
										<SelectItem key={method} value={method} data-testid={`payment-method-${method}`}>
											<div className="flex items-center gap-2">
												<PaymentMethodIcon method={method} />
												{paymentMethodLabels[method]}
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="scope" className="font-medium">
								Scope
							</Label>
							<ScopeSelector
								value={editedPaymentDetail.scope}
								scopeId={editedPaymentDetail.scopeId}
								userPubkey={user?.pubkey || ''}
								onChange={(scope, scopeId, scopeName) => {
									setEditedPaymentDetail((prev) => ({
										...prev,
										scope,
										scopeId,
										scopeName,
									}))
								}}
							/>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="payment-details" className="font-medium">
							Payment details
						</Label>
						<Input
							id="payment-details"
							data-testid="payment-details-input"
							value={editedPaymentDetail.paymentDetail}
							onChange={(e) => setEditedPaymentDetail((prev) => ({ ...prev, paymentDetail: e.target.value }))}
							placeholder="Enter payment details e.g. plebeian@getalby.com"
							className="w-full"
						/>

						{walletDetailQuery.data &&
							paymentDetail?.paymentDetail &&
							isExtendedPublicKey(paymentDetail.paymentDetail) &&
							(() => {
								try {
									const derivedAddresses = deriveAddresses(paymentDetail.paymentDetail, 1, walletDetailQuery.data.valueNumeric)
									const currentAddress = derivedAddresses?.[0]

									if (!currentAddress) {
										return (
											<div className="bg-red-50 p-3 rounded-md space-y-2">
												<Label className="font-medium text-red-700">Error</Label>
												<small className="text-red-600">Unable to derive address from extended public key</small>
											</div>
										)
									}

									return (
										<div className="bg-gray-50 p-3 rounded-md space-y-2">
											<Label className="font-medium">Current address</Label>
											<div className="space-y-1">
												<small className="font-mono">
													Index: {walletDetailQuery.data.valueNumeric} - {currentAddress}
												</small>
												<small>Last updated: {format(walletDetailQuery.data.updatedAt, 'PPp')}</small>
											</div>
										</div>
									)
								} catch (error) {
									console.error('Error displaying current address:', error)
									return (
										<div className="bg-red-50 p-3 rounded-md space-y-2">
											<Label className="font-medium text-red-700">Error</Label>
											<small className="text-red-600">Invalid extended public key format</small>
										</div>
									)
								}
							})()}
					</div>

					{validationMessage && formState === 'idle' && <p className="text-red-500 text-sm">{validationMessage}</p>}

					{formState !== 'idle' && (
						<div className="flex items-center gap-2">
							<Spinner />
							<span className="text-sm">{formState === 'validating' ? 'Validating...' : 'Saving...'}</span>
						</div>
					)}

					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<Checkbox
								id="default-payment"
								data-testid="default-payment-checkbox"
								checked={editedPaymentDetail.isDefault}
								onCheckedChange={(checked) => setEditedPaymentDetail((prev) => ({ ...prev, isDefault: !!checked }))}
							/>
							<Label htmlFor="default-payment" className="font-medium">
								Default
							</Label>
						</div>

						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={formState !== 'idle'}
								data-testid="cancel-payment-button"
							>
								Cancel
							</Button>

							{isEditing && (
								<Button
									type="button"
									variant="destructive"
									onClick={handleDelete}
									disabled={formState !== 'idle'}
									data-testid="delete-payment-button"
								>
									<TrashIcon className="w-4 h-4" />
								</Button>
							)}

							<Button type="submit" disabled={formState !== 'idle'} data-testid="save-payment-button">
								{formState === 'submitting' && <Spinner />}
								{formState === 'validating' ? 'Validating...' : formState === 'submitting' ? 'Saving...' : isEditing ? 'Update' : 'Save'}
							</Button>
						</div>
					</div>
				</form>
			)}
		</div>
	)
}

interface PaymentDetailListItemProps {
	paymentDetail: RichPaymentDetail
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	isDeleting?: boolean
	onSuccess?: () => void
}

function PaymentDetailListItem({ paymentDetail, isOpen, onOpenChange, isDeleting, onSuccess }: PaymentDetailListItemProps) {
	const deleteMutation = useDeletePaymentDetail()

	const handleDelete = () => {
		if (paymentDetail) {
			deleteMutation.mutate(
				{ paymentDetailId: paymentDetail.id, userPubkey: paymentDetail.userId },
				{
					onSuccess: () => {
						toast.success('Payment detail deleted successfully')
						onOpenChange(false)
					},
					onError: (error) => {
						toast.error(`Error deleting payment detail: ${error.message}`)
					},
				},
			)
		}
	}

	const PaymentMethodIcon = ({ method }: { method: PaymentDetailsMethod }) => {
		switch (method) {
			case PAYMENT_DETAILS_METHOD.ON_CHAIN:
				return <AnchorIcon className="w-5 h-5 text-black" />
			case PAYMENT_DETAILS_METHOD.LIGHTNING_NETWORK:
				return <ZapIcon className="w-5 h-5 text-black" />
			default:
				return <GlobeIcon className="w-5 h-5 text-black" />
		}
	}

	const triggerContent = (
		<div>
			<p className="font-semibold">{paymentMethodLabels[paymentDetail.paymentMethod]}</p>
			<p className="text-sm text-muted-foreground break-all">
				{paymentDetail.paymentDetail} - {paymentDetail.scopeName}
			</p>
		</div>
	)

	const actions = (
		<Button
			variant="ghost"
			size="icon"
			onClick={(e) => {
				e.stopPropagation()
				handleDelete()
			}}
			className="h-8 w-8 text-destructive hover:bg-destructive/10"
			aria-label="Delete payment detail"
			disabled={deleteMutation.isPending}
		>
			{deleteMutation.isPending ? <Spinner className="h-4 w-4" /> : <TrashIcon className="h-4 w-4" />}
		</Button>
	)

	return (
		<DashboardListItem
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			triggerContent={triggerContent}
			actions={actions}
			isDeleting={deleteMutation.isPending}
			icon={<PaymentMethodIcon method={paymentDetail.paymentMethod} />}
		>
			<PaymentDetailForm paymentDetail={paymentDetail} isOpen={isOpen} onOpenChange={onOpenChange} onSuccess={onSuccess} />
		</DashboardListItem>
	)
}

function ReceivingPaymentsComponent() {
	const { getUser } = useNDK()
	const [user, setUser] = useState<any>(null)
	const [openPaymentDetailId, setOpenPaymentDetailId] = useState<string | null>(null)
	const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentDetailsMethod | 'all'>('all')
	useDashboardTitle('Receiving Payments')

	// Auto-animate for smooth list transitions
	const [animationParent] = (() => {
		try {
			return useAutoAnimate()
		} catch (error) {
			console.warn('Auto-animate not available:', error)
			return [null]
		}
	})()

	useEffect(() => {
		getUser().then(setUser)
	}, [getUser])

	const { data: paymentDetails, isLoading, isError, error } = useRichUserPaymentDetails(user?.pubkey)

	const handleOpenChange = (paymentDetailId: string | null, open: boolean) => {
		if (open) {
			setOpenPaymentDetailId(paymentDetailId)
		} else {
			setOpenPaymentDetailId(null)
		}
	}

	const handleSuccess = () => {
		setOpenPaymentDetailId(null)
	}

	if (isLoading) {
		return <div>Loading payment details...</div>
	}

	if (isError) {
		return <div>Error loading payment details: {error.message}</div>
	}

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 fg-layer-elevated border-b border-layer-subtle py-4 px-4 lg:px-6 items-center justify-between">
				<h1 className="text-2xl font-bold">Receiving Payments</h1>
				<Button
					onClick={() => handleOpenChange('new', true)}
					className="btn-black flex items-center gap-2 px-4 py-2 text-sm font-semibold"
				>
					<PlusIcon className="w-5 h-5" />
					Add Payment Method
				</Button>
			</div>
			<div className="space-y-4 p-4 lg:p-6 bg-layer-base">
				<div className="lg:hidden">
					<Button
						onClick={() => handleOpenChange('new', true)}
						className="w-full btn-black flex items-center justify-center gap-2 py-3 text-base font-semibold rounded-t-md rounded-b-none border-b border-neutral-600"
					>
						<PlusIcon className="w-5 h-5" />
						Add Payment Method
					</Button>
				</div>

				{/* Payment form - shows at top when opened */}
				{openPaymentDetailId === 'new' && (
					<Card className="mt-4 fg-layer-elevated border-layer-subtle">
						<CardHeader>
							<CardTitle>Add New Payment Detail</CardTitle>
							<CardDescription>Configure a new way to receive payments</CardDescription>
						</CardHeader>
						<CardContent>
							<PaymentDetailForm
								paymentDetail={null}
								isOpen={openPaymentDetailId === 'new'}
								onOpenChange={(open) => handleOpenChange('new', open)}
								onSuccess={handleSuccess}
							/>
						</CardContent>
					</Card>
				)}

				<div ref={animationParent} className="space-y-4">
					{paymentDetails?.map((pd) => (
						<PaymentDetailListItem
							key={pd.id}
							paymentDetail={pd}
							isOpen={openPaymentDetailId === pd.id}
							onOpenChange={(open) => handleOpenChange(pd.id, open)}
							onSuccess={handleSuccess}
						/>
					))}
				</div>
			</div>
		</div>
	)
}
