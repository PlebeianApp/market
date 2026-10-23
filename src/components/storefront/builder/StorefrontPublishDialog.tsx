import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LightningPaymentProcessor } from '@/components/lightning/LightningPaymentProcessor'
import { useConfigQuery } from '@/queries/config'
import { getNip05ForPubkey, isNip05Available, useNip05Settings } from '@/queries/nip05'
import { getVanityForPubkey, isVanityAvailable, useVanitySettings } from '@/queries/vanity'
import { ndkStore } from '@/lib/stores/ndk'
import { nip05Actions } from '@/lib/stores/nip05'
import { vanityActions } from '@/lib/stores/vanity'
import { purchaseNip05ForPubkey, purchaseVanityForPubkey } from '@/lib/zapPurchase'
import type { StorefrontPage } from '@/lib/schemas/storefront'
import { NIP05_PRICING } from '@/server/Nip05Manager'
import { VANITY_PRICING } from '@/server/VanityManager'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { toast } from 'sonner'

interface StorefrontPublishDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	pubkey: string
	page: StorefrontPage | null
	onPublish: (page: StorefrontPage) => Promise<boolean>
}

type IdentityKind = 'vanity' | 'nip05'
type PaymentInvoice = {
	kind: IdentityKind
	name: string
	amountSats: number
	invoice: string
	invoiceId: string
	stage: 'paying' | 'awaiting-registration'
}

const vanityTiers = Object.entries(VANITY_PRICING)
const nip05Tiers = Object.entries(NIP05_PRICING)

/**
 * Optional storefront identity step. Vanity and NIP-05 remain separate legacy
 * purchases, each using its existing zap invoice and receipt-driven registry.
 * A selected purchase must appear in the active app registry before this dialog
 * allows publishing with that identity selected. Publishing without buying an
 * identity remains available: a storefront is still reachable by pubkey.
 */
