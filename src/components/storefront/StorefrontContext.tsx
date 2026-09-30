import { createContext, useContext, type ReactNode } from 'react'

/**
 * Ambient facts every storefront block needs but none of them should ask for.
 *
 * `pubkey` is the page's author. Data blocks resolve their own Nostr queries
 * against it rather than taking a pubkey prop, so a page can never be authored
 * to display somebody *else's* listings as if they were the author's — the
 * document has no field capable of expressing that.
 *
 * `isEditing` is true inside the Puck canvas. Blocks use it to stand in for
 * data they cannot have yet (an unbound product) and to keep the canvas inert:
 * clicking a link in the editor should select the block, not navigate away.
 */
export interface StorefrontContextValue {
	pubkey: string
	isEditing: boolean
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null)

export function StorefrontProvider({ value, children }: { value: StorefrontContextValue; children: ReactNode }) {
	return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>
}

/**
 * Blocks render in both the published page and the Puck canvas, and Puck can
 * mount a component outside the provider while dragging. The neutral default
 * keeps that case from throwing mid-drag.
 */
export function useStorefrontContext(): StorefrontContextValue {
	return useContext(StorefrontContext) ?? { pubkey: '', isEditing: false }
}
