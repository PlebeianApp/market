/**
 * One fake-money admission -> displacement -> recovered outbid return over
 * authenticated FIPS signer RPC. This process opens no listener.
 */
import { Database } from 'bun:sqlite'
import { connect } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, open, readFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { hasValidDleq } from '@cashu/cashu-ts'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { createDemoCometBidConsensus, createLoopbackCometBidBroadcaster, type DemoNostrBidEvent, type DemoNostrBidSignerPort } from './demo-comet-bid-consensus'
import { createDemoCometDisplacementVerifier, createLoopbackCometReader } from './demo-comet-displacement-verifier'
import { deriveDemoCometSignedBidEvidence } from './demo-comet-signed-bid-verifier'
import { createDemoFipsAdmissionParticipantPort, createDemoFipsAdmissionThreshold3Port } from './demo-fips-admission-coordinator'
import { createDemoFipsAdmissionRpcClient } from './demo-fips-admission-rpc'
import { DemoAdmissionSqliteSessionStore } from './demo-frost-threshold3-admission'
import { demoFrostCommitteeLockedProofsDigest, demoFrostParticipantPolicyDigest, type DemoFrostParticipantPolicyPackage } from './demo-frost-participant-policy'
import type { DemoFrostProcessParticipant } from './demo-frost-process-boundary'
import { admitDemoIntegratedThreshold3Bid } from './demo-integrated-admission-service'
import { authorizeDemoCooperativeOutbidReturn, demoIntegratedDisplacementFinalityDigest, demoIntegratedTiming } from './demo-integrated-authority'
import { DemoIntegratedAuthoritySqliteStore } from './demo-integrated-authority-sqlite'
import { demoIntegratedFundingBundleDigest, prepareDemoIntegratedFundingReceipt, type DemoIntegratedFundingReceiptTerms } from './demo-integrated-funding-receipt'
import { DemoMaintainerEncryptedSqliteStore } from './demo-integrated-private-sqlite'
import { demoMaintainerExactTemplateDigest, demoMaintainerScopeFor, demoMaintainerTemplateBundleDigest, type DemoMaintainerExactBranchTemplate, type DemoMaintainerExactTemplateBundle } from './demo-maintainer-offline'
import { createDemoMaintainerThreshold3ProcessComposition } from './demo-maintainer-threshold3-process'
import type { DemoMaintainerFederationRequest } from './demo-maintainer-federation'
import { DemoSignerCoordinatorAnchorSqlite } from './demo-signer-coordinator-anchor-sqlite'
import { createDemoSignerRpcTransport, type DemoSignerDurableBindingV1 } from './demo-signer-rpc'
import { acceptDemoSigAllRecipientResponse, prepareDemoSigAllRecipientOutputs, type DemoRecipientCoordinatorRequest, type DemoRecipientIntent, type DemoRecipientPrivateJournalPort, type DemoRecipientPrivateRecord } from './demo-sigall-recipient'
import { buildDemoSigAllSecret, demoCashuSigAllDigest, demoDenominationKeyDigest, demoRecipientCapabilityDigest, type DemoMintCapabilitySeal } from './demo-sigall-settlement'
import { exactDemoNut07Result } from './demo-nut07-exact'
import {
	blindMessage, CashuMintClient, generateSchnorrKeypair, keysetPublicKey, proofPoint, randomSecretHex,
	splitAmount, unblindBlindedSignature, type BlindedSignature, type BlindingData,
	type CashuKeyset, type CashuProof,
} from './nut-client'

const ROOT_PREFIX = '/tmp/plebeian-friday-fips-lab.'
const HEX_32 = /^[0-9a-f]{64}$/
const PARTICIPANTS = [1, 2, 3, 4] as const
type ParticipantId = typeof PARTICIPANTS[number]

export interface Application { schema: 'PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2';
 run_id: string;
 fips_ulas: [string,string,string,string];
 network_root: string;
 dkg_root: string;
 driver_result: string;
 comet_p2p_port:26656;
 comet_rpc_port:26657;
 signer_rpc_port:39101;
 mint_port:3338 }
export interface Facts { schema:'PlebeianAuctionsPOCNetworkFactsV1';
 chain_id:string;
 genesis_sha256:string;
 validators_hash:string;
 committee_public_key:string;
 validator_roster_version:string }
export interface DkgParticipant { participantId:ParticipantId;
 configPath:string;
 stateDirectory:string;
 verifyingShare:string;
 signerIdentity:string;
 signerEndpoint:string }
export interface Dkg { schema:'PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1';
 runId:string;
 dkgRunId:string;
 committeeKeysetId:string;
 committeeKeysetVersion:string;
 publicKeyPackagePath:string;
 publicKeyPackageSha256:string;
 signerRosterDigest:string;
 committeePublicKey:string;
 coordinatorIdentity:string;
 participants:DkgParticipant[] }
type Opening = { secret:string;
 r:string;
 B_:string }
