import { NDKBlossom } from '@nostr-dev-kit/ndk-blossom'
import { imetaTagToTag } from '@nostr-dev-kit/ndk'
import { ndkActions } from '@/lib/stores/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { sha256 } from '@noble/hashes/sha2.js'

export type BlossomServer = {
	name: string
	url: string
	plan: 'free' | 'paid' | 'public'
}

export const BLOSSOM_SERVERS = [
	{ name: 'nostrcheck.me', url: 'https://nostrcheck.me', plan: 'public' },
	{ name: 'Primal', url: 'https://blossom.primal.net', plan: 'public' },
	{ name: 'Blossom Band', url: 'https://blossom.band', plan: 'paid' },
	{ name: '24242', url: 'https://24242.io', plan: 'public' },
	{ name: 'f7z Blossom', url: 'https://blossom.f7z.io', plan: 'public' },
	{ name: 'nostr.download', url: 'https://nostr.download', plan: 'public' },
] as const

export async function checkBlossomAvailability(serverUrl: string, timeoutMs = 3000): Promise<boolean> {
	const controller = new AbortController()
	const t = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const target = serverUrl.replace(/\/$/, '')
		const res = await fetch(target, { method: 'HEAD', signal: controller.signal })
		return res.ok
	} catch {
		return false
	} finally {
		clearTimeout(t)
	}
}

export type UploadProgress = (progress: { loaded: number; total: number }, file: File, serverUrl: string) => 'continue' | 'cancel'

export interface UploadOptions {
	preferredServerUrl?: string
	onProgress?: UploadProgress
	logger?: (msg: string, data?: unknown) => void
	maxAttempts?: number
}

export async function uploadWithRetries(ndk: unknown, file: File, opts: UploadOptions = {}) {
	if (!ndk) throw new Error('NDK not initialized')

	const log = opts.logger ?? ((msg: string, data?: unknown) => console.log(`[blossom] ${msg}`, data ?? ''))
	const servers = uniqueServers(
		opts.preferredServerUrl ? [opts.preferredServerUrl, ...BLOSSOM_SERVERS.map((s) => s.url)] : BLOSSOM_SERVERS.map((s) => s.url),
	)
	const maxAttempts = opts.maxAttempts ?? Math.min(servers.length, 5)

	let lastError: unknown = null
	let attempt = 0

	for (const serverUrl of servers) {
		if (attempt >= maxAttempts) break
		attempt++

		const isUp = await checkBlossomAvailability(serverUrl)
		if (!isUp) {
			log('Server unavailable, skipping', { serverUrl })
			continue
		}

		try {
			log('Attempting upload', { attempt, serverUrl, fileName: file.name, size: file.size })

			const blossom = new NDKBlossom(ndk as any)

			blossom.onUploadFailed = async (error: any) => {
				// Try to log Blossom server response if present
				const resp = error?.response
				if (resp) {
					try {
						const bodyText = await resp.text?.()
						log('Upload failed callback (server response)', {
							serverUrl,
							status: resp.status,
							statusText: resp.statusText,
							headers: Object.fromEntries(resp.headers?.entries?.() || []),
							bodyText,
						})
					} catch (_) {
						log('Upload failed callback (no body)', { serverUrl, status: resp.status, statusText: resp.statusText })
					}
				} else {
					log('Upload failed callback', { serverUrl, error })
				}
			}
			if (opts.onProgress) {
				blossom.onUploadProgress = (progress, f) => opts.onProgress!(progress, f, serverUrl)
			}

			// Some versions support an options object with serverUrl.
			// @ts-expect-error optional depending on library version
			const imeta = await blossom.upload(file, { serverUrl })
			const imetaTag = imetaTagToTag(imeta)

			log('Upload successful', { serverUrl, imeta })
			return { imeta, imetaTag, serverUrl }
		} catch (err: any) {
			lastError = err
			// If the error carries a Response, log status/body for diagnostics
			const resp = err?.response
			if (resp) {
				try {
					const bodyText = await resp.text?.()
					log('Upload attempt error (server response)', {
						attempt,
						serverUrl,
						status: resp.status,
						statusText: resp.statusText,
						headers: Object.fromEntries(resp.headers?.entries?.() || []),
						bodyText,
					})
				} catch (_) {
					log('Upload attempt error (no body)', { attempt, serverUrl })
				}
			} else {
				log('Upload attempt error', { attempt, serverUrl, error: err?.message || String(err) })
			}
		}
	}

	throw new Error(`All Blossom upload attempts failed. Last error: ${String(lastError)}`)
}

export async function fixUrlWithNDK(ndk: unknown, brokenUrl: string, serverUrl?: string) {
	const blossom = new NDKBlossom(ndk as any)
	const user = (ndk as any)?.signer ? await (ndk as any).signer.user() : undefined
	if (!user) throw new Error('No signer available to fix Blossom URL')

	if (serverUrl) {
		// @ts-expect-error optional depending on library version
		return await blossom.fixUrl(user, brokenUrl, { serverUrl })
	}

	return await blossom.fixUrl(user, brokenUrl)
}

