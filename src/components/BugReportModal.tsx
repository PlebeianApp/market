import { Button } from '@/components/ui/button'
import { BLOSSOM_SERVERS, uploadFileToBlossom } from '@/lib/blossom'
import { ndkActions } from '@/lib/stores/ndk'
import { cn } from '@/lib/utils'
import { bugReportKeys } from '@/queries/bugReports'
import { useQueryClient } from '@tanstack/react-query'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BugReportsList } from './BugReportsList'

// Check for staging environment
const isStaging =
	(typeof process !== 'undefined' && process.env?.STAGING === 'true') ||
	(typeof import.meta !== 'undefined' && import.meta.env?.STAGING === 'true')

interface BugReportModalProps {
	isOpen: boolean
	onClose: () => void
}

export function BugReportModal({ isOpen, onClose }: BugReportModalProps) {
	const queryClient = useQueryClient()
	const [activeTab, setActiveTab] = useState<'report' | 'viewer'>('report')
	const [bugReport, setBugReport] = useState(
		'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
	)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const [isUploading, setIsUploading] = useState(false)
	const [isSending, setIsSending] = useState(false)
	const [sendStatus, setSendStatus] = useState<'idle' | 'success' | 'error'>('idle')
	const [hasAutoPopulated, setHasAutoPopulated] = useState(false)
	const [isDragOver, setIsDragOver] = useState(false)
	const [uploadedImages, setUploadedImages] = useState<string[]>([])

	// Prevent body scrolling when modal is open
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden'
		} else {
			document.body.style.overflow = 'unset'
		}

		// Cleanup on unmount
		return () => {
			document.body.style.overflow = 'unset'
		}
	}, [isOpen])

	// Gather system information from browser
	const getSystemInfo = () => {
		const info = {
			userAgent: navigator.userAgent,
			platform: navigator.platform,
			language: navigator.language,
			languages: navigator.languages?.join(', '),
			cookieEnabled: navigator.cookieEnabled,
			onLine: navigator.onLine,
			screenResolution: `${screen.width}x${screen.height}`,
			screenColorDepth: screen.colorDepth,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			viewportSize: `${window.innerWidth}x${window.innerHeight}`,
			devicePixelRatio: window.devicePixelRatio,
			touchSupport: 'ontouchstart' in window,
			webglSupport: !!document.createElement('canvas').getContext('webgl'),
			webgl2Support: !!document.createElement('canvas').getContext('webgl2'),
			serviceWorkerSupport: 'serviceWorker' in navigator,
			notificationSupport: 'Notification' in window,
			geolocationSupport: 'geolocation' in navigator,
			localStorageSupport: typeof Storage !== 'undefined',
			sessionStorageSupport: typeof Storage !== 'undefined',
		}

		return `Device: ${info.platform}
Operating System: ${info.userAgent.split('(')[1]?.split(')')[0] || 'Unknown'}
Browser: ${info.userAgent.split(' ').slice(-2).join(' ')}
Language: ${info.language} (${info.languages})
Screen Resolution: ${info.screenResolution}
Viewport Size: ${info.viewportSize}
Color Depth: ${info.screenColorDepth} bits
Device Pixel Ratio: ${info.devicePixelRatio}
Timezone: ${info.timezone}
Touch Support: ${info.touchSupport ? 'Yes' : 'No'}
WebGL Support: ${info.webglSupport ? 'Yes' : 'No'}
WebGL2 Support: ${info.webgl2Support ? 'Yes' : 'No'}
Service Worker: ${info.serviceWorkerSupport ? 'Yes' : 'No'}
Notifications: ${info.notificationSupport ? 'Yes' : 'No'}
Geolocation: ${info.geolocationSupport ? 'Yes' : 'No'}
Local Storage: ${info.localStorageSupport ? 'Yes' : 'No'}
Session Storage: ${info.sessionStorageSupport ? 'Yes' : 'No'}
Online: ${info.onLine ? 'Yes' : 'No'}
Cookies: ${info.cookieEnabled ? 'Enabled' : 'Disabled'}`
	}

	// Upload image to Blossom using the merged blossom upload code
	const uploadToBlossom = async (file: File) => {
		try {
			console.log('Uploading to Blossom using merged upload code...')

			// Use the merged blossom upload function
			const result = await uploadFileToBlossom(file, {
				preferredServer: BLOSSOM_SERVERS[0].url, // Use first available server
				onProgress: ({ loaded, total }) => {
					const pct = Math.round((loaded / total) * 100)
					console.log(`Upload progress: ${pct}%`)
				},
				maxRetries: 3,
			})

			console.log('Blossom upload successful:', result)
			return result
		} catch (error) {
			console.error('Blossom upload error:', error)
			throw error
		}
	}

	// Auto-populate system information when modal opens
	useEffect(() => {
		if (isOpen && !hasAutoPopulated) {
			const systemInfo = getSystemInfo()
			const systemInfoInsertText = 'What device and operating system are you using?\n\n'
			const systemInfoInsertIndex = bugReport.indexOf(systemInfoInsertText)

			if (systemInfoInsertIndex !== -1) {
				const beforeInsert = bugReport.substring(0, systemInfoInsertIndex + systemInfoInsertText.length)
				const afterInsert = bugReport.substring(systemInfoInsertIndex + systemInfoInsertText.length)
				const newText = beforeInsert + `${systemInfo}\n\n` + afterInsert
				setBugReport(newText)
				setHasAutoPopulated(true)
			}
		}
	}, [isOpen, hasAutoPopulated, bugReport])

	// Insert uploaded image URLs into the text
	const insertImageUrl = (imageUrl: string) => {
		const imageInsertText = 'Use the drag and drop or paste to add images of the problem.\n\n\n\n'
		const imageInsertIndex = bugReport.indexOf(imageInsertText)

		if (imageInsertIndex !== -1) {
			const beforeInsert = bugReport.substring(0, imageInsertIndex + imageInsertText.length)
			const afterInsert = bugReport.substring(imageInsertIndex + imageInsertText.length)

			// If this is the first image, insert it. If not, add it on a new line after existing images
			const existingImages = uploadedImages.length
			const imageText = existingImages === 0 ? `[Image: ${imageUrl}]\n\n` : `\n[Image: ${imageUrl}]\n\n`

			const newText = beforeInsert + imageText + afterInsert
			setBugReport(newText)
			setUploadedImages((prev) => [...prev, imageUrl])

			// Focus the textarea and position cursor after the inserted image
			setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.focus()
					const cursorPos = beforeInsert.length + imageText.length
					textareaRef.current.setSelectionRange(cursorPos, cursorPos)
				}
			}, 100)
		} else {
			// Fallback: insert at end if pattern not found
			const imageText = uploadedImages.length === 0 ? `\n[Image: ${imageUrl}]\n` : `\n[Image: ${imageUrl}]\n`

			const newText = bugReport + imageText
			setBugReport(newText)
			setUploadedImages((prev) => [...prev, imageUrl])

			setTimeout(() => {
				if (textareaRef.current) {
					textareaRef.current.focus()
					textareaRef.current.setSelectionRange(newText.length, newText.length)
				}
			}, 100)
		}
	}

	// Cleanup effect to reset states when modal closes
	useEffect(() => {
		if (!isOpen) {
			setActiveTab('report')
			setIsUploading(false)
			setIsSending(false)
			setSendStatus('idle')
			setHasAutoPopulated(false)
			setUploadedImages([])
			// Reset to default template for next time
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
		}
	}, [isOpen])


	const handleSend = async () => {
		if (isSending) return // Prevent double submission
		
		setIsSending(true)
		setSendStatus('idle')
		
		try {
			console.log('🐛 Starting bug report send with nostr-tools...')

			// Get relay URL
			const bugReportRelay = isStaging ? 'wss://relay.staging.plebeian.market' : 'wss://bugs.plebeian.market/'
			console.log('🐛 Using bug report relay:', bugReportRelay)

			// Get the main NDK instance to get the signer
			const mainNdk = ndkActions.getNDK()
			if (!mainNdk || !mainNdk.signer) {
				console.error('Main NDK not available or no signer')
				setSendStatus('error')
				throw new Error('Main NDK not available or no signer')
			}

			console.log('🐛 Main NDK signer type:', mainNdk.signer?.constructor?.name)

			// Create the event
			const eventTemplate = {
				kind: 1,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['t', 'plebian2beta']],
				content: bugReport,
			}

			console.log('🐛 Event template created:', {
				kind: eventTemplate.kind,
				contentLength: eventTemplate.content.length,
				tags: eventTemplate.tags,
			})

			// Sign the event using nostr-tools directly
			console.log('🐛 Signing event with nostr-tools...')
			let signedEvent
			try {
				// Get user info from NDK signer
				const user = await mainNdk.signer.user()
				const pubkey = user.pubkey
				
				console.log('🐛 Got user pubkey from signer:', pubkey)
				
				// Create event with pubkey
				const eventWithPubkey = {
					...eventTemplate,
					pubkey: pubkey,
				}
				
				console.log('🐛 Event template with pubkey:', {
					kind: eventWithPubkey.kind,
					contentLength: eventWithPubkey.content.length,
					tags: eventWithPubkey.tags,
					pubkey: eventWithPubkey.pubkey,
				})
				
				// Check if this is a private key signer (we can sign directly)
				if (mainNdk.signer.constructor.name === 'NDKPrivateKeySigner') {
					console.log('🐛 Using NDKPrivateKeySigner - signing with nostr-tools...')
					// Get the private key from the signer
					const privateKey = (mainNdk.signer as any).privateKey
					if (privateKey) {
						signedEvent = finalizeEvent(eventWithPubkey, privateKey)
						console.log('🐛 Event signed with private key signer')
					} else {
						throw new Error('Private key not available from NDKPrivateKeySigner')
					}
				} else {
					console.log('🐛 Using extension signer - falling back to NDK signing...')
					// For extension signers, we need to use NDK's signing method
					const ndkEvent = new (await import('@nostr-dev-kit/ndk')).NDKEvent(mainNdk, eventWithPubkey)
					await ndkEvent.sign()
					
					signedEvent = {
						...eventWithPubkey,
						id: ndkEvent.id!,
						pubkey: ndkEvent.pubkey!,
						sig: ndkEvent.sig!,
					}
					console.log('🐛 Event signed with extension signer')
				}
				
				console.log('🐛 Event signed successfully:', {
					id: signedEvent.id,
					pubkey: signedEvent.pubkey,
					sigLength: signedEvent.sig?.length,
				})
			} catch (signError) {
				console.error('🐛 Failed to sign event:', signError)
				throw new Error(`Failed to sign event: ${signError instanceof Error ? signError.message : String(signError)}`)
			}

			// Publish using direct WebSocket connection (more reliable in browser)
			console.log('🐛 Publishing event with direct WebSocket...')
			let publishSuccess = false
			let lastError: any = null
			const maxRetries = 3
			
			for (let attempt = 1; attempt <= maxRetries; attempt++) {
				try {
					console.log(`🐛 Publish attempt ${attempt}/${maxRetries} to ${bugReportRelay}...`)
					
					await new Promise<void>((resolve, reject) => {
						const ws = new WebSocket(bugReportRelay)
						let isResolved = false
						
						const cleanup = () => {
							if (ws.readyState === WebSocket.OPEN) {
								ws.close()
							}
						}
						
						const timeout = setTimeout(() => {
							if (!isResolved) {
								isResolved = true
								cleanup()
								reject(new Error('WebSocket connection timeout after 10 seconds'))
							}
						}, 10000)
						
						ws.onopen = () => {
							console.log(`🐛 WebSocket connected to ${bugReportRelay}`)
							
							// Send the EVENT message
							const eventMessage = JSON.stringify(['EVENT', signedEvent])
							console.log(`🐛 Sending EVENT message:`, eventMessage.substring(0, 200) + '...')
							ws.send(eventMessage)
						}
						
						ws.onmessage = (event) => {
							console.log(`🐛 Received message:`, event.data)
							
							try {
								const message = JSON.parse(event.data)
								
								// Check for OK response
								if (Array.isArray(message) && message[0] === 'OK') {
									const [, eventId, success, reason] = message
									
									if (success) {
										console.log(`🐛 Event published successfully! ID: ${eventId}`)
										if (!isResolved) {
											isResolved = true
											clearTimeout(timeout)
											cleanup()
											resolve()
										}
									} else {
										console.error(`🐛 Event rejected by relay: ${reason}`)
										if (!isResolved) {
											isResolved = true
											clearTimeout(timeout)
											cleanup()
											reject(new Error(`Event rejected: ${reason}`))
										}
									}
								}
								// Also handle NOTICE messages
								else if (Array.isArray(message) && message[0] === 'NOTICE') {
									console.log(`🐛 Relay notice: ${message[1]}`)
								}
							} catch (parseError) {
								console.error('🐛 Failed to parse relay message:', parseError)
							}
						}
						
						ws.onerror = (error) => {
							console.error(`🐛 WebSocket error:`, error)
							if (!isResolved) {
								isResolved = true
								clearTimeout(timeout)
								cleanup()
								reject(new Error('WebSocket connection error'))
							}
						}
						
						ws.onclose = (event) => {
							console.log(`🐛 WebSocket closed: code=${event.code}, reason=${event.reason}`)
							if (!isResolved) {
								isResolved = true
								clearTimeout(timeout)
								reject(new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`))
							}
						}
					})
					
					console.log(`🐛 Attempt ${attempt}: Event published successfully!`)
					publishSuccess = true
					break // Success, exit retry loop
					
				} catch (publishError) {
					lastError = publishError
					console.error(`🐛 Attempt ${attempt}: Publish failed:`, publishError)
					
					if (attempt < maxRetries) {
						console.log(`🐛 Retrying in 2 seconds... (${maxRetries - attempt} attempts remaining)`)
						await new Promise(resolve => setTimeout(resolve, 2000))
					}
				}
			}
			
			if (!publishSuccess) {
				console.error('🐛 All publish attempts failed')
				throw new Error(`Failed to publish event after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
			}

			// Log the event details for debugging
			console.log('🐛 Published event details:', {
				id: signedEvent.id,
				pubkey: signedEvent.pubkey,
				kind: signedEvent.kind,
				created_at: signedEvent.created_at,
				tags: signedEvent.tags,
				content: signedEvent.content.substring(0, 100) + '...',
			})

			// Wait a moment for the event to propagate to the relay
			console.log('🐛 Waiting for event propagation...')
			await new Promise(resolve => setTimeout(resolve, 2000))
			
			// Force refetch the bug reports to ensure we get the latest data
			console.log('🐛 Force refetching bug reports...')
			await queryClient.refetchQueries({ queryKey: bugReportKeys.all })
			
			setSendStatus('success')
			console.log('🐛 Bug report send completed successfully!')
			
			// Switch to viewer tab to show the new report
			console.log('🐛 Switching to report viewer...')
			setActiveTab('viewer')
			
			// Clear the input for next time
			setBugReport(
				'Describe the problem you are having:\n\n\n\nUse the drag and drop or paste to add images of the problem.\n\n\n\nWhat device and operating system are you using?\n\nWhat steps did you take to reproduce the problem?\n\n\n\nWhat did you expect to happen?\n\n\n\nWhat actually happened?\n\n\n\nPlease provide any other relevant information\n\n',
			)
			
			// Show success message briefly
			setTimeout(() => {
				setSendStatus('idle')
				onClose()
			}, 3000)
		} catch (error) {
			console.error('🐛 Failed to publish bug report:', error)
			setSendStatus('error')
			if (error instanceof Error) {
				console.error('🐛 Error details:', {
					name: error.name,
					message: error.message,
					stack: error.stack,
				})
			} else {
				console.error('🐛 Unknown error type:', error)
			}
		} finally {
			setIsSending(false)
		}
	}

	// Handle file upload
	const handleFileUpload = async (file: File) => {
		if (!file.type.startsWith('image/')) {
			console.error('Only image files are supported')
			return
		}

		setIsUploading(true)
		try {
			const result = await uploadToBlossom(file)
			const imageUrl = result.url
			insertImageUrl(imageUrl)
			console.log('Image uploaded:', imageUrl)
		} catch (error) {
			console.error('Image upload failed:', error)
		} finally {
			setIsUploading(false)
		}
	}

	// Handle drag and drop
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(true)
	}

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)
	}

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)

		const files = Array.from(e.dataTransfer.files)
		files.forEach((file) => {
			if (file.type.startsWith('image/')) {
				handleFileUpload(file)
			}
		})
	}

	// Handle paste
	const handlePaste = (e: React.ClipboardEvent) => {
		const items = Array.from(e.clipboardData.items)
		items.forEach((item) => {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile()
				if (file) {
					handleFileUpload(file)
				}
			}
		})
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			onClose()
		}
	}

	if (!isOpen) return null

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
			onKeyDown={handleKeyDown}
			style={{ overflow: 'hidden' }}
		>
			<div className="bg-white rounded-lg shadow-xl w-[40em] h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="flex items-center justify-between p-6 border-b border-gray-200">
					<div className="flex items-center gap-2">
						<Button
							variant={activeTab === 'report' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('report')}
							className="flex items-center gap-2"
						>
							<span className="i-warning w-4 h-4" />
							Report a bug
						</Button>
						<Button
							variant={activeTab === 'viewer' ? 'primary' : 'outline'}
							size="sm"
							onClick={() => setActiveTab('viewer')}
							className="flex items-center gap-2"
						>
							<span className="i-search w-4 h-4" />
							View bug reports
						</Button>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						className="h-8 w-8 text-gray-500 hover:text-gray-700"
						aria-label="Close bug report modal"
					>
						<span className="i-close w-5 h-5" />
					</Button>
				</div>

				{/* Content */}
				<div className="flex-1 flex flex-col p-6 min-h-0">
					{activeTab === 'report' ? (
						<>
							<p className="text-gray-600 mb-6">Report a bug you have found</p>
							<p className="text-gray-600 mb-6">Use the drag and drop or paste to add images of the problem.</p>
							<p className="text-gray-600 mb-6">The details of your system configuration have been automatically added.</p>
							<div className="flex-1 flex flex-col">
								<textarea
									ref={textareaRef}
									value={bugReport}
									onChange={(e) => setBugReport(e.target.value)}
									onPaste={handlePaste}
									onDragOver={handleDragOver}
									onDragLeave={handleDragLeave}
									onDrop={handleDrop}
									onWheel={(e) => e.stopPropagation()}
									onTouchMove={(e) => e.stopPropagation()}
									placeholder="Describe the bug you encountered..."
									className={cn(
										'flex-1 w-full p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent',
										isDragOver && 'border-secondary bg-secondary/5',
										isUploading && 'opacity-50',
									)}
									rows={10}
									disabled={isUploading}
								/>
								{isDragOver && (
									<div className="absolute inset-0 flex items-center justify-center bg-secondary/10 border-2 border-dashed border-secondary rounded-lg pointer-events-none">
										<p className="text-secondary font-medium">Drop image files here</p>
									</div>
								)}
								{isUploading && (
									<div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-lg pointer-events-none">
										<p className="text-gray-600 font-medium">Uploading image...</p>
									</div>
								)}
							</div>
						</>
					) : (
						<>
							<p className="text-gray-600 mb-6">View bug reports from the community</p>
							<div className="flex-1 overflow-y-auto">
								<BugReportsList />
							</div>
						</>
					)}
				</div>

				{/* Footer */}
				{activeTab === 'report' && (
					<div className="flex justify-end items-center p-6 border-t border-gray-200">
						{sendStatus === 'error' && (
							<div className="text-red-600 text-sm mr-4">
								Failed to send bug report. Check console for details and try again.
							</div>
						)}
						{sendStatus === 'success' && (
							<div className="text-green-600 text-sm mr-4">
								Bug report sent successfully!
							</div>
						)}
						<Button
							onClick={() => {
								if (sendStatus === 'error') {
									setSendStatus('idle')
								}
								handleSend()
							}}
							disabled={!bugReport.trim() || isUploading || isSending || sendStatus === 'success'}
							className={cn(
								"flex items-center gap-2 text-white",
								sendStatus === 'success' 
									? "bg-green-600 hover:bg-green-600" 
									: "bg-secondary hover:bg-secondary/90"
							)}
						>
							{isSending ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									Sending...
								</>
							) : sendStatus === 'success' ? (
								<>
									<span className="i-tick w-4 h-4" />
									Sent
								</>
							) : (
								<>
									<span className="i-send-message w-4 h-4" />
									Send
								</>
							)}
						</Button>
					</div>
				)}
			</div>
		</div>
	)
}
