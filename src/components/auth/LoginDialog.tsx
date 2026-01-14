import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/stores/auth'
import { NOSTR_AUTO_LOGIN } from '@/lib/stores/auth'
import { useState } from 'react'
import { NostrConnectQR } from './NostrConnectQR'
import { PrivateKeyLogin } from './PrivateKeyLogin'
import { BunkerConnect } from './BunkerConnect'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { hasAcceptedTerms } from '@/components/dialogs/TermsConditionsDialog'
import { uiActions } from '@/lib/stores/ui'

interface LoginDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
	const [activeTab, setActiveTab] = useState('extension')
	const [enableAutoLogin, setEnableAutoLogin] = useState(localStorage.getItem(NOSTR_AUTO_LOGIN) === 'true')
	const [extensionError, setExtensionError] = useState<string | null>(null)
	const { loginWithExtension } = useAuth()

	const handleError = (error: string) => {
		console.error(error)
	}

	const handleLoginSuccess = () => {
		onOpenChange(false)
		if (!hasAcceptedTerms()) {
			uiActions.openDialog('terms')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[425px] p-0 gap-0 overflow-hidden [&>button:not([data-dialog-close])]:text-white [&>button:not([data-dialog-close])]:hover:text-gray-300"
				data-testid="login-dialog"
			>
				{/* Header Section */}
				<div className="relative bg-black text-white px-4 sm:px-6 py-6 overflow-hidden w-full max-w-full">
					<div
						className="absolute inset-0 opacity-80"
						style={{
							backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.3) 1px, transparent 1px)',
							backgroundSize: '10px 10px',
							backgroundRepeat: 'repeat',
						}}
					/>
					<div className="relative z-10">
						<h2 className="text-xl font-semibold mb-2">Login</h2>
						<p className="text-sm text-gray-300">Choose your preferred login method below.</p>
					</div>
				</div>
				<div className="px-4 sm:px-6 pt-0 pb-6 overflow-hidden w-full max-w-full">
					<Tabs defaultValue="extension" className="w-full max-w-full min-w-0" value={activeTab} onValueChange={setActiveTab}>
						<TabsList className="w-full rounded-none bg-transparent h-auto p-0 flex">
							<TabsTrigger
								value="extension"
								data-testid="extension-tab"
								className="flex-1 px-1 sm:px-2 py-2 text-sm sm:text-base font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
							>
								Extension
							</TabsTrigger>
							<TabsTrigger
								value="connect"
								data-testid="connect-tab"
								className="flex-1 px-1 sm:px-2 py-2 text-sm sm:text-base font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
							>
								N-Connect
							</TabsTrigger>
							<TabsTrigger
								value="private-key"
								data-testid="private-key-tab"
								className="flex-1 px-1 sm:px-2 py-2 text-sm sm:text-base font-medium data-[state=active]:text-secondary border-b-1 data-[state=active]:border-secondary data-[state=inactive]:text-black rounded-none"
							>
								Private Key
							</TabsTrigger>
						</TabsList>
						<TabsContent value="private-key" className="w-full max-w-full overflow-hidden">
							<PrivateKeyLogin onError={handleError} onSuccess={handleLoginSuccess} />
						</TabsContent>
						<TabsContent value="connect" className="w-full max-w-full overflow-hidden">
							<Tabs defaultValue="qr" className="w-full max-w-full min-w-0">
								<TabsList className="w-full bg-transparent h-auto p-0 flex flex-wrap gap-[1px]">
									<TabsTrigger
										value="qr"
										data-testid="qr-tab"
										className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
									>
										QR Code
									</TabsTrigger>
									<TabsTrigger
										value="bunker"
										data-testid="bunker-tab"
										className="flex-1 px-4 py-2 text-xs font-medium data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=inactive]:bg-gray-100 data-[state=inactive]:text-black rounded-none"
									>
										Bunker URL
									</TabsTrigger>
								</TabsList>

								<TabsContent value="qr" className="w-full max-w-full overflow-hidden">
									<NostrConnectQR onError={handleError} onSuccess={handleLoginSuccess} />
								</TabsContent>

								<TabsContent value="bunker" className="w-full max-w-full overflow-hidden">
									<BunkerConnect onError={handleError} onSuccess={handleLoginSuccess} />
								</TabsContent>
							</Tabs>
						</TabsContent>
						<TabsContent value="extension" className="w-full max-w-full overflow-hidden">
							<div className="space-y-4 py-4">
								<p className="text-sm text-muted-foreground">Login using your Nostr browser extension (e.g., Alby, nos2x).</p>
								{extensionError && (
									<div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm" role="alert">
										<p className="font-medium">Login Failed</p>
										<p>{extensionError}</p>
									</div>
								)}
								<Button
									onClick={() => {
										setExtensionError(null)
										loginWithExtension()
											.then(() => handleLoginSuccess())
											.catch((error) => {
												console.error(error)
												setExtensionError(error.message || 'Failed to connect to extension')
											})
									}}
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
				</div>
			</DialogContent>
		</Dialog>
	)
}
