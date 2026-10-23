import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LightningPaymentProcessor } from '@/components/lightning/LightningPaymentProcessor'
import { nip05Actions } from '@/lib/stores/nip05'
import { ndkStore } from '@/lib/stores/ndk'
import { vanityActions } from '@/lib/stores/vanity'
import { purchaseStorefrontIdentity } from '@/lib/zapPurchase'
import type { StorefrontPage } from '@/lib/schemas/storefront'
import { NIP05_PRICING } from '@/server/Nip05Manager'
import { VANITY_PRICING } from '@/server/VanityManager'
import { AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'
import { useConfigQuery } from '@/queries/config'
import { useNip05Settings } from '@/queries/nip05'
import { useVanitySettings } from '@/queries/vanity'

interface StorefrontPublishDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	pubkey: string
	page: StorefrontPage | null
	onPublish: (page: StorefrontPage) => Promise<boolean>
}

type PaymentInvoice = {
	name: string
	amountSats: number
	invoice: string
	invoiceId: string
	stage: 'paying' | 'awaiting-registration'
}

const identityTiers = Object.entries(VANITY_PRICING).filter(([key]) => NIP05_PRICING[key])

export function StorefrontPublishDialog({ open, onOpenChange, pubkey, page, onPublish }: StorefrontPublishDialogProps) {
	const { data: config } = useConfigQuery()
	const {
		data: vanitySettings,
		isLoading: isLoadingVanity,
		refetch: refetchVanity,
	} = useVanitySettings(config?.appPublicKey, config?.handlerId)
	const {
		data: nip05Settings,
		isLoading: isLoadingNip05,
		refetch: refetchNip05,
	} = useNip05Settings(config?.appPublicKey, config?.handlerId)
	const { ndk } = useStore(ndkStore)
	const [nameInput, setNameInput] = useState('')
	const [domain, setDomain] = useState('')
	const [tierKey, setTierKey] = useState('6mo')
	const [invoice, setInvoice] = useState<PaymentInvoice | null>(null)
	const [isCreatingInvoice, setIsCreatingInvoice] = useState(false)
	const [isCheckingRegistration, setIsCheckingRegistration] = useState(false)
	const [registrationTimedOut, setRegistrationTimedOut] = useState(false)
	const [purchaseError, setPurchaseError] = useState('')
	const [isPublishing, setIsPublishing] = useState(false)
	const username = nameInput.trim().toLowerCase()
	const nameValid =
		!!domain &&
		!username.includes('@') &&
		vanityActions.isValidVanityName(username) &&
		!vanityActions.isReservedName(username) &&
		nip05Actions.isValidUsername(username) &&
		!nip05Actions.isReservedName(username)
	const nowSeconds = Date.now() / 1000
	const unifiedVanity = vanitySettings?.entries.find(
		(entry) => entry.vanityName === username && entry.pubkey === pubkey && entry.isUnified && entry.validUntil > nowSeconds,
	)
	const unifiedNip05 = nip05Settings?.entries.find(
		(entry) => entry.username === username && entry.pubkey === pubkey && entry.isUnified && entry.validUntil > nowSeconds,
	)
	const unifiedRegistered = Boolean(unifiedVanity && unifiedNip05 && unifiedVanity.validUntil === unifiedNip05.validUntil)
	const vanityEntry = vanitySettings?.entries.find((entry) => entry.vanityName === username && entry.validUntil > nowSeconds)
	const nip05Entry = nip05Settings?.entries.find((entry) => entry.username === username && entry.validUntil > nowSeconds)
	const isTakenByOther = Boolean((vanityEntry && vanityEntry.pubkey !== pubkey) || (nip05Entry && nip05Entry.pubkey !== pubkey))
	const ownedLegacyCount = [vanityEntry, nip05Entry].filter((entry) => entry?.pubkey === pubkey && !entry.isUnified).length
	const chargeCount = unifiedRegistered ? 2 : ownedLegacyCount === 1 ? 1 : 2
	const tier = VANITY_PRICING[tierKey]
	const amountSats = tier ? tier.sats * chargeCount : 0
	const namesLoading = isLoadingVanity || isLoadingNip05
	const nameAvailable = nameValid && !namesLoading && !isTakenByOther
	const haveIdentityRequest = username.length > 0

	useEffect(() => {
		setDomain(window.location.hostname.toLowerCase())
	}, [])

	useEffect(() => {
		if (nameInput || namesLoading) return
		const activeName = vanitySettings?.entries.find((entry) => entry.pubkey === pubkey && entry.validUntil > Date.now() / 1000)?.vanityName
		if (activeName && nip05Actions.isValidUsername(activeName)) setNameInput(activeName)
	}, [nameInput, namesLoading, pubkey, vanitySettings?.entries])

	useEffect(() => {
		if (!invoice || invoice.stage !== 'awaiting-registration') return
		if (!unifiedRegistered) return
		setInvoice(null)
		setRegistrationTimedOut(false)
	}, [invoice, unifiedRegistered])

	const recheckRegistration = useCallback(async () => {
		if (!invoice || invoice.stage !== 'awaiting-registration') return
		setIsCheckingRegistration(true)
		try {
			await Promise.all([refetchVanity(), refetchNip05()])
		} finally {
			setIsCheckingRegistration(false)
		}
	}, [invoice, refetchNip05, refetchVanity])

	useEffect(() => {
		if (!invoice || invoice.stage !== 'awaiting-registration' || registrationTimedOut) return
		let cancelled = false
		let timeout: ReturnType<typeof setTimeout> | undefined
		let attempts = 0

		const check = async () => {
			try {
				const [vanityResult, nip05Result] = await Promise.all([refetchVanity(), refetchNip05()])
				const now = Date.now() / 1000
				const vanity = vanityResult.data?.entries.find(
					(entry) => entry.vanityName === invoice.name && entry.pubkey === pubkey && entry.isUnified && entry.validUntil > now,
				)
				const nip05 = nip05Result.data?.entries.find(
					(entry) => entry.username === invoice.name && entry.pubkey === pubkey && entry.isUnified && entry.validUntil > now,
				)
				if (vanity && nip05 && vanity.validUntil === nip05.validUntil) {
					if (!cancelled) {
						setInvoice(null)
						setRegistrationTimedOut(false)
						toast.success('Your NIP-05 address and vanity URL are active.')
					}
					return
				}
			} catch {
				// Relay reads can fail transiently; continue checking while the dialog remains open.
			}

			attempts += 1
			if (cancelled) return
			if (attempts >= 20) {
				setRegistrationTimedOut(true)
				return
			}
			timeout = setTimeout(check, 3000)
		}

		void check()
		return () => {
			cancelled = true
			if (timeout) clearTimeout(timeout)
		}
	}, [invoice, pubkey, refetchNip05, refetchVanity, registrationTimedOut])

	const makeInvoice = async () => {
		if (!tier || !ndk || !config?.appPublicKey || !config.appRelay || !nameAvailable || unifiedRegistered) return
		if (ndk.activeUser?.pubkey !== pubkey) {
			setPurchaseError('Reconnect the account that owns this storefront before creating an invoice.')
			return
		}

		setIsCreatingInvoice(true)
		setPurchaseError('')
		try {
			const result = await purchaseStorefrontIdentity(
				{ ndk, appPubkey: config.appPublicKey, appRelay: config.appRelay },
				{ name: username, tier: tierKey, count: chargeCount, amountSats },
			)
			setInvoice({ name: username, amountSats, invoice: result.pr, invoiceId: result.invoiceId, stage: 'paying' })
		} catch (error) {
			setPurchaseError(error instanceof Error ? error.message : 'Could not create a payment invoice.')
		} finally {
			setIsCreatingInvoice(false)
		}
	}

	const finishPublish = async (skipIdentityPurchase: boolean) => {
		if (!page || isPublishing || invoice?.stage === 'paying' || isCreatingInvoice) return
		if (!skipIdentityPurchase && haveIdentityRequest && !unifiedRegistered) return
		setIsPublishing(true)
		try {
			const published = await onPublish(page)
			if (published) {
				setNameInput('')
				setInvoice(null)
				onOpenChange(false)
			}
		} finally {
			setIsPublishing(false)
		}
	}

	const canDismiss = invoice?.stage !== 'paying' && !isCreatingInvoice && !isPublishing
	const canCreateInvoice =
		!!ndk?.activeUser?.pubkey &&
		ndk.activeUser.pubkey === pubkey &&
		!!config?.appPublicKey &&
		!!config.appRelay &&
		nameAvailable &&
		!!tier &&
		!unifiedRegistered

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen || canDismiss) onOpenChange(nextOpen)
			}}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="storefront-publish-identity-dialog">
				<DialogHeader>
					<DialogTitle>Publish your storefront</DialogTitle>
					<DialogDescription>
						Choose a name. The site's domain is added to create your NIP-05 address, and one Lightning invoice activates both identities.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<section className="space-y-3 rounded-lg border p-4" data-testid="storefront-identity">
						<div className="space-y-1.5">
							<Label htmlFor="storefront-identity-name">Storefront name</Label>
							<Input
								id="storefront-identity-name"
								value={nameInput}
								onChange={(event) => setNameInput(event.target.value.toLowerCase())}
								placeholder="your-name"
								disabled={!!invoice || isCreatingInvoice}
								data-testid="storefront-identity-name"
							/>
							<p className="text-xs text-muted-foreground">
								Only enter the name. The current site domain is added to the NIP-05 address and vanity URL.
							</p>
						</div>

						{username && (
							<div className="rounded-md bg-muted/50 p-3 text-sm">
								<p>
									NIP-05:{' '}
									<span className="font-mono">
										{username}@{domain}
									</span>
								</p>
								<p>
									Vanity URL:{' '}
									<span className="font-mono">
										{domain}/{username}
									</span>
								</p>
							</div>
						)}

						{nameInput && !namesLoading && (
							<p className={`flex items-center gap-1 text-xs ${nameAvailable ? 'text-green-700' : 'text-destructive'}`}>
								{nameAvailable ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
								{!domain
									? "Could not determine this site's domain."
									: username.includes('@')
										? "Enter a name only; the site's domain is added automatically."
										: !nameValid
											? 'This name is invalid or reserved.'
											: isTakenByOther
												? 'This name is already held by another account.'
												: 'Name appears available; the server checks again when the invoice is created.'}
							</p>
						)}
						{namesLoading && <p className="text-xs text-muted-foreground">Loading registered names…</p>}
						{unifiedRegistered && (
							<p className="flex items-center gap-2 text-sm text-green-700" role="status">
								<CheckCircle2 className="size-4" /> Both identities are active until{' '}
								{new Date(unifiedVanity!.validUntil * 1000).toLocaleDateString()}.
							</p>
						)}
					</section>

					{!unifiedRegistered && (
						<section className="space-y-2">
							<Label htmlFor="storefront-identity-tier">Registration duration</Label>
							<select
								id="storefront-identity-tier"
								className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
								value={tierKey}
								disabled={!!invoice || isCreatingInvoice}
								onChange={(event) => setTierKey(event.target.value)}
							>
								{identityTiers.map(([key, option]) => (
									<option key={key} value={key}>
										{option.label} · {(option.sats + NIP05_PRICING[key].sats).toLocaleString()} sats for both
									</option>
								))}
							</select>
							<p className="text-xs text-muted-foreground">
								{ownedLegacyCount === 1
									? `One matching legacy identity is already active; this invoice covers the missing identity (${amountSats.toLocaleString()} sats).`
									: `One invoice covers both registrations (${amountSats.toLocaleString()} sats).`}
							</p>
						</section>
					)}

					{!unifiedRegistered && !invoice && !isCreatingInvoice && (
						<Button
							className="w-full"
							disabled={!canCreateInvoice}
							onClick={() => void makeInvoice()}
							data-testid="storefront-identity-invoice"
						>
							<Zap className="size-4" /> Create one invoice for both identities
						</Button>
					)}
					{isCreatingInvoice && (
						<div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Creating invoice…
						</div>
					)}
					{purchaseError && (
						<p role="alert" className="text-sm text-destructive">
							{purchaseError}
						</p>
					)}

					{invoice?.stage === 'paying' && (
						<div className="space-y-2" data-testid="storefront-identity-payment">
							<p className="text-sm text-muted-foreground">
								Keep this step open while payment is being checked. The purchase remains pending until a zap receipt and unified registry
								activation are observed.
							</p>
							<LightningPaymentProcessor
								data={{
									amount: invoice.amountSats,
									invoiceId: invoice.invoiceId,
									description: `NIP-05 and vanity identity registration: ${invoice.name}@${domain}`,
									bolt11: invoice.invoice,
									isZap: true,
									monitorZapReceipt: true,
									requireZapReceipt: true,
								}}
								title="Pay to register both identities"
								onPaymentComplete={(result) => {
									if (!result.success) return
									setRegistrationTimedOut(false)
									setInvoice((current) => (current ? { ...current, stage: 'awaiting-registration' } : current))
									toast.info('Zap receipt observed. Waiting for the storefront identity registry to activate.')
								}}
								onPaymentFailed={(result) => setPurchaseError(result.error ?? 'Payment could not be confirmed.')}
							/>
						</div>
					)}

					{invoice?.stage === 'awaiting-registration' && (
						<div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4" role="status">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Loader2 className="size-4 animate-spin" /> Payment receipt observed; waiting for the unified registry to activate both
								identities.
							</p>
							{registrationTimedOut && (
								<p className="text-sm text-muted-foreground">
									Activation is taking longer than expected. Publishing with this identity stays disabled until the registry confirms it.
								</p>
							)}
							<Button variant="outline" size="sm" disabled={isCheckingRegistration} onClick={() => void recheckRegistration()}>
								{isCheckingRegistration && <Loader2 className="size-4 animate-spin" />}
								Check registration
							</Button>
						</div>
					)}

					{haveIdentityRequest && !unifiedRegistered && !invoice && !isCreatingInvoice && !purchaseError && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<AlertCircle className="size-4" /> Pay the single invoice and wait for the registry to activate both identities before
							publishing.
						</p>
					)}

					<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
						{haveIdentityRequest && (
							<Button
								variant="ghost"
								onClick={() => void finishPublish(true)}
								disabled={isPublishing || isCreatingInvoice || invoice?.stage === 'paying'}
							>
								{invoice?.stage === 'awaiting-registration' ? 'Publish without waiting for activation' : 'Publish without an identity'}
							</Button>
						)}
						<Button
							onClick={() => void finishPublish(false)}
							disabled={(haveIdentityRequest && !unifiedRegistered) || isPublishing || isCreatingInvoice || !!invoice}
							data-testid="storefront-publish-confirm"
						>
							{isPublishing && <Loader2 className="size-4 animate-spin" />}
							Publish storefront
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
