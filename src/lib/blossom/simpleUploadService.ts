import { BLOSSOM_SERVERS, type BlossomServer } from './config'

export interface UploadResult {
  url: string
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

export class SimpleBlossomUploadService {
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

      // For demonstration, we'll create a data URL as a fallback
      // In a real implementation, this would upload to the actual server
      const dataUrl = await this.fileToDataUrl(file)

      // Simulate progress
      if (onProgress) {
        onProgress({ loaded: 0, total: 100, percentage: 0 })
        await new Promise(resolve => setTimeout(resolve, 100))
        onProgress({ loaded: 50, total: 100, percentage: 50 })
        await new Promise(resolve => setTimeout(resolve, 100))
        onProgress({ loaded: 100, total: 100, percentage: 100 })
      }

      // Get image dimensions if it's an image
      let dimensions: { width: number; height: number } | undefined
      if (file.type.startsWith('image/')) {
        dimensions = await this.getImageDimensions(file)
      }

      return {
        url: dataUrl,
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

  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
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
