import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/stores/auth'
import { useState } from 'react'
// import { BunkerConnect } from './BunkerConnect'
import { NostrConnectQR } from './NostrConnectQR'
import { PrivateKeyLogin } from './PrivateKeyLogin'

interface LoginDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
	const [activeTab, setActiveTab] = useState('private-key')
	const { loginWithExtension } = useAuth()

	const handleError = (error: string) => {
		console.error(error)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Login</DialogTitle>
					<DialogDescription>Choose your preferred login method below.</DialogDescription>
				</DialogHeader>
				<Tabs defaultValue="private-key" className="w-full" value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="private-key">Private Key</TabsTrigger>
						<TabsTrigger value="connect">Nostr Connect</TabsTrigger>
						<TabsTrigger value="extension">Extension</TabsTrigger>
					</TabsList>
					<TabsContent value="private-key">
						<PrivateKeyLogin onError={handleError} onSuccess={() => onOpenChange(false)} />
					</TabsContent>
					<TabsContent value="connect">
						<Tabs defaultValue="qr" className="w-full">
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="qr">QR Code</TabsTrigger>
								<TabsTrigger value="bunker">Bunker</TabsTrigger>
							</TabsList>

							<TabsContent value="qr">
								<NostrConnectQR onError={handleError} onSuccess={() => onOpenChange(false)} />
							</TabsContent>

							<TabsContent value="bunker">{/* <BunkerConnect onError={handleError} /> */}</TabsContent>
						</Tabs>
					</TabsContent>
					<TabsContent value="extension">
						<div className="space-y-4 py-4">
							<p className="text-sm text-muted-foreground">Login using your Nostr browser extension (e.g., Alby, nos2x).</p>
							<Button onClick={() => loginWithExtension().catch(console.error)} className="w-full">
								Connect to Extension
							</Button>
						</div>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	)
}
