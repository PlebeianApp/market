/** Public, incident-specific successor enrollment roots preserved on 2026-11-06. */
export interface IncidentSignerSuccessorPinV1 {
	enrollmentSha256: string
	restartEpoch: number
	signerIdentity: string
}

export type IncidentSignerSuccessorPinsV1 = Readonly<Record<1 | 2 | 3 | 4, Readonly<IncidentSignerSuccessorPinV1>>>

export const INCIDENT_SIGNER_SUCCESSORS_20261106: IncidentSignerSuccessorPinsV1 = Object.freeze({
	1: Object.freeze({
		enrollmentSha256: '8525f9b48e400fd7c5e4325ddff7df26954e7183c041abc474bffafc7a1042df',
		restartEpoch: 6,
		signerIdentity: '7bbd6fefa289786174bfe6aaedd28b82dd53b22e36bc2ab6ad8bd874c7d30b63',
	}),
	2: Object.freeze({
		enrollmentSha256: '6eb5a7297e6e809e8f6d19998ed3b5413cf30e8d18e7961ff22291c58a6d85fc',
		restartEpoch: 5,
		signerIdentity: '595a24ce72978be91ae993c96d28bfc12d6ccb94212599ff69f7d1371f9a6a91',
	}),
	3: Object.freeze({
		enrollmentSha256: '567d371a4498f787fdbea91db1113e43031f41a6dc0d593029178905e4ee6986',
		restartEpoch: 5,
		signerIdentity: '298da713895db65b5b860a11307a78ae8a3057daa7d938af60ca13e439a31b42',
	}),
	4: Object.freeze({
		enrollmentSha256: '15c368d2557bcaa22ace45c393adcba2b421f08199acea52782dc72adf69fd49',
		restartEpoch: 5,
		signerIdentity: 'bfa05c77a3f23666e3b586a8edca5e50aa6717c309132ed2f9bee93ac7fc3956',
	}),
})

/** Public successor enrollment roots produced by the reviewed R45 recovery on 2026-11-09. */
export const INCIDENT_SIGNER_SUCCESSORS_20261109: IncidentSignerSuccessorPinsV1 = Object.freeze({
	1: Object.freeze({
		enrollmentSha256: '49741fbb5da4e23170afaf2c8b1929b5fdde94f59bf620ebe335e59d96a41f17',
		restartEpoch: 8,
		signerIdentity: '7bbd6fefa289786174bfe6aaedd28b82dd53b22e36bc2ab6ad8bd874c7d30b63',
	}),
	2: Object.freeze({
		enrollmentSha256: 'e59c6fa6e83debec6b28f626ff3041ae16cff8352da7c7bdcaf31a32d555bdee',
		restartEpoch: 7,
		signerIdentity: '595a24ce72978be91ae993c96d28bfc12d6ccb94212599ff69f7d1371f9a6a91',
	}),
	3: Object.freeze({
		enrollmentSha256: '36b264e760f7d903c649da15d6a3aec4befd8c160b5291b7b664af863230e524',
		restartEpoch: 7,
		signerIdentity: '298da713895db65b5b860a11307a78ae8a3057daa7d938af60ca13e439a31b42',
	}),
	4: Object.freeze({
		enrollmentSha256: '4d5581b48f9f2f0a11e9a601e837a4ace7c08ee2a0549736238ef22441efe115',
		restartEpoch: 7,
		signerIdentity: 'bfa05c77a3f23666e3b586a8edca5e50aa6717c309132ed2f9bee93ac7fc3956',
	}),
})
