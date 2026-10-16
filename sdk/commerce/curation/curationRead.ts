import { CURATION_LISTS, MUTE_LIST_KIND, readCurationListItems, type CurationListKey } from './curationLists'

// A type alias (not interface) so it stays assignable to relay-client filters with `#${string}` index signatures.
export type CurationFilter = {
	kinds: number[]
	authors: string[]
	'#d'?: string[]
	limit?: number
}

export interface CurationListEvent {
	tags: string[][]
	created_at?: number
}

export interface AdminSettings<E = CurationListEvent> {
	admins: string[]
	owner: string
	lastUpdated: number
	event: E
}

export interface EditorSettings<E = CurationListEvent> {
	editors: string[]
	lastUpdated: number
	event: E | null
}

export interface BlacklistSettings<E = CurationListEvent> {
	blacklistedPubkeys: string[]
	blacklistedProducts: string[]
	blacklistedCollections: string[]
	lastUpdated: number
	event: E | null
}

export type UserRole = 'owner' | 'admin' | 'editor' | 'user'

export type FeaturedListKey = 'featuredProducts' | 'featuredCollections' | 'featuredAuctions' | 'featuredUsers'

export interface FeaturedProductsData {
	featuredProducts: string[]
	lastUpdated: number
}

export interface FeaturedCollectionsData {
	featuredCollections: string[]
	lastUpdated: number
}

export interface FeaturedAuctionsData {
	featuredAuctions: string[]
	lastUpdated: number
}

export interface FeaturedUsersData {
	featuredUsers: string[]
	lastUpdated: number
}

type ItemsFilter = (items: string[]) => string[]

export function buildCurationListFilter(list: CurationListKey, appPubkey: string): CurationFilter {
	const spec = CURATION_LISTS[list]
	return { kinds: [spec.kind], authors: [appPubkey], '#d': [spec.dTag] }
}

export function buildBlacklistFilter(appPubkey: string): CurationFilter {
	return { kinds: [MUTE_LIST_KIND], authors: [appPubkey] }
}

/** Owner is the first listed admin, falling back to the app pubkey. */
export function parseAdminSettings<E extends CurationListEvent>(event: E, appPubkey: string): AdminSettings<E> {
	const admins = readCurationListItems('admins', event.tags)
	return { admins, owner: admins[0] || appPubkey, lastUpdated: event.created_at ?? 0, event }
}

export function parseEditorSettings<E extends CurationListEvent>(event: E | null): EditorSettings<E> {
	if (!event) return { editors: [], lastUpdated: 0, event: null }
	return { editors: readCurationListItems('editors', event.tags), lastUpdated: event.created_at ?? 0, event }
}

export function parseBlacklistSettings<E extends CurationListEvent>(event: E | null): BlacklistSettings<E> {
	if (!event) return { blacklistedPubkeys: [], blacklistedProducts: [], blacklistedCollections: [], lastUpdated: 0, event: null }
	const coordinates = event.tags.filter((tag) => tag[0] === 'a' && tag[1]).map((tag) => tag[1])
	return {
		blacklistedPubkeys: event.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]),
		blacklistedProducts: coordinates.filter((coordinate) => coordinate.startsWith('30402:')),
		blacklistedCollections: coordinates.filter((coordinate) => coordinate.startsWith('30405:')),
		lastUpdated: event.created_at ?? 0,
		event,
	}
}

/** Coordinates whose kind prefix matches the list's item kind, in published order. */
export function readFeaturedCoordinates(list: 'featuredProducts' | 'featuredCollections' | 'featuredAuctions', tags: string[][]): string[] {
	const prefix = `${CURATION_LISTS[list].itemKind}:`
	return readCurationListItems(list, tags).filter((coordinate) => coordinate.startsWith(prefix))
}

const featuredLastUpdated = (event: CurationListEvent, nowSeconds: number) => event.created_at || nowSeconds

export function parseFeaturedProducts(
	event: CurationListEvent,
	filterProducts: ItemsFilter,
	nowSeconds = Date.now() / 1000,
): FeaturedProductsData {
	return {
		featuredProducts: filterProducts(readFeaturedCoordinates('featuredProducts', event.tags)),
		lastUpdated: featuredLastUpdated(event, nowSeconds),
	}
}

export function parseFeaturedCollections(
	event: CurationListEvent,
	filterCollections: ItemsFilter,
	nowSeconds = Date.now() / 1000,
): FeaturedCollectionsData {
	return {
		featuredCollections: filterCollections(readFeaturedCoordinates('featuredCollections', event.tags)),
		lastUpdated: featuredLastUpdated(event, nowSeconds),
	}
}

/** Drops malformed coordinates and auctions whose seller `filterSellers` removes. */
export function parseFeaturedAuctions(
	event: CurationListEvent,
	filterSellers: ItemsFilter,
	nowSeconds = Date.now() / 1000,
): FeaturedAuctionsData {
	const featuredAuctions = readFeaturedCoordinates('featuredAuctions', event.tags).filter((coordinate) => {
		const parts = coordinate.split(':')
		if (parts.length !== 3 || !parts[1] || !parts[2]) return false
		return filterSellers([parts[1]]).length > 0
	})
	return { featuredAuctions, lastUpdated: featuredLastUpdated(event, nowSeconds) }
}

export function parseFeaturedUsers(event: CurationListEvent, filterUsers: ItemsFilter, nowSeconds = Date.now() / 1000): FeaturedUsersData {
	return {
		featuredUsers: filterUsers(readCurationListItems('featuredUsers', event.tags)),
		lastUpdated: featuredLastUpdated(event, nowSeconds),
	}
}

export function isAdmin(adminSettings: AdminSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!adminSettings || !pubkey) return false
	return adminSettings.admins.includes(pubkey)
}

export function isOwner(adminSettings: AdminSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!adminSettings || !pubkey) return false
	return adminSettings.owner === pubkey
}

export function isEditor(editorSettings: EditorSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!editorSettings || !pubkey) return false
	return editorSettings.editors.includes(pubkey)
}

export function isBlacklisted(blacklistSettings: BlacklistSettings<unknown> | null | undefined, pubkey: string): boolean {
	if (!blacklistSettings || !pubkey) return false
	return blacklistSettings.blacklistedPubkeys.includes(pubkey)
}

export function getFormattedAdmins(adminSettings: AdminSettings<unknown> | null | undefined) {
	if (!adminSettings) return []
	return adminSettings.admins.map((pubkey, index) => ({ pubkey, isOwner: pubkey === adminSettings.owner, index }))
}

export function getFormattedEditors(editorSettings: EditorSettings<unknown> | null | undefined) {
	if (!editorSettings || !editorSettings.editors) return []
	return editorSettings.editors.map((pubkey) => ({ pubkey, role: 'editor' as const }))
}

export function getFormattedBlacklist(blacklistSettings: BlacklistSettings<unknown> | null | undefined) {
	if (!blacklistSettings || !blacklistSettings.blacklistedPubkeys) return []
	return blacklistSettings.blacklistedPubkeys.map((pubkey) => ({ pubkey, status: 'blacklisted' as const }))
}

export function getUserRoleForPubkey(
	adminSettings: AdminSettings<unknown> | null | undefined,
	editorSettings: EditorSettings<unknown> | null | undefined,
	pubkey: string,
): UserRole {
	if (isOwner(adminSettings, pubkey)) return 'owner'
	if (isAdmin(adminSettings, pubkey)) return 'admin'
	if (isEditor(editorSettings, pubkey)) return 'editor'
	return 'user'
}
