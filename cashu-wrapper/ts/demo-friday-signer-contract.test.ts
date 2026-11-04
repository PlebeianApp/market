// Valid fixed synthetic branch fixture reused with a selected mint identity.
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { HDKey } from '@scure/bip32'
import { demoIntegratedFundingBundleDigest, prepareDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptTerms } from './demo-integrated-funding-receipt'
import { demoMaintainerExactTemplateDigest, demoMaintainerTemplateBundleDigest, type DemoMaintainerExactBranchTemplate, type DemoMaintainerExactTemplateBundle } from './demo-maintainer-offline'
import { buildDemoSigAllSecret, demoCashuSigAllDigest, demoOutputsDigest, demoRecipientCapabilityDigest } from './demo-sigall-settlement'
import { proofPoint, type BlindedMessage, type CashuProof } from './nut-client'
const scalar = (value: number): string => value.toString(16).padStart(64, '0')
const publicKey = (value: number): string => bytesToHex(secp256k1.getPublicKey(hexToBytes(scalar(value)), true))
const sign = (digest: string, value: number): string => bytesToHex(schnorr.sign(hexToBytes(digest), hexToBytes(scalar(value))))
const digest = (value: string): string => value.repeat(64)

function branch(role: 'winner_settlement' | 'refund', mintUrl: string): DemoMaintainerExactBranchTemplate {
	const bidderPublicKey = publicKey(1), committeePublicKey = publicKey(3), refundPublicKey = publicKey(4)
	const inputs: CashuProof[] = [4, 8].map((amount, index) => ({
		amount, id: 'keyset-1', C: publicKey(30 + index),
		secret: buildDemoSigAllSecret({ nonce: `${index + 1}`.padStart(64, '0'), bidderPublicKey, committeePublicKey, refundPublicKey, locktime: 2_700 }),
	}))
	const outputs: BlindedMessage[] = role === 'refund'
		? [{ amount: 12, id: 'keyset-1', B_: publicKey(42) }]
		: [{ amount: 4, id: 'keyset-1', B_: publicKey(40) }, { amount: 8, id: 'keyset-1', B_: publicKey(41) }]
	const seller = HDKey.fromMasterSeed(new Uint8Array(32).fill(0x42))
	const path = 'm/1/2/3/4/5'
	const sellerPrivate = bytesToHex(seller.derive(path).privateKey!)
	const exactRecipientPublicKey = role === 'refund'
		? refundPublicKey
		: bytesToHex(secp256k1.getPublicKey(hexToBytes(sellerPrivate), true))
	const recipientSecret = role === 'refund' ? 4 : null
	const capabilityBase = {
		schema: 'COCO_DEMO_RECIPIENT_CAPABILITY_V1' as const, network: digest('a'), chainId: 'demo-chain', auctionId: 'auction-1',
		operationId: digest('f'), role, mintUrl, unit: 'sat' as const,
		recipientPublicKey: exactRecipientPublicKey, outputsDigest: demoOutputsDigest(outputs), signature: '00'.repeat(64),
	}
	const recipientSignature = recipientSecret === null
		? bytesToHex(schnorr.sign(hexToBytes(demoRecipientCapabilityDigest(capabilityBase)), hexToBytes(sellerPrivate)))
		: sign(demoRecipientCapabilityDigest(capabilityBase), recipientSecret)
	const cashuSigAllDigest = demoCashuSigAllDigest(inputs, outputs)
	const value: DemoMaintainerExactBranchTemplate = {
		schema: 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1', role, network: capabilityBase.network, chainId: capabilityBase.chainId,
		// Exact spend branches are prepared before the final Nostr event exists.
		// These two legacy-named slots carry the stable pre-commit funding intent;
		// authenticated Comet history later binds it to the concrete event id.
		auctionId: capabilityBase.auctionId, operationId: capabilityBase.operationId,
		bidId: capabilityBase.operationId, bidEventId: capabilityBase.operationId,
		bidderActorId: publicKey(2).slice(2), amount: 12, inputFee: 0, mintUrl: capabilityBase.mintUrl, unit: 'sat',
		locktime: 2_700, validUntil: 2_000, closeTime: 1_900, settlementWindowSeconds: 500,
		sellerP2pkXpub: seller.publicExtendedKey, bidderDerivationPath: path, recipientPublicKey: exactRecipientPublicKey,
		bidderPublicKey, refundPublicKey, committeePublicKey, committeeKeysetId: 'committee-1', committeeKeysetVersion: '1',
		threshold: 3, participants: [1, 2, 3, 4].map((identifier) => ({ identifier: identifier as 1 | 2 | 3 | 4, verifyingShare: publicKey(10 + identifier) })),
		mintSeal: { mintUrl: capabilityBase.mintUrl, mintPublicKey: publicKey(80), serverVersion: 'Nutshell/0.19.2', activeSatKeysetId: 'keyset-1', denominationKeyDigest: digest('c'), denominationAmounts: [1, 2, 4, 8, 12], inputFeePpk: 0, nuts: [4, 7, 9, 10, 11] },
		inputs, outputs, recipientCapability: { ...capabilityBase, signature: recipientSignature }, templateDigest: digest('0'),
		cashuSigAllDigest, bidderMainSignature: sign(cashuSigAllDigest, 1),
		...(role === 'refund' ? { refundSignature: sign(cashuSigAllDigest, 4) } : {}),
	}
	value.templateDigest = demoMaintainerExactTemplateDigest(value)
	return value
}

