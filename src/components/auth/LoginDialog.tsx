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
			<DialogContent className="sm:max-w-[425px]" data-testid="login-dialog">
				<DialogHeader>
					<DialogTitle>Login</DialogTitle>
					<DialogDescription>Choose your preferred login method below.</DialogDescription>
				</DialogHeader>
				<Tabs defaultValue="extension" className="w-full" value={activeTab} onValueChange={setActiveTab}>
					<TabsList className="w-full rounded-none bg-transparent h-auto p-0 flex">
						<TabsTrigger 
							value="extension" 
							data-testid="extension-tab"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Extension
						</TabsTrigger>
						<TabsTrigger 
							value="connect" 
							data-testid="connect-tab"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Nostr Connect
						</TabsTrigger>
						<TabsTrigger 
							value="private-key" 
							data-testid="private-key-tab"
							className="flex-1 px-4 py-2 font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
						>
							Private Key
						</TabsTrigger>
					</TabsList>
					<TabsContent value="private-key">
						<PrivateKeyLogin onError={handleError} onSuccess={() => onOpenChange(false)} />
					</TabsContent>
					<TabsContent value="connect">
						<Tabs defaultValue="qr" className="w-full">
							<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
								<TabsTrigger 
									value="qr"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									QR Code
								</TabsTrigger>
								<TabsTrigger 
									value="bunker"
									className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
								>
									Bunker
								</TabsTrigger>
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
								data-testid="connect-extension-button"
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
							data-testid="auto-login-checkbox"
						/>
						Auto-login
					</Label>
				</div>
			</DialogContent>
		</Dialog>
	)
}
