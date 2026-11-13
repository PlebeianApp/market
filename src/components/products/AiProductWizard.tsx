import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { PRODUCT_CATEGORIES } from '@/lib/constants'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { usePublishShippingOptionMutation } from '@/publish/shipping'
import { PaidCallConfirmDialog } from '@/components/extensions/PaidCallConfirmDialog'
import { extensionErrorMessage, paidCallErrorMessage, useProductListingDraft } from '@/queries/extensions'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { getSellerProductFormValidationIssues, type ProductListingDraft } from '@sdk/commerce/products'
import { PaidCallError, paidCallSpentSats, type PaidCallRecord } from '@sdk/core/extensions'
import { Badge } from '@ui/primitives/badge'
import { Button } from '@ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/primitives/card'
import { Input } from '@ui/primitives/input'
import { Label } from '@ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/primitives/select'
import { Textarea } from '@ui/primitives/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

const DEFAULT_SHIPPING = {
	title: 'Worldwide Standard',
	description: 'Ship anywhere in the world with standard delivery',
	price: '0',
	currency: 'USD',
	countries: [],
	service: 'standard' as const,
}

interface ListingFields {
	title: string
	summary: string
	description: string
	category: string
	tags: string
}

const EMPTY_FIELDS: ListingFields = { title: '', summary: '', description: '', category: '', tags: '' }

function fieldsFromDraft(draft: ProductListingDraft): ListingFields {
	return {
		title: draft.title,
		summary: draft.summary,
		description: draft.description,
		category: draft.category,
		tags: draft.tags.join(', '),
	}
}

function draftErrorMessage(error: Error): string {
	if (error instanceof PaidCallError) return paidCallErrorMessage(error)
	if ('reason' in error && error.reason === 'invalid_output') return 'The extension returned an unusable draft.'
	return extensionErrorMessage(error as Parameters<typeof extensionErrorMessage>[0])
}

function paymentReceipt(record: PaidCallRecord): string | undefined {
	const spent = paidCallSpentSats(record)
	if (spent === undefined) return undefined
	const returned = record.returnedSats ? ` · ${record.returnedSats} returned` : ''
	const unclaimed = record.state === 'change_unclaimed' ? ' · change could not be added to your wallet' : ''
	return `Paid ${spent} sats from your wallet${returned}${unclaimed}`
}

function parseTags(value: string): string[] {
	return [
		...new Set(
			value
				.split(',')
				.map((tag) => tag.trim().toLowerCase())
				.filter(Boolean),
		),
	]
}

/**
 * Create a product from a photo: an extension drafts the listing, every field stays editable, the price starts
 * empty, and the seller's first shipping option is preselected. Only the seller signs and publishes.
 */
