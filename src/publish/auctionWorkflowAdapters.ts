import type { EventTemplate } from 'nostr-tools/pure'
import type { SignedEventLike } from '@sdk/core/ports/signer'
import {
	executeAuctionListingTemplateWorkflow,
	executeAuctionPathReleaseWorkflow,
	executeAuctionSettlementWorkflow,
	executeAuctionWinnerClaimWorkflow,
	type AuctionListingPublishPorts,
	type AuctionPathReleaseLeg,
	type AuctionPathReleaseWorkflowPorts,
	type AuctionSettlementPlan,
	type AuctionSettlementWorkflowPorts,
	type AuctionWinnerClaimInput,
	type AuctionWinnerClaimPorts,
} from '@sdk/commerce/auctions'

/** Host boundary for auction listing mint checks, event construction, signing, and relay publication. */
export function runAuctionListingAppAdapter<SignedEvent extends SignedEventLike>(params: {
	prepareTemplate: () => EventTemplate | Promise<EventTemplate>
	mints: readonly string[]
	ports: AuctionListingPublishPorts<SignedEvent>
}) {
	return executeAuctionListingTemplateWorkflow(params.prepareTemplate, params.mints, params.ports)
}

/** Host boundary for bidder-chain signing, publication, and local record updates. */
export function runAuctionPathReleaseAppAdapter<Template, SignedEvent extends SignedEventLike>(params: {
	legs: readonly AuctionPathReleaseLeg<Template>[]
	ports: AuctionPathReleaseWorkflowPorts<Template, SignedEvent>
}) {
	return executeAuctionPathReleaseWorkflow(params.legs, params.ports)
}

/** Host boundary for verified seller-settlement plans and wallet/mint effects. */
export function runAuctionSettlementAppAdapter<RedemptionData>(params: {
	plan: AuctionSettlementPlan<RedemptionData>
	ports: AuctionSettlementWorkflowPorts<RedemptionData>
}) {
	return executeAuctionSettlementWorkflow(params.plan, params.ports)
}

/** Host boundary for NIP-59 private claim delivery and its relay-scoped public marker. */
export function runAuctionWinnerClaimAppAdapter<PrivateDelivery, SignedMarker extends SignedEventLike>(params: {
	claim: AuctionWinnerClaimInput
	ports: AuctionWinnerClaimPorts<PrivateDelivery, SignedMarker>
}) {
	return executeAuctionWinnerClaimWorkflow(params.claim, params.ports)
}