interface RecoveryContext {
	schema:'PLEBEIAN_FRIDAY_FIPS_RECOVERY_CONTEXT_V1'
	mintUrl:string
	keyset:CashuKeyset
	intent:DemoRecipientIntent
	request:DemoRecipientCoordinatorRequest
	recipientJournalPath:string
	operationJournalPath:string
	walletPath:string
	inputRefs:string[]
	expectedAmount:number
	operationRoot:string
	cometTransactionDigest:string
	signerRequestDigest:string
	unavailableSignerUla:string
	participantIds:number[]
}
export function digest(value: unknown): string { return bytesToHex(sha256(utf8ToBytes(JSON.stringify(value)))) }
function frame(value: Uint8Array): Uint8Array {
	const length = new Uint8Array(4)
	new DataView(length.buffer).setUint32(0, value.length, false)
	return concatBytes(length, value)
}
export function offlineStoreKey(coordinatorSecret: Uint8Array, facts: Facts,
	dkg: Pick<Dkg, 'dkgRunId' | 'publicKeyPackageSha256' | 'signerRosterDigest'>): Uint8Array {
	return sha256(concatBytes(
		utf8ToBytes('PLEBEIAN_FRIDAY_FIPS_OFFLINE_STORE_KEY_V1'),
		frame(coordinatorSecret), frame(utf8ToBytes(facts.chain_id)),
		frame(utf8ToBytes(dkg.dkgRunId)), frame(hexToBytes(dkg.publicKeyPackageSha256)),
		frame(hexToBytes(dkg.signerRosterDigest)),
	))
}
export function compressed(key: Uint8Array): string { return bytesToHex(secp256k1.getPublicKey(key, true)) }
export function xonly(key: Uint8Array): string { return bytesToHex(schnorr.getPublicKey(key)) }
export function sign(value: string, key: Uint8Array): string { return bytesToHex(schnorr.sign(hexToBytes(value), key)) }
export function exactPath(value: string, label: string): string {
	if (!value.startsWith(ROOT_PREFIX) || resolve(value) !== value || value === '/' || value.endsWith('/') || value.includes('//')) throw new Error(`DEMO_FIPS_DRIVER_PATH: ${label} is outside run root`)
	return value
}
export async function json<T>(path:string):Promise<T>{ return JSON.parse(await readFile(path,'utf8')) as T }
export async function replaceJson(path:string,value:unknown):Promise<void>{ const tmp=`${path}.${randomUUID()}.tmp`;
 const file=await open(tmp,'wx',0o600);
 try{await file.writeFile(`${JSON.stringify(value)}\n`);
await file.sync()}finally{await file.close()} await rename(tmp,path);
await chmod(path,0o600) }
export async function waitFor<T>(label:string, read:()=>Promise<T>, ready:(value:T)=>boolean):Promise<T>{const end=Date.now()+60_000;
let last:unknown;
while(Date.now()<end){try{const value=await read();
if(ready(value))return value;
last=value}catch(error){last=error}await Bun.sleep(200)}throw new Error(`${label}: ${last instanceof Error?last.message:JSON.stringify(last)}`)}

async function connectionBlocked(host: string, port: number): Promise<boolean> {
	return new Promise<boolean>((resolvePromise) => {
		const socket = connect({ host, port })
		const timer = setTimeout(() => { socket.destroy(); resolvePromise(true) }, 1_500)
		socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolvePromise(false) })
		socket.once('error', () => { clearTimeout(timer); resolvePromise(true) })
	})
}

export function supportedNuts(value: unknown): number[] {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
	const supported: number[] = []
	for (const [rawNut, rawSettings] of Object.entries(value as Record<string, unknown>)) {
		if (!/^(?:0|[1-9][0-9]*)$/.test(rawNut) || rawSettings === null
			|| typeof rawSettings !== 'object' || Array.isArray(rawSettings)) continue
		const nut = Number(rawNut); const settings = rawSettings as Record<string, unknown>
		if (nut === 4) {
			if (settings.disabled !== true && Array.isArray(settings.methods)
				&& settings.methods.some((method) => method !== null && typeof method === 'object'
					&& (method as Record<string, unknown>).method === 'bolt11'
					&& (method as Record<string, unknown>).unit === 'sat')) supported.push(nut)
		} else if (settings.supported === true) supported.push(nut)
	}
	return supported.sort((left, right) => left - right)
}

export class JsonRecipientJournal implements DemoRecipientPrivateJournalPort<Opening>{
	constructor(private readonly path:string){}
	async runExclusive<T>(_scope:string,run:()=>Promise<T>):Promise<T>{return run()}
	async load(scope:string){try{const all=await json<Record<string,DemoRecipientPrivateRecord<Opening>>>(this.path);
return structuredClone(all[scope]??null)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
throw error}}
	async savePrepared(scope:string,record:DemoRecipientPrivateRecord<Opening>){let all:Record<string,DemoRecipientPrivateRecord<Opening>>={};
try{all=await json(this.path)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}if(all[scope]!==undefined&&JSON.stringify(all[scope])!==JSON.stringify(record))throw new Error('DEMO_FIPS_DRIVER_RECIPIENT: journal conflict');
all[scope]=structuredClone(record);
await replaceJson(this.path,all)}
	async markImported(scope:string,requestDigest:string,responseDigest:string){const all=await json<Record<string,DemoRecipientPrivateRecord<Opening>>>(this.path);
const row=all[scope];
if(row===undefined||row.requestDigest!==requestDigest)throw new Error('DEMO_FIPS_DRIVER_RECIPIENT: import conflict');
row.importedResponseDigest=responseDigest;
await replaceJson(this.path,all)}
}

export async function mintFacts(client:CashuMintClient,mintUrl:string):Promise<{keyset:CashuKeyset;
seal:DemoMintCapabilitySeal}>{const [info,advertised]=await Promise.all([client.info(),client.keysets()]);
const active=advertised.keysets.filter((entry)=>entry.active&&entry.unit==='sat');
if(active.length!==1||(active[0]!.input_fee_ppk??0)!==0)throw new Error('DEMO_FIPS_DRIVER_MINT: expected one active zero-fee keyset');
const keyset=(await client.keys(active[0]!.id)).keysets.find((entry)=>entry.id===active[0]!.id&&entry.unit==='sat');
if(keyset===undefined||typeof info.pubkey!=='string'||typeof info.version!=='string')throw new Error('DEMO_FIPS_DRIVER_MINT: facts malformed');
const amounts=Object.keys(keyset.keys).map(Number).filter(Number.isSafeInteger).sort((a,b)=>a-b);
const nuts=supportedNuts(info.nuts);
if (![4,7,9,10,11].every((nut)=>nuts.includes(nut))) throw new Error('DEMO_FIPS_DRIVER_MINT: required NUT support absent');
return{keyset,seal:{mintUrl,mintPublicKey:info.pubkey,serverVersion:info.version,activeSatKeysetId:keyset.id,denominationKeyDigest:demoDenominationKeyDigest(keyset.keys),denominationAmounts:amounts,inputFeePpk:0,nuts}}}
export async function mintPool(client:CashuMintClient,keyset:CashuKeyset,amount:number,locktime:number,bidder:string,committee:string,refund:string):Promise<CashuProof[]>{const parts=splitAmount(amount);
const openings=parts.map(()=>blindMessage(buildDemoSigAllSecret({nonce:randomSecretHex(),bidderPublicKey:bidder,committeePublicKey:committee,refundPublicKey:refund,locktime})));
const outputs=openings.map((entry,index)=>({amount:parts[index]!,id:keyset.id,B_:entry.B_}));
const quote=await client.createMintQuote(amount);
await client.awaitMintQuotePaid(quote.quote,{intervalMs:100,timeoutMs:10_000});
const minted=await client.mint(quote.quote,outputs);
const proofs=minted.signatures.map((sig,index)=>unblindBlindedSignature(sig,openings[index]!,keysetPublicKey(keyset,sig.amount)));
if(proofs.reduce((sum,p)=>sum+p.amount,0)!==amount||proofs.some((p)=>!hasValidDleq(p as never,keyset as never,{require:true})))throw new Error('DEMO_FIPS_DRIVER_MINT: locked pool verification failed');
return proofs.sort((a,b)=>bytesToHex(proofPoint(a).toBytes(true)).localeCompare(bytesToHex(proofPoint(b).toBytes(true))))}

