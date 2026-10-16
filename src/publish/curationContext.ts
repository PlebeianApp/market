import { submitAppSettings } from '@/lib/appSettings'
import type { NDKSigner } from '@/lib/nostr/ndk-events'
import { createNdkPublishContext, type NdkClient } from '@platform/web/ndkPublishContext'
import type { CurationPublishIssue } from '@sdk/commerce/curation'

export type { NdkClient }

/** Curation lists go to the app server, which re-signs them with the app key. */
export function createAppSettingsPublishContext(ndk: NdkClient, signer: NDKSigner) {
	return createNdkPublishContext(ndk, signer, (event) => submitAppSettings(event.rawEvent()))
}

/** Lists live under the app pubkey; without one, fall back to the signer's own pubkey. */
export async function resolveListOwner(signer: NDKSigner, appPubkey?: string): Promise<string> {
	const currentUser = await signer.user()
	if (!currentUser || !currentUser.pubkey) {
		throw new Error('Unable to get current user pubkey')
	}
	return appPubkey || currentUser.pubkey
}

export function curationIssueMessage(issue: CurationPublishIssue, invalidItemLabel = 'pubkey'): string {
	return issue.issue === 'admins-required' ? 'At least one admin is required' : `Invalid ${invalidItemLabel} format: ${issue.item}`
}
