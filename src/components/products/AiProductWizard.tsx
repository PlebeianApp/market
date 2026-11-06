import { ImageUploader } from '@/components/ui/image-uploader/ImageUploader'
import { authStore } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { productFormActions, productFormStore } from '@/lib/stores/product'
import { usePublishShippingOptionMutation } from '@/publish/shipping'
import { extensionErrorMessage, useProductListingDraft } from '@/queries/extensions'
import { createShippingReference, getShippingInfo, useShippingOptionsByPubkey } from '@/queries/shipping'
import { getSellerProductFormValidationIssues } from '@sdk/commerce/products'
import { Badge } from '@ui/primitives/badge'
import { Button } from '@ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ui/primitives/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/primitives/dialog'
import { Input } from '@ui/primitives/input'
import { Label } from '@ui/primitives/label'
import { useQueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { RefreshCw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

const DEFAULT_SHIPPING = {
	title: 'Worldwide Standard',
	description: 'Ship anywhere in the world with standard delivery',
	price: '0',
	currency: 'USD',
	countries: [],
	service: 'standard' as const,
}

/**
 * Create a product from a photo: upload an image, an extension (e.g. a mock AI over ContextVM) drafts the title,
 * summary, description, tags, and category, and the seller only enters the price. The seller signs and publishes.
 */
export function AiProductWizard({ onPublished }: { onPublished: () => void }) {
	const { user } = useStore(authStore)
	const queryClient = useQueryClient()
	const draft = useProductListingDraft()
	const shippingOptions = useShippingOptionsByPubkey(user?.pubkey ?? '')
	const publishShipping = usePublishShippingOptionMutation()
	const [imageUrl, setImageUrl] = useState<string | null>(null)
	const [priceOpen, setPriceOpen] = useState(false)
	const [price, setPrice] = useState('')
	const [createdShippingRef, setCreatedShippingRef] = useState<string>()
	const [publishing, setPublishing] = useState(false)
	const [publishError, setPublishError] = useState<string>()

	const shippingRef = useMemo(() => {
		if (createdShippingRef) return createdShippingRef
		if (!user?.pubkey) return undefined
		for (const event of shippingOptions.data ?? []) {
			const info = getShippingInfo(event)
			if (info?.id && typeof info.id === 'string' && info.id.trim()) return createShippingReference(user.pubkey, info.id)
		}
		return undefined
	}, [createdShippingRef, shippingOptions.data, user?.pubkey])

	const priceValid = /^\d+$/.test(price.trim()) && Number(price) > 0

	const describe = (url: string) => draft.mutate({ imageUrl: url })

	const createShipping = async () => {
		try {
			const published = await publishShipping.mutateAsync(DEFAULT_SHIPPING)
			setCreatedShippingRef(published.shippingRef)
		} catch {
			toast.error('Could not create a shipping option')
		}
	}

	const publish = async () => {
		if (!draft.data || !imageUrl || !shippingRef || !priceValid || publishing) return
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
			name: draft.data.title,
			summary: draft.data.summary,
			description: draft.data.description,
			price: price.trim(),
			currency: 'SATS',
			currencyMode: 'sats',
			bitcoinUnit: 'SATS',
			quantity: '1',
			status: 'on-sale',
			productType: 'single',
			mainCategory: draft.data.category,
			categories: draft.data.tags.map((tag, index) => ({ key: `ai-tag-${index}`, name: tag, checked: true })),
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
		setPriceOpen(false)
		toast.success('Product published')
		onPublished()
	}

	if (!draft.available) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="ai-product-unavailable">
					No extension can draft listings yet. An admin can accept a <code>product.listing.draft</code> binding in the Extension store.
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-4" data-testid="ai-product-wizard">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">1. Upload a photo</CardTitle>
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
								draft.reset()
								describe(url)
							}}
							onDelete={() => {
								setImageUrl(null)
								draft.reset()
							}}
						/>
					</div>
					{draft.isPending && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ai-product-thinking">
							<Sparkles className="h-4 w-4 animate-pulse" /> AI is describing your product…
						</p>
					)}
					{draft.error && (
						<div className="flex items-center gap-2">
							<p role="alert" className="text-sm text-red-600" data-testid="ai-product-error">
								{draft.error.reason === 'invalid_output' ? 'The extension returned an unusable draft.' : extensionErrorMessage(draft.error)}
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
						<CardTitle className="text-lg">2. Review the draft</CardTitle>
						<div className="flex items-center gap-2">
							<Badge variant="outline" className="border-violet-500 text-violet-700" title="Generated text; review before publishing">
								AI draft{draft.data.model ? ` · ${draft.data.model}` : ''}
							</Badge>
							<Button size="sm" variant="ghost" onClick={() => describe(imageUrl)} disabled={draft.isPending} aria-label="Regenerate">
								<RefreshCw className="h-4 w-4" />
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-3 text-sm">
						<div>
							<div className="text-xs text-muted-foreground">Title</div>
							<p className="font-medium" data-testid="ai-product-title">
								{draft.data.title}
							</p>
						</div>
						<div>
							<div className="text-xs text-muted-foreground">Summary</div>
							<p>{draft.data.summary}</p>
						</div>
						<div>
							<div className="text-xs text-muted-foreground">Description</div>
							<p className="whitespace-pre-wrap">{draft.data.description}</p>
						</div>
						<div className="flex flex-wrap items-center gap-1">
							<Badge>{draft.data.category}</Badge>
							{draft.data.tags.map((tag) => (
								<Badge key={tag} variant="outline">
									#{tag}
								</Badge>
							))}
						</div>
						<Button onClick={() => setPriceOpen(true)} data-testid="ai-product-set-price">
							3. Set price &amp; publish
						</Button>
					</CardContent>
				</Card>
			)}

			<Dialog open={priceOpen} onOpenChange={(open) => !publishing && setPriceOpen(open)}>
				<DialogContent className="sm:max-w-md" data-testid="ai-product-price-dialog">
					<DialogHeader>
						<DialogTitle>Set a price</DialogTitle>
						<DialogDescription>{draft.data?.title}</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<div className="space-y-1">
							<Label htmlFor="ai-product-price">Price (sats)</Label>
							<Input
								id="ai-product-price"
								inputMode="numeric"
								autoFocus
								placeholder="21000"
								value={price}
								onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))}
								data-testid="ai-product-price-input"
							/>
						</div>
						<p className="text-xs text-muted-foreground">Quantity 1 · on sale</p>
						{shippingRef ? (
							<p className="text-xs text-muted-foreground">Uses your shipping option.</p>
						) : shippingOptions.isLoading ? (
							<p className="text-xs text-muted-foreground">Loading shipping options…</p>
						) : (
							<div className="flex items-center gap-2 text-xs">
								<span className="text-amber-700">No shipping option yet.</span>
								<Button size="sm" variant="outline" disabled={publishShipping.isPending} onClick={() => void createShipping()}>
									{publishShipping.isPending ? 'Creating…' : 'Create Worldwide Standard'}
								</Button>
							</div>
						)}
						{publishError && (
							<p role="alert" className="text-sm text-red-600" data-testid="ai-product-publish-error">
								{publishError}
							</p>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" disabled={publishing} onClick={() => setPriceOpen(false)}>
							Cancel
						</Button>
						<Button disabled={!priceValid || !shippingRef || publishing} onClick={() => void publish()} data-testid="ai-product-publish">
							{publishing ? 'Publishing…' : 'Publish'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
