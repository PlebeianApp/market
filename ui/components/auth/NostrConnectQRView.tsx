import { CopyIcon, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../primitives/select'

export const CUSTOM_RELAY_OPTION = 'custom'

export interface NostrConnectQRViewProps {
	relays: readonly { value: string; label: string }[]
	selectedRelay: string
	onRelayChange: (relay: string) => void
	customRelay: string
	onCustomRelayChange: (relay: string) => void
	isGenerating: boolean
	isConnected: boolean
	hasError: boolean
	isListening: boolean
	/** `nostrconnect://` URI; null until the local signer and relay are ready. */
	connectionUrl: string | null
	onCopyConnectionUrl: (url: string) => void
}

function Spinner({ label }: { label: string }) {
	return (
		<div className="flex flex-col items-center gap-2 py-8">
			<Loader2 className="h-8 w-8 animate-spin" />
			<p className="text-sm text-muted-foreground">{label}</p>
		</div>
	)
}

export function NostrConnectQRView({
	relays,
	selectedRelay,
	onRelayChange,
	customRelay,
	onCustomRelayChange,
	isGenerating,
	isConnected,
	hasError,
	isListening,
	connectionUrl,
	onCopyConnectionUrl,
}: NostrConnectQRViewProps) {
	return (
		<div className="flex flex-col items-center gap-4 py-4 w-full max-w-full overflow-hidden">
			{hasError && (
				<div className="bg-destructive/10 text-destructive rounded p-2 mb-2 text-sm w-full">Connection failed. Please try again.</div>
			)}

			<div className="w-full space-y-2">
				<label className="text-sm font-medium">Relay</label>
				<Select value={selectedRelay} onValueChange={onRelayChange}>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{relays.map((relay) => (
							<SelectItem key={relay.value} value={relay.value}>
								{relay.label}
							</SelectItem>
						))}
						<SelectItem value={CUSTOM_RELAY_OPTION}>Custom relay...</SelectItem>
					</SelectContent>
				</Select>
				{selectedRelay === CUSTOM_RELAY_OPTION && (
					<Input placeholder="wss://..." value={customRelay} onChange={(e) => onCustomRelayChange(e.target.value)} />
				)}
			</div>

			{isGenerating ? (
				<Spinner label="Generating connection..." />
			) : isConnected ? (
				<div className="flex flex-col items-center gap-2 py-8">
					<div className="text-green-500 mb-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="36"
							height="36"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
							<polyline points="22 4 12 14.01 9 11.01" />
						</svg>
					</div>
					<p className="text-sm text-green-500 font-medium">Connected successfully!</p>
					<p className="text-sm text-muted-foreground">Logging you in...</p>
				</div>
			) : connectionUrl ? (
				<>
					<a
						href={connectionUrl}
						className="block hover:opacity-90 transition-opacity bg-white p-4 rounded-lg w-full max-w-[250px]"
						target="_blank"
						rel="noopener noreferrer"
					>
						<QRCodeSVG
							value={connectionUrl}
							className="w-full h-auto"
							bgColor="#ffffff"
							fgColor="#000000"
							level="L"
							includeMargin={false}
						/>
					</a>

					<div className="flex w-full items-center justify-center">
						{isListening && (
							<div className="flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								<span className="text-sm">Waiting for approval...</span>
							</div>
						)}
					</div>

					<div className="flex items-center gap-2 w-full min-w-0">
						<Input value={connectionUrl} readOnly onClick={(e) => e.currentTarget.select()} className="min-w-0" />
						<Button variant="outline" size="icon" className="shrink-0" onClick={() => onCopyConnectionUrl(connectionUrl)}>
							<CopyIcon className="h-4 w-4" />
						</Button>
					</div>
				</>
			) : (
				<Spinner label="Initializing connection..." />
			)}
		</div>
	)
}
