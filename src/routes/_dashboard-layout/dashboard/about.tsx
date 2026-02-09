import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfigQuery } from '@/queries/config'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, ExternalLink, Info, Mail, Server, Shield, User } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useState } from 'react'
import { toast } from 'sonner'

export const Route = createFileRoute('/_dashboard-layout/dashboard/about')({
	component: AboutComponent,
})

function CopyableField({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			toast.success('Copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			toast.error('Failed to copy')
		}
	}

	// Truncate long values for display
	const displayValue = value.length > 40 ? `${value.slice(0, 20)}...${value.slice(-16)}` : value

	return (
		<div className="flex items-start gap-3 p-3 border rounded-md bg-gray-50">
			<Icon className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium text-muted-foreground">{label}</p>
				<p className="font-mono text-sm break-all">{displayValue}</p>
			</div>
			<Button variant="ghost" size="sm" onClick={handleCopy} className="flex-shrink-0">
				{copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
			</Button>
		</div>
	)
}

function AboutComponent() {
	useDashboardTitle('About')

	const { data: config } = useConfigQuery()
	const appSettings = config?.appSettings

	const appPubkey = config?.appPublicKey
	const appRelay = config?.appRelay
	const instanceName = appSettings?.displayName || appSettings?.name || 'Plebeian Market'
	const ownerPubkey = appSettings?.ownerPk
	const contactEmail = appSettings?.contactEmail

	// Convert pubkeys to npub format for display
	const appNpub = appPubkey ? nip19.npubEncode(appPubkey) : null
	const ownerNpub = ownerPubkey ? nip19.npubEncode(ownerPubkey) : null

	return (
		<div>
			<div className="hidden lg:flex sticky top-0 z-10 bg-white border-b py-4 px-4 lg:px-6 items-center justify-between">
				<div className="flex items-center gap-3">
					<Info className="w-6 h-6 text-muted-foreground" />
					<div>
						<h1 className="text-2xl font-bold">About</h1>
						<p className="text-muted-foreground text-sm">App information and verification</p>
					</div>
				</div>
			</div>
			<div className="p-4 lg:p-8 space-y-6">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Info className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">About</h1>
							<p className="text-muted-foreground text-sm">App information and verification</p>
						</div>
					</div>
				</div>

				{/* Instance Info */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Instance Information</CardTitle>
						<CardDescription>Details about this Plebeian Market instance</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center gap-3 p-3 border rounded-md bg-gray-50">
							<Server className="w-5 h-5 text-muted-foreground flex-shrink-0" />
							<div>
								<p className="text-sm font-medium text-muted-foreground">Instance Name</p>
								<p className="font-semibold">{instanceName}</p>
							</div>
						</div>

						{appRelay && <CopyableField label="App Relay" value={appRelay} icon={Server} />}
					</CardContent>
				</Card>

				{/* Authenticity Verification */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Shield className="w-5 h-5" />
							Authenticity Verification
						</CardTitle>
						<CardDescription>Use these public keys to verify that events are genuinely from this app or its owner</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{appNpub && (
							<div className="space-y-2">
								<CopyableField label="App Public Key (npub)" value={appNpub} icon={Shield} />
								<CopyableField label="App Public Key (hex)" value={appPubkey!} icon={Shield} />
							</div>
						)}

						{ownerNpub && (
							<div className="space-y-2 pt-4 border-t">
								<CopyableField label="Owner Public Key (npub)" value={ownerNpub} icon={User} />
								<CopyableField label="Owner Public Key (hex)" value={ownerPubkey!} icon={User} />
							</div>
						)}

						{!appNpub && !ownerNpub && <p className="text-muted-foreground text-sm">No public keys available</p>}
					</CardContent>
				</Card>

				{/* Contact */}
				{contactEmail && (
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Contact</CardTitle>
							<CardDescription>Get in touch with the instance operator</CardDescription>
						</CardHeader>
						<CardContent>
							<a
								href={`mailto:${contactEmail}`}
								className="flex items-center gap-3 p-3 border rounded-md bg-gray-50 hover:bg-gray-100 transition-colors"
							>
								<Mail className="w-5 h-5 text-muted-foreground flex-shrink-0" />
								<div>
									<p className="text-sm font-medium text-muted-foreground">Email</p>
									<p className="font-medium text-blue-600">{contactEmail}</p>
								</div>
								<ExternalLink className="w-4 h-4 text-muted-foreground ml-auto" />
							</a>
						</CardContent>
					</Card>
				)}

				{/* About Plebeian Market */}
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">About Plebeian Market</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3 text-sm text-muted-foreground">
						<p>
							Plebeian Market is a decentralized marketplace built on the Nostr protocol. All data is stored on Nostr relays, giving you
							full ownership and control of your data.
						</p>
						<p>
							<a
								href="https://github.com/PlebeianApp/market"
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-600 hover:underline inline-flex items-center gap-1"
							>
								View on GitHub
								<ExternalLink className="w-3 h-3" />
							</a>
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