export function AiProductWizard({ onPublished, extensionId }: { onPublished: () => void; extensionId?: string }) {
	const { user } = useStore(authStore)
	const queryClient = useQueryClient()
	const draft = useProductListingDraft(extensionId)
	const shippingOptionsQuery = useShippingOptionsByPubkey(user?.pubkey ?? '')
	const publishShipping = usePublishShippingOptionMutation()
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [fields, setFields] = useState<ListingFields>(EMPTY_FIELDS)
	const [price, setPrice] = useState('')
	const [shippingRef, setShippingRef] = useState('')
	const [publishing, setPublishing] = useState(false)
	const [publishError, setPublishError] = useState<string>()

	const shippingOptions = useMemo(() => {
		if (!user?.pubkey) return []
		return (shippingOptionsQuery.data ?? []).flatMap((event) => {
			const info = getShippingInfo(event)
			return info
				? [{ ref: createShippingReference(user.pubkey, info.id), label: `${info.title} · ${info.price.amount} ${info.price.currency}` }]
				: []
		})
	}, [shippingOptionsQuery.data, user?.pubkey])

	useEffect(() => {
		if (!shippingRef && shippingOptions.length > 0) setShippingRef(shippingOptions[0].ref)
	}, [shippingOptions, shippingRef])

	useEffect(() => {
		if (draft.data) setFields(fieldsFromDraft(draft.data))
	}, [draft.data])

	const update = (key: keyof ListingFields) => (value: string) => setFields((current) => ({ ...current, [key]: value }))
	const priceValid = /^\d+$/.test(price) && Number(price) > 0
	const canPublish = Boolean(imageUrl && fields.title.trim() && fields.description.trim() && fields.category && priceValid && shippingRef)

	const describe = (url: string) => draft.mutate({ imageUrl: url })

	const createShipping = async () => {
		try {
			const published = await publishShipping.mutateAsync(DEFAULT_SHIPPING)
			setShippingRef(published.shippingRef)
		} catch {
			toast.error('Could not create a shipping option')
		}
	}

	const publish = async () => {
		if (!canPublish || !imageUrl || publishing) return
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()
		if (!ndk || !signer) {
			setPublishError('Connect a signer to publish')
			return
		}
		setPublishing(true)
		setPublishError(undefined)
		productFormActions.startCreateProductSession()
		productFormActions.updateValues({
			name: fields.title.trim(),
			summary: fields.summary.trim(),
			description: fields.description.trim(),
			price,
			currency: 'SATS',
			currencyMode: 'sats',
			bitcoinUnit: 'SATS',
			quantity: '1',
			status: 'on-sale',
			productType: 'single',
			mainCategory: fields.category,
			categories: parseTags(fields.tags).map((tag, index) => ({ key: `ai-tag-${index}`, name: tag, checked: true })),
			images: [{ imageUrl, imageOrder: 0 }],
			shippings: [{ shippingRef, extraCost: '' }],
		})
		const issues = getSellerProductFormValidationIssues({
			...productFormStore.state,
			mainCategory: productFormStore.state.mainCategory ?? '',
		})
		if (issues.length > 0) {
			setPublishError(issues[0])
			setPublishing(false)
			return
		}
		const result = await productFormActions.continuePublishing(signer, ndk, queryClient)
		setPublishing(false)
		if (!result) {
			setPublishError('Failed to publish the product')
			return
		}
		productFormActions.reset()
		toast.success('Product published')
		onPublished()
	}

	if (!draft.available) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="ai-product-unavailable">
					No extension can draft listings. Enable the Product image describer in Extensions.
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-4" data-testid="ai-product-wizard">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Photo</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="max-w-sm">
						<ImageUploader
							key={imageUrl ?? 'empty'}
							src={imageUrl}
							index={imageUrl ? 0 : -1}
							imagesLength={imageUrl ? 1 : 0}
							forSingle
							onSave={({ url }) => {
								setImageUrl(url)
								setFields(EMPTY_FIELDS)
								draft.reset()
								describe(url)
							}}
							onDelete={() => {
								setImageUrl(null)
								setFields(EMPTY_FIELDS)
								draft.reset()
							}}
						/>
					</div>
					<p className="text-xs text-muted-foreground" data-testid="ai-product-disclosure">
						The photo link is sent to an AI provider to draft the listing.
						{draft.payment && ` Each draft costs ${draft.payment.amountSats} sats from your wallet; you confirm before paying.`}
					</p>
					{draft.isPending && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ai-product-thinking">
							<Sparkles className="h-4 w-4 animate-pulse" /> Describing your product…
						</p>
					)}
					{draft.error && (
						<div className="flex items-center gap-2">
							<p role="alert" className="text-sm text-red-600" data-testid="ai-product-error">
								{draftErrorMessage(draft.error)}
							</p>
							{imageUrl && (
								<Button size="sm" variant="outline" onClick={() => describe(imageUrl)}>
									Retry
								</Button>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{draft.data && imageUrl && (
				<Card data-testid="ai-product-draft">
					<CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
						<CardTitle className="text-lg">Listing</CardTitle>
						<div className="flex items-center gap-2">
							<Badge variant="outline" className="border-violet-500 text-violet-700" title="Generated text; review before publishing">
								AI draft{draft.data.model ? ` · ${draft.data.model}` : ''}
							</Badge>
							<Button size="sm" variant="ghost" onClick={() => describe(imageUrl)} disabled={draft.isPending} aria-label="Regenerate">
								<RefreshCw className="h-4 w-4" />
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{draft.data.payment && paymentReceipt(draft.data.payment) && (
							<p className="text-xs text-muted-foreground" data-testid="ai-product-payment-receipt">
								{paymentReceipt(draft.data.payment)}
							</p>
						)}
						<div className="space-y-1">
							<Label htmlFor="ai-product-title">Title</Label>
							<Input
								id="ai-product-title"
								value={fields.title}
								maxLength={120}
								onChange={(event) => update('title')(event.target.value)}
								data-testid="ai-product-title"
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="ai-product-description">Description</Label>
							<Textarea
								id="ai-product-description"
								rows={5}
								value={fields.description}
								maxLength={2000}
								onChange={(event) => update('description')(event.target.value)}
								data-testid="ai-product-description"
							/>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="ai-product-price">Price (sats)</Label>
								<Input
									id="ai-product-price"
									inputMode="numeric"
									placeholder="Enter a price"
									value={price}
									onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))}
									data-testid="ai-product-price-input"
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="ai-product-category">Category</Label>
								<Select value={fields.category} onValueChange={update('category')}>
									<SelectTrigger id="ai-product-category" className="w-full" data-testid="ai-product-category">
										<SelectValue placeholder="Choose a category" />
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
						</div>
						<div className="space-y-1">
							<Label htmlFor="ai-product-tags">Tags (comma separated)</Label>
							<Input id="ai-product-tags" value={fields.tags} onChange={(event) => update('tags')(event.target.value)} />
						</div>
						<div className="space-y-1">
							<Label htmlFor="ai-product-shipping">Shipping</Label>
							{shippingOptions.length > 0 ? (
								<Select value={shippingRef} onValueChange={setShippingRef}>
									<SelectTrigger id="ai-product-shipping" className="w-full" data-testid="ai-product-shipping">
										<SelectValue placeholder="Choose shipping" />
									</SelectTrigger>
									<SelectContent>
										{shippingOptions.map((option) => (
											<SelectItem key={option.ref} value={option.ref}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : shippingOptionsQuery.isLoading ? (
								<p className="text-xs text-muted-foreground">Loading shipping options…</p>
							) : shippingRef ? (
								<p className="text-sm">{DEFAULT_SHIPPING.title}</p>
							) : (
								<Button size="sm" variant="outline" disabled={publishShipping.isPending} onClick={() => void createShipping()}>
									{publishShipping.isPending ? 'Creating…' : `Create ${DEFAULT_SHIPPING.title}`}
								</Button>
							)}
						</div>
						{publishError && (
							<p role="alert" className="text-sm text-red-600" data-testid="ai-product-publish-error">
								{publishError}
							</p>
						)}
						<Button
							className="w-full sm:w-auto"
							disabled={!canPublish || publishing}
							onClick={() => void publish()}
							data-testid="ai-product-publish"
						>
							{publishing ? 'Publishing…' : 'Publish'}
						</Button>
					</CardContent>
				</Card>
			)}
			<PaidCallConfirmDialog requirement={draft.approval.pending} onApprove={draft.approval.approve} onDecline={draft.approval.decline} />
		</div>
	)
}