export function StorefrontPublishDialog({ open, onOpenChange, pubkey, page, onPublish }: StorefrontPublishDialogProps) {
	const { data: config } = useConfigQuery()
	const { data: vanitySettings, isLoading: isLoadingVanity, refetch: refetchVanity } = useVanitySettings(config?.appPublicKey)
	const { data: nip05Settings, isLoading: isLoadingNip05, refetch: refetchNip05 } = useNip05Settings(config?.appPublicKey)
	const { ndk } = useStore(ndkStore)
	const [wantVanity, setWantVanity] = useState(false)
	const [wantNip05, setWantNip05] = useState(false)
	const [vanityName, setVanityName] = useState('')
	const [nip05Name, setNip05Name] = useState('')
	const [vanityTierKey, setVanityTierKey] = useState('6mo')
	const [nip05TierKey, setNip05TierKey] = useState('6mo')
	const [invoice, setInvoice] = useState<PaymentInvoice | null>(null)
	const [isCreatingInvoice, setIsCreatingInvoice] = useState(false)
	const [isCheckingRegistration, setIsCheckingRegistration] = useState(false)
	const [registrationTimedOut, setRegistrationTimedOut] = useState(false)
	const [purchaseError, setPurchaseError] = useState('')
	const [isPublishing, setIsPublishing] = useState(false)
	const domain = typeof window === 'undefined' ? '' : window.location.hostname

	const currentVanity = useMemo(() => getVanityForPubkey(vanitySettings, pubkey), [pubkey, vanitySettings])
	const currentNip05 = useMemo(() => getNip05ForPubkey(nip05Settings, pubkey), [nip05Settings, pubkey])
	const vanityNormalized = vanityName.trim().toLowerCase()
	const nip05Normalized = nip05Name.trim().toLowerCase()
	const vanityNameValid = vanityActions.isValidVanityName(vanityNormalized) && !vanityActions.isReservedName(vanityNormalized)
	const nip05NameValid = nip05Actions.isValidUsername(nip05Normalized) && !nip05Actions.isReservedName(nip05Normalized)
	const vanityNameAvailable = !isLoadingVanity && vanityNameValid && isVanityAvailable(vanitySettings, vanityNormalized)
	const nip05NameAvailable = !isLoadingNip05 && nip05NameValid && isNip05Available(nip05Settings, nip05Normalized)
	const vanityRegistered = Boolean(
		vanitySettings?.entries.some(
			(entry) => entry.vanityName === vanityNormalized && entry.pubkey === pubkey && entry.validUntil > Date.now() / 1000,
		),
	)
	const nip05Registered = Boolean(
		nip05Settings?.entries.some(
			(entry) => entry.username === nip05Normalized && entry.pubkey === pubkey && entry.validUntil > Date.now() / 1000,
		),
	)
	const selectionsReady = (!wantVanity || vanityRegistered) && (!wantNip05 || nip05Registered)
	const haveSelections = wantVanity || wantNip05
	const canCreateVanityInvoice =
		!!ndk?.activeUser?.pubkey &&
		ndk.activeUser.pubkey === pubkey &&
		!!config?.appPublicKey &&
		!!config.appRelay &&
		vanityNameAvailable &&
		!!VANITY_PRICING[vanityTierKey]
	const canCreateNip05Invoice =
		!!ndk?.activeUser?.pubkey &&
		ndk.activeUser.pubkey === pubkey &&
		!!config?.appPublicKey &&
		!!config.appRelay &&
		nip05NameAvailable &&
		!!NIP05_PRICING[nip05TierKey]

	useEffect(() => {
		if (!invoice || invoice.stage !== 'awaiting-registration') return
		const registered = invoice.kind === 'vanity' ? vanityRegistered : nip05Registered
		if (!registered) return
		setInvoice(null)
		setRegistrationTimedOut(false)
	}, [invoice, nip05Registered, vanityRegistered])

	const recheckRegistration = useCallback(async () => {
		if (!invoice || invoice.stage !== 'awaiting-registration') return
		setIsCheckingRegistration(true)
		try {
			if (invoice.kind === 'vanity') await refetchVanity()
			else await refetchNip05()
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
				const now = Date.now() / 1000
				let registered = false
				if (invoice.kind === 'vanity') {
					const result = await refetchVanity()
					registered = Boolean(
						result.data?.entries.some((entry) => entry.vanityName === invoice.name && entry.pubkey === pubkey && entry.validUntil > now),
					)
				} else {
					const result = await refetchNip05()
					registered = Boolean(
						result.data?.entries.some((entry) => entry.username === invoice.name && entry.pubkey === pubkey && entry.validUntil > now),
					)
				}

				if (registered) {
					if (!cancelled) {
						setInvoice(null)
						setRegistrationTimedOut(false)
						toast.success(`${invoice.kind === 'vanity' ? 'Vanity URL' : 'NIP-05 address'} is active. You can publish your storefront.`)
					}
					return
				}
			} catch {
				// Relay errors are transient. Keep the payment and registration
				// states separate and continue checking while the dialog is open.
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

	const makeInvoice = async (kind: IdentityKind) => {
		const name = kind === 'vanity' ? vanityNormalized : nip05Normalized
		const tier = kind === 'vanity' ? VANITY_PRICING[vanityTierKey] : NIP05_PRICING[nip05TierKey]
		if (!tier || !ndk || !config?.appPublicKey || !config.appRelay) return
		if (ndk.activeUser?.pubkey !== pubkey) {
			setPurchaseError('Reconnect the account that owns this storefront before creating an invoice.')
			return
		}

		setIsCreatingInvoice(true)
		setPurchaseError('')
		try {
			const context = { ndk, appPubkey: config.appPublicKey, appRelay: config.appRelay }
			const result =
				kind === 'vanity'
					? await purchaseVanityForPubkey(context, { name, amountSats: tier.sats })
					: await purchaseNip05ForPubkey(context, { username: name, amountSats: tier.sats })
			setInvoice({ kind, name, amountSats: tier.sats, invoice: result.pr, invoiceId: result.invoiceId, stage: 'paying' })
		} catch (error) {
			setPurchaseError(error instanceof Error ? error.message : 'Could not create a payment invoice.')
		} finally {
			setIsCreatingInvoice(false)
		}
	}

	const finishPublish = async (skipIdentityPurchase: boolean) => {
		if (!page || isPublishing || invoice?.stage === 'paying' || isCreatingInvoice) return
		if (!skipIdentityPurchase && !selectionsReady) return
		setIsPublishing(true)
		try {
			const published = await onPublish(page)
			if (published) {
				setWantVanity(false)
				setWantNip05(false)
				setVanityName('')
				setNip05Name('')
				setInvoice(null)
				onOpenChange(false)
			}
		} finally {
			setIsPublishing(false)
		}
	}

	const canDismiss = invoice?.stage !== 'paying' && !isCreatingInvoice && !isPublishing

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
						Choose whether to add a paid custom URL or Nostr address first. Each is a separate Lightning purchase; neither is required to
						publish.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<IdentityPurchaseOption
						kind="vanity"
						domain={domain}
						currentName={currentVanity?.vanityName}
						checked={wantVanity}
						name={vanityName}
						nameValid={vanityNameValid}
						nameAvailable={vanityNameAvailable}
						nameLoading={isLoadingVanity}
						tierKey={vanityTierKey}
						tiers={vanityTiers}
						disabled={!!invoice || isCreatingInvoice || !!currentVanity}
						onCheckedChange={setWantVanity}
						onNameChange={(name) => setVanityName(name.toLowerCase())}
						onTierChange={setVanityTierKey}
					/>
					<IdentityPurchaseOption
						kind="nip05"
						domain={domain}
						currentName={currentNip05?.username}
						checked={wantNip05}
						name={nip05Name}
						nameValid={nip05NameValid}
						nameAvailable={nip05NameAvailable}
						nameLoading={isLoadingNip05}
						tierKey={nip05TierKey}
						tiers={nip05Tiers}
						disabled={!!invoice || isCreatingInvoice || !!currentNip05}
						onCheckedChange={setWantNip05}
						onNameChange={(name) => setNip05Name(name.toLowerCase())}
						onTierChange={setNip05TierKey}
					/>

					{wantVanity && !vanityRegistered && !invoice && !isCreatingInvoice && (
						<Button
							className="w-full"
							disabled={!canCreateVanityInvoice}
							onClick={() => void makeInvoice('vanity')}
							data-testid="storefront-vanity-invoice"
						>
							<Zap className="size-4" /> Create vanity URL invoice
						</Button>
					)}
					{wantNip05 && !nip05Registered && !invoice && !isCreatingInvoice && (
						<Button
							className="w-full"
							disabled={!canCreateNip05Invoice}
							onClick={() => void makeInvoice('nip05')}
							data-testid="storefront-nip05-invoice"
						>
							<Zap className="size-4" /> Create NIP-05 invoice
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
								Keep this step open while payment is being checked. The purchase remains pending until a zap receipt and registry activation
								are observed.
							</p>
							<LightningPaymentProcessor
								data={{
									amount: invoice.amountSats,
									invoiceId: invoice.invoiceId,
									description:
										invoice.kind === 'vanity'
											? `Vanity URL registration: ${invoice.name}`
											: `NIP-05 registration: ${invoice.name}@${domain}`,
									bolt11: invoice.invoice,
									isZap: true,
									monitorZapReceipt: true,
									requireZapReceipt: true,
								}}
								title="Pay to register this identity"
								onPaymentComplete={(result) => {
									if (!result.success) return
									setRegistrationTimedOut(false)
									setInvoice((current) => (current ? { ...current, stage: 'awaiting-registration' } : current))
									toast.info('Zap receipt observed. Waiting for the identity registry to confirm activation.')
								}}
								onPaymentFailed={(result) => setPurchaseError(result.error ?? 'Payment could not be confirmed.')}
							/>
						</div>
					)}

					{invoice?.stage === 'awaiting-registration' && (
						<div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4" role="status">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Loader2 className="size-4 animate-spin" /> Payment receipt observed; waiting for the app registry to activate this
								identity.
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

					{selectionsReady && haveSelections && (
						<p className="flex items-center gap-2 text-sm text-green-700" role="status">
							<CheckCircle2 className="size-4" /> Selected identities are active in the app registry.
						</p>
					)}
					{haveSelections && !selectionsReady && !invoice && !isCreatingInvoice && !purchaseError && (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<AlertCircle className="size-4" /> Pay each selected invoice and wait for registry activation before publishing with these
							identities.
						</p>
					)}

					<div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
						{haveSelections && (
							<Button
								variant="ghost"
								onClick={() => void finishPublish(true)}
								disabled={isPublishing || isCreatingInvoice || invoice?.stage === 'paying'}
							>
								{invoice?.stage === 'awaiting-registration'
									? 'Publish without waiting for activation'
									: 'Publish without buying an identity'}
							</Button>
						)}
						<Button
							onClick={() => void finishPublish(false)}
							disabled={!selectionsReady || isPublishing || isCreatingInvoice || !!invoice}
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

function IdentityPurchaseOption({
	kind,
	domain,
	currentName,
	checked,
	name,
	nameValid,
	nameAvailable,
	nameLoading,
	tierKey,
	tiers,
	disabled,
	onCheckedChange,
	onNameChange,
	onTierChange,
}: {
	kind: IdentityKind
	domain: string
	currentName?: string
	checked: boolean
	name: string
	nameValid: boolean
	nameAvailable: boolean
	nameLoading: boolean
	tierKey: string
	tiers: [string, (typeof VANITY_PRICING)[string]][] | [string, (typeof NIP05_PRICING)[string]][]
	disabled: boolean
	onCheckedChange: (checked: boolean) => void
	onNameChange: (name: string) => void
	onTierChange: (tier: string) => void
}) {
	const isVanity = kind === 'vanity'
	const inputId = `storefront-${kind}-identity-name`
	const tier = tiers.find(([key]) => key === tierKey)?.[1]
	const help = isVanity
		? '3–30 characters: letters, numbers, hyphens, or underscores.'
		: '1–30 characters: letters, numbers, dots, hyphens, or underscores.'

	return (
		<section className="space-y-3 rounded-lg border p-4" data-testid={`storefront-identity-${kind}`}>
			<div className="flex items-start gap-3">
				<input
					id={`storefront-identity-${kind}-enabled`}
					type="checkbox"
					checked={!!currentName || checked}
					disabled={disabled || !!currentName}
					onChange={(event) => onCheckedChange(event.target.checked)}
					className="mt-1 size-4 accent-primary"
				/>
				<div className="min-w-0 flex-1">
					<Label htmlFor={`storefront-identity-${kind}-enabled`} className="font-semibold">
						{isVanity ? 'Vanity URL' : 'NIP-05 address'}
					</Label>
					<p className="text-sm text-muted-foreground">
						{currentName
							? `Already active: ${isVanity ? `${domain}/${currentName}` : `${currentName}@${domain}`}`
							: isVanity
								? 'An optional paid short URL for your storefront.'
								: 'An optional paid Nostr verification address.'}
					</p>
				</div>
			</div>

			{checked && !currentName && (
				<div className="space-y-3 pl-7">
					<div className="space-y-1.5">
						<Label htmlFor={inputId}>{isVanity ? 'Choose URL name' : 'Choose NIP-05 username'}</Label>
						<div className="flex items-center gap-2">
							{isVanity ? <span className="shrink-0 text-sm text-muted-foreground">{domain}/</span> : null}
							<Input
								id={inputId}
								value={name}
								onChange={(event) => onNameChange(event.target.value)}
								placeholder={isVanity ? 'your-shop' : 'your-name'}
								disabled={disabled}
							/>
							{!isVanity ? <span className="shrink-0 text-sm text-muted-foreground">@{domain}</span> : null}
						</div>
						<p className="text-xs text-muted-foreground">{help}</p>
						{name && !nameLoading && (
							<p className={`flex items-center gap-1 text-xs ${nameValid && nameAvailable ? 'text-green-700' : 'text-destructive'}`}>
								{nameValid && nameAvailable ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
								{!nameValid
									? 'This name is invalid or reserved.'
									: nameAvailable
										? 'Name appears available; the server checks again when the invoice is created.'
										: 'Name is unavailable.'}
							</p>
						)}
						{nameLoading && <p className="text-xs text-muted-foreground">Loading registered names…</p>}
					</div>

					<div className="space-y-1.5">
						<Label htmlFor={`storefront-${kind}-identity-tier`}>Registration duration</Label>
						<select
							id={`storefront-${kind}-identity-tier`}
							className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
							value={tierKey}
							disabled={disabled}
							onChange={(event) => onTierChange(event.target.value)}
						>
							{tiers.map(([key, option]) => (
								<option key={key} value={key}>
									{option.label} · {option.sats.toLocaleString()} sats
								</option>
							))}
						</select>
						{tier && (
							<p className="text-xs text-muted-foreground">
								Payment uses the existing Lightning zap purchase flow ({tier.sats.toLocaleString()} sats).
							</p>
						)}
					</div>
				</div>
			)}
		</section>
	)
}
