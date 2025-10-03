export interface BlossomServer {
  name: string
  url: string
  type: 'free' | 'paid'
  description: string
  maxFileSize: number // in MB
  supportedFormats: string[]
  features?: string[]
}

export const BLOSSOM_SERVERS: BlossomServer[] = [
  {
    name: 'Nostr.build',
    url: 'https://nostr.build',
    type: 'free',
    description: 'Free image hosting for Nostr',
    maxFileSize: 5,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    features: ['Direct upload', 'NIP-96 compliant']
  },
  {
    name: 'NostrFiles',
    url: 'https://nostrfiles.dev',
    type: 'free',
    description: 'Decentralized file storage',
    maxFileSize: 10,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'pdf'],
    features: ['Multiple formats', 'Larger files']
  },
  {
    name: 'Blossom Relay',
    url: 'https://blossom.relay',
    type: 'paid',
    description: 'Premium file hosting with advanced features',
    maxFileSize: 50,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'pdf', 'zip'],
    features: ['Large files', 'Multiple formats', 'CDN', 'Analytics']
  },
  {
    name: 'NostrCDN',
    url: 'https://nostrcdn.com',
    type: 'paid',
    description: 'High-performance CDN for Nostr files',
    maxFileSize: 100,
    supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'pdf', 'zip', 'tar'],
    features: ['CDN', 'Large files', 'Fast delivery', 'Global distribution']
  }
]

export const getBlossomServer = (url: string): BlossomServer | undefined => {
  return BLOSSOM_SERVERS.find(server => server.url === url)
}

export const getFreeBlossomServers = (): BlossomServer[] => {
  return BLOSSOM_SERVERS.filter(server => server.type === 'free')
}

export const getPaidBlossomServers = (): BlossomServer[] => {
  return BLOSSOM_SERVERS.filter(server => server.type === 'paid')
}