function policyFixture(mintUrl: string, directSeller = false) {
	const winner = branch('winner_settlement', mintUrl), refund = branch('refund', mintUrl)
	const bundle: DemoMaintainerExactTemplateBundle = {
		schema: 'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1', preparedAt: 1_000, winner, refund,
		actorWinnerAuthorization: {
			actorId: winner.bidderActorId, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, 2),
		},
		actorReturnAuthorization: {
			actorId: winner.bidderActorId, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, 2),
		},
		bundleDigest: digest('0'), actorBundleSignature: '00'.repeat(64), bidderBundleSignature: '00'.repeat(64),
	}
	bundle.bundleDigest = demoMaintainerTemplateBundleDigest(bundle)
	bundle.actorBundleSignature = sign(bundle.bundleDigest, 2)
	bundle.bidderBundleSignature = sign(bundle.bundleDigest, 1)
	if (directSeller) {
		const sellerPaymentPublicKey = winner.recipientPublicKey
		for (const template of [bundle.winner, bundle.refund]) {
			template.schema = 'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V2'
			delete template.sellerP2pkXpub
			delete template.bidderDerivationPath
			template.sellerPaymentPublicKey = sellerPaymentPublicKey
			template.templateDigest = demoMaintainerExactTemplateDigest(template)
		}
		bundle.actorWinnerAuthorization = {
			schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
			paymentPublicKey: winner.bidderPublicKey, packageDigest: winner.templateDigest,
			signature: sign(winner.templateDigest, 1),
		}
		bundle.actorReturnAuthorization = {
			schema: 'COCO_DEMO_PAYMENT_KEY_PACKAGE_AUTHORIZATION_V1',
			paymentPublicKey: winner.bidderPublicKey, packageDigest: refund.templateDigest,
			signature: sign(refund.templateDigest, 1),
		}
		bundle.bundleDigest = demoMaintainerTemplateBundleDigest(bundle)
		bundle.actorBundleSignature = sign(bundle.bundleDigest, 1)
		bundle.bidderBundleSignature = sign(bundle.bundleDigest, 1)
	}
	const refs = winner.inputs.map((proof) => bytesToHex(proofPoint(proof).toBytes(true))).sort()
	const terms: DemoIntegratedFundingReceiptTerms = {
		schema: 'PlebeianAuctionsPOCIntegratedFundingV3', auth_network_id: winner.network, chain_id: winner.chainId,
		mint_url: winner.mintUrl, auction_id: winner.auctionId,
		bidder: winner.bidderActorId, bid_amount: 12, pool_amount: 12, replaces_bid_id: '', funding_operation_id: winner.operationId,
		attested_at: 1_001, expires_at: 1_201, proof_state_refs: refs, active_keyset_id: 'keyset-1', input_fee_ppk: 0,
		locktime: winner.locktime, bidder_public_key: winner.bidderPublicKey, refund_public_key: winner.refundPublicKey,
		committee_public_key: winner.committeePublicKey, committee_keyset_id: winner.committeeKeysetId,
		committee_keyset_version: winner.committeeKeysetVersion, dkg_run_id: 'dkg-run-1',
		public_key_package_sha256: digest('d'), signer_roster_digest: digest('e'), winner_package_digest: winner.templateDigest,
		return_package_digest: refund.templateDigest, return_cashu_sigall_digest: refund.cashuSigAllDigest,
		bidder_return_signature: refund.bidderMainSignature,
	}
	if (mintUrl.startsWith('https:')) {
		const content = { schema: 'PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1' as const,
			authNetworkId: terms.auth_network_id, chainId: terms.chain_id, auctionId: terms.auction_id,
			amount: terms.pool_amount, mintUrl, paymentPublicKey: terms.bidder_public_key,
			refundPublicKey: terms.refund_public_key, fundingOperationId: terms.funding_operation_id,
			bundleDigest: bundle.bundleDigest, returnPackageDigest: terms.return_package_digest,
			returnCashuSigAllDigest: terms.return_cashu_sigall_digest,
			bidderReturnSignature: terms.bidder_return_signature, expiresAt: terms.expires_at }
		const kd = demoFridayFundingKeyAuthorizationDigest(terms.bidder, content)
		const unsigned = demoFridayFundingAuthorizationUnsignedEvent(terms.bidder, terms.attested_at, {
			...content, paymentKeyAuthorizationSignature: sign(kd, 1), refundKeyAuthorizationSignature: sign(kd, 4) })
		const id = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0,unsigned.pubkey,unsigned.created_at,unsigned.kind,unsigned.tags,unsigned.content]))))
		const receipt = prepareDemoIntegratedFundingReceiptV4({ ...terms, schema: 'PlebeianAuctionsPOCIntegratedFundingV4',
			prepared_bundle_digest: bundle.bundleDigest, actor_funding_authorization: { ...unsigned, id, sig: sign(id, 2) } })
		return { bundle, receipt, refs }
	}
	const receipt = prepareDemoIntegratedFundingReceipt(terms, sign(demoIntegratedFundingBundleDigest(terms), 2))
	return { bundle, receipt, refs }
}


