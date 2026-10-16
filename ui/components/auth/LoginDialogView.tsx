import { useState, type ReactNode } from 'react'
import { Button } from '../../primitives/button'
import { Checkbox } from '../../primitives/checkbox'
import { Dialog, DialogContent } from '../../primitives/dialog'
import { Label } from '../../primitives/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../primitives/tabs'
import { cn } from '../../utils/cn'

export interface LoginDialogViewProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	privateKeyPanel: ReactNode
	nostrConnectQrPanel: ReactNode
	bunkerPanel: ReactNode
	extensionError: string | null
	onConnectExtension: () => void
	autoLogin: boolean
	onAutoLoginChange: (enabled: boolean) => void
}

const classNameTab = cn(
	'flex-1 px-1 sm:px-2 py-2 text-sm sm:text-base font-medium rounded-none',
	// Remove the default tab shadow.
	'shadow-none!',
	'border-x-0 border-t-0 border-b border-primary',
	'text-black hover:text-secondary',
	'data-[state=active]:border-secondary',
	'data-[state=active]:text-secondary',
	'data-[state=active]:shadow-none',
	// Hide the built-in underline indicator.
	'after:hidden',
)

const classNameSubTab =
	'flex-1 data-[state=active]:bg-secondary data-[state=inactive]:bg-gray-100 px-4 py-2 rounded-none font-medium data-[state=active]:text-white data-[state=inactive]:text-black text-xs'

export function LoginDialogView({
	open,
	onOpenChange,
	privateKeyPanel,
	nostrConnectQrPanel,
	bunkerPanel,
	extensionError,
	onConnectExtension,
	autoLogin,
	onAutoLoginChange,
}: LoginDialogViewProps) {
	const [activeTab, setActiveTab] = useState('extension')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[425px] p-0 gap-0 overflow-hidden [&>button:not([data-dialog-close])]:text-white [&>button:not([data-dialog-close])]:hover:text-gray-300"
				data-testid="login-dialog"
			>
				<div className="relative bg-black px-4 sm:px-6 py-6 w-full max-w-full overflow-hidden text-white">
					<div
						className="absolute inset-0 opacity-80"
						style={{
							backgroundImage: 'radial-gradient(circle, rgba(255, 255, 255, 0.3) 1px, transparent 1px)',
							backgroundSize: '10px 10px',
							backgroundRepeat: 'repeat',
						}}
					/>
					<div className="z-10 relative">
						<h2 className="mb-2 font-semibold text-xl">Login</h2>
						<p className="text-gray-300 text-sm">Choose your preferred login method below.</p>
					</div>
				</div>
				<div className="px-4 sm:px-6 pt-0 pb-6 w-full max-w-full overflow-hidden">
					<Tabs defaultValue="extension" className="w-full min-w-0 max-w-full" value={activeTab}>
						<TabsList className="flex bg-transparent p-0 rounded-none w-full h-auto">
							<TabsTrigger value="extension" data-testid="extension-tab" className={classNameTab} onClick={() => setActiveTab('extension')}>
								Extension
							</TabsTrigger>
							<TabsTrigger value="connect" data-testid="connect-tab" className={classNameTab} onClick={() => setActiveTab('connect')}>
								N-Connect
							</TabsTrigger>
							<TabsTrigger
								value="private-key"
								data-testid="private-key-tab"
								className={classNameTab}
								onClick={() => setActiveTab('private-key')}
							>
								Private Key
							</TabsTrigger>
						</TabsList>
						<TabsContent value="private-key" className="w-full max-w-full overflow-hidden">
							{privateKeyPanel}
						</TabsContent>
						<TabsContent value="connect" className="w-full max-w-full overflow-hidden">
							<Tabs defaultValue="qr" className="w-full min-w-0 max-w-full">
								<TabsList className="flex flex-wrap gap-[1px] bg-transparent p-0 w-full h-auto">
									<TabsTrigger value="qr" data-testid="qr-tab" className={classNameSubTab}>
										QR Code
									</TabsTrigger>
									<TabsTrigger value="bunker" data-testid="bunker-tab" className={classNameSubTab}>
										Bunker URL
									</TabsTrigger>
								</TabsList>
								<TabsContent value="qr" className="w-full max-w-full overflow-hidden">
									{nostrConnectQrPanel}
								</TabsContent>
								<TabsContent value="bunker" className="w-full max-w-full overflow-hidden">
									{bunkerPanel}
								</TabsContent>
							</Tabs>
						</TabsContent>
						<TabsContent value="extension" className="w-full max-w-full overflow-hidden">
							<div className="space-y-4 py-4">
								<p className="text-muted-foreground text-sm">Login using your Nostr browser extension (e.g., Alby, nos2x).</p>
								{extensionError && (
									<div className="bg-red-50 px-4 py-3 border border-red-200 rounded text-red-700 text-sm" role="alert">
										<p className="font-medium">Login Failed</p>
										<p>{extensionError}</p>
									</div>
								)}
								<Button onClick={onConnectExtension} className="w-full" data-testid="connect-extension-button">
									Connect to Extension
								</Button>
							</div>
						</TabsContent>
					</Tabs>
					<div className="flex items-center space-x-2">
						<Label htmlFor="auto-login" className="flex items-center gap-2 text-muted-foreground text-sm">
							<Checkbox
								id="auto-login"
								checked={autoLogin}
								onCheckedChange={(checked) => onAutoLoginChange(checked === true)}
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