export async function outputPlan(root:string,network:string,mintUrl:string,auctionId:string,operationId:string,role:'winner_settlement'|'refund',privateKey:Uint8Array,keyset:CashuKeyset,amount:number){const recipientPublicKey=compressed(privateKey);
const intent={schema:'COCO_DEMO_RECIPIENT_INTENT_V1' as const,network,chainId:network,auctionId,operationId,role,mintUrl,unit:'sat' as const,recipientPublicKey,amounts:splitAmount(amount)};
const journalPath=join(root,`${operationId}.${role}.json`);
const journal=new JsonRecipientJournal(journalPath);
const request=await prepareDemoSigAllRecipientOutputs({intent,keyset:{id:keyset.id,unit:keyset.unit,keys:{...keyset.keys}},roleBinding:{async assertWinnerRecipient(){if(role!=='winner_settlement')throw new Error('role changed')},async assertRefundRecipient(){if(role!=='refund')throw new Error('role changed')}},signer:{async signCapability(value){return sign(value.digest,privateKey)}},outputFactory:{async createRecipientOwnedOutput(value){const opening=blindMessage(randomSecretHex());
return{message:{amount:value.amount,id:value.keysetId,B_:opening.B_},privateOpeningRef:{secret:opening.secret,r:opening.r.toString(16),B_:opening.B_}}}},journal});
return{intent,request,journalPath}}

export async function packageFor(options:{root:string;
mintUrl:string;
network:string;
auctionId:string;
amount:number;
replaces:string;
now:number;
originalEnd:number;
end:number;
actor:Uint8Array;
bidder:Uint8Array;
refund:Uint8Array;
seller:HDKey;
keyset:CashuKeyset;
seal:DemoMintCapabilitySeal;
dkg:Dkg;
inputs:CashuProof[]}){const operationId=randomBytes(32).toString('hex');
const timing=demoIntegratedTiming(options.originalEnd,options.end);
const sellerChild=options.seller.derive('m/1/2/3/4/5');
if(sellerChild.privateKey===null)throw new Error('seller key absent');
const winner=await outputPlan(options.root,options.network,options.mintUrl,options.auctionId,operationId,'winner_settlement',sellerChild.privateKey,options.keyset,options.amount);
const refund=await outputPlan(options.root,options.network,options.mintUrl,options.auctionId,operationId,'refund',options.refund,options.keyset,options.amount);
const common={schema:'COCO_DEMO_MAINTAINER_EXACT_BRANCH_V1' as const,network:options.network,chainId:options.network,auctionId:options.auctionId,operationId,bidId:operationId,bidEventId:operationId,bidderActorId:xonly(options.actor),amount:options.amount,inputFee:0,mintUrl:options.mintUrl,unit:'sat' as const,locktime:timing.locktime,validUntil:timing.maximumEndTime,closeTime:timing.certifiedEndTime,settlementWindowSeconds:600,sellerP2pkXpub:options.seller.publicExtendedKey,bidderDerivationPath:'m/1/2/3/4/5',bidderPublicKey:compressed(options.bidder),refundPublicKey:compressed(options.refund),committeePublicKey:options.dkg.committeePublicKey,committeeKeysetId:options.dkg.committeeKeysetId,committeeKeysetVersion:options.dkg.committeeKeysetVersion,threshold:3 as const,participants:options.dkg.participants.map((p)=>({identifier:p.participantId,verifyingShare:p.verifyingShare})) as DemoMaintainerExactBranchTemplate['participants'],mintSeal:options.seal,inputs:options.inputs};
const make=(role:'winner_settlement'|'refund',plan:typeof winner):DemoMaintainerExactBranchTemplate=>{const value:DemoMaintainerExactBranchTemplate={...common,role,recipientPublicKey:plan.intent.recipientPublicKey,outputs:plan.request.outputs,recipientCapability:plan.request.capability,templateDigest:'',cashuSigAllDigest:'',bidderMainSignature:''};
value.cashuSigAllDigest=demoCashuSigAllDigest(value.inputs,value.outputs);
value.bidderMainSignature=sign(value.cashuSigAllDigest,options.bidder);
if(role==='refund')value.refundSignature=sign(value.cashuSigAllDigest,options.refund);
value.templateDigest=demoMaintainerExactTemplateDigest(value);
return value};
const winnerTemplate=make('winner_settlement',winner),refundTemplate=make('refund',refund);
const actorWinnerAuthorization={actorId:xonly(options.actor),packageDigest:winnerTemplate.templateDigest,signature:sign(winnerTemplate.templateDigest,options.actor)};
const actorReturnAuthorization={actorId:xonly(options.actor),packageDigest:refundTemplate.templateDigest,signature:sign(refundTemplate.templateDigest,options.actor)};
const bundle:DemoMaintainerExactTemplateBundle={schema:'COCO_DEMO_MAINTAINER_TEMPLATE_BUNDLE_V1',preparedAt:options.now,winner:winnerTemplate,refund:refundTemplate,actorWinnerAuthorization,actorReturnAuthorization,bundleDigest:'',actorBundleSignature:'',bidderBundleSignature:''};
bundle.bundleDigest=demoMaintainerTemplateBundleDigest(bundle);
bundle.actorBundleSignature=sign(bundle.bundleDigest,options.actor);
bundle.bidderBundleSignature=sign(bundle.bundleDigest,options.bidder);
const refs=options.inputs.map((p)=>bytesToHex(proofPoint(p).toBytes(true))).sort();
const terms:DemoIntegratedFundingReceiptTerms={schema:'PlebeianAuctionsPOCIntegratedFundingV3',auth_network_id:options.network,chain_id:options.network,mint_url:options.mintUrl,auction_id:options.auctionId,bidder:xonly(options.actor),bid_amount:options.amount,pool_amount:options.amount,replaces_bid_id:options.replaces,funding_operation_id:operationId,attested_at:options.now,expires_at:options.now+240,proof_state_refs:refs,active_keyset_id:options.keyset.id,input_fee_ppk:0,locktime:timing.locktime,bidder_public_key:compressed(options.bidder),refund_public_key:compressed(options.refund),committee_public_key:options.dkg.committeePublicKey,committee_keyset_id:options.dkg.committeeKeysetId,committee_keyset_version:options.dkg.committeeKeysetVersion,dkg_run_id:options.dkg.dkgRunId,public_key_package_sha256:options.dkg.publicKeyPackageSha256,signer_roster_digest:options.dkg.signerRosterDigest,winner_package_digest:winnerTemplate.templateDigest,return_package_digest:refundTemplate.templateDigest,return_cashu_sigall_digest:refundTemplate.cashuSigAllDigest,bidder_return_signature:refundTemplate.bidderMainSignature};
return{
	bundle,
	unsignedReceipt:prepareDemoIntegratedFundingReceipt(terms,sign(demoIntegratedFundingBundleDigest(terms),options.actor)),
		winnerPlan:winner,
	refundPlan:refund,
}}

