import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_NIP46_RELAYS } from '@/lib/constants'
import { authActions } from '@/lib/stores/auth'
import {
	buildBunkerUrlFromResolvedRelayUrls,
	buildNostrConnectUrlFromResolvedRelayUrls,
	getNip46RelayUrls,
	isApprovedNostrConnectResponse,
} from '@/lib/nostr/nip46'
import { copyToClipboard } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { CopyIcon, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'

interface NostrConnectQRProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

export function NostrConnectQR({ onError, onSuccess }: NostrConnectQRProps) {
	const { data: config, isLoading, isError } = useConfigQuery()

	const [localSigner, setLocalSigner] = useState<NDKPrivateKeySigner | null>(null)
	const [localPubkey, setLocalPubkey] = useState<string | null>(null)
	const [listening, setListening] = useState(false)
	const [generatingConnectionUrl, setGeneratingConnectionUrl] = useState(false)
	const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
	const [selectedRelay, setSelectedRelay] = useState(DEFAULT_NIP46_RELAYS[0].value)
	const [customRelay, setCustomRelay] = useState('')
	const isCustomRelay = selectedRelay === 'custom'
	const activeRelay = isCustomRelay ? customRelay : selectedRelay

	// Generate secret once and keep it stable
	const tempSecretRef = useRef<string>(Math.random().toString(36).substring(2, 15))
	const tempSecret = tempSecretRef.current

	const isLoggingInRef = useRef(false)
	const activeSubscriptionRef = useRef<any>(null)
	const isMountedRef = useRef(true)
	const hasTriggeredSuccessRef = useRef(false)
	const hasAppliedConfigRelayRef = useRef(false)
	const nip46NdkRef = useRef<NDK | null>(null)

	const cleanup = useCallback((preserveLoggingIn = false) => {
		if (!preserveLoggingIn) {
			isLoggingInRef.current = false
		}

		if (activeSubscriptionRef.current) {
			try {
				activeSubscriptionRef.current.stop()
			} catch (e) {
				console.error('Error stopping subscription:', e)
			}
			activeSubscriptionRef.current = null
		}

		// Clean up the NIP-46 NDK instance
		if (nip46NdkRef.current) {
			try {
				nip46NdkRef.current = null
			} catch (e) {
				console.error('Error cleaning up NIP-46 NDK:', e)
			}
		}

		if (isMountedRef.current) {
			setListening(false)
		}
	}, [])

	useEffect(() => {
		isMountedRef.current = true

		return () => {
			isMountedRef.current = false
			cleanup()
		}
	}, [cleanup])

	useEffect(() => {
		setGeneratingConnectionUrl(true)
		const signer = NDKPrivateKeySigner.generate()
		setLocalSigner(signer)

		signer
			.user()
			.then((user) => {
				if (!isMountedRef.current) return
				setLocalPubkey(user.pubkey)
				setGeneratingConnectionUrl(false)
			})
			.catch((err) => {
				console.error('Failed to get user pubkey:', err)
				if (!isMountedRef.current) return
				setConnectionStatus('error')
				onError?.('Failed to initialize connection')
			})
	}, [])

	useEffect(() => {
		const configuredRelay = config?.nip46Relay?.trim()
		if (!configuredRelay || hasAppliedConfigRelayRef.current) return

		hasAppliedConfigRelayRef.current = true

		if (DEFAULT_NIP46_RELAYS.some((relay) => relay.value === configuredRelay)) {
			setSelectedRelay(configuredRelay)
			return
		}

		setSelectedRelay('custom')
		setCustomRelay(configuredRelay)
	}, [config?.nip46Relay])

	const explicitRelayUrls = useMemo(() => {
		if (!config) return []
		if (isCustomRelay && !customRelay.trim()) return []
		if (!activeRelay.trim()) return []

		return getNip46RelayUrls(activeRelay)
	}, [activeRelay, config, customRelay, isCustomRelay])

	const connectionUrl = useMemo(() => {
		if (!localPubkey || !config) return null
		if (isCustomRelay && !customRelay) return null
		if (explicitRelayUrls.length === 0) return null

		return buildNostrConnectUrlFromResolvedRelayUrls(localPubkey, explicitRelayUrls, tempSecret, {
			name: 'Plebeian.market',
			url: window.location.origin,
			icons: [`${window.location.origin}/images/logo.svg`],
		})
	}, [localPubkey, config, tempSecret, isCustomRelay, customRelay, explicitRelayUrls])

	const constructBunkerUrl = useCallback(
		(event: NDKEvent) => buildBunkerUrlFromResolvedRelayUrls(event.pubkey, explicitRelayUrls, tempSecret),
		[explicitRelayUrls, tempSecret],
	)

	const triggerSuccess = useCallback(() => {
		if (hasTriggeredSuccessRef.current) {
			return
		}

		hasTriggeredSuccessRef.current = true
		cleanup()

		isMountedRef.current = false

		if (onSuccess) {
			setTimeout(() => {
				onSuccess()
			}, 0)
		}
	}, [cleanup, onSuccess])

	const handleLoginWithNip46Signer = useCallback(
		async (event: NDKEvent) => {
			if (isLoggingInRef.current || !isMountedRef.current || hasTriggeredSuccessRef.current) {
				return
			}

			try {
				isLoggingInRef.current = true
				cleanup(true)

				const bunkerUrl = constructBunkerUrl(event)
				if (!localSigner) {
					throw new Error('No local signer available')
				}

				setConnectionStatus('connected')
				await authActions.loginWithNip46(bunkerUrl, localSigner)

				triggerSuccess()
			} catch (err) {
				console.error('NIP-46 login error:', err)

				if (isMountedRef.current) {
					setConnectionStatus('error')
					if (onError) {
						onError(err instanceof Error ? err.message : 'Connection error')
					}
				}

				isLoggingInRef.current = false
			}
		},
		[localSigner, constructBunkerUrl, cleanup, triggerSuccess, onError],
	)

	useEffect(() => {
		if (
			!localPubkey ||
			!localSigner ||
			!connectionUrl ||
			isLoggingInRef.current ||
			hasTriggeredSuccessRef.current ||
			!isMountedRef.current ||
			!config
		) {
			return
		}

		let timeout: ReturnType<typeof setTimeout> | undefined
		let disposed = false

		const initNip46Connection = async () => {
			setListening(true)
			setConnectionStatus('connecting')

			const ndk = new NDK({
				explicitRelayUrls: explicitRelayUrls,
			})

			nip46NdkRef.current = ndk

			try {
				await ndk.connect()
			} catch (error) {
				if (disposed) return
				console.error('[NIP46] failed to connect to relays', { explicitRelayUrls, error })
				setConnectionStatus('error')
				if (onError) onError('Failed to connect to NIP-46 relay')
				return
			}

			if (disposed) return

			const processedRequestIds = new Set<string>()
			const processedResponseIds = new Set<string>()
			const approvedSignerPubkeys = new Set<string>()
			const relaySet = NDKRelaySet.fromRelayUrls(explicitRelayUrls, ndk)

			const sub = ndk.subscribe(
				{
					kinds: [NDKKind.NostrConnect],
					'#p': [localPubkey],
				},
				{ closeOnEose: false },
				relaySet,
			)

			activeSubscriptionRef.current = sub

			sub.on('event', async (event: NDKEvent) => {
				if (isLoggingInRef.current || !isMountedRef.current || hasTriggeredSuccessRef.current) {
					return
				}

				try {
					await event.decrypt(undefined, localSigner)
					const request = JSON.parse(event.content)

					if (request.method === 'connect') {
						if (request.id && processedRequestIds.has(request.id)) {
							return
						}

						if (request.id) {
							processedRequestIds.add(request.id)
						}

						const connectSecret = Array.isArray(request.params) ? request.params[0] : (request.params?.secret ?? request.params?.token)

						if (connectSecret === tempSecret) {
							approvedSignerPubkeys.add(event.pubkey)

							const response = {
								id: request.id,
								result: tempSecret,
							}

							const responseEvent = new NDKEvent(ndk)
							responseEvent.kind = NDKKind.NostrConnect
							responseEvent.tags = [['p', event.pubkey]]
							responseEvent.content = JSON.stringify(response)

							try {
								// Encrypt BEFORE signing — signing computes the event ID
								// from the content, so the content must be final (encrypted).
								// @ts-ignore - The NDK API requires a string pubkey here despite type definitions
								await responseEvent.encrypt(undefined, localSigner, event.pubkey)
								await responseEvent.sign(localSigner)
								await responseEvent.publish(relaySet)
								await handleLoginWithNip46Signer(event)
							} catch (err) {
								console.error('Error sending NIP-46 approval:', err)
								if (isMountedRef.current && !hasTriggeredSuccessRef.current) {
									setConnectionStatus('error')
									if (onError) onError(err instanceof Error ? err.message : 'Error sending approval')
								}
							}
						}
					} else if (isApprovedNostrConnectResponse(request.result, tempSecret, event.pubkey, approvedSignerPubkeys)) {
						if (processedResponseIds.has(event.id)) {
							return
						}

						processedResponseIds.add(event.id)
						await handleLoginWithNip46Signer(event)
					}
				} catch (error) {
					console.error('Failed to process NIP-46 event:', error)
					if (isMountedRef.current && !hasTriggeredSuccessRef.current) {
						setConnectionStatus('error')
						if (onError) onError(error instanceof Error ? error.message : 'Failed to process event')
					}
				}
			})

			timeout = setTimeout(() => {
				if (isMountedRef.current && !hasTriggeredSuccessRef.current && !isLoggingInRef.current) {
					cleanup()
					setConnectionStatus('error')
					if (onError) onError('Connection timed out. Please try again.')
				}
			}, 300000) // 5 minutes
		}

		const cleanupPromise = initNip46Connection()

		return () => {
			disposed = true
			if (timeout) clearTimeout(timeout)
			cleanup()
			void cleanupPromise.catch((error) => {
				console.error('Failed to clean up NIP-46 connection:', error)
			})
		}
	}, [connectionUrl, localPubkey, localSigner, tempSecret, config, onError, handleLoginWithNip46Signer, cleanup, explicitRelayUrls])

	return (
		<div className="flex flex-col items-center gap-4 py-4 w-full max-w-full overflow-hidden">
			{connectionStatus === 'error' && (
				<div className="bg-destructive/10 text-destructive rounded p-2 mb-2 text-sm w-full">Connection failed. Please try again.</div>
			)}

			<div className="w-full space-y-2">
				<label className="text-sm font-medium">Relay</label>
				<Select value={selectedRelay} onValueChange={setSelectedRelay}>
					<SelectTrigger className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{DEFAULT_NIP46_RELAYS.map((relay) => (
							<SelectItem key={relay.value} value={relay.value}>
								{relay.label}
							</SelectItem>
						))}
						<SelectItem value="custom">Custom relay...</SelectItem>
					</SelectContent>
				</Select>
				{isCustomRelay && <Input placeholder="wss://..." value={customRelay} onChange={(e) => setCustomRelay(e.target.value)} />}
			</div>

			{generatingConnectionUrl ? (
				<div className="flex flex-col items-center gap-2 py-8">
					<Loader2 className="h-8 w-8 animate-spin" />
					<p className="text-sm text-muted-foreground">Generating connection...</p>
				</div>
			) : connectionStatus === 'connected' ? (
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
						{listening && (
							<div className="flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								<span className="text-sm">Waiting for approval...</span>
							</div>
						)}
					</div>

					<div className="flex items-center gap-2 w-full min-w-0">
						<Input value={connectionUrl} readOnly onClick={(e) => e.currentTarget.select()} className="min-w-0" />
						<Button variant="outline" size="icon" className="shrink-0" onClick={() => copyToClipboard(connectionUrl)}>
							<CopyIcon className="h-4 w-4" />
						</Button>
					</div>
				</>
			) : (
				<div className="flex flex-col items-center gap-2 py-8">
					<Loader2 className="h-8 w-8 animate-spin" />
					<p className="text-sm text-muted-foreground">Initializing connection...</p>
				</div>
			)}
		</div>
	)
}