function uniqueServers(urls: string[]) {
	const seen = new Set<string>()
	const result: string[] = []
	for (const u of urls) {
		const norm = u.replace(/\/$/, '')
		if (!seen.has(norm)) {
			seen.add(norm)
			result.push(norm)
		}
	}
	return result
}

export async function uploadWithStoreSigner(file: File) {
	const ndk = ndkActions.getNDK()
	if (!ndk || !ndk.signer) throw new Error('NDK or signer not initialized')

	const blossom = new NDKBlossom(ndk as any)

	blossom.onUploadFailed = (e) => console.error(e)
	blossom.onUploadProgress = (p, f, serverUrl) => {
		console.log(`Upload ${f.name} -> ${serverUrl}: ${Math.round((p.loaded / p.total) * 100)}%`)
		return 'continue'
	}

	return await blossom.upload(file)
}

async function computeSha256(buffer: ArrayBuffer): Promise<string> {
	const hashBytes = sha256(new Uint8Array(buffer))
	return Array.from(hashBytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

async function createAuthEvent(hash: string, ndk: any): Promise<any> {
	if (!ndk.signer) throw new Error('No signer available')

	const event = new NDKEvent()
	event.kind = 24242
	event.content = 'Upload media file'
	event.tags = [
		['t', 'upload'],
		['x', hash],
		['expiration', Math.floor(Date.now() / 1000 + 3600).toString()],
	]

	await event.sign(ndk.signer)
	return event.rawEvent()
}

export interface BlossomUploadConfig {
	serverUrl: string
	onProgress?: (loaded: number, total: number) => void
	maxRetries?: number
	retryDelay?: number
	fallbackToOtherServers?: boolean
}

export async function uploadToBlossomServer(file: File, config: BlossomUploadConfig): Promise<{ url: string; imeta: any }> {
	const ndk = ndkActions.getNDK()
	if (!ndk || !ndk.signer) throw new Error('NDK or signer not initialized')

	const maxRetries = config.maxRetries ?? 3
	const retryDelay = config.retryDelay ?? 1000

	// Get all available servers, starting with the selected one
	const servers = [config.serverUrl, ...BLOSSOM_SERVERS.filter((s) => s.url !== config.serverUrl).map((s) => s.url)]

	const attempted = new Set<string>()
	let lastError: Error | null = null

	// Try each server until success or all fail
	for (const serverUrl of servers) {
		if (attempted.has(serverUrl)) continue
		attempted.add(serverUrl)

		let attempt = 0
		while (attempt < maxRetries) {
			try {
				const data = await file.arrayBuffer()
				const hash = await computeSha256(data)
				const authEvent = await createAuthEvent(hash, ndk)

				console.log(`Server ${serverUrl}, attempt ${attempt + 1}/${maxRetries}`)

				const result = await new Promise<{ url: string; imeta: any }>((resolve, reject) => {
					const xhr = new XMLHttpRequest()

					xhr.upload.addEventListener('progress', (e) => {
						if (e.lengthComputable && config.onProgress) {
							config.onProgress(e.loaded, e.total)
						}
					})

					xhr.addEventListener('load', async () => {
						if (xhr.status >= 200 && xhr.status < 300) {
							try {
								let url: string
								let extraMeta = {}

								if (xhr.responseText) {
									try {
										const json = JSON.parse(xhr.responseText)
										url = json.url || json.urls?.[0] || `${serverUrl}/${hash}`
										extraMeta = json
									} catch {
										url = xhr.responseURL || `${serverUrl}/${hash}`
									}
								} else {
									url = xhr.responseURL || `${serverUrl}/${hash}`
								}

								const imeta = {
									url,
									m: file.type,
									x: hash,
									size: file.size.toString(),
									...extraMeta,
								}

								resolve({ url, imeta })
							} catch (error) {
								reject(new Error(`Invalid response: ${xhr.responseText}`))
							}
						} else {
							reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
						}
					})

					xhr.addEventListener('error', () => reject(new Error('Network error')))
					xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

					xhr.open('PUT', `${serverUrl}/upload`)
					xhr.setRequestHeader('Content-Type', file.type)
					xhr.setRequestHeader('Authorization', `Nostr ${btoa(JSON.stringify(authEvent))}`)
					xhr.send(data)
				})

				return result
			} catch (error: any) {
				attempt++
				lastError = error
				console.log(`Server ${serverUrl}, attempt ${attempt} failed:`, error.message)

				if (attempt < maxRetries) {
					console.log(`Retrying in ${retryDelay}ms...`)
					await new Promise((resolve) => setTimeout(resolve, retryDelay))
				}
			}
		}

		console.log(`All attempts failed for ${serverUrl}, trying next server...`)
	}

	throw new Error(`Upload failed on all servers. Last error: ${lastError?.message}`)
}
