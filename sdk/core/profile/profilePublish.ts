import type { EventPublishContext } from '../ports/eventPublish'
import type { SignedEventLike } from '../ports/signer'
import { signAndPublish, type UnsignedEventData } from '../publishing'

export const PROFILE_METADATA_KIND = 0

/** NIP-01 kind-0 content; unknown fields are kept so other clients' metadata survives a republish. */
export type ProfileMetadata = Record<string, unknown>

export function buildProfileMetadataEventData(profile: ProfileMetadata): UnsignedEventData {
	return { kind: PROFILE_METADATA_KIND, content: JSON.stringify(profile), tags: [] }
}

export function mergeProfileField<Profile extends ProfileMetadata>(current: Profile, field: string, value: string | undefined): Profile {
	return { ...current, [field]: value }
}

/** Kind 0 is replaceable: the published profile fully replaces the previous one. */
export function publishProfileWorkflow<SignedEvent extends SignedEventLike>(
	context: EventPublishContext<SignedEvent>,
	profile: ProfileMetadata,
): Promise<SignedEvent> {
	return signAndPublish(context, buildProfileMetadataEventData(profile))
}
