import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'

export type PrivateKeyLoginStep = 'stored-key' | 'set-password' | 'enter-key'

export interface PrivateKeyLoginViewProps {
	step: PrivateKeyLoginStep
	isLoading: boolean
	storedPubkey: string | null
	privateKey: string
	onPrivateKeyChange: (value: string) => void
	keyError: string | null
	password: string
	onPasswordChange: (value: string) => void
	confirmPassword: string
	onConfirmPasswordChange: (value: string) => void
	passwordError: string
	/** A freshly generated key must be acknowledged as saved before continuing. */
	isGeneratedKey: boolean
	onGenerateKey: () => void
	onContinue: () => void
	onEncryptAndStore: () => void
	onStoredKeyLogin: () => void
	onClearStoredKey: () => void
}

function Divider() {
	return (
		<div className="flex items-center my-4">
			<div className="flex-grow h-px bg-muted"></div>
			<span className="px-2 text-xs text-muted-foreground">OR</span>
			<div className="flex-grow h-px bg-muted"></div>
		</div>
	)
}

export function PrivateKeyLoginView(props: PrivateKeyLoginViewProps) {
	const { step, isLoading, privateKey, isGeneratedKey } = props
	const [showPrivateKey, setShowPrivateKey] = useState(false)
	const [acknowledgedWarning, setAcknowledgedWarning] = useState(false)
	const [copied, setCopied] = useState(false)
	const privateKeyInputRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!showPrivateKey) return
		const handleClickOutside = (event: MouseEvent) => {
			if (privateKeyInputRef.current && !privateKeyInputRef.current.contains(event.target as Node)) {
				setShowPrivateKey(false)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [showPrivateKey])

	const handleCopyToClipboard = async () => {
		if (!privateKey) return
		try {
			await navigator.clipboard.writeText(privateKey)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy to clipboard:', error)
		}
	}

	if (step === 'stored-key') {
		return (
			<div className="space-y-4 py-4 w-full max-w-full overflow-hidden">
				<div className="space-y-2 max-w-full">
					<Label htmlFor="stored-password">Enter Password</Label>
					<p className="text-sm text-muted-foreground">Enter your password to decrypt your stored private key.</p>
					<p className="text-sm font-medium">Pubkey: {props.storedPubkey ? `${props.storedPubkey.slice(0, 8)}...` : 'Unknown'}</p>
					<Input
						id="stored-password"
						type="password"
						placeholder="Password"
						value={props.password}
						onChange={(e) => props.onPasswordChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && props.password) props.onStoredKeyLogin()
						}}
						data-testid="stored-password-input"
					/>
					{props.passwordError && <p className="text-sm text-red-500">{props.passwordError}</p>}
				</div>
				<Button onClick={props.onStoredKeyLogin} disabled={isLoading} className="w-full" data-testid="stored-key-login-button">
					{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Login'}
				</Button>

				<Divider />

				<Button onClick={props.onClearStoredKey} variant="outline" className="w-full" data-testid="clear-stored-key-button">
					Remove Stored Key & Continue Anonymously
				</Button>
			</div>
		)
	}

	if (step === 'set-password') {
		return (
			<div className="space-y-4 py-4 w-full max-w-full overflow-hidden">
				<div className="space-y-2 max-w-full">
					<Label htmlFor="password">Set Password</Label>
					<p className="text-sm text-muted-foreground">Set a password to encrypt your private key.</p>
					<Input
						id="password"
						type="password"
						placeholder="Password"
						value={props.password}
						onChange={(e) => props.onPasswordChange(e.target.value)}
						data-testid="new-password-input"
					/>
					<Input
						id="confirm-password"
						type="password"
						placeholder="Confirm Password"
						value={props.confirmPassword}
						onChange={(e) => props.onConfirmPasswordChange(e.target.value)}
						data-testid="confirm-password-input"
					/>
					{props.passwordError && <p className="text-sm text-red-500">{props.passwordError}</p>}
				</div>
				<Button onClick={props.onEncryptAndStore} disabled={isLoading} className="w-full" data-testid="encrypt-continue-button">
					{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Encrypt & Continue'}
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-4 py-4 w-full max-w-full overflow-hidden">
			<div className="space-y-2 max-w-full">
				<div className="flex justify-between items-center gap-2 flex-wrap">
					<Label htmlFor="private-key">Private Key (nsec or hex)</Label>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							props.onGenerateKey()
							setShowPrivateKey(true)
						}}
						data-testid="generate-key-button"
					>
						Generate New Key
					</Button>
				</div>
				<div className="relative max-w-full" ref={privateKeyInputRef}>
					<Input
						id="private-key"
						type={showPrivateKey ? 'text' : 'password'}
						placeholder="nsec1... or 64-char hex"
						value={privateKey}
						onChange={(e) => props.onPrivateKeyChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') props.onContinue()
						}}
						className={`pr-20 min-w-0 ${props.keyError ? 'border-red-500 focus-visible:ring-red-500' : ''} ${showPrivateKey ? 'text-red-500' : ''}`}
						data-testid="private-key-input"
					/>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={`absolute right-10 top-0 h-full px-3 py-2 hover:bg-transparent ${isGeneratedKey && !copied ? 'animate-pulse' : ''}`}
						onClick={handleCopyToClipboard}
						data-testid="copy-private-key-button"
						title={copied ? 'Copied!' : 'Copy to clipboard'}
					>
						<Copy className={`h-4 w-4 ${copied ? 'text-green-500' : isGeneratedKey ? 'text-red-500' : 'text-gray-500'}`} />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
						onClick={() => setShowPrivateKey(!showPrivateKey)}
						data-testid="toggle-private-key-visibility"
					>
						{showPrivateKey ? <EyeOff className="h-4 w-4 text-gray-500" /> : <Eye className="h-4 w-4 text-gray-500" />}
					</Button>
				</div>

				{props.keyError && (
					<div className="flex items-center gap-2 text-sm text-red-500">
						<span>{props.keyError}</span>
					</div>
				)}

				{isGeneratedKey && (
					<div className="space-y-2">
						<p className="text-sm text-red-500 font-medium">⚠️ Copy this text and save it somewhere safe, it cannot be recovered.</p>
						<p className="text-sm text-red-500 font-medium">It is the key to your new nostr identity.</p>
						<div className="flex items-start space-x-2">
							<input
								type="checkbox"
								id="acknowledge-warning"
								checked={acknowledgedWarning}
								onChange={(e) => setAcknowledgedWarning(e.target.checked)}
								className="mt-1"
								data-testid="acknowledge-warning-checkbox"
							/>
							<label htmlFor="acknowledge-warning" className="text-sm cursor-pointer">
								I have saved my private key securely
							</label>
						</div>
					</div>
				)}
			</div>
			<Button
				onClick={props.onContinue}
				disabled={isLoading || !privateKey || (isGeneratedKey && !acknowledgedWarning)}
				className="w-full"
				data-testid="continue-button"
			>
				{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue'}
			</Button>
		</div>
	)
}
