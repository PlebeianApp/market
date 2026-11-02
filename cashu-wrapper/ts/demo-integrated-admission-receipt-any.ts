/**
 * Version-dispatched admission framing shared by participant policy, FROST,
 * and the Friday V4 funding service.  V3 remains accepted for the preserved
 * local harness; V4 is required by the browser-prepared package route.
 */
import {
	demoIntegratedFundingAdmissionSignatureDigest,
	demoIntegratedFundingReceiptCanonicalBytes,
	demoIntegratedFundingReceiptDigest,
	type DemoIntegratedFundingReceiptUnsigned,
	verifyDemoIntegratedFundingReceipt,
	type DemoIntegratedFundingReceiptV2,
} from './demo-integrated-funding-receipt'
import {
	demoIntegratedFundingV4AdmissionSignatureDigest,
	demoIntegratedFundingV4CanonicalBytes,
	demoIntegratedFundingV4ReceiptDigest,
	type DemoIntegratedFundingReceiptV4Unsigned,
	verifyDemoIntegratedFundingReceiptV4,
	type DemoIntegratedFundingReceiptV4,
} from './demo-integrated-funding-receipt-v4'

export type DemoIntegratedFundingReceiptAny = DemoIntegratedFundingReceiptV2 | DemoIntegratedFundingReceiptV4

export type DemoIntegratedFundingReceiptAnyUnsigned =
	| DemoIntegratedFundingReceiptUnsigned
	| DemoIntegratedFundingReceiptV4Unsigned

export function demoIntegratedFundingAnyReceiptDigest(
	value: DemoIntegratedFundingReceiptAnyUnsigned,
): string {
	return value.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		? demoIntegratedFundingV4ReceiptDigest(value)
		: demoIntegratedFundingReceiptDigest(value)
}

export function demoIntegratedFundingAnyCanonicalBytes(
	value: DemoIntegratedFundingReceiptAnyUnsigned,
): Uint8Array {
	return value.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		? demoIntegratedFundingV4CanonicalBytes(value)
		: demoIntegratedFundingReceiptCanonicalBytes(value)
}

export function demoIntegratedFundingAnyAdmissionSignatureDigest(
	value: DemoIntegratedFundingReceiptAnyUnsigned,
	participantPolicyDigest: string,
): string {
	return value.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		? demoIntegratedFundingV4AdmissionSignatureDigest(value, participantPolicyDigest)
		: demoIntegratedFundingAdmissionSignatureDigest(value, participantPolicyDigest)
}

export function verifyDemoIntegratedFundingReceiptAny(value: DemoIntegratedFundingReceiptAny): DemoIntegratedFundingReceiptAny {
	return value.schema === 'PlebeianAuctionsPOCIntegratedFundingV4'
		? verifyDemoIntegratedFundingReceiptV4(value)
		: verifyDemoIntegratedFundingReceipt(value)
}
