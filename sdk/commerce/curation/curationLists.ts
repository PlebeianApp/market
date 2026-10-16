import type { UnsignedEventData } from '../../core/publishing'
import type { Result } from '../../core/result'
import { failure, success } from '../../core/result'

export const MUTE_LIST_KIND = 10000

export const CURATION_LISTS = {
	admins: { kind: 30000, dTag: 'admins', itemTag: 'p' },
	editors: { kind: 30000, dTag: 'editors', itemTag: 'p' },
	featuredProducts: { kind: 30405, dTag: 'featured_products', itemTag: 'a', itemKind: 30402 },
	featuredCollections: { kind: 30003, dTag: 'featured_collections', itemTag: 'a', itemKind: 30405 },
	featuredAuctions: { kind: 30409, dTag: 'featured_auctions', itemTag: 'a', itemKind: 30408 },
	featuredUsers: { kind: 30000, dTag: 'featured_users', itemTag: 'p' },
} as const

export type CurationListKey = keyof typeof CURATION_LISTS

export interface BlacklistData {
	blacklistedPubkeys: string[]
	blacklistedProducts: string[]
	blacklistedCollections: string[]
}

export function isHexPubkey(value: string): boolean {
	return /^[0-9a-f]{64}$/i.test(value)
}

export function isCoordinateOfKind(coordinate: string, expectedKind: number): boolean {
	const parts = coordinate.split(':')
	if (parts.length !== 3) return false
	const [kind, pubkey, dTag] = parts
	return parseInt(kind) === expectedKind && isHexPubkey(pubkey) && dTag.length > 0
}

export function isValidCurationListItem(list: CurationListKey, item: string): boolean {
	const spec = CURATION_LISTS[list]
	return 'itemKind' in spec ? isCoordinateOfKind(item, spec.itemKind) : isHexPubkey(item)
}

/** Item values of a list event in published order. */
export function readCurationListItems(list: CurationListKey, tags: readonly string[][] | undefined): string[] {
	const itemTag = CURATION_LISTS[list].itemTag
	return (tags ?? []).filter((tag) => tag[0] === itemTag && tag[1]).map((tag) => tag[1])
}

export function buildCurationListEventData(list: CurationListKey, items: readonly string[]): UnsignedEventData {
	const spec = CURATION_LISTS[list]
	const header = list === 'featuredProducts' ? [['title', 'Featured Products']] : []
	return {
		kind: spec.kind,
		content: list === 'featuredProducts' ? 'Featured products collection' : '',
		tags: [['d', spec.dTag], ...header, ...items.map((item) => [spec.itemTag, item])],
	}
}

/** NIP-51 mute list: muted pubkeys as `p`, products then collections as `a`. */
export function buildBlacklistEventData(data: BlacklistData): UnsignedEventData {
	return {
		kind: MUTE_LIST_KIND,
		content: '',
		tags: [
			...data.blacklistedPubkeys.map((pubkey) => ['p', pubkey]),
			...data.blacklistedProducts.map((coordinate) => ['a', coordinate]),
			...data.blacklistedCollections.map((coordinate) => ['a', coordinate]),
		],
	}
}

export type ListMembershipIssue = 'already-listed' | 'not-listed'

export function addListItem(items: readonly string[], item: string): Result<string[], ListMembershipIssue> {
	return items.includes(item) ? failure('already-listed') : success([...items, item])
}

export function removeListItem(items: readonly string[], item: string): Result<string[], ListMembershipIssue> {
	return items.includes(item) ? success(items.filter((existing) => existing !== item)) : failure('not-listed')
}

/** Current role lists; `null` means no list event was found. */
export interface RoleListsState {
	admins: string[] | null
	editors: string[] | null
	owner?: string
}

/** Lists to republish; omitted lists are unchanged. */
export interface RoleChangePlan {
	admins?: string[]
	editors?: string[]
}

export type RoleChangeIssue =
	| 'no-admin-list'
	| 'no-editor-list'
	| 'already-admin'
	| 'already-editor'
	| 'not-admin'
	| 'not-editor'
	| 'last-admin'
	| 'owner-protected'
	| 'no-roles'

export type RoleChange =
	| 'addAdmin'
	| 'removeAdmin'
	| 'addEditor'
	| 'removeEditor'
	| 'promoteEditorToAdmin'
	| 'demoteAdminToEditor'
	| 'promoteUserToEditor'
	| 'demoteEditorToUser'
	| 'removeFromAllRoles'

/** Pure role-transition rules: owner and last admin are protected; editors may become empty. */
export function planRoleChange(change: RoleChange, state: RoleListsState, user: string): Result<RoleChangePlan, RoleChangeIssue> {
	const admins = state.admins ?? []
	const editors = state.editors ?? []
	const isAdmin = admins.includes(user)
	const isEditor = editors.includes(user)
	const withoutUser = (list: string[]) => list.filter((pubkey) => pubkey !== user)

	switch (change) {
		case 'addAdmin':
			return isAdmin ? failure('already-admin') : success({ admins: [...admins, user] })
		case 'removeAdmin':
			if (!state.admins) return failure('no-admin-list')
			if (!isAdmin) return failure('not-admin')
			if (admins.length === 1) return failure('last-admin')
			return success({ admins: withoutUser(admins) })
		case 'addEditor':
			return isEditor ? failure('already-editor') : success({ editors: [...editors, user] })
		case 'removeEditor':
		case 'demoteEditorToUser':
			if (!state.editors) return failure('no-editor-list')
			if (!isEditor) return failure('not-editor')
			return success({ editors: withoutUser(editors) })
		case 'promoteEditorToAdmin':
			if (!state.admins) return failure('no-admin-list')
			if (isAdmin) return failure('already-admin')
			if (!isEditor) return failure('not-editor')
			return success({ admins: [...admins, user], editors: withoutUser(editors) })
		case 'demoteAdminToEditor':
			if (!state.admins) return failure('no-admin-list')
			if (!isAdmin) return failure('not-admin')
			if (state.owner === user) return failure('owner-protected')
			if (admins.length === 1) return failure('last-admin')
			return success({ admins: withoutUser(admins), editors: isEditor ? editors : [...editors, user] })
		case 'promoteUserToEditor':
			if (isAdmin) return failure('already-admin')
			if (isEditor) return failure('already-editor')
			return success({ editors: [...editors, user] })
		case 'removeFromAllRoles': {
			const plan: RoleChangePlan = {}
			if (state.admins && isAdmin) {
				if (state.owner === user) return failure('owner-protected')
				if (admins.length === 1) return failure('last-admin')
				plan.admins = withoutUser(admins)
			}
			if (state.editors && isEditor) plan.editors = withoutUser(editors)
			return plan.admins || plan.editors ? success(plan) : failure('no-roles')
		}
	}
}