import { prepareDemoIntegratedFundingReceiptV4 } from './demo-integrated-funding-receipt-v4'
import { demoFridayFundingKeyAuthorizationDigest, demoFridayFundingAuthorizationUnsignedEvent } from './demo-friday-browser-funding-authorization'
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightDemoFridaySignerPolicyComposition, demoFridaySignerCometFetch, ensureDemoFridaySignerScratch } from './demo-friday-signer-contract'
import { sha256 } from '@noble/hashes/sha2.js'
import { createDemoFipsAdmissionParticipant, assertDemoFipsAdmissionPins } from './demo-fips-admission-policy'
import { createDemoFipsFundingAbortParticipant, assertDemoFipsFundingAbortPins } from './demo-fips-funding-abort-policy'
import { createDemoFipsTerminalPolicyPorts, assertDemoFipsTerminalPins } from './demo-fips-terminal-policy'
import type { DemoDispositionSignerAnchor } from './demo-disposition-signer-anchor'
import type { DemoFrostParticipantPolicyPackage } from './demo-frost-participant-policy'
import { demoFridayFundingAbortActorUnsignedEvent } from './demo-friday-funding-pool-lifecycle'

const live = { schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2', deployment_id: 'friday-test', run_id: 'run-test', application_host_slot: 2,
	fips_ulas: ['fd42::1','fd42::2','fd42::3','fd42::4'], comet_p2p_port: 27656, comet_rpc_port: 27657,
	signer_rpc_port: 39101, mint_port: 3438, cashu_mint_url: 'https://mint.example', site_port: 8180,
	network_root: '/var/lib/plebeian-auctions-friday/network', dkg_root: '/var/lib/plebeian-auctions-friday/frost/keyset-v1',
	coordinator_root: '/var/lib/plebeian-auctions-friday/coordinator', coordinator_rpc_identity_path: '/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key' }
const r20 = { ...live, schema:'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3', deployment_id:'friday-demo-20261023-r20',run_id:'friday-demo-20261023-r20-run1',
	network_root:'/var/lib/plebeian-auctions-friday/network-r20', dkg_root:'/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2',
	coordinator_root:'/var/lib/plebeian-auctions-friday/coordinator-v2', coordinator_rpc_identity_path:'/var/lib/plebeian-auctions-friday/coordinator-v2/coordinator-rpc-identity.key' }
const lab = { schema:'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2',run_id:'lab-test',fips_ulas:live.fips_ulas,
	comet_p2p_port:26656,comet_rpc_port:26657,signer_rpc_port:39101,mint_port:3338,
	network_root:'/tmp/plebeian-friday-fips-lab.contract/network',dkg_root:'/tmp/plebeian-friday-fips-lab.contract/frost/keyset',driver_result:'/tmp/plebeian-friday-fips-lab.contract/result.json' }
