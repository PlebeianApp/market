import { DEFAULT_NIP46_RELAYS } from '@/lib/constants'
import { authActions } from '@/lib/stores/auth'
import { copyToClipboard } from '@/lib/utils'
import { useConfigQuery } from '@/queries/config'
import NDK, { NDKEvent, NDKKind, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { CUSTOM_RELAY_OPTION, NostrConnectQRView } from '@ui/components/auth/NostrConnectQRView'

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
	const isCustomRelay = selectedRelay === CUSTOM_RELAY_OPTION
	const activeRelay = isCustomRelay ? customRelay : selectedRelay

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
		if (isCustomRelay && !customRelay) return null

		const params = new URLSearchParams()
		params.set('relay', activeRelay)
		params.set(
			'metadata',
			JSON.stringify({
				name: config.displayName || config.name,
				description: `Connect with ${config.displayName || config.name}`,
				url: config.siteUrl || window.location.origin,
				icons: config.picture ? [config.picture] : [],
			}),
		)
		params.set('token', tempSecret)

		return `nostrconnect://${localPubkey}?` + params.toString()
	}, [localPubkey, config, tempSecret, activeRelay, isCustomRelay, customRelay])

	const constructBunkerUrl = useCallback(
		(event: NDKEvent) => {
			const baseUrl = `bunker://${event.pubkey}?`

			const params = new URLSearchParams()
			params.set('relay', activeRelay)
			params.set('secret', tempSecret)

			return baseUrl + params.toString()
		},
		[activeRelay, tempSecret],
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

			const ndk = new NDK({
				explicitRelayUrls: [activeRelay],
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
								// Encrypt BEFORE signing — signing computes the event ID
								// from the content, so the content must be final (encrypted).
								// @ts-ignore - The NDK API requires a string pubkey here despite type definitions
								await responseEvent.encrypt(undefined, localSigner, event.pubkey)
								await responseEvent.sign(localSigner)
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
	}, [connectionUrl, localPubkey, localSigner, tempSecret, config, onError, handleLoginWithNip46Signer, cleanup, activeRelay])

	return (
		<NostrConnectQRView
			relays={DEFAULT_NIP46_RELAYS}
			selectedRelay={selectedRelay}
			onRelayChange={setSelectedRelay}
			customRelay={customRelay}
			onCustomRelayChange={setCustomRelay}
			isGenerating={generatingConnectionUrl}
			isConnected={connectionStatus === 'connected'}
			hasError={connectionStatus === 'error'}
			isListening={listening}
			connectionUrl={connectionUrl}
			onCopyConnectionUrl={(url) => copyToClipboard(url)}
		/>
	)
}
