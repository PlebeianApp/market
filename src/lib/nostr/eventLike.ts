export interface NostrEventLike {
	id: string
	pubkey: string
	kind: number
	created_at?: number
	content: string
	tags: string[][]
	sig?: string
}