const facts = { chain_id:'demo-chain', genesis_sha256:digest('7'),validators_hash:digest('8'),validator_roster_version:'genesis-v1' }
const dkg = { committeePublicKey:publicKey(3),committeeKeysetId:'committee-1',committeeKeysetVersion:'1',dkgRunId:'dkg-run-1',publicKeyPackageSha256:digest('d'),signerRosterDigest:digest('e') }
const validate = { admission:assertDemoFipsAdmissionPins,fundingAbort:assertDemoFipsFundingAbortPins,terminal:assertDemoFipsTerminalPins }
function composition(application: unknown=r20, slot: 1|2|3|4=1) {
	return preflightDemoFridaySignerPolicyComposition({application,slot,facts,dkg,validate})
}
function build(application: unknown=r20, endpoint?: string, transport?: typeof fetch) {
	const c=composition(application), calls={fetch:0,claims:0}, { contract }=c
	const fetchImpl=transport ?? (Object.assign(async ():Promise<Response>=>{calls.fetch++;throw new Error('unexpected read')},{preconnect:fetch.preconnect}))
	const proofUse={claimAdmissionProofs(){calls.claims++}}
	// Only constructor/closure-read fields are used here; no terminal economic
	// authorization is requested or accepted by these construction fixtures.
	const policy={mintUrl:contract.mintUrl,activeKeysetId:'keyset-1',committeePublicKey:dkg.committeePublicKey,auctionId:'auction-1'} as DemoFrostParticipantPolicyPackage
	const pins=(p:typeof c.admissionPins|typeof c.abortPins|typeof c.terminalPins)=>({...p,cometRpc:endpoint??p.cometRpc})
	return {c,calls, admission:()=>createDemoFipsAdmissionParticipant({contract,pins:pins(c.admissionPins) as typeof c.admissionPins,proofUse,fetchImpl}),
		abort:()=>createDemoFipsFundingAbortParticipant({contract,pins:{...pins(c.abortPins),activeKeysetId:'keyset-1'} as typeof c.abortPins & {activeKeysetId:string},proofUse,fetchImpl}),
		terminal:()=>createDemoFipsTerminalPolicyPorts({contract,pins:pins(c.terminalPins) as typeof c.terminalPins,anchor:{claimProofs(){calls.claims++}} as unknown as DemoDispositionSignerAnchor,policy,fetchImpl}) }
}
for(const [name,application,port] of [['lab',lab,26657],['live-v2',live,27657],['R20',r20,27657]] as const) {
	test(`P1 ${name}: exact pre-bootstrap composition and all concrete factories construct without reads or claims`,()=>{
		const s=build(application); expect(s.c.contract.cometRpc).toBe(`http://127.0.0.1:${port}`)
		s.admission();s.abort();s.terminal();expect(s.calls).toEqual({fetch:0,claims:0})
		expect(Object.isFrozen(s.c.contract)).toBe(true);expect(Object.isFrozen(s.c.contract.paths)).toBe(true)
		const other=build(application,`http://127.0.0.1:${port===26657?27657:26657}`)
		for(const factory of [other.admission,other.abort,other.terminal]) expect(factory).toThrow(/CONTRACT/)
		expect(other.calls).toEqual({fetch:0,claims:0})
	})
}
for(const endpoint of ['http://localhost:27657','http://127.0.0.1:27657/','http://127.0.0.1:27658','http://127.0.0.1:26657','http://127.0.0.1:27657/path','http://127.0.0.1:27657?q=x','http://127.0.0.1:27657#x','http://user@127.0.0.1:27657','https://127.0.0.1:27657','http://198.51.100.1:27657','http://127.000.000.001:27657']) {
	test(`P1 all factories reject non-selected RPC ${endpoint}`,()=>{
		const s=build(r20,endpoint);for(const factory of [s.admission,s.abort,s.terminal])expect(factory).toThrow(/CONTRACT/)
		expect(s.calls).toEqual({fetch:0,claims:0})
	})
}
test('P1 rejects fabricated contracts, changed topology and slot before validators/bootstrap',()=>{
	const s=build();expect(()=>assertDemoFipsAdmissionPins({...s.c.contract},s.c.admissionPins)).toThrow(/CONTRACT/)
	for(const change of [{comet_rpc_port:26657},{dkg_root:live.dkg_root},{schema:live.schema},{run_id:'another'},{fips_ulas:['fd42::1','fd42::1','fd42::3','fd42::4']}])expect(()=>composition({...r20,...change})).toThrow()
	expect(()=>composition(r20,5 as never)).toThrow()
	let touched=0;expect(()=>preflightDemoFridaySignerPolicyComposition({application:{...r20,comet_rpc_port:26657},slot:1,facts,dkg,
		validate:{admission(){touched++},fundingAbort(){touched++},terminal(){touched++}}})).toThrow();expect(touched).toBe(0)
	expect(()=>assertDemoFipsAdmissionPins(s.c.contract,{...s.c.admissionPins,participantId:2})).toThrow(/CONTRACT/)
})
function observedFetch(nodeChain='demo-chain',stateChain='demo-chain',mode:'normal'|'outage'|'redirect'='normal') {
	const urls:string[]=[],redirects:RequestRedirect[]=[],state={chain_id:stateChain,height:42,auctions:{},funding_lifecycles:{}}
	const bytes=Buffer.from(JSON.stringify(state)),appHash=bytesToHex(sha256(bytes));let mintReads=0
	const fetchImpl=Object.assign(async (input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
		const url=new URL(input instanceof Request?input.url:String(input));urls.push(url.href)
		if(url.hostname!=='127.0.0.1'){mintReads++;const response=Response.json({keysets:[]});Object.defineProperty(response,'url',{value:url.href});return response}
		redirects.push(init?.redirect??'follow')
		if(mode==='outage')throw new TypeError('read transport failed')
		if(mode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1:26657/status'}})
		if(url.pathname==='/status')return Response.json({result:{node_info:{network:nodeChain}}})
		if(url.pathname==='/abci_query')return Response.json({result:{response:{code:0,height:'42',value:Buffer.from(JSON.stringify({state,app_hash:appHash,canonical_state:bytes.toString('base64')})).toString('base64')}}})
		if(url.pathname==='/commit')return Response.json({result:{canonical:true,signed_header:{header:{height:url.searchParams.get('height'),time:'2026-10-28T00:00:00Z',app_hash:appHash.toUpperCase(),validators_hash:facts.validators_hash},commit:{block_id:{hash:digest('9')},signatures:['A','B','C'].map(x=>({block_id_flag:2,validator_address:x.repeat(40)}))}}}})
		throw new Error(`unexpected observation ${url.pathname}`)
	},{preconnect:fetch.preconnect})
	return {fetchImpl,urls,redirects,mintReads:()=>mintReads}
}
function requests(mintUrl:string){
	const f=policyFixture(mintUrl),t=f.bundle.refund
	const terms={schema:'PLEBEIAN_FRIDAY_FUNDING_ABORT_V1' as const,authNetworkId:t.network,chainId:t.chainId,genesisSha256:facts.genesis_sha256,auctionId:t.auctionId,operationId:t.operationId,actor:t.bidderActorId,mintUrl:t.mintUrl,activeKeysetId:'keyset-1',amount:t.amount,proofYs:f.refs,poolDigest:digest('6'),nut11LockPublicKeys:[t.bidderPublicKey,t.committeePublicKey] as [string,string],locktime:t.locktime,paymentPublicKey:t.bidderPublicKey,refundPublicKey:t.refundPublicKey,committeePublicKey:t.committeePublicKey,returnPackageDigest:t.templateDigest,returnCashuSigAllDigest:t.cashuSigAllDigest,bidderReturnSignature:t.bidderMainSignature,fundingAuthorizationEventId:digest('4'),abortNotBefore:1000,abortExpiresAt:1200,abortReason:'prebroadcast_service_failure' as const,committeeKeysetId:t.committeeKeysetId,committeeKeysetVersion:t.committeeKeysetVersion,dkgRunId:'dkg-run-1',publicKeyPackageSha256:digest('d'),signerRosterDigest:digest('e')}
	const unsigned=demoFridayFundingAbortActorUnsignedEvent(terms,1100),id=createHash('sha256').update(JSON.stringify([0,unsigned.pubkey,unsigned.created_at,unsigned.kind,unsigned.tags,unsigned.content])).digest('hex')
	return {admission:{receipt:f.receipt,bundle:f.bundle,nowSeconds:1100,dkgBinding:{dkgRunId:'dkg-run-1',publicKeyPackageSha256:digest('d'),signerRosterDigest:digest('e')}},
		abort:{schema:'COCO_DEMO_FUNDING_ABORT_PARTICIPANT_POLICY_REQUEST_V1' as const,actorTerms:terms,actorAbortEvent:{...unsigned,id,sig:sign(id,2)},evidence:{operationId:t.operationId,poolDigest:terms.poolDigest,proofYs:f.refs} as any,returnTemplate:t,nowSeconds:1100}}
}
for(const domain of ['admission','abort'] as const)for(const wrong of ['node','state','neither'] as const){
	test(`P1 ${domain}: ${wrong} chain with matching validator hash and authenticated state`,async()=>{
		const o=observedFetch(wrong==='node'?'wrong':'demo-chain',wrong==='state'?'wrong':'demo-chain'),s=build(r20,undefined,o.fetchImpl)
		// Admission's receipt uses its independent auth-network ID, while both
		// node and authenticated state are independently bound to demo-chain.
		const request=requests(s.c.contract.mintUrl)
		const participant=domain==='admission'?createDemoFipsAdmissionParticipant({contract:s.c.contract,pins:{...s.c.admissionPins,network:request.admission.receipt.auth_network_id},proofUse:{claimAdmissionProofs(){s.calls.claims++}},fetchImpl:o.fetchImpl}):createDemoFipsFundingAbortParticipant({contract:s.c.contract,pins:{...s.c.abortPins,authNetworkId:request.abort.actorTerms.authNetworkId,activeKeysetId:'keyset-1'},proofUse:{claimAdmissionProofs(){s.calls.claims++}},fetchImpl:o.fetchImpl})
		await expect((participant.preflightExact as any)(request[domain])).rejects.toThrow(wrong==='neither'?/MINT/:/chain differs/)
		expect(s.calls.claims).toBe(0);expect(o.mintReads()).toBe(wrong==='neither'?1:0)
		expect(o.urls.filter(x=>x.includes('127.0.0.1')).every(x=>new URL(x).origin===s.c.contract.cometRpc)).toBe(true)
		expect(o.redirects.every(x=>x==='manual')).toBe(true)
	})
}
for(const mode of ['outage','redirect'] as const)test(`P1 ${mode}: no legacy retry or redirect follow for concrete policies`,async()=>{
	const o=observedFetch('demo-chain','demo-chain',mode),s=build(r20,undefined,o.fetchImpl),r=requests(s.c.contract.mintUrl)
	const admission=createDemoFipsAdmissionParticipant({contract:s.c.contract,pins:{...s.c.admissionPins,network:r.admission.receipt.auth_network_id},proofUse:{claimAdmissionProofs(){s.calls.claims++}},fetchImpl:o.fetchImpl})
	await expect(admission.preflightExact(r.admission)).rejects.toThrow(mode==='redirect'?/REDIRECT/:/transport/)
	const abort=createDemoFipsFundingAbortParticipant({contract:s.c.contract,pins:{...s.c.abortPins,authNetworkId:r.abort.actorTerms.authNetworkId,activeKeysetId:'keyset-1'},proofUse:{claimAdmissionProofs(){s.calls.claims++}},fetchImpl:o.fetchImpl})
	await expect(abort.preflightExact(r.abort)).rejects.toThrow(mode==='redirect'?/REDIRECT/:/transport/)
	const terminal=s.terminal();await expect(terminal.closureVerifier.verifyAndDerive({schema:'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2',source:'participant-local',kind:'close',eventHeight:1})).rejects.toThrow(mode==='redirect'?/REDIRECT/:/transport/)
	expect(o.urls).toEqual(Array(3).fill(s.c.contract.cometRpc+'/status'));expect(o.redirects).toEqual(['manual','manual','manual']);expect(s.calls.claims).toBe(0)
})
test('P1 Comet origin guard rejects a foreign host before fetch',async()=>{
	let reads=0;const c=composition().contract,fetchImpl=Object.assign(async()=>{reads++;return Response.json({})},{preconnect:fetch.preconnect})
	await expect(demoFridaySignerCometFetch(c,fetchImpl)('http://127.0.0.1:26657/status')).rejects.toThrow(/ORIGIN/);expect(reads).toBe(0)
})
test('P1 signer startup creates and revalidates its private scratch parent',async()=>{
	const root=await mkdtemp('/tmp/plebeian-friday-fips-lab.signer-scratch.')
	try{
		const application={...lab,network_root:join(root,'network'),dkg_root:join(root,'frost','keyset')}
		const contract=composition(application).contract
		await mkdir(contract.nodeRoot,{recursive:true,mode:0o700})
		expect(await ensureDemoFridaySignerScratch(contract)).toBe(contract.paths.scratchParent)
		const metadata=await lstat(contract.paths.scratchParent)
		expect(metadata.isDirectory()).toBe(true);expect(metadata.mode&0o777).toBe(0o700)
		expect(await ensureDemoFridaySignerScratch(contract)).toBe(contract.paths.scratchParent)
	}finally{await rm(root,{recursive:true,force:true})}
})
for(const kind of ['file','symlink','mode'] as const)test(`P1 signer startup rejects unsafe scratch ${kind}`,async()=>{
	const root=await mkdtemp('/tmp/plebeian-friday-fips-lab.signer-scratch-reject.')
	try{
		const application={...lab,network_root:join(root,'network'),dkg_root:join(root,'frost','keyset')}
		const contract=composition(application).contract
		await mkdir(contract.nodeRoot,{recursive:true,mode:0o700})
		if(kind==='file')await writeFile(contract.paths.scratchParent,'not a directory',{mode:0o600})
		if(kind==='symlink')await symlink(root,contract.paths.scratchParent)
		if(kind==='mode'){await mkdir(contract.paths.scratchParent,{mode:0o700});await chmod(contract.paths.scratchParent,0o750)}
		await expect(ensureDemoFridaySignerScratch(contract)).rejects.toThrow(/runtime-owned 0700 directory/)
	}finally{await rm(root,{recursive:true,force:true})}
})
for(const slot of [1,2,3,4] as const)test(`P2 slot${slot}: every CLI writer and SQLite sidecar fits exact rendered roots`,async()=>{
	const c=composition(r20,slot).contract,renderer=new URL('../../deploy/friday/r20/render-friday-signer-state-dropin.py',import.meta.url).pathname
	const child=Bun.spawn(['python3','-I','-S','-B',renderer,'--slot',String(slot)],{stdin:new Blob([JSON.stringify(r20)]),stdout:'pipe',stderr:'pipe'})
	const text=await new Response(child.stdout).text(),stderr=await new Response(child.stderr).text();expect(stderr).toBe('');expect(await child.exited).toBe(0)
	const lines=text.trimEnd().split('\n');expect(lines.slice(-2)).toEqual(['ReadWritePaths=',`ReadWritePaths=${c.keysetRoot} ${c.nodeRoot}`])
	const roots=lines.at(-1)!.slice('ReadWritePaths='.length).split(' '),within=(path:string)=>roots.some(root=>path===root||path.startsWith(root+'/'))
	for(const path of Object.values(c.paths))expect(within(path)).toBe(true)
	for(const path of Object.values(c.paths).filter(path=>path.endsWith('.sqlite3')))for(const suffix of ['-wal','-shm','-journal'])expect(within(path+suffix)).toBe(true)
	expect(within(c.paths.scratchParent+'/invocation/response.json')).toBe(true);expect(within(c.keysetRoot+'/state/admission-sign/operation.json')).toBe(true)
	for(const path of ['/var/lib','/var/lib/plebeian-auctions-friday','/var/lib/plebeian-auctions-friday/r20',`/var/lib/plebeian-auctions-friday/r20/node-${slot===4?1:slot+1}/foreign`,'/var/lib/plebeian-auctions-friday/frost/node-1/x','/var/lib/plebeian-auctions-poc/x','/var/lib/plebeian-auctions-friday/coordinator-v2/x','/var/lib/plebeian-auctions-friday-anchor-r20/x'])expect(within(path)).toBe(false)
	expect(c.paths.anchorPath.startsWith(c.keysetRoot+'/')).toBe(false)
	const cli=await readFile(new URL('./demo-fips-signer-cli.ts',import.meta.url),'utf8')
	for(const name of ['signerJournalPath','publicEnrollmentPath','leasePath','quarantinePath'])expect(cli).toContain('signerContract.paths.'+name)
	expect(cli.indexOf('} = preflightDemoFridaySignerPolicyComposition(')).toBeLessThan(cli.indexOf('const participantBootstrap ='))
	expect(cli.indexOf('await ensureDemoFridaySignerScratch(signerContract)')).toBeLessThan(cli.indexOf('createDemoSignerSerialization({'))
	expect(cli).not.toContain('demoFridayLoopbackRpc(');expect(cli).not.toContain('nodeRoot,')
})


for(const mode of ['outage','redirect'] as const)test(`P1 typed pure phase: ${mode} keeps its intended failure category`,async()=>{
	const {createDemoSignerPurePhase}=await import('./demo-signer-pure-policy')
	const o=observedFetch('demo-chain','demo-chain',mode),s=build(r20,undefined,o.fetchImpl),r=requests(s.c.contract.mintUrl)
	const participant=createDemoFipsAdmissionParticipant({contract:s.c.contract,pins:{...s.c.admissionPins,network:r.admission.receipt.auth_network_id},proofUse:{claimAdmissionProofs(){s.calls.claims++}},fetchImpl:o.fetchImpl})
	const phase=createDemoSignerPurePhase(new AbortController().signal)
	try{await phase.run(context=>participant.preflightExact(r.admission,context));throw new Error('must fail')}
	catch(error){expect(phase.classification(error)).toEqual({kind:mode==='outage'?'unavailable':'unknown'})}
	expect(s.calls.claims).toBe(0)
})

import {
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, demoFridayR20ProfileDigest,
	type DemoFridayR20RuntimeDkgBindingV1,
} from './demo-friday-r20-enrollment-runtime'
import {
	DEMO_FRIDAY_R20_APPLICATION_RUN_ID, DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	DEMO_FRIDAY_R20_DEPLOYMENT_ID, DEMO_FRIDAY_R20_DKG_RUN_ID,
	DEMO_FRIDAY_R20_KEYSET_ID, DEMO_FRIDAY_R20_KEYSET_ROOT,
	DEMO_FRIDAY_R20_KEYSET_VERSION, DEMO_FRIDAY_R20_OPERATOR_ROOT,
	type DemoFridayR20FreshDkgProfileV2,
} from './demo-friday-r20-fresh-profile'
import { exactDemoFridayApplication } from './demo-friday-runtime-config'
import { assertDemoFridayR20PublicPackageBytes, bindDemoFridaySignerDkgR20 } from './demo-friday-signer-dkg-r20'


async function actualR20PublicBindingFixture() {
const golden = await Bun.file(new URL(
	'../../internal/poc/testdata/friday-r20-runtime-binding-go-golden.json', import.meta.url,
)).json() as { predecessorManifest: unknown; binding: DemoFridayR20RuntimeDkgBindingV1 }
const runtime = golden.binding
const profile: DemoFridayR20FreshDkgProfileV2 = {
	schema: 'PLEBEIAN_FRIDAY_FRESH_DKG_PROFILE_V2', valueProfile: 'FAKE_MONEY_ONLY',
	deploymentId: DEMO_FRIDAY_R20_DEPLOYMENT_ID, applicationRunId: DEMO_FRIDAY_R20_APPLICATION_RUN_ID,
	dkgRunId: DEMO_FRIDAY_R20_DKG_RUN_ID, committeeKeysetId: DEMO_FRIDAY_R20_KEYSET_ID,
	committeeKeysetVersion: DEMO_FRIDAY_R20_KEYSET_VERSION, keysetRoot: DEMO_FRIDAY_R20_KEYSET_ROOT,
	configPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/participant.config.json`,
	transportSecretsPath: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/transport-secrets.json`,
	stateDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/state`,
	exchangeDirectory: `${DEMO_FRIDAY_R20_KEYSET_ROOT}/exchange/${DEMO_FRIDAY_R20_DKG_RUN_ID}`,
	coordinatorRoot: DEMO_FRIDAY_R20_COORDINATOR_ROOT, operatorRoot: DEMO_FRIDAY_R20_OPERATOR_ROOT,
	predecessorManifestDigest: runtime.predecessorManifestDigest,
	predecessorAbortDigest: runtime.predecessorAbortDigest,
	abortAcknowledgementsDigest: runtime.abortAcknowledgementsDigest,
}
const profileDigest = demoFridayR20ProfileDigest(profile)
const manifestBindingDigest = bytesToHex(sha256(utf8ToBytes(JSON.stringify([
	DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest, profile.predecessorAbortDigest, runtime.manifestDigest,
]))))
const boundManifest = {
	schema: DEMO_FRIDAY_R20_BOUND_MANIFEST_SCHEMA, profileDigest,
	predecessorAbortDigest: profile.predecessorAbortDigest, manifest: runtime.result.manifest,
	manifestDigest: runtime.manifestDigest, bindingDigest: manifestBindingDigest,
}
const parsedApplication = exactDemoFridayApplication({
	schema: 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3', deployment_id: DEMO_FRIDAY_R20_DEPLOYMENT_ID,
	run_id: DEMO_FRIDAY_R20_APPLICATION_RUN_ID, application_host_slot: 2,
	fips_ulas: runtime.result.participants.map((participant) => participant.fipsUla),
	comet_p2p_port: 27656, comet_rpc_port: 27657, signer_rpc_port: 39101,
	mint_port: 3438, cashu_mint_url: 'https://172.105.95.57', site_port: 8180,
	network_root: '/var/lib/plebeian-auctions-friday/network-r20', dkg_root: DEMO_FRIDAY_R20_KEYSET_ROOT,
	coordinator_root: DEMO_FRIDAY_R20_COORDINATOR_ROOT,
	coordinator_rpc_identity_path: `${DEMO_FRIDAY_R20_COORDINATOR_ROOT}/coordinator-rpc-identity.key`,
})
if (parsedApplication.schema !== 'PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3') throw new Error('R20 application did not narrow')
const application = parsedApplication
const facts = {
	schema: 'PlebeianAuctionsPOCNetworkFactsV1', chain_id: 'plebeian-friday-r20',
	genesis_sha256: '11'.repeat(32), validators_hash: '22'.repeat(32),
	committee_public_key: runtime.result.committeePublicKey, validator_roster_version: 'genesis-v1',
}

function bind() {
	return bindDemoFridaySignerDkgR20({
		application, profile, predecessorManifest: golden.predecessorManifest, boundManifest,
		expectedManifestBindingDigest: manifestBindingDigest,
		expectedRuntimeBindingDigest: runtime.bindingDigest, runtimeBinding: runtime,
		networkFacts: facts, slot: 2,
	})
}


const binding = bind()
assertDemoFridayR20PublicPackageBytes(binding, Buffer.from(runtime.result.publicKeyPackageHex, 'hex'))
return {binding,application,facts}
}

test('P1 exact R20 public DKG/facts binding feeds the production startup composition and every concrete policy factory',async()=>{
	const {binding,application,facts}=await actualR20PublicBindingFixture(), dkg=binding.runtime.result
	const c=preflightDemoFridaySignerPolicyComposition({application,slot:2,facts,dkg,validate})
	let reads=0,claims=0
	const fetchImpl=Object.assign(async():Promise<Response>=>{reads++;throw new Error('unexpected fetch')},{preconnect:fetch.preconnect})
	const proofUse={claimAdmissionProofs(){claims++}},policy={mintUrl:c.contract.mintUrl,activeKeysetId:'synthetic',committeePublicKey:dkg.committeePublicKey} as DemoFrostParticipantPolicyPackage
	createDemoFipsAdmissionParticipant({contract:c.contract,pins:c.admissionPins,proofUse,fetchImpl})
	createDemoFipsFundingAbortParticipant({contract:c.contract,pins:{...c.abortPins,activeKeysetId:'synthetic'},proofUse,fetchImpl})
	createDemoFipsTerminalPolicyPorts({contract:c.contract,pins:c.terminalPins,policy,anchor:{claimProofs(){claims++}} as unknown as DemoDispositionSignerAnchor,fetchImpl})
	expect(c.contract.cometRpc).toBe('http://127.0.0.1:27657');expect(c.contract.keysetRoot).toBe(application.dkg_root)
	expect(reads).toBe(0);expect(claims).toBe(0)
	for(const assertPins of [()=>assertDemoFipsAdmissionPins(c.contract,{...c.admissionPins,cometRpc:'http://127.0.0.1:26657'}),()=>assertDemoFipsFundingAbortPins(c.contract,{...c.abortPins,cometRpc:'http://127.0.0.1:26657'}),()=>assertDemoFipsTerminalPins(c.contract,{...c.terminalPins,cometRpc:'http://127.0.0.1:26657'})])expect(assertPins).toThrow(/CONTRACT/)
})
