import type { EventPublishContext } from '../../core/ports/eventPublish'
import type { SignedEventLike } from '../../core/ports/signer'
import { signAndPublish } from '../../core/publishing'
import {
	buildBlacklistEventData,
	buildCurationListEventData,
	isHexPubkey,
	isValidCurationListItem,
	type BlacklistData,
	type CurationListKey,
	type RoleChangePlan,
} from './curationLists'

export type CurationPublishIssue = { issue: 'invalid-item'; item: string } | { issue: 'admins-required' }

export type CurationPublishOutcome<SignedEvent> = { ok: true; event: SignedEvent } | ({ ok: false } & CurationPublishIssue)

/**
 * Curation lists are signed by the curator; the host's `publish` decides where they go
 * (the web host submits them to the app server, which re-signs with the app key).
 */
export async function publishCurationListWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	list: CurationListKey,
	items: readonly string[],
): Promise<CurationPublishOutcome<SignedEvent>> {
	if (list === 'admins' && items.length === 0) return { ok: false, issue: 'admins-required' }
	const invalid = items.find((item) => !isValidCurationListItem(list, item))
	if (invalid !== undefined) return { ok: false, issue: 'invalid-item', item: invalid }

	return { ok: true, event: await signAndPublish(context, buildCurationListEventData(list, items)) }
}

export async function publishBlacklistWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	data: BlacklistData,
): Promise<CurationPublishOutcome<SignedEvent>> {
	const invalid = data.blacklistedPubkeys.find((pubkey) => !isHexPubkey(pubkey))
	if (invalid !== undefined) return { ok: false, issue: 'invalid-item', item: invalid }

	return { ok: true, event: await signAndPublish(context, buildBlacklistEventData(data)) }
}

export type RoleChangePublishOutcome<SignedEvent> =
	| { ok: true; adminEvent?: SignedEvent; editorEvent?: SignedEvent }
	| ({ ok: false; list: 'admins' | 'editors' } & CurationPublishIssue)

/** Admin list first, then editors; not atomic — a failure after the first publish leaves the first change in place. */
export async function publishRoleChangeWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	plan: RoleChangePlan,
): Promise<RoleChangePublishOutcome<SignedEvent>> {
	const result: { ok: true; adminEvent?: SignedEvent; editorEvent?: SignedEvent } = { ok: true }
	if (plan.admins) {
		const outcome = await publishCurationListWorkflow(context, 'admins', plan.admins)
		if (!outcome.ok) return { ...outcome, list: 'admins' }
		result.adminEvent = outcome.event
	}
	if (plan.editors) {
		const outcome = await publishCurationListWorkflow(context, 'editors', plan.editors)
		if (!outcome.ok) return { ...outcome, list: 'editors' }
		result.editorEvent = outcome.event
	}
	return result
}
