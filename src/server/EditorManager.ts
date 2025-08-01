import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk'
import type { EditorManager } from './types'

export class EditorManagerImpl implements EditorManager {
	private editorPubkeys: Set<string> = new Set()

	constructor(initialEditors: string[] = []) {
		this.editorPubkeys = new Set(initialEditors)
	}

	public addEditor(pubkey: string): void {
		if (typeof pubkey !== 'string' || pubkey.length !== 64) {
			throw new Error('Invalid public key format')
		}
		this.editorPubkeys.add(pubkey)
	}

	public isEditor(pubkey: string): boolean {
		return this.editorPubkeys.has(pubkey)
	}

	public getEditors(): Set<string> {
		return new Set(this.editorPubkeys)
	}

	public updateFromEvent(event: NostrEvent | NDKEvent): void {
		try {
			// Extract editor pubkeys from 'p' tags in the editor list event
			const newEditors = event.tags.filter((tag) => tag[0] === 'p' && tag[1] && tag[1].length === 64).map((tag) => tag[1])

			// Replace the current editor list with the new one
			this.editorPubkeys.clear()
			newEditors.forEach((pubkey) => this.editorPubkeys.add(pubkey))

			console.log(`Updated editor list with ${newEditors.length} editors:`, newEditors)
		} catch (error) {
			console.error('Failed to update editor list from event:', error)
		}
	}

	public clear(): void {
		this.editorPubkeys.clear()
	}

	public size(): number {
		return this.editorPubkeys.size
	}
}
