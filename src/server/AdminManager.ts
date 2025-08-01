import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'
import type { AdminManager } from './types'

export class AdminManagerImpl implements AdminManager {
  private adminPubkeys: Set<string> = new Set()

  constructor(initialAdmins: string[] = []) {
    this.adminPubkeys = new Set(initialAdmins)
  }

  public addAdmin(pubkey: string): void {
    if (typeof pubkey !== 'string' || pubkey.length !== 64) {
      throw new Error('Invalid public key format')
    }
    this.adminPubkeys.add(pubkey)
  }

  public isAdmin(pubkey: string): boolean {
    return this.adminPubkeys.has(pubkey)
  }

  public getAdmins(): Set<string> {
    return new Set(this.adminPubkeys)
  }

  public updateFromEvent(event: NostrEvent | NDKEvent): void {
    try {
      // Extract admin pubkeys from 'p' tags in the admin list event
      const newAdmins = event.tags
        .filter((tag) => tag[0] === 'p' && tag[1] && tag[1].length === 64)
        .map((tag) => tag[1])

      // Replace the current admin list with the new one
      this.adminPubkeys.clear()
      newAdmins.forEach((pubkey) => this.adminPubkeys.add(pubkey))

      console.log(`Updated admin list with ${newAdmins.length} admins:`, newAdmins)
    } catch (error) {
      console.error('Failed to update admin list from event:', error)
    }
  }

  public clear(): void {
    this.adminPubkeys.clear()
  }

  public size(): number {
    return this.adminPubkeys.size
  }
}