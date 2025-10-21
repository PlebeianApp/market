import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ndkActions } from '@/lib/stores/ndk'
import { toast } from 'sonner'
import { uploadToBlossomServer, BLOSSOM_SERVERS } from '@/lib/blossom'

interface ImageUploaderProps {
  src: string | null
  index: number
  imagesLength: number
  forSingle?: boolean
  initialUrl?: string
  onSave: (data: { url: string; index: number }) => void
  onDelete: (index: number) => void
  onPromote?: (index: number) => void
  onDemote?: (index: number) => void
  onInteraction?: () => void
  onUrlChange?: (url: string) => void
}

export function ImageUploader({
  src,
  index,
  imagesLength,
  forSingle = false,
  initialUrl = '',
  onSave,
  onDelete,
  onPromote,
  onDemote,
  onInteraction,
  onUrlChange
}: ImageUploaderProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [inputEditable, setInputEditable] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [localSrc, setLocalSrc] = useState<string | null>(src)
  const [inputValue, setInputValue] = useState(initialUrl || '')
  const [hasInteracted, setHasInteracted] = useState(false)
  const [selectedServer, setSelectedServer] = useState<string>(BLOSSOM_SERVERS[0].url)
  const inputTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  async function performBlossomUpload(file: File) {
    const ndk = ndkActions.getNDK()
    if (!ndk || !ndk.signer) {
      toast.error('NDK or signer not initialized')
      throw new Error('NDK or signer not initialized')
    }

    setIsLoading(true)
    try {
      const result = await uploadToBlossomServer(file, {
        serverUrl: selectedServer,
        onProgress: (loaded, total) => {
          const pct = Math.round((loaded / total) * 100)
          console.log(`Upload progress: ${pct}%`)
        },
        maxRetries: 3,
        retryDelay: 2000
      })

      // setInputValue(result.url)
      onSave({ url: result.url, index })
      toast.success('Image uploaded successfully')
    } catch (err: any) {
      console.error('Upload error:', err)
      toast.error(err.message || 'Upload failed')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setLocalSrc(src)
  }, [src])

  useEffect(() => {
    setInputValue(initialUrl || '')
  }, [initialUrl])

  const handleUploadIntent = async () => {
    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.multiple = !forSingle
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length) {
        try {
          await performBlossomUpload(files[0])
        } catch (err) {
          console.error('Blossom upload error', err)
          toast.error('Upload failed. Try again.')
        }
      }
    }
    input.click()
  }

  function handleDragEnter(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setIsDragging(true)

    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setIsDragging(false)

    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }

    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) {
      ;(async () => {
        try {
          await performBlossomUpload(files[0])
        } catch (err) {
          console.error('Blossom upload error', err)
          toast.error('Upload failed. Try again.')
        }
      })()
    }
  }

  const handleEditByUpload = async () => {
    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length) {
        try {
          await performBlossomUpload(files[0])
        } catch (err) {
          console.error('Blossom upload error', err)
          toast.error('Upload failed. Try again.')
        }
      }
    }
    input.click()
  }

  function handleInput(event: React.ChangeEvent<HTMLInputElement>): void {
    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }

    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current)
    }

    const newValue = event.target.value
    setInputValue(newValue)

    if (onUrlChange) {
      onUrlChange(newValue)
    }

    inputTimeoutRef.current = setTimeout(() => {
      if (!newValue.trim()) {
        setUrlError(null)
        return
      }
      try {
        new URL(newValue)
        setUrlError(null)
      } catch {
        setUrlError('Invalid URL format')
      }
    }, 300)
  }

  function handleInputFocus() {
    if (!hasInteracted && onInteraction) {
      setHasInteracted(true)
      onInteraction()
    }
  }

  function handleSaveImage() {
    if (!inputValue) return
    if (urlError) return

    onSave({ url: inputValue, index })

    if (index === -1) {
      setInputValue('')
    }

    if (inputEditable) {
      setInputEditable(false)
    }
  }

  function getMediaType(url: string): 'image' | 'video' {
    if (url.match(/\.(mp4|webm|ogg|mov)($|\?)/i)) {
      return 'video'
    }
    return 'image'
  }

  return (
    <div className="w-full h-full">
      <div className="flex flex-col">
        <div
          className={`border-2 border-b-0 border-black relative w-full aspect-video overflow-hidden
            ${localSrc ? 'bg-black' : ''}`}
          style={localSrc ? {} : { backgroundImage: 'url("images/checker.png")', backgroundRepeat: 'repeat' }}
        >
          {localSrc ? (
            <>
              <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0 bg-gradient-to-r from-gray-300 to-white" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}></div>
                <div className="absolute inset-0 bg-gradient-to-l from-gray-300 to-white" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}></div>
              </div>

              <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundImage: 'url("images/image-bg-pattern.png")', backgroundRepeat: 'repeat' }}>
                {getMediaType(localSrc) === 'video' ? (
                  <video src={localSrc} controls className="max-w-full max-h-full object-contain">
                    <track kind="captions" />
                    Your browser does not support the video tag.
                  </video>
                ) : (
                  <img src={localSrc} alt="uploaded media" className="max-w-full max-h-full object-contain" />
                )}
              </div>

              <div className="absolute bottom-2 right-2 flex gap-2">
                {inputEditable && (
                  <Button type="button" variant="outline" size="icon" className="bg-white" onClick={handleEditByUpload}>
                    <span className="i-upload w-6 h-6" />
                  </Button>
                )}
                <Button type="button" variant="outline" size="icon" className="bg-white" onClick={() => onDelete(index)}>
                  <span className="i-delete w-4 h-4" />
                </Button>
              </div>

              {index !== -1 && (
                <div className="absolute left-2 bottom-2 flex flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="bg-white"
                    disabled={index === 0}
                    onClick={() => onPromote && onPromote(index)}
                  >
                    <span className="i-up w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="bg-white"
                    disabled={index === imagesLength - 1}
                    onClick={() => onDemote && onDemote(index)}
                  >
                    <span className="i-down w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              className={`absolute inset-0 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-black/5 ${
                isDragging ? 'bg-black/10' : ''
              }`}
              onClick={handleUploadIntent}
              onDragEnter={handleDragEnter}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span className="i-upload w-10 h-10" />
              <strong>{isDragging ? 'Drop media here' : 'Upload at least one image'}</strong>
            </button>
          )}
        </div>

        <div className="w-full flex items-center justify-center">
          <div className="flex items-center gap-2 mb-2 w-full">
            <select
              className="border-2 border-black h-10 px-2 rounded-none"
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              title="Upload server"
            >
              {BLOSSOM_SERVERS.map((server) => (
                <option key={server.url} value={server.url}>
                  {server.name} ({server.plan})
                </option>
              ))}
            </select>
          </div>

          <div className="relative w-full">
            <Input
              disabled={!inputEditable && Boolean(localSrc)}
              value={inputValue}
              type="text"
              className="border-2 border-black pr-12 h-12 rounded-none"
              placeholder="Set a remote image URL"
              id="userImageRemote"
              name="imageRemoteInput"
              onChange={handleInput}
              onFocus={handleInputFocus}
              data-testid="image-url-input"
            />
            {localSrc ? (
              inputEditable ? (
                <Button
                  type="button"
                  variant="primary"
                  className="absolute right-1 top-1 bottom-1 h-10"
                  onClick={handleSaveImage}
                  data-testid="image-save-button"
                >
                  Save
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="absolute right-1 top-1 bottom-1 h-10 bg-white"
                  onClick={() => setInputEditable(true)}
                  data-testid="image-edit-button"
                >
                  Edit
                </Button>
              )
            ) : (
              <Button
                type="button"
                variant="primary"
                className="absolute right-1 top-1 bottom-1 h-10"
                onClick={handleSaveImage}
                data-testid="image-save-button"
              >
                Save
              </Button>
            )}
          </div>
        </div>

        {urlError && (
          <p className="text-destructive">{urlError}</p>
        )}

        {isLoading && (
          <div className="flex flex-row gap-2 mt-2">
            <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>
            <p>Loading...</p>
          </div>
        )}
      </div>
    </div>
  )
}