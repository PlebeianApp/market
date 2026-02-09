import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfigQuery } from '@/queries/config'
import { useDashboardTitle } from '@/routes/_dashboard-layout'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, ExternalLink, Github, Info, Mail, Server, Shield, User } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useState } from 'react'
import { toast } from 'sonner'

interface GitHubContributor {
	login: string
	avatar_url: string
	html_url: string
	contributions: number
}

export const Route = createFileRoute('/_dashboard-layout/dashboard/about')({
	component: AboutComponent,
})

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			toast.success(`${label} copied to clipboard`)
			setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			toast.error('Failed to copy')
		}
	}

	return (
		<Button variant="ghost" size="icon" onClick={handleCopy} className="h-6 w-6 flex-shrink-0">
			{copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
		</Button>
	)
}

function PubkeyField({
	label,
	npub,
	hex,
	icon: Icon,
}: {
	label: string
	npub: string
	hex: string
	icon: React.ComponentType<{ className?: string }>
}) {
	// Truncate for display
	const displayNpub = npub.length > 40 ? `${npub.slice(0, 20)}...${npub.slice(-16)}` : npub
	const displayHex = hex.length > 40 ? `${hex.slice(0, 20)}...${hex.slice(-16)}` : hex

	return (
		<div className="p-3 border rounded-md bg-muted/50 space-y-2">
			<div className="flex items-center gap-2">
				<Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
				<span className="text-sm font-medium">{label}</span>
			</div>
			<div className="space-y-1 pl-7">
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground w-10">npub</span>
					<a
						href={`https://njump.me/${npub}`}
						target="_blank"
						rel="noopener noreferrer"
						className="font-mono text-xs text-blue-600 hover:underline truncate flex-1"
					>
						{displayNpub}
					</a>
					<CopyButton value={npub} label="npub" />
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground w-10">hex</span>
					<span className="font-mono text-xs truncate flex-1">{displayHex}</span>
					<CopyButton value={hex} label="hex" />
				</div>
			</div>
		</div>
	)
}

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

	return (
		<div className="flex items-start gap-3 p-3 border rounded-md bg-muted/50">
			<Icon className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
			<div className="flex-1 min-w-0">
				<p className="text-sm font-medium text-muted-foreground">{label}</p>
				<p className="font-mono text-sm break-all">{value}</p>
			</div>
			<Button variant="ghost" size="icon" onClick={handleCopy} className="flex-shrink-0 h-8 w-8">
				{copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
			</Button>
		</div>
	)
}

function useGitHubContributors() {
	return useQuery({
		queryKey: ['github-contributors'],
		queryFn: async (): Promise<GitHubContributor[]> => {
			const response = await fetch('https://api.github.com/repos/PlebeianApp/market/contributors')
			if (!response.ok) throw new Error('Failed to fetch contributors')
			return response.json()
		},
		staleTime: 1000 * 60 * 60, // Cache for 1 hour
	})
}

function AboutComponent() {
	useDashboardTitle('About')

	const { data: config } = useConfigQuery()
	const { data: contributors, isLoading: contributorsLoading } = useGitHubContributors()
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
			<div className="p-4 lg:p-8">
				<div className="lg:hidden mb-6">
					<div className="flex items-center gap-3">
						<Info className="w-6 h-6 text-muted-foreground" />
						<div>
							<h1 className="text-2xl font-bold">About</h1>
							<p className="text-muted-foreground text-sm">App information and verification</p>
						</div>
					</div>
				</div>

				<div className="space-y-6">
					{/* Instance Info */}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Instance Information</CardTitle>
							<CardDescription>Details about this Plebeian Market instance</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center gap-3 p-3 border rounded-md bg-muted/50">
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
							{appNpub && appPubkey && <PubkeyField label="App Public Key" npub={appNpub} hex={appPubkey} icon={Shield} />}

							{ownerNpub && ownerPubkey && <PubkeyField label="Owner Public Key" npub={ownerNpub} hex={ownerPubkey} icon={User} />}

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
									className="flex items-center gap-3 p-3 border rounded-md bg-muted/50 hover:bg-muted transition-colors"
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
							<CardTitle className="text-lg flex items-center gap-2">
								<Github className="w-5 h-5" />
								About Plebeian Market
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4 text-sm text-muted-foreground">
							<p>
								Plebeian Market is a decentralized marketplace built on the Nostr protocol. All data is stored on Nostr relays, giving you
								full ownership and control of your data.
							</p>
							<a
								href="https://github.com/PlebeianApp/market"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-3 p-3 border rounded-md bg-muted/50 hover:bg-muted transition-colors"
							>
								<Github className="w-5 h-5 text-muted-foreground flex-shrink-0" />
								<div>
									<p className="text-sm font-medium text-muted-foreground">Repository</p>
									<p className="font-medium text-blue-600">PlebeianApp/market</p>
								</div>
								<ExternalLink className="w-4 h-4 text-muted-foreground ml-auto" />
							</a>
						</CardContent>
					</Card>

					{/* Contributors */}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg flex items-center gap-2">
								<User className="w-5 h-5" />
								Contributors
							</CardTitle>
							<CardDescription>People who have contributed to Plebeian Market</CardDescription>
						</CardHeader>
						<CardContent>
							{contributorsLoading ? (
								<p className="text-muted-foreground text-sm">Loading contributors...</p>
							) : contributors && contributors.length > 0 ? (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
									{contributors.map((contributor) => (
										<a
											key={contributor.login}
											href={contributor.html_url}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center gap-2 p-2 border rounded-md bg-muted/50 hover:bg-muted transition-colors"
										>
											<img src={contributor.avatar_url} alt={contributor.login} className="w-8 h-8 rounded-full flex-shrink-0" />
											<div className="min-w-0 flex-1">
												<p className="font-medium text-sm truncate">{contributor.login}</p>
												<p className="text-xs text-muted-foreground">{contributor.contributions} commits</p>
											</div>
										</a>
									))}
								</div>
							) : (
								<p className="text-muted-foreground text-sm">Unable to load contributors</p>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	)
}
