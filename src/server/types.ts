import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'
import type { UnsignedEvent } from 'nostr-tools/pure'

export interface EventHandlerConfig {
  appPrivateKey: string
  adminPubkeys: string[]
  relayUrl?: string
}

export interface EventValidationResult {
  isValid: boolean
  reason?: string
}

export interface ProcessedEvent {
  originalEvent: NostrEvent
  signedEvent: NostrEvent | null
  validationResult: EventValidationResult
}

export interface AdminManager {
  addAdmin(pubkey: string): void
  isAdmin(pubkey: string): boolean
  getAdmins(): Set<string>
  updateFromEvent(event: NostrEvent | NDKEvent): void
}

export interface EditorManager {
  addEditor(pubkey: string): void
  isEditor(pubkey: string): boolean
  getEditors(): Set<string>
  updateFromEvent(event: NostrEvent | NDKEvent): void
}

export interface BootstrapManager {
  isBootstrapMode(): boolean
  exitBootstrapMode(): void
  handleSetupEvent(event: NostrEvent): void
  hasSetup(): boolean
}