import { NDKBlossom } from '@nostr-dev-kit/ndk-blossom'
import { imetaTagToTag } from '@nostr-dev-kit/ndk'
import { ndkActions } from '@/lib/stores/ndk'

export type BlossomServer = {
  name: string
  url: string
  plan: 'free' | 'paid' | 'public'
}

export const BLOSSOM_SERVERS: BlossomServer[] = [
  { name: 'Blossom Band (Nostr.build infra)', url: 'https://blossom.band', plan: 'paid' },
  { name: 'f7z Blossom', url: 'https://blossom.f7z.io', plan: 'public' },
  { name: '24242 Blossom', url: 'https://24242.io', plan: 'public' },
]

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
  const servers = uniqueServers(opts.preferredServerUrl ? [opts.preferredServerUrl, ...BLOSSOM_SERVERS.map(s => s.url)] : BLOSSOM_SERVERS.map(s => s.url))
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