export function nostrSigner(key:Uint8Array):DemoNostrBidSignerPort{return{async getPublicKey(){return xonly(key)},async signEvent(unsigned:Omit<DemoNostrBidEvent,'id'|'sig'>){const id=digest([0,unsigned.pubkey,unsigned.created_at,unsigned.kind,unsigned.tags,unsigned.content]);
return{...structuredClone(unsigned),id,sig:sign(id,key)}}}}
export async function post(site:string,path:string,value:unknown){const response=await fetch(`${site}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
return{status:response.status,body:await response.json()}}
export async function signedEvent(key:Uint8Array,kind:number,content:unknown){const base={pubkey:xonly(key),created_at:Math.floor(Date.now()/1000),kind,tags:[],content:JSON.stringify(content)};
const id=digest([0,base.pubkey,base.created_at,base.kind,base.tags,base.content]);
return{...base,id,sig:sign(id,key)}}

async function recoverFromDisk(contextPath:string,outputPath:string):Promise<void>{
	const context=await json<RecoveryContext>(exactPath(contextPath,'recovery context'))
	if(context.schema!=='PLEBEIAN_FRIDAY_FIPS_RECOVERY_CONTEXT_V1'||!/^http:\/\/\[(?:fc|fd)[0-9a-f:]+\]:3338$/i.test(context.mintUrl)
		||!Number.isSafeInteger(context.expectedAmount)||context.expectedAmount<1||!HEX_32.test(context.operationRoot)
		||!HEX_32.test(context.cometTransactionDigest)||!HEX_32.test(context.signerRequestDigest)
		||JSON.stringify(context.participantIds)!==JSON.stringify([1,2,3]))throw new Error('DEMO_FIPS_RECOVERY_CONTEXT: durable identity is malformed')
	for(const [label,path] of [['recipient journal',context.recipientJournalPath],['operation journal',context.operationJournalPath],['wallet',context.walletPath]] as const)exactPath(path,label)
	const operation=await json<Record<string,unknown>>(context.operationJournalPath)
	if(operation.schema!=='PLEBEIAN_FRIDAY_FIPS_MINT_OPERATION_V1'||operation.status!=='response_unknown'
		||operation.operationId!==context.intent.operationId||operation.operationRoot!==context.operationRoot
		||operation.requestDigest!==context.signerRequestDigest)throw new Error('DEMO_FIPS_RECOVERY_OPERATION: exact unknown operation is absent')
	const spent=await waitFor('mint commit after driver restart',async()=>{const response=await fetch(`${context.mintUrl}/v1/checkstate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({Ys:context.inputRefs})});
		return exactDemoNut07Result(context.inputRefs,await response.json())},(value)=>value.states.every((state)=>state==='SPENT'))
	const restoredResponse=await fetch(`${context.mintUrl}/v1/restore`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outputs:context.request.outputs})})
	if(!restoredResponse.ok)throw new Error('DEMO_FIPS_RECOVERY: NUT-09 failed')
	const restored=await restoredResponse.json() as {signatures?:BlindedSignature[]}
	if(!Array.isArray(restored.signatures)||restored.signatures.length!==context.request.outputs.length)throw new Error('DEMO_FIPS_RECOVERY: exact outputs absent')
	let importedProofs:CashuProof[]=[]
	const recipientJournal=new JsonRecipientJournal(context.recipientJournalPath)
	const importReceipt=await acceptDemoSigAllRecipientResponse({intent:context.intent,keyset:{id:context.keyset.id,unit:context.keyset.unit,keys:{...context.keyset.keys}},
		response:{schema:'COCO_DEMO_RECIPIENT_RESPONSE_V1',operationId:context.intent.operationId,recipientCapabilityDigest:demoRecipientCapabilityDigest(context.request.capability),signatures:restored.signatures},
		roleBinding:{async assertWinnerRecipient(){throw new Error('outbid return cannot import as winner')},async assertRefundRecipient(binding){if(binding.recipientPublicKey!==context.intent.recipientPublicKey)throw new Error('refund recipient changed')}},
		unblinder:{async unblindExact(request){return request.signatures.map((signature,index)=>{const opening=request.privateOpeningRefs[index]!;return unblindBlindedSignature(signature,{secret:opening.secret,r:BigInt(`0x${opening.r}`),B_:opening.B_} as BlindingData,keysetPublicKey(context.keyset,signature.amount))})}},
		verifier:{async verifyExact(request){const proofs=request.unblindedRef;if(proofs.reduce((sum,p)=>sum+p.amount,0)!==context.expectedAmount||proofs.some((p)=>!hasValidDleq(p as never,context.keyset as never,{require:true})))throw new Error('DEMO_FIPS_RECOVERY: imported proofs invalid');return proofs}},
		wallet:{async importVerified(request){importedProofs=request.verifiedRef.map((proof)=>structuredClone(proof));await replaceJson(context.walletPath,{schema:'PLEBEIAN_FRIDAY_FIPS_THROWAWAY_WALLET_V1',operationId:context.intent.operationId,proofs:importedProofs})}},journal:recipientJournal})
	const outputRefs=importedProofs.map((proof)=>bytesToHex(proofPoint(proof).toBytes(true)))
	const outputStateResponse=await fetch(`${context.mintUrl}/v1/checkstate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({Ys:outputRefs})})
	const outputStates=exactDemoNut07Result(outputRefs,await outputStateResponse.json())
	if(outputStates.states.some((state)=>state!=='UNSPENT')||importReceipt.amount!==context.expectedAmount)throw new Error('DEMO_FIPS_RECOVERY: outputs are not exact unspent value')
	const responseDigest=digest(restored.signatures.map((signature)=>({amount:signature.amount,id:signature.id,C_:signature.C_,dleq:signature.dleq??null})))
	await replaceJson(context.operationJournalPath,{schema:'PLEBEIAN_FRIDAY_FIPS_MINT_OPERATION_V1',status:'recipient_imported',operationId:context.intent.operationId,operationRoot:context.operationRoot,requestDigest:context.signerRequestDigest,responseDigest,inputStates:spent.states,outputStates:outputStates.states,outputCount:restored.signatures.length,importedAmount:importReceipt.amount})
	const directUnderlayCometBlocked=await connectionBlocked('198.18.242.2',26656),directUnderlaySignerBlocked=await connectionBlocked('198.18.242.2',39101),unavailableSignerBlocked=await connectionBlocked(context.unavailableSignerUla,39101)
	if(!directUnderlayCometBlocked||!directUnderlaySignerBlocked||!unavailableSignerBlocked)throw new Error('DEMO_FIPS_RECOVERY_ISOLATION: underlay or unavailable signer unexpectedly reachable')
	await replaceJson(outputPath,{schema:'PLEBEIAN_FRIDAY_FIPS_DRIVER_RESULT_V2',operation_root:context.operationRoot,comet_transaction_digest:context.cometTransactionDigest,signer_request_digest:context.signerRequestDigest,comet_plaintext_probe_committed:true,signer_plaintext_probe_authenticated:true,direct_underlay_comet_refused:true,direct_underlay_signer_refused:true,fake_mint_settlement:'finalized',recipient_imported_amount:importReceipt.amount,one_signer_unavailable:true,threshold_signature_verified:true,nut07_inputs:spent.states,nut07_outputs:outputStates.states,nut09_outputs:restored.signatures.length,participant_ids:context.participantIds,recovery_process_boundary:true})
}

function args(){const argv=process.argv.slice(2)
	if(argv.length===5&&argv[0]==='recover'&&argv[1]==='--context'&&argv[3]==='--output')return{mode:'recover' as const,context:exactPath(argv[2]!,'recovery context'),output:exactPath(argv[4]!,'output')}
	if(argv.length!==11||argv[0]!=='run'||argv[1]!=='--application'||argv[3]!=='--dkg-result'||argv[5]!=='--network-facts'||argv[7]!=='--participant-binary'||argv[9]!=='--output')throw new Error('usage: plebeian-friday-integrated-driver run --application PATH --dkg-result PATH --network-facts PATH --participant-binary PATH --output PATH | recover --context PATH --output PATH')
	return{mode:'run' as const,application:exactPath(argv[2]!,'application'),dkg:exactPath(argv[4]!,'dkg'),facts:exactPath(argv[6]!,'facts'),participantBinary:argv[8]!,output:exactPath(argv[10]!,'output')}}

export async function main():Promise<void>{
const cli=args();
if(cli.mode==='recover'){await recoverFromDisk(cli.context,cli.output);return}
const application=await json<Application>(cli.application),dkg=await json<Dkg>(cli.dkg),facts=await json<Facts>(cli.facts);
if(application.schema!=='PLEBEIAN_FRIDAY_FIPS_LAB_APPLICATION_V2'||dkg.runId!==application.run_id||facts.committee_public_key!==dkg.committeePublicKey||!HEX_32.test(facts.validators_hash)||dkg.participants.length!==4)throw new Error('DEMO_FIPS_DRIVER_CONFIG: public run identities disagree');
const root=resolve(application.dkg_root,'..');
const mintUrl=`http://[${application.fips_ulas[0]}]:3338`,site='http://127.0.0.1:8080',rpc='http://127.0.0.1:26657';
const coordinatorSecret=hexToBytes((await readFile(join(root,'node-1/coordinator-rpc-identity.key'),'utf8')).trim());
if(xonly(coordinatorSecret)!==dkg.coordinatorIdentity)throw new Error('DEMO_FIPS_DRIVER_COORDINATOR: identity mismatch');

await waitFor('site readiness',async()=>{const response=await fetch(`${site}/api/validators`);return{ok:response.ok,body:await response.json()}},(value)=>value.ok)
await waitFor('mint readiness',async()=>{const response=await fetch(`${mintUrl}/v1/info`);return{ok:response.ok,body:await response.json()}},(value)=>value.ok)
const admissionClients=dkg.participants.map((participant)=>createDemoFipsAdmissionRpcClient({endpoint:participant.signerEndpoint.replace('/v1/frost','/v1/admission'),binding:{participantId:participant.participantId,network:facts.chain_id,chainId:facts.chain_id,committeeKeysetId:dkg.committeeKeysetId,committeeKeysetVersion:dkg.committeeKeysetVersion,dkgRunId:dkg.dkgRunId,publicKeyPackageSha256:dkg.publicKeyPackageSha256,signerRosterDigest:dkg.signerRosterDigest,coordinatorIdentity:dkg.coordinatorIdentity,signerIdentity:participant.signerIdentity},coordinatorIdentityPrivateKey:coordinatorSecret})) as Parameters<typeof createDemoFipsAdmissionThreshold3Port>[0]['clients'];

const admissionPorts=admissionClients.map((client,index)=>createDemoFipsAdmissionParticipantPort((index+1) as ParticipantId,client)) as Parameters<typeof admitDemoIntegratedThreshold3Bid>[0]['participants'];
const sessionDb=new Database(join(root,'driver-admission.sqlite3'),{create:true,strict:true});
const committee=createDemoFipsAdmissionThreshold3Port({clients:admissionClients,sessions:new DemoAdmissionSqliteSessionStore(sessionDb),binaryPath:cli.participantBinary,publicKeyPackagePath:dkg.publicKeyPackagePath,scratchParent:join(root,'node-1/scratch'),committeePublicKey:dkg.committeePublicKey});
const privateStorePath=join(root,'driver-private.sqlite3')
let privateDb=new Database(privateStorePath,{create:true,strict:true});
// Re-derivable only inside this one-run lab from the already-persisted
// coordinator identity plus the exact public DKG/network identity. This keeps
// an admission package readable after a driver-process restart without
// creating another persistent secret, while a copied database from another
// run/keyset remains undecryptable.
const privateStoreKey=offlineStoreKey(coordinatorSecret,facts,dkg)
let offlineStore=new DemoMaintainerEncryptedSqliteStore(privateDb,privateStoreKey);
privateStoreKey.fill(0)
const sellerKey=hexToBytes(generateSchnorrKeypair().privateKeyHex),seller=HDKey.fromMasterSeed(randomBytes(32)),actor1=hexToBytes(generateSchnorrKeypair().privateKeyHex),actor2=hexToBytes(generateSchnorrKeypair().privateKeyHex),bidder1=hexToBytes(generateSchnorrKeypair().privateKeyHex),bidder2=hexToBytes(generateSchnorrKeypair().privateKeyHex),refund1=hexToBytes(generateSchnorrKeypair().privateKeyHex),refund2=hexToBytes(generateSchnorrKeypair().privateKeyHex);
const auctionId=`fips-friday-${Date.now()}`;
const created=await post(site,'/api/event',await signedEvent(sellerKey,28640,{auction_id:auctionId,title:'FIPS threshold fake-money lot',description:'isolated no-value lab PLEBEIAN-FRIDAY-COMET-TRANSPORT-V1',duration_seconds:300,starting_bid:100,min_increment:100,reserve:0,funding_mode:'threshold_sigall_v1'}));
if(created.status!==200)throw new Error(`DEMO_FIPS_DRIVER_AUCTION: ${created.status}`);
const reader=createLoopbackCometReader(rpc);
const state=await waitFor('auction commit',()=>reader.readCurrentState(),(value)=>value.state.auctions?.[auctionId]!==undefined);
const auction=state.state.auctions[auctionId]!;
if(!Number.isSafeInteger(auction.original_end_time)||!Number.isSafeInteger(auction.end_time))throw new Error('DEMO_FIPS_DRIVER_AUCTION: timing absent');
const mint=new CashuMintClient({mintUrl});
const {keyset,seal}=await mintFacts(mint,mintUrl);
const timing=demoIntegratedTiming(auction.original_end_time!,auction.end_time!);
const firstInputs=await mintPool(mint,keyset,1000,timing.locktime,compressed(bidder1),dkg.committeePublicKey,compressed(refund1));
const secondInputs=await mintPool(mint,keyset,1200,timing.locktime,compressed(bidder2),dkg.committeePublicKey,compressed(refund2));
const dkgBinding={dkgRunId:dkg.dkgRunId,publicKeyPackageSha256:dkg.publicKeyPackageSha256,signerRosterDigest:dkg.signerRosterDigest};
const first=await packageFor({root,mintUrl,network:facts.chain_id,auctionId,amount:1000,replaces:'',now:Math.floor(Date.now()/1000),originalEnd:auction.original_end_time!,end:auction.end_time!,actor:actor1,bidder:bidder1,refund:refund1,seller,keyset,seal,dkg,inputs:firstInputs});
const admit=async(pkg:typeof first,actor:Uint8Array)=>admitDemoIntegratedThreshold3Bid({unsignedReceipt:pkg.unsignedReceipt,bundle:pkg.bundle,nowSeconds:Math.floor(Date.now()/1000),dkgBinding,participants:admissionPorts,committee,offlineStore,consensus:createDemoCometBidConsensus({reader,broadcaster:createLoopbackCometBidBroadcaster(rpc),signer:nostrSigner(actor),chainId:facts.chain_id,validatorsHash:facts.validators_hash,nowSeconds:()=>Math.floor(Date.now()/1000)}),policyTimeoutMs:15_000});
const firstAdmission=await admit(first,actor1);
// Durable admission now contains every exact authorization needed by the
// cooperative return.  Destroy all three client-side secrets before another
// bidder can displace it: the Nostr actor key, the NUT-11 MAIN spend key and
// the unilateral REFUND key.  The coordinator keeps only the encrypted exact
// package and cannot synthesize a new destination or branch.
actor1.fill(0);bidder1.fill(0);refund1.fill(0)
const displacedBidderActorKeyAvailable=actor1.some((byte)=>byte!==0)
const displacedBidderMainKeyAvailable=bidder1.some((byte)=>byte!==0)
const displacedBidderEmergencyRefundKeyAvailable=refund1.some((byte)=>byte!==0)
if(displacedBidderActorKeyAvailable||displacedBidderMainKeyAvailable||displacedBidderEmergencyRefundKeyAvailable)throw new Error('DEMO_FIPS_DRIVER_OFFLINE: displaced bidder client secrets remain available')
// Reopen the encrypted database using a newly derived copy of the same
// run-scoped key. This is a deliberate store-manager reconstruction; the
// later mint recovery remains a separate full process boundary.
privateDb.close(false)
privateDb=new Database(privateStorePath,{create:false,strict:true})
const restoredPrivateStoreKey=offlineStoreKey(coordinatorSecret,facts,dkg)
offlineStore=new DemoMaintainerEncryptedSqliteStore(privateDb,restoredPrivateStoreKey)
restoredPrivateStoreKey.fill(0)
const admissionPrivateStoreReopened=true
const second=await packageFor({root,mintUrl,network:facts.chain_id,auctionId,amount:1200,replaces:firstAdmission.commit.bidId,now:Math.floor(Date.now()/1000),originalEnd:auction.original_end_time!,end:auction.end_time!,actor:actor2,bidder:bidder2,refund:refund2,seller,keyset,seal,dkg,inputs:secondInputs});
const secondAdmission=await admit(second,actor2);
const verifier=createDemoCometDisplacementVerifier({reader,network:facts.chain_id,chainId:facts.chain_id,genesisHash:facts.genesis_sha256,validatorRosterVersion:facts.validator_roster_version,validatorsHash:facts.validators_hash,committeeKeysetId:dkg.committeeKeysetId,committeeKeysetVersion:dkg.committeeKeysetVersion,dkgRunId:dkg.dkgRunId,publicKeyPackageSha256:dkg.publicKeyPackageSha256,signerRosterDigest:dkg.signerRosterDigest});
const certificate=await verifier.verifyAndDerive({network:facts.chain_id,chainId:facts.chain_id,genesisHash:facts.genesis_sha256,validatorRosterVersion:facts.validator_roster_version,auctionId,displacementHeight:secondAdmission.commit.height,replacementBidEventId:secondAdmission.commit.bidId});
const authorityDb=new Database(join(root,'driver-authority.sqlite3'),{create:true,strict:true});
const authorityStore=new DemoIntegratedAuthoritySqliteStore(authorityDb);
const claim=await authorizeDemoCooperativeOutbidReturn({certificate,template:first.bundle.refund,store:authorityStore,nowSeconds:certificate.commits[2].blockTime,displacementVerifier:{async verifyAndDerive(){return structuredClone(certificate)}}});
const signedBid=await deriveDemoCometSignedBidEvidence({reader,validatorsHash:facts.validators_hash,minimumHeight:certificate.displacementState.stateHeight,fundingOperationId:claim.operationId,deposits:first.bundle.refund.inputs.map((proof)=>({proofStateRef:bytesToHex(proofPoint(proof).toBytes(true)),amount:proof.amount,keysetId:proof.id})),sellerRecipientPublicKey:first.bundle.winner.recipientPublicKey});
const durableFirst=await offlineStore.loadExact(demoMaintainerScopeFor(first.bundle.winner),first.bundle.bundleDigest)
if(durableFirst===null)throw new Error('DEMO_FIPS_DRIVER_OFFLINE: admitted private bundle is absent after bidder departure')
const policy:DemoFrostParticipantPolicyPackage={schema:'COCO_DEMO_FROST_PARTICIPANT_POLICY_V1',network:facts.chain_id,chainId:facts.chain_id,auctionId,operationId:claim.operationId,bidId:claim.displacedBidId,bidEventId:claim.displacedBidId,bidderActorId:certificate.displacedBidderActorId,role:'refund',outcomeHeight:certificate.displacementState.stateHeight,appStateHash:certificate.displacementState.stateAppHash,amount:claim.poolAmount,inputFee:0,inputFeePpk:0,mintUrl,unit:'sat',activeKeysetId:keyset.id,locktime:first.bundle.refund.locktime,bidderPublicKey:first.bundle.refund.bidderPublicKey,committeePublicKey:dkg.committeePublicKey,sellerRecipientPublicKey:first.bundle.winner.recipientPublicKey,recipientPublicKey:first.bundle.refund.recipientPublicKey,deposits:first.bundle.refund.inputs.map((proof)=>({proofStateRef:bytesToHex(proofPoint(proof).toBytes(true)),amount:proof.amount,keysetId:proof.id})),committeeLockedProofs:first.bundle.refund.inputs,outputs:first.bundle.refund.outputs,recipientCapability:first.bundle.refund.recipientCapability,packageDigest:first.bundle.refund.templateDigest,cashuSigAllDigest:first.bundle.refund.cashuSigAllDigest,actorPackageAuthorization:structuredClone(durableFirst.bundle.actorReturnAuthorization),certifiedClosure:{evidenceDigest:demoIntegratedDisplacementFinalityDigest(certificate),evidence:{schema:'COCO_DEMO_FROST_PARTICIPANT_LOCAL_CLOSURE_EVIDENCE_V2',source:'participant-local',kind:'outbid',eventHeight:secondAdmission.commit.height,eventId:secondAdmission.commit.bidId}},signedBid:{evidenceDigest:signedBid.evidenceDigest,evidence:{schema:'COCO_DEMO_FROST_PARTICIPANT_LOCAL_SIGNED_BID_EVIDENCE_V1',source:'participant-local'}}};

const anchorDb=new Database(join(root,'driver-signer-anchor.sqlite3'),{create:true,strict:true});
const coordinatorAnchor=new DemoSignerCoordinatorAnchorSqlite(anchorDb);
const terminalParticipants=[] as DemoFrostProcessParticipant[];
for(const participant of dkg.participants){const enrollment=await json<{schema:string;
binding:DemoSignerDurableBindingV1;
signerIdentity:string;
digest:string;
signature:string}>(join(root,`node-${participant.participantId}/signer-enrollment-public.json`));
const expected=digest(['COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1',enrollment.binding,participant.signerIdentity]);
if(enrollment.schema!=='COCO_DEMO_FIPS_SIGNER_ENROLLMENT_V1'||enrollment.digest!==expected||enrollment.signerIdentity!==participant.signerIdentity||!schnorr.verify(hexToBytes(enrollment.signature),hexToBytes(expected),hexToBytes(participant.signerIdentity)))throw new Error('DEMO_FIPS_DRIVER_ENROLLMENT: signer enrollment invalid');
terminalParticipants.push({enrollment:{participantId:participant.participantId,processIdentity:participant.signerIdentity,stateDirectory:participant.stateDirectory,verifyingShare:participant.verifyingShare},transport:createDemoSignerRpcTransport({endpoint:participant.signerEndpoint,enrollment:{participantId:participant.participantId,processIdentity:participant.signerIdentity,stateDirectory:participant.stateDirectory,verifyingShare:participant.verifyingShare},signerBinding:enrollment.binding,anchor:coordinatorAnchor,coordinatorIdentityPrivateKey:coordinatorSecret,signerIdentity:participant.signerIdentity})})}
const policyDigest=demoFrostParticipantPolicyDigest(policy);
const request:DemoMaintainerFederationRequest={schema:'COCO_DEMO_FROST_REQUEST_V1',threshold:3,sessionId:randomBytes(32).toString('hex'),packageDigest:policy.packageDigest,cashuSigAllDigest:policy.cashuSigAllDigest,committeePublicKey:dkg.committeePublicKey,committeeKeysetId:dkg.committeeKeysetId,committeeKeysetVersion:dkg.committeeKeysetVersion,participants:dkg.participants.map((p)=>({identifier:p.participantId,verifyingShare:p.verifyingShare})),policyPackageDigest:policyDigest,closureEvidenceDigest:policy.certifiedClosure.evidenceDigest,signedBidEvidenceDigest:policy.signedBid.evidenceDigest,committeeLockedProofsDigest:demoFrostCommitteeLockedProofsDigest(policy.committeeLockedProofs)};
const composition=await createDemoMaintainerThreshold3ProcessComposition({request,policy,authorityClaim:claim,authorityStore,participants:terminalParticipants as any,dkgRunId:dkg.dkgRunId,publicKeyPackageSha256:dkg.publicKeyPackageSha256,signerRosterDigest:dkg.signerRosterDigest,binaryPath:cli.participantBinary,publicKeyPackagePath:dkg.publicKeyPackagePath,scratchParent:join(root,'node-1/scratch'),processTimeoutMs:20_000,federationTimeoutMs:25_000});
const authorization=await composition.federation.authorize(request);
if(!schnorr.verify(hexToBytes(authorization.signature),hexToBytes(policy.cashuSigAllDigest),hexToBytes(dkg.committeePublicKey.slice(2))))throw new Error('DEMO_FIPS_DRIVER_FROST: aggregate invalid');

const inputs=first.bundle.refund.inputs.map((proof)=>structuredClone(proof));
inputs[0]!.witness=JSON.stringify({signatures:[first.bundle.refund.bidderMainSignature,authorization.signature]});
const operationJournal=join(root,'driver-mint-operation.json');
await replaceJson(operationJournal,{schema:'PLEBEIAN_FRIDAY_FIPS_MINT_OPERATION_V1',status:'attempting',operationId:claim.operationId,operationRoot:composition.executionBinding.frostOperationRoot,requestDigest:policy.cashuSigAllDigest,outputs:first.bundle.refund.outputs});
const mintIp=application.fips_ulas[0];
const body=JSON.stringify({inputs,outputs:first.bundle.refund.outputs});
await new Promise<void>((resolvePromise,reject)=>{const socket=connect({host:mintIp,port:3338},()=>{socket.write(`POST /v1/swap HTTP/1.1\r\nHost: [${mintIp}]:3338\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,()=>{socket.destroy();
resolvePromise()})});
socket.once('error',reject)});
await replaceJson(operationJournal,{schema:'PLEBEIAN_FRIDAY_FIPS_MINT_OPERATION_V1',status:'response_unknown',operationId:claim.operationId,operationRoot:composition.executionBinding.frostOperationRoot,requestDigest:policy.cashuSigAllDigest,outputs:first.bundle.refund.outputs});
const contextPath=join(root,'driver-recovery-context.json')
await replaceJson(contextPath,{schema:'PLEBEIAN_FRIDAY_FIPS_RECOVERY_CONTEXT_V1',mintUrl,keyset,intent:first.refundPlan.intent,request:first.refundPlan.request,recipientJournalPath:first.refundPlan.journalPath,operationJournalPath:operationJournal,walletPath:join(root,'driver-refund-wallet.json'),inputRefs:firstInputs.map((proof)=>bytesToHex(proofPoint(proof).toBytes(true))),expectedAmount:1000,operationRoot:composition.executionBinding.frostOperationRoot,cometTransactionDigest:secondAdmission.commit.broadcastTxHash,signerRequestDigest:policyDigest,unavailableSignerUla:application.fips_ulas[3],participantIds:authorization.participantIds} satisfies RecoveryContext)
await replaceJson(cli.output,{schema:'PLEBEIAN_FRIDAY_FIPS_DRIVER_PREPARED_V1',contextPath,operationId:claim.operationId,operationRoot:composition.executionBinding.frostOperationRoot,status:'response_unknown',displacedBidderActorKeyAvailable,displacedBidderMainKeyAvailable,displacedBidderEmergencyRefundKeyAvailable,admissionPrivateStoreReopened})
anchorDb.close(false);authorityDb.close(false);privateDb.close(false);sessionDb.close(false)
}

if(import.meta.main) await main()
