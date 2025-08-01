import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { nip19 } from 'nostr-tools'
import type { BootstrapManager, AdminManager } from './types'

export class BootstrapManagerImpl implements BootstrapManager {
  private bootstrapMode: boolean = false
  private hasSetupEvent: boolean = false
  private adminManager: AdminManager

  constructor(adminManager: AdminManager, initialAdminCount: number = 0) {
    this.adminManager = adminManager
    this.bootstrapMode = initialAdminCount === 0
    
    if (this.bootstrapMode) {
      console.log('Bootstrap manager initialized in bootstrap mode')
    }
  }

  public isBootstrapMode(): boolean {
    return this.bootstrapMode
  }

  public exitBootstrapMode(): void {
    this.bootstrapMode = false
    console.log('Exited bootstrap mode')
  }

  public handleSetupEvent(event: NostrEvent): void {
    if (!this.hasSetupEvent) {
      this.hasSetupEvent = true
      console.log('First setup event received and validated')
    } else {
      console.log('Subsequent setup event received and validated from admin')
    }

    if (this.bootstrapMode) {
      this.exitBootstrapMode()

      try {
        const settings = JSON.parse(event.content)
        if (settings.ownerPk) {
          let pubkey = settings.ownerPk
          if (pubkey.startsWith('npub')) {
            const { data } = nip19.decode(pubkey)
            pubkey = data.toString()
          }
          this.adminManager.addAdmin(pubkey)
          console.log('Added owner as admin during bootstrap:', pubkey)
        }
      } catch (e) {
        console.error('Failed to parse settings during bootstrap', e)
      }
    }
  }

  public hasSetup(): boolean {
    return this.hasSetupEvent
  }
}