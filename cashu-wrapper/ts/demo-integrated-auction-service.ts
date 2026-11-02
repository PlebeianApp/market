/**
 * Smallest application service boundary for the integrated fake-money route.
 * Admission and terminal execution are separated by real Comet history; this
 * object does not invent cross-system atomicity or a coordinator outcome flag.
 */
import {
	admitDemoIntegratedThreshold3Bid,
	type DemoAdmissionParticipantPorts,
	type DemoIntegratedAdmissionThreshold3Port,
	type DemoIntegratedBidConsensusPort,
} from './demo-integrated-admission-service'
import type { DemoIntegratedAdmissionDkgBindingV1 } from './demo-integrated-admission-policy'
import type { DemoIntegratedFundingReceiptUnsigned } from './demo-integrated-funding-receipt'
import type { DemoMaintainerExactTemplateBundle, DemoMaintainerOfflineStore } from './demo-maintainer-offline'
import {
	executeDemoIntegratedThreshold3Terminal,
	type DemoIntegratedThreshold3TerminalRequest,
} from './demo-integrated-threshold3-terminal-service'

type Four<T> = [T, T, T, T]

export interface DemoIntegratedAuctionServiceOptions {
	dkgBinding: DemoIntegratedAdmissionDkgBindingV1
	admissionParticipants: Four<DemoAdmissionParticipantPorts>
	admissionCommittee: DemoIntegratedAdmissionThreshold3Port
	offlineStore: DemoMaintainerOfflineStore
	admissionConsensus: DemoIntegratedBidConsensusPort
}

export function createDemoIntegratedThreshold3AuctionService(options: DemoIntegratedAuctionServiceOptions) {
	return Object.freeze({
		async admitBid(request: {
			unsignedReceipt: DemoIntegratedFundingReceiptUnsigned
			bundle: DemoMaintainerExactTemplateBundle
			nowSeconds: number
		}) {
			return admitDemoIntegratedThreshold3Bid({
				...request, dkgBinding: structuredClone(options.dkgBinding),
				participants: options.admissionParticipants, committee: options.admissionCommittee,
				offlineStore: options.offlineStore, consensus: options.admissionConsensus,
			})
		},
		async executeTerminal(request: DemoIntegratedThreshold3TerminalRequest) {
			return executeDemoIntegratedThreshold3Terminal(request)
		},
	})
}
