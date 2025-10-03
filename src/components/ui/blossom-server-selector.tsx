import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BLOSSOM_SERVERS, type BlossomServer } from '@/lib/blossom/config'

interface BlossomServerSelectorProps {
  selectedServer: string
  onServerChange: (serverUrl: string) => void
  className?: string
}

export function BlossomServerSelector({
  selectedServer,
  onServerChange,
  className = ''
}: BlossomServerSelectorProps) {
  const selectedServerInfo = BLOSSOM_SERVERS.find(s => s.url === selectedServer)

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="text-sm font-medium">Blossom Server</label>
      <Select value={selectedServer} onValueChange={onServerChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a blossom server" />
        </SelectTrigger>
        <SelectContent>
          {BLOSSOM_SERVERS.map((server) => (
            <SelectItem key={server.url} value={server.url}>
              <div className="flex items-center justify-between w-full">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{server.name}</span>
                    <Badge variant={server.type === 'free' ? 'default' : 'secondary'}>
                      {server.type}
                    </Badge>
                  </div>
                  <span className="text-xs text-gray-500">{server.description}</span>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedServerInfo && (
        <div className="text-xs text-gray-600 space-y-1">
          <div>Max file size: {selectedServerInfo.maxFileSize}MB</div>
          <div>Supported formats: {selectedServerInfo.supportedFormats.join(', ')}</div>
          {selectedServerInfo.features && (
            <div>Features: {selectedServerInfo.features.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
