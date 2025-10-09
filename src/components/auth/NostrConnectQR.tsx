import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authActions } from '@/lib/stores/auth'
import { copyToClipboard } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
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

	// Generate secret once and keep it stable
	const tempSecretRef = useRef<string>(Math.random().toString(36).substring(2, 15))
	const tempSecret = tempSecretRef.current

	const isLoggingInRef = useRef(false)
	const activeSubscriptionRef = useRef<any>(null)
	const isMountedRef = useRef(true)
	const hasTriggeredSuccessRef = useRef(false)
	const nip46NdkRef = useRef<NDK | null>(null)

	const cleanup = useCallback(() => {
		if (!isMountedRef.current) return

		isLoggingInRef.current = false

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

		setListening(false)
	}, [])

	useEffect(() => {
		isMountedRef.current = true

		return () => {
			isMountedRef.current = false

			if (activeSubscriptionRef.current) {
				try {
					activeSubscriptionRef.current.stop()
				} catch (e) {
					console.error('Error stopping subscription:', e)
				}
				activeSubscriptionRef.current = null
			}
		}
	}, [])

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

	const connectionUrl = useMemo(() => {
		if (!localPubkey || !config) return null
		const relay = config.nip46Relay || 'wss://relay.nsec.app'

		const params = new URLSearchParams()
		params.set('relay', relay)
		params.set(
			'metadata',
			JSON.stringify({
				name: 'Plebeian.market',
				description: 'Connect with Plebeian.market',
				url: window.location.origin,
				icons: [],
			}),
		)
		params.set('token', tempSecret)

		return `nostrconnect://${localPubkey}?` + params.toString()
	}, [localPubkey, config, tempSecret])

	const constructBunkerUrl = useCallback(
		(event: NDKEvent) => {
			const baseUrl = `bunker://${event.pubkey}?`
			const relay = config?.nip46Relay || 'wss://relay.nsec.app'

			const params = new URLSearchParams()
			params.set('relay', relay)
			params.set('secret', tempSecret)

			return baseUrl + params.toString()
		},
		[config, tempSecret],
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
				cleanup()

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

		const initNip46Connection = async () => {
			setListening(true)
			setConnectionStatus('connecting')

			// Create a dedicated NDK instance connected to the NIP-46 relay
			const nip46Relay = config.nip46Relay || 'wss://relay.nsec.app'

			const ndk = new NDK({
				explicitRelayUrls: [nip46Relay],
			})

			nip46NdkRef.current = ndk

			try {
				await ndk.connect()
			} catch (error) {
				console.error('Failed to connect to NIP-46 relay:', error)
				setConnectionStatus('error')
				if (onError) onError('Failed to connect to NIP-46 relay')
				return
			}

			const processedRequestIds = new Set<string>()
			const processedAckIds = new Set<string>()

			const sub = ndk.subscribe(
				{
					kinds: [NDKKind.NostrConnect],
					'#p': [localPubkey],
				},
				{ closeOnEose: false },
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

						if (request.params && request.params.token === tempSecret) {
							const response = {
								id: request.id,
								result: tempSecret,
							}

							const responseEvent = new NDKEvent(ndk)
							responseEvent.kind = NDKKind.NostrConnect
							responseEvent.tags = [['p', event.pubkey]]
							responseEvent.content = JSON.stringify(response)

							try {
								await responseEvent.sign(localSigner)
								// @ts-ignore - The NDK API requires a string pubkey here despite type definitions
								await responseEvent.encrypt(undefined, localSigner, event.pubkey)
								await responseEvent.publish()
							} catch (err) {
								console.error('Error sending NIP-46 approval:', err)
								if (isMountedRef.current && !hasTriggeredSuccessRef.current) {
									setConnectionStatus('error')
									if (onError) onError(err instanceof Error ? err.message : 'Error sending approval')
								}
							}
						}
					} else if (request.result === 'ack') {
						if (processedAckIds.has(event.id)) {
							return
						}

						processedAckIds.add(event.id)
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

			const timeout = setTimeout(() => {
				if (isMountedRef.current && !hasTriggeredSuccessRef.current && connectionStatus !== 'connected' && !isLoggingInRef.current) {
					cleanup()
					setConnectionStatus('error')
					if (onError) onError('Connection timed out. Please try again.')
				}
			}, 300000) // 5 minutes

			return () => {
				clearTimeout(timeout)
				cleanup()
			}
		}

		initNip46Connection()
	}, [connectionUrl, localPubkey, localSigner, tempSecret, config, onError, handleLoginWithNip46Signer, cleanup])

	return (
		<div className="flex flex-col items-center gap-4 py-4">
			{connectionStatus === 'error' && (
				<div className="bg-destructive/10 text-destructive rounded p-2 mb-2 text-sm w-full">Connection failed. Please try again.</div>
			)}

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
						className="block hover:opacity-90 transition-opacity bg-white p-4 rounded-lg"
						target="_blank"
						rel="noopener noreferrer"
					>
						<QRCodeSVG value={connectionUrl} size={250} bgColor="#ffffff" fgColor="#000000" level="L" includeMargin={false} />
					</a>

					<div className="flex w-full items-center justify-center">
						{listening && (
							<div className="flex items-center gap-2">
								<Loader2 className="h-4 w-4 animate-spin" />
								<span className="text-sm">Waiting for approval...</span>
							</div>
						)}
					</div>

					<div className="flex items-center gap-2 w-full">
						<Input value={connectionUrl} readOnly onClick={(e) => e.currentTarget.select()} />
						<Button variant="outline" size="icon" onClick={() => copyToClipboard(connectionUrl)}>
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
