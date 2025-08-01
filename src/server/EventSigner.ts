import type { NostrEvent } from '@nostr-dev-kit/ndk'
import { getPublicKey } from 'nostr-tools'
import { finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure'

export class EventSigner {
  private appPrivateKey: string
  private privateBytes: Uint8Array
  private appPubkey: string

  constructor(appPrivateKey: string) {
    this.appPrivateKey = appPrivateKey
    this.privateBytes = new Uint8Array(Buffer.from(appPrivateKey, 'hex'))
    this.appPubkey = getPublicKey(this.privateBytes)
  }

  public signEvent(event: NostrEvent): NostrEvent {
    const unsignedEvent: UnsignedEvent = {
      kind: event.kind as number,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
      pubkey: this.appPubkey,
    }

    return finalizeEvent(unsignedEvent, this.privateBytes)
  }

  public getAppPubkey(): string {
    return this.appPubkey
  }
}