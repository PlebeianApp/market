import { BLOSSOM_SERVERS, type BlossomServer } from './config'

export interface UploadResult {
  url: string
  nip96Url?: string
  metadata?: {
    size: number
    type: string
    dimensions?: { width: number; height: number }
  }
}

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export class ProxyBlossomUploadService {
  private currentServer: BlossomServer

  constructor(serverUrl: string) {
    this.currentServer = BLOSSOM_SERVERS.find(s => s.url === serverUrl) || BLOSSOM_SERVERS[0]
  }

  async uploadFile(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    try {
      // Validate file size
      if (file.size > this.currentServer.maxFileSize * 1024 * 1024) {
        throw new Error(`File too large. Maximum size: ${this.currentServer.maxFileSize}MB`)
      }

      // Validate file type
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      if (fileExtension && !this.currentServer.supportedFormats.includes(fileExtension)) {
        throw new Error(`Unsupported file type. Supported: ${this.currentServer.supportedFormats.join(', ')}`)
      }

      // Use server-side proxy to avoid CORS issues
      const formData = new FormData()
      formData.append('file', file)
      formData.append('server', this.currentServer.url)

      const response = await fetch('/api/upload-proxy', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      const result = await response.json()

      // Get image dimensions if it's an image
      let dimensions: { width: number; height: number } | undefined
      if (file.type.startsWith('image/')) {
        dimensions = await this.getImageDimensions(file)
      }

      return {
        url: result.url,
        nip96Url: result.nip96Url,
        metadata: {
          size: file.size,
          type: file.type,
          dimensions
        }
      }
    } catch (error) {
      console.error('Upload failed:', error)
      throw new Error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        resolve({ width: img.width, height: img.height })
        URL.revokeObjectURL(img.src)
      }
      img.onerror = () => {
        reject(new Error('Could not load image'))
        URL.revokeObjectURL(img.src)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  getCurrentServer(): BlossomServer {
    return this.currentServer
  }

  getSupportedFormats(): string[] {
    return this.currentServer.supportedFormats
  }

  getMaxFileSize(): number {
    return this.currentServer.maxFileSize
  }
}
