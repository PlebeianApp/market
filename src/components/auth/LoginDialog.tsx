import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/stores/auth'
import { NOSTR_AUTO_LOGIN } from '@/lib/stores/auth'
import { useState } from 'react'
import { NostrConnectQR } from './NostrConnectQR'
import { PrivateKeyLogin } from './PrivateKeyLogin'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

interface LoginDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
	const [activeTab, setActiveTab] = useState('extension')
	const [enableAutoLogin, setEnableAutoLogin] = useState(localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true')
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
				<Tabs defaultValue="extension" className="w-full" value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="extension">Extension</TabsTrigger>
						<TabsTrigger value="connect">Nostr Connect</TabsTrigger>
						<TabsTrigger value="private-key">Private Key</TabsTrigger>
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
							<Button
								onClick={() =>
									loginWithExtension()
										.catch(console.error)
										.finally(() => onOpenChange(false))
								}
								className="w-full"
							>
								Connect to Extension
							</Button>
						</div>
					</TabsContent>
				</Tabs>
				<div className="flex items-center space-x-2">
					<Label htmlFor="auto-login" className=" flex gap-2 text-sm text-muted-foreground items-center">
						<Checkbox
							id="auto-login"
							checked={enableAutoLogin}
							onCheckedChange={(checked) => {
								setEnableAutoLogin(checked === true)
								localStorage.setItem(NOSTR_AUTO_LOGIN, checked === true ? 'true' : 'false')
							}}
						/>
						Auto-login
					</Label>
				</div>
			</DialogContent>
		</Dialog>
	)
}
