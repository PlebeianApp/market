import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LightningPaymentProcessor } from '@/components/lightning/LightningPaymentProcessor'
import { STOREFRONT_PRICING } from '@/server/StorefrontIdentityManager'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { ndkActions } from '@/lib/stores/ndk'
import { useConfigQuery } from '@/queries/config'
import { useStorefrontIdentities, useStorefrontPage } from '@/queries/storefront'
import { purchaseStorefrontIdentity } from '@/lib/zapPurchase'
import { parseStorefrontPage } from '@/lib/schemas/storefront'
import { publishStorefrontPage } from '@/publish/storefront-page'
import { storefrontKeys } from '@/queries/queryKeyFactory'
import { useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/_dashboard-layout/dashboard/account/storefront')({
	component: StorefrontComponent,
})

const DEFAULT_PAGE = JSON.stringify(
	{
		version: 1,
		blocks: [{ type: 'hero', title: 'Welcome', text: 'A storefront page managed by its seller.' }],
	},
	null,
	2,
)

function StorefrontComponent() {
	useDashboardTitle('Storefront')
	const ndk = ndkActions.getNDK()
	const pubkey = ndk?.activeUser?.pubkey
	const { data: config } = useConfigQuery()
	const { data: identities = [] } = useStorefrontIdentities(config?.appPublicKey)
	const currentIdentity = useMemo(
		() => identities.find((entry) => entry.pubkey === pubkey && entry.validUntil > Date.now() / 1000),
		[identities, pubkey],
	)
	const { data: publishedPage } = useStorefrontPage(pubkey)
	const queryClient = useQueryClient()
	const [name, setName] = useState('')
	const [content, setContent] = useState(DEFAULT_PAGE)
	const [isPublishing, setIsPublishing] = useState(false)
	const [payment, setPayment] = useState<{ invoice: string; amount: number; invoiceId: string } | null>(null)

	useEffect(() => {
		if (currentIdentity) setName(currentIdentity.name)
	}, [currentIdentity])

	useEffect(() => {
		if (publishedPage) setContent(JSON.stringify(publishedPage.page, null, 2))
	}, [publishedPage])

	const normalizedName = name.trim().toLowerCase()
	const nameTaken = identities.some(
		(entry) => entry.name === normalizedName && entry.validUntil > Date.now() / 1000 && entry.pubkey !== pubkey,
	)
	const nameValid = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(normalizedName)

	const publishPage = async () => {
		const page = parseStorefrontPage(content)
		if (!page) {
			toast.error('Page JSON is invalid or contains unsupported blocks')
			return
		}
		setIsPublishing(true)
		try {
			await publishStorefrontPage(page)
			await queryClient.invalidateQueries({ queryKey: ['storefront', 'page', pubkey] })
			toast.success('Storefront page published')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to publish storefront page')
		} finally {
			setIsPublishing(false)
		}
	}

	const buyName = async (amountSats: number) => {
		if (!config?.appPublicKey || !config.appRelay || !ndk || !nameValid || nameTaken) return
		try {
			const result = await purchaseStorefrontIdentity(
				{ ndk, appPubkey: config.appPublicKey, appRelay: config.appRelay },
				{ name: normalizedName, amountSats },
			)
			setPayment({ invoice: result.pr, amount: amountSats, invoiceId: result.invoiceId })
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to create storefront invoice')
		}
	}

	if (!pubkey) {
		return <p className="p-8 text-muted-foreground">Connect a Nostr account to manage your storefront.</p>
	}

	return (
		<div className="space-y-6 p-4 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">Storefront</h1>
				<p className="text-muted-foreground">One name for your NIP-05 address, storefront URL, and published page.</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Storefront identity</CardTitle>
					<CardDescription>{currentIdentity ? 'Your identity is active.' : 'Choose an available name to begin.'}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Label htmlFor="storefront-name">Name</Label>
					<Input id="storefront-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="alice-store" />
					<p className="text-sm text-muted-foreground">
						{normalizedName
							? `${normalizedName}@${window.location.hostname} · ${window.location.origin}/${normalizedName}`
							: 'Use 3-30 lowercase letters, numbers, hyphens, or underscores.'}
					</p>
					{!currentIdentity && nameValid && !nameTaken ? (
						<div className="flex flex-wrap gap-2">
							{Object.values(STOREFRONT_PRICING).map((tier) => (
								<Button key={tier.label} onClick={() => void buyName(tier.sats)}>
									Buy {tier.label} · {tier.sats} sats
								</Button>
							))}
						</div>
					) : null}
					{nameTaken ? <p className="text-sm text-destructive">That name is already active.</p> : null}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Page content</CardTitle>
					<CardDescription>Publish validated storefront blocks as a seller-signed Nostr event.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={18} className="font-mono text-sm" />
					<Button onClick={() => void publishPage()} disabled={!currentIdentity || isPublishing}>
						{isPublishing ? 'Publishing...' : 'Publish page'}
					</Button>
				</CardContent>
			</Card>
			<Dialog open={Boolean(payment)} onOpenChange={(open) => !open && setPayment(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Complete storefront purchase</DialogTitle>
					</DialogHeader>
					{payment ? (
						<LightningPaymentProcessor
							data={{
								amount: payment.amount,
								description: `Storefront name: ${normalizedName}`,
								invoiceId: payment.invoiceId,
								bolt11: payment.invoice,
								isZap: true,
								requireZapReceipt: true,
							}}
							onPaymentComplete={() => {
								setPayment(null)
								void queryClient.invalidateQueries({ queryKey: storefrontKeys.all })
							}}
							onPaymentFailed={(result) => toast.error(result.error || 'Payment failed')}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	)
}
