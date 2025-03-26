import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authActions } from '@/lib/stores/auth'
import { ndkActions } from '@/lib/stores/ndk'
import { useConfigQuery } from '@/queries/config'
import { NDKEvent, NDKKind, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { CopyIcon, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface NostrConnectQRProps {
	onError?: (error: string) => void
	onSuccess?: () => void
}

let globalLoginInProgress = false

export function NostrConnectQR({ onError, onSuccess }: NostrConnectQRProps) {
	const { data: config, isLoading, isError } = useConfigQuery()

	const [localSigner, setLocalSigner] = useState<NDKPrivateKeySigner | null>(null)
	const [localPubkey, setLocalPubkey] = useState<string | null>(null)
	const [tempSecret, setTempSecret] = useState<string | null>(null)
	const [listening, setListening] = useState(false)
	const [generatingConnectionUrl, setGeneratingConnectionUrl] = useState(false)
	const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')

	const isLoggingInRef = useRef(false)
	const activeSubscriptionRef = useRef<any>(null)
	const isMountedRef = useRef(true)
	const hasTriggeredSuccessRef = useRef(false)

	useEffect(() => {
		if (!document.querySelector('[data-nostr-connect-active="true"]')) {
			globalLoginInProgress = false
		}

		isMountedRef.current = true
		document.body.setAttribute('data-nostr-connect-active', 'true')

		return () => {
			isMountedRef.current = false
			document.body.removeAttribute('data-nostr-connect-active')

			if (activeSubscriptionRef.current) {
				console.log('Final cleanup on unmount')
				try {
					activeSubscriptionRef.current.stop()
				} catch (e) {
					console.error('Error stopping subscription:', e)
				}
				activeSubscriptionRef.current = null
			}
		}
	}, [])

	const cleanup = () => {
		if (!isMountedRef.current) return

		console.log('Running cleanup')
		isLoggingInRef.current = false

		if (activeSubscriptionRef.current) {
			console.log('Cleaning up subscription')
			try {
				activeSubscriptionRef.current.stop()
			} catch (e) {
				console.error('Error stopping subscription:', e)
			}
			activeSubscriptionRef.current = null
		}

		setListening(false)
	}

	useEffect(() => {
		if (globalLoginInProgress) {
			console.log('Global login already in progress, skipping initialization')
			return
		}

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
		if (!localPubkey) return null
		const relay = config?.appRelay || 'ws://localhost:10547'
		const secret = Math.random().toString(36).substring(2, 15)

		setTempSecret(secret)

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
		params.set('token', secret)

		return `nostrconnect://${localPubkey}?` + params.toString()
	}, [localPubkey])

	const constructBunkerUrl = (event: NDKEvent) => {
		const baseUrl = `bunker://${event.pubkey}?`
		const relay = config?.appRelay || 'ws://localhost:10547'

		const params = new URLSearchParams()
		params.set('relay', relay)
		params.set('secret', tempSecret ?? '')

		return baseUrl + params.toString()
	}

	const triggerSuccess = () => {
		if (hasTriggeredSuccessRef.current) {
			return
		}

		console.log('triggerSuccess')

		hasTriggeredSuccessRef.current = true
		cleanup()

		isMountedRef.current = false
		globalLoginInProgress = false

		if (onSuccess) {
			setTimeout(() => {
				onSuccess()
			}, 0)
		}
	}

	const handleLoginWithNip46Signer = async (event: NDKEvent) => {
		if (globalLoginInProgress || isLoggingInRef.current || !isMountedRef.current || hasTriggeredSuccessRef.current) {
			console.log('Login already in progress or component unmounted, skipping duplicate login attempt')
			return
		}

		try {
			globalLoginInProgress = true
			isLoggingInRef.current = true
			cleanup()

			const bunkerUrl = constructBunkerUrl(event)
			if (!localSigner) {
				throw new Error('No local signer available')
			}

			if (!tempSecret) {
				throw new Error('No temporary secret available')
			}

			console.log('bunkerUrl', bunkerUrl)

			setConnectionStatus('connected')
			await authActions.loginWithNip46(bunkerUrl, localSigner)

			triggerSuccess()
		} catch (err) {
			console.error('Error in login flow:', err)

			if (isMountedRef.current) {
				setConnectionStatus('error')
				if (onError) {
					onError(err instanceof Error ? err.message : 'Connection error')
				}
			}

			isLoggingInRef.current = false
			globalLoginInProgress = false
		}
	}

	useEffect(() => {
		if (
			!localPubkey ||
			!localSigner ||
			!connectionUrl ||
			isLoggingInRef.current ||
			globalLoginInProgress ||
			hasTriggeredSuccessRef.current ||
			!isMountedRef.current
		) {
			return
		}

		console.log('Starting subscription for pubkey:', localPubkey)
		setListening(true)
		setConnectionStatus('connecting')

		const ndk = ndkActions.getNDK()
		if (!ndk) {
			console.error('NDK not initialized')
			setConnectionStatus('error')
			if (onError) onError('NDK not initialized')
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

		sub.on('event', async (event) => {
			if (globalLoginInProgress || isLoggingInRef.current || !isMountedRef.current || hasTriggeredSuccessRef.current) {
				console.log('Login in progress or component unmounted, ignoring event')
				return
			}

			try {
				await event.decrypt(undefined, localSigner)
				const request = JSON.parse(event.content)

				if (request.method === 'connect') {
					if (request.id && processedRequestIds.has(request.id)) {
						console.log('Skipping already processed connect request:', request.id)
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

							console.log('Connection approved, waiting for ACK response')
						} catch (err) {
							console.error('Error sending approval:', err)
							if (isMountedRef.current && !hasTriggeredSuccessRef.current) {
								setConnectionStatus('error')
								if (onError) onError(err instanceof Error ? err.message : 'Error sending approval')
							}
						}
					} else {
						console.log('Token mismatch:', request.params?.token, tempSecret)
					}
				} else if (request.result === 'ack') {
					if (processedAckIds.has(event.id)) {
						console.log('Skipping already processed ACK:', event.id)
						return
					}

					processedAckIds.add(event.id)

					console.log('Received ACK response, processing login...')
					await handleLoginWithNip46Signer(event)
				}
			} catch (error) {
				console.error('Failed to process event:', error)
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
	}, [connectionUrl, localPubkey, localSigner, onError, onSuccess, tempSecret])

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text).catch((err) => {
			console.warn('Failed to copy:', err)
		})
	}

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
