//! Fake-money admission-receipt signing domain for the task-local 3-of-4
//! signer.  This module deliberately does not reuse the Cashu disposition
//! authorization or its commands.  It reuses only the DKG key material and
//! the durable nonce machinery primitives from the parent binary.

use super::*;
use frost::keys::EvenY;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

const ADMISSION_VERSION: &str = "COCO_DEMO_FROST_ADMISSION_3OF4_V1";
const ADMISSION_AUTH_CONTEXT: &[u8] = b"COCO_DEMO_FROST_ADMISSION_AUTH_V1";
const ADMISSION_OPERATION_ROOT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_ADMISSION_OPERATION_ROOT_V1";
const ADMISSION_TRANSCRIPT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_ADMISSION_TRANSCRIPT_V1";
const ADMISSION_SIGNATURE_CONTEXT: &[u8] = b"COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1";
const ADMISSION_PROOF_REFS_CONTEXT: &str = "COCO_DEMO_FROST_ADMISSION_PROOF_REFS_V1";
const ADMISSION_BID_INTENT_CONTEXT: &str = "COCO_DEMO_FROST_ADMISSION_BID_INTENT_V1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionAuthorization {
    version: String,
    dkg_run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    public_key_package_sha256: String,
    signer_roster_digest: String,
    committee_public_key: String,
    operation_id: String,
    operation_root: String,
    session_id: String,
    receipt_hex: String,
    receipt_sha256: String,
    receipt_digest: String,
    participant_evidence_digest: String,
    bid_intent_id: String,
    auth_network_id: String,
    chain_id: String,
    auction_id: String,
    bidder: String,
    mint_url: String,
    pool_amount: u64,
    proof_state_refs_digest: String,
    active_keyset_id: String,
    bundle_digest: String,
    winner_package_digest: String,
    return_package_digest: String,
    return_cashu_sigall_digest: String,
    valid_from: u64,
    valid_until: u64,
    roster: Vec<u16>,
    threshold: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionReceipt {
    schema: String,
    auth_network_id: String,
    chain_id: String,
    mint_url: String,
    auction_id: String,
    bidder: String,
    bid_amount: u64,
    pool_amount: u64,
    replaces_bid_id: String,
    funding_operation_id: String,
    attested_at: u64,
    expires_at: u64,
    proof_state_refs: Vec<String>,
    active_keyset_id: String,
    input_fee_ppk: u64,
    locktime: u64,
    bidder_public_key: String,
    refund_public_key: String,
    committee_public_key: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    dkg_run_id: String,
    public_key_package_sha256: String,
    signer_roster_digest: String,
    winner_package_digest: String,
    return_package_digest: String,
    return_cashu_sigall_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prepared_bundle_digest: Option<String>,
    bundle_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    actor_funding_signature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    actor_funding_authorization: Option<NostrFundingAuthorizationEvent>,
    bidder_return_signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct NostrFundingAuthorizationEvent {
    id: String,
    pubkey: String,
    created_at: u64,
    kind: u64,
    tags: Vec<Vec<String>>,
    content: String,
    sig: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrowserFundingAuthorizationContent {
    schema: String,
    auth_network_id: String,
    chain_id: String,
    auction_id: String,
    amount: u64,
    mint_url: String,
    payment_public_key: String,
    refund_public_key: String,
    funding_operation_id: String,
    bundle_digest: String,
    return_package_digest: String,
    return_cashu_sig_all_digest: String,
    bidder_return_signature: String,
    expires_at: u64,
    payment_key_authorization_signature: String,
    refund_key_authorization_signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFundingKeyTerms<'a> {
    schema: &'a str,
    actor: &'a str,
    auth_network_id: &'a str,
    chain_id: &'a str,
    auction_id: &'a str,
    amount: u64,
    mint_url: &'a str,
    payment_public_key: &'a str,
    refund_public_key: &'a str,
    funding_operation_id: &'a str,
    bundle_digest: &'a str,
    return_package_digest: &'a str,
    return_cashu_sig_all_digest: &'a str,
    bidder_return_signature: &'a str,
    expires_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionOperationClaim {
    version: String,
    operation_id: String,
    operation_root: String,
    receipt_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct AdmissionSignJournal {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    participant_id: u16,
    #[zeroize(skip)]
    state: SignState,
    commitments_digest: Option<String>,
    nonces_hex: Option<String>,
    commitment_hex: String,
    share_hex: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionDurableBinding {
    version: String,
    participant_id: u16,
    dkg_run_id: String,
    public_key_package_sha256: String,
    signer_roster_digest: String,
    state_directory_identity: String,
    journal_generation: String,
    restart_epoch: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionCommitmentEnvelope {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    participant_id: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    durable_binding: Option<AdmissionDurableBinding>,
    hiding_hex: String,
    binding_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionShareEnvelope {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    commitments_digest: String,
    participant_id: u16,
    durable_binding: AdmissionDurableBinding,
    share_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionAggregateRequest {
    version: String,
    operation_id: String,
    session_id: String,
    commitments: Vec<AggregateCommitment>,
    shares: Vec<AggregateShare>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AdmissionAggregateSignature {
    version: String,
    operation_id: String,
    operation_root: String,
    session_id: String,
    authorization_digest: String,
    commitments_digest: String,
    receipt_digest: String,
    admission_signature_digest: String,
    bid_intent_id: String,
    signer_roster_digest: String,
    participant_ids: Vec<u16>,
    signature_hex: String,
}

fn hash_json(value: serde_json::Value) -> AnyResult<String> {
    Ok(sha256_hex(&serde_json::to_vec(&value)?))
}

fn verify_xonly(signature_hex: &str, digest_hex: &str, public_key_hex: &str) -> AnyResult<()> {
    let signature_bytes = exact_hex::<64>(signature_hex, "admission_signature")?;
    let digest = exact_hex::<32>(digest_hex, "admission_signed_digest")?;
    let public = exact_hex::<32>(public_key_hex, "admission_xonly_public_key")?;
    let signature = IdentitySignature::try_from(signature_bytes.as_slice())?;
    // The consensus and Cashu bindings are already 32-byte protocol digests.
    // `Verifier::verify` would SHA-256 them again; use the explicit prehash
    // API so Rust, Go, and noble-secp256k1 all verify the same BIP-340 message.
    IdentityVerifyingKey::from_bytes(&public)?.verify_prehash(&digest, &signature)?;
    Ok(())
}

fn verify_v4_browser_authorization(receipt: &AdmissionReceipt) -> AnyResult<()> {
    let event = receipt.actor_funding_authorization.as_ref().ok_or("V4 funding authorization is absent")?;
    if receipt.actor_funding_signature.is_some() || event.kind != 28_647 || event.pubkey != receipt.bidder
        || event.created_at != receipt.attested_at
    {
        return Err("V4 funding authorization identity differs".into());
    }
    let unsigned = serde_json::to_vec(&json!([0, event.pubkey, event.created_at, event.kind, &event.tags, event.content]))?;
    if sha256_hex(&unsigned) != event.id {
        return Err("V4 Nostr event id differs".into());
    }
    verify_xonly(&event.sig, &event.id, &event.pubkey)
        .map_err(|error| format!("V4 Nostr signature is invalid: {error}"))?;
    let content: BrowserFundingAuthorizationContent = serde_json::from_str(&event.content)?;
    if serde_json::to_string(&content)? != event.content {
        return Err("V4 funding authorization content is noncanonical".into());
    }
    let expected_tags = vec![
        vec!["t".into(), "plebeian-friday-funding-v1".into()],
        vec!["a".into(), receipt.auction_id.clone()],
        vec!["operation".into(), receipt.funding_operation_id.clone()],
        vec!["payment".into(), receipt.bidder_public_key.clone()],
    ];
    if event.tags != expected_tags || content.schema != "PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1"
        || content.auth_network_id != receipt.auth_network_id || content.chain_id != receipt.chain_id
        || content.auction_id != receipt.auction_id || content.amount != receipt.pool_amount
        || content.mint_url != receipt.mint_url || content.payment_public_key != receipt.bidder_public_key
        || content.refund_public_key != receipt.refund_public_key
        || content.funding_operation_id != receipt.funding_operation_id
        || Some(content.bundle_digest.as_str()) != receipt.prepared_bundle_digest.as_deref()
        || content.return_package_digest != receipt.return_package_digest
        || content.return_cashu_sig_all_digest != receipt.return_cashu_sigall_digest
        || content.bidder_return_signature != receipt.bidder_return_signature
        || content.expires_at != receipt.expires_at
    {
        return Err("V4 funding authorization differs from exact receipt identity".into());
    }
    let terms = BrowserFundingKeyTerms {
        schema: &content.schema, actor: &receipt.bidder, auth_network_id: &content.auth_network_id,
        chain_id: &content.chain_id, auction_id: &content.auction_id, amount: content.amount,
        mint_url: &content.mint_url, payment_public_key: &content.payment_public_key,
        refund_public_key: &content.refund_public_key, funding_operation_id: &content.funding_operation_id,
        bundle_digest: &content.bundle_digest, return_package_digest: &content.return_package_digest,
        return_cashu_sig_all_digest: &content.return_cashu_sig_all_digest,
        bidder_return_signature: &content.bidder_return_signature, expires_at: content.expires_at,
    };
    let mut framed = b"PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1".to_vec();
    framed.extend_from_slice(serde_json::to_string(&terms)?.as_bytes());
    let key_digest = hex::encode(sha256(&framed));
    verify_xonly(
        &content.payment_key_authorization_signature, &key_digest,
        content.payment_public_key.strip_prefix("02").or_else(|| content.payment_public_key.strip_prefix("03")).ok_or("invalid payment key")?,
    )?;
    verify_xonly(
        &content.refund_key_authorization_signature, &key_digest,
        content.refund_public_key.strip_prefix("02").or_else(|| content.refund_public_key.strip_prefix("03")).ok_or("invalid refund key")?,
    )?;
    Ok(())
}

fn receipt_bundle_digest(receipt: &AdmissionReceipt) -> AnyResult<String> {
    if receipt.schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
        return hash_json(json!([
            "PlebeianAuctionsPOCIntegratedFundingBundleV4", receipt.auth_network_id.as_str(), receipt.chain_id.as_str(),
            receipt.mint_url.as_str(), receipt.auction_id.as_str(), receipt.bidder.as_str(), receipt.bid_amount,
            receipt.pool_amount, receipt.replaces_bid_id.as_str(), receipt.funding_operation_id.as_str(),
            receipt.attested_at, receipt.expires_at, &receipt.proof_state_refs, receipt.active_keyset_id.as_str(),
            receipt.input_fee_ppk, receipt.locktime, receipt.bidder_public_key.as_str(), receipt.refund_public_key.as_str(),
            receipt.committee_public_key.as_str(), receipt.committee_keyset_id.as_str(), receipt.committee_keyset_version.as_str(),
            receipt.dkg_run_id.as_str(), receipt.public_key_package_sha256.as_str(), receipt.signer_roster_digest.as_str(),
            receipt.winner_package_digest.as_str(), receipt.return_package_digest.as_str(),
            receipt.return_cashu_sigall_digest.as_str(), receipt.prepared_bundle_digest.as_deref().unwrap_or("")
        ]));
    }
    hash_json(json!([
        "PlebeianAuctionsPOCIntegratedFundingBundleV3", receipt.auth_network_id.as_str(), receipt.chain_id.as_str(),
        receipt.mint_url.as_str(), receipt.auction_id.as_str(),
        receipt.bidder.as_str(), receipt.bid_amount, receipt.pool_amount, receipt.replaces_bid_id.as_str(),
        receipt.funding_operation_id.as_str(), receipt.attested_at, receipt.expires_at,
        &receipt.proof_state_refs, receipt.active_keyset_id.as_str(), receipt.input_fee_ppk,
        receipt.locktime, receipt.bidder_public_key.as_str(), receipt.refund_public_key.as_str(),
        receipt.committee_public_key.as_str(), receipt.committee_keyset_id.as_str(),
        receipt.committee_keyset_version.as_str(), receipt.dkg_run_id.as_str(),
        receipt.public_key_package_sha256.as_str(), receipt.signer_roster_digest.as_str(),
        receipt.winner_package_digest.as_str(), receipt.return_package_digest.as_str(),
        receipt.return_cashu_sigall_digest.as_str()
    ]))
}

fn receipt_digest(receipt: &AdmissionReceipt) -> AnyResult<String> {
    if receipt.schema == "PlebeianAuctionsPOCIntegratedFundingV4" {
        return hash_json(json!([
            receipt.schema.as_str(), receipt.auth_network_id.as_str(), receipt.chain_id.as_str(), receipt.mint_url.as_str(),
            receipt.auction_id.as_str(), receipt.bidder.as_str(), receipt.bid_amount, receipt.pool_amount,
            receipt.replaces_bid_id.as_str(), receipt.funding_operation_id.as_str(), receipt.attested_at, receipt.expires_at,
            &receipt.proof_state_refs, receipt.active_keyset_id.as_str(), receipt.input_fee_ppk, receipt.locktime,
            receipt.bidder_public_key.as_str(), receipt.refund_public_key.as_str(), receipt.committee_public_key.as_str(),
            receipt.committee_keyset_id.as_str(), receipt.committee_keyset_version.as_str(), receipt.dkg_run_id.as_str(),
            receipt.public_key_package_sha256.as_str(), receipt.signer_roster_digest.as_str(), receipt.winner_package_digest.as_str(),
            receipt.return_package_digest.as_str(), receipt.return_cashu_sigall_digest.as_str(),
            receipt.prepared_bundle_digest.as_deref().unwrap_or(""), receipt.bundle_digest.as_str(),
            receipt.actor_funding_authorization.as_ref().map(|event| event.id.as_str()).unwrap_or(""),
            receipt.bidder_return_signature.as_str()
        ]));
    }
    hash_json(json!([
        receipt.schema.as_str(), receipt.auth_network_id.as_str(), receipt.chain_id.as_str(),
        receipt.mint_url.as_str(), receipt.auction_id.as_str(), receipt.bidder.as_str(),
        receipt.bid_amount, receipt.pool_amount, receipt.replaces_bid_id.as_str(),
        receipt.funding_operation_id.as_str(), receipt.attested_at, receipt.expires_at,
        &receipt.proof_state_refs, receipt.active_keyset_id.as_str(), receipt.input_fee_ppk,
        receipt.locktime, receipt.bidder_public_key.as_str(), receipt.refund_public_key.as_str(),
        receipt.committee_public_key.as_str(), receipt.committee_keyset_id.as_str(),
        receipt.committee_keyset_version.as_str(), receipt.dkg_run_id.as_str(),
        receipt.public_key_package_sha256.as_str(), receipt.signer_roster_digest.as_str(),
        receipt.winner_package_digest.as_str(), receipt.return_package_digest.as_str(),
        receipt.return_cashu_sigall_digest.as_str(), receipt.bundle_digest.as_str(),
        receipt.actor_funding_signature.as_deref().unwrap_or(""), receipt.bidder_return_signature.as_str()
    ]))
}

fn proof_refs_digest(receipt: &AdmissionReceipt) -> AnyResult<String> {
    hash_json(json!([ADMISSION_PROOF_REFS_CONTEXT, &receipt.proof_state_refs]))
}

fn bid_intent_id(receipt: &AdmissionReceipt, digest: &str) -> AnyResult<String> {
    hash_json(json!([
        ADMISSION_BID_INTENT_CONTEXT, receipt.auth_network_id.as_str(), receipt.chain_id.as_str(),
        receipt.auction_id.as_str(), receipt.bidder.as_str(),
        receipt.funding_operation_id.as_str(), digest
    ]))
}

fn admission_signature_digest(receipt_digest: &str, participant_evidence_digest: &str) -> AnyResult<[u8; 32]> {
    let receipt = exact_hex::<32>(receipt_digest, "receipt_digest")?;
    let evidence = exact_hex::<32>(participant_evidence_digest, "participant_evidence_digest")?;
    let mut framed = Vec::with_capacity(ADMISSION_SIGNATURE_CONTEXT.len() + receipt.len() + evidence.len());
    framed.extend_from_slice(ADMISSION_SIGNATURE_CONTEXT);
    framed.extend_from_slice(&receipt);
    framed.extend_from_slice(&evidence);
    Ok(sha256(&framed))
}

fn admission_operation_root(auth: &AdmissionAuthorization) -> String {
    let mut framed = Vec::new();
    framed.extend_from_slice(ADMISSION_OPERATION_ROOT_CONTEXT);
    for field in [
        auth.dkg_run_id.as_bytes(), auth.committee_keyset_id.as_bytes(),
        auth.committee_keyset_version.as_bytes(), auth.public_key_package_sha256.as_bytes(),
        auth.signer_roster_digest.as_bytes(), auth.committee_public_key.as_bytes(),
        auth.operation_id.as_bytes(), auth.receipt_sha256.as_bytes(), auth.receipt_digest.as_bytes(),
        auth.participant_evidence_digest.as_bytes(),
        auth.bid_intent_id.as_bytes(), auth.auth_network_id.as_bytes(), auth.chain_id.as_bytes(),
        auth.auction_id.as_bytes(), auth.bidder.as_bytes(),
        auth.mint_url.as_bytes(), auth.proof_state_refs_digest.as_bytes(),
        auth.active_keyset_id.as_bytes(), auth.bundle_digest.as_bytes(),
        auth.winner_package_digest.as_bytes(), auth.return_package_digest.as_bytes(),
        auth.return_cashu_sigall_digest.as_bytes(),
    ] {
        framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
        framed.extend_from_slice(field);
    }
    framed.extend_from_slice(&auth.pool_amount.to_be_bytes());
    framed.extend_from_slice(&auth.valid_from.to_be_bytes());
    framed.extend_from_slice(&auth.valid_until.to_be_bytes());
    for id in &auth.roster {
        framed.extend_from_slice(&id.to_be_bytes());
    }
    framed.extend_from_slice(&auth.threshold.to_be_bytes());
    sha256_hex(&framed)
}

fn now_seconds() -> AnyResult<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs())
}

fn validate_authorization(auth: &AdmissionAuthorization) -> AnyResult<([u8; 32], AdmissionReceipt)> {
    if auth.version != ADMISSION_VERSION || auth.dkg_run_id.is_empty()
        || auth.committee_keyset_id.is_empty() || auth.committee_keyset_version.is_empty()
        || auth.operation_id.is_empty() || auth.auth_network_id.is_empty() || auth.chain_id.is_empty()
        || auth.auction_id.is_empty() || auth.mint_url.is_empty()
        || auth.active_keyset_id.is_empty() || auth.roster != [1, 2, 3, 4]
        || auth.threshold != MIN_SIGNERS || auth.pool_amount == 0
    {
        return Err("invalid admission authorization shape or exact 3-of-4 roster".into());
    }
    for (value, label) in [
        (&auth.public_key_package_sha256, "public_key_package_sha256"),
        (&auth.signer_roster_digest, "signer_roster_digest"),
        (&auth.operation_root, "operation_root"), (&auth.session_id, "session_id"),
        (&auth.receipt_sha256, "receipt_sha256"), (&auth.receipt_digest, "receipt_digest"),
        (&auth.participant_evidence_digest, "participant_evidence_digest"),
        (&auth.bid_intent_id, "bid_intent_id"), (&auth.bidder, "bidder"),
        (&auth.proof_state_refs_digest, "proof_state_refs_digest"),
        (&auth.bundle_digest, "bundle_digest"),
        (&auth.winner_package_digest, "winner_package_digest"),
        (&auth.return_package_digest, "return_package_digest"),
        (&auth.return_cashu_sigall_digest, "return_cashu_sigall_digest"),
    ] {
        exact_hex::<32>(value, label)?;
    }
    let committee = exact_hex::<33>(&auth.committee_public_key, "committee_public_key")?;
    if committee[0] != 2 {
        return Err("admission committee public key must be even compressed secp256k1".into());
    }
    if auth.valid_from == 0 || auth.valid_until < auth.valid_from
        || auth.valid_until - auth.valid_from > 300
    {
        return Err("invalid admission validity interval".into());
    }
    let now = now_seconds()?;
    if now < auth.valid_from || now > auth.valid_until {
        return Err("admission authorization is outside its validity interval".into());
    }
    let receipt_bytes = hex::decode(&auth.receipt_hex)?;
    if hex::encode(&receipt_bytes) != auth.receipt_hex || sha256_hex(&receipt_bytes) != auth.receipt_sha256 {
        return Err("admission receipt bytes are noncanonical or hash-mismatched".into());
    }
    let receipt: AdmissionReceipt = serde_json::from_slice(&receipt_bytes)?;
    if !["PlebeianAuctionsPOCIntegratedFundingV3", "PlebeianAuctionsPOCIntegratedFundingV4"].contains(&receipt.schema.as_str())
        || receipt.auth_network_id != auth.auth_network_id || receipt.chain_id != auth.chain_id
        || receipt.funding_operation_id != auth.operation_id || receipt.auction_id != auth.auction_id
        || receipt.bidder != auth.bidder || receipt.mint_url != auth.mint_url
        || receipt.pool_amount != auth.pool_amount || receipt.bid_amount != receipt.pool_amount
        || receipt.active_keyset_id != auth.active_keyset_id || receipt.input_fee_ppk != 0
        || receipt.committee_keyset_id != auth.committee_keyset_id
        || receipt.committee_keyset_version != auth.committee_keyset_version
        || receipt.dkg_run_id != auth.dkg_run_id
        || receipt.public_key_package_sha256 != auth.public_key_package_sha256
        || receipt.signer_roster_digest != auth.signer_roster_digest
        || receipt.committee_public_key != auth.committee_public_key
        || receipt.bundle_digest != auth.bundle_digest
        || receipt.winner_package_digest != auth.winner_package_digest
        || receipt.return_package_digest != auth.return_package_digest
        || receipt.return_cashu_sigall_digest != auth.return_cashu_sigall_digest
        || receipt.attested_at != auth.valid_from || receipt.expires_at != auth.valid_until
        || receipt.proof_state_refs.is_empty()
        || receipt.proof_state_refs.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err("admission authorization differs from exact receipt identity".into());
    }
    for proof_ref in &receipt.proof_state_refs {
        let point = exact_hex::<33>(proof_ref, "proof_state_ref")?;
        if point[0] != 2 && point[0] != 3 {
            return Err("proof state reference is not a compressed secp256k1 point".into());
        }
    }
    if receipt_bundle_digest(&receipt)? != receipt.bundle_digest {
        return Err("admission receipt bundle digest mismatch".into());
    }
    if receipt.schema == "PlebeianAuctionsPOCIntegratedFundingV3" {
        if receipt.prepared_bundle_digest.is_some() || receipt.actor_funding_authorization.is_some() {
            return Err("V3 receipt contains V4 authorization fields".into());
        }
        verify_xonly(receipt.actor_funding_signature.as_deref().ok_or("V3 actor signature absent")?, &receipt.bundle_digest, &receipt.bidder)
            .map_err(|error| format!("admission actor funding signature is invalid: {error}"))?;
    } else {
        if receipt.prepared_bundle_digest.as_ref().map(|value| exact_hex::<32>(value, "prepared_bundle_digest").is_err()).unwrap_or(true) {
            return Err("V4 prepared bundle digest is absent or invalid".into());
        }
        verify_v4_browser_authorization(&receipt)?;
    }
    verify_xonly(
        &receipt.bidder_return_signature,
        &receipt.return_cashu_sigall_digest,
        receipt.bidder_public_key.strip_prefix("02").or_else(|| receipt.bidder_public_key.strip_prefix("03")).ok_or("invalid bidder return key")?,
    ).map_err(|error| format!("admission bidder return signature is invalid: {error}"))?;
    let derived_receipt_digest = receipt_digest(&receipt)?;
    if derived_receipt_digest != auth.receipt_digest
        || proof_refs_digest(&receipt)? != auth.proof_state_refs_digest
        || bid_intent_id(&receipt, &derived_receipt_digest)? != auth.bid_intent_id
        || admission_operation_root(auth) != auth.operation_root
    {
        return Err("admission authorization derived identities do not match receipt".into());
    }
    let mut framed = Vec::new();
    framed.extend_from_slice(ADMISSION_AUTH_CONTEXT);
    for field in [
        auth.dkg_run_id.as_bytes(), auth.committee_keyset_id.as_bytes(),
        auth.committee_keyset_version.as_bytes(), auth.public_key_package_sha256.as_bytes(),
        auth.signer_roster_digest.as_bytes(), auth.committee_public_key.as_bytes(),
        auth.operation_id.as_bytes(), auth.operation_root.as_bytes(), auth.session_id.as_bytes(),
        auth.receipt_sha256.as_bytes(), auth.receipt_digest.as_bytes(),
        auth.participant_evidence_digest.as_bytes(), auth.bid_intent_id.as_bytes(),
        auth.auth_network_id.as_bytes(), auth.chain_id.as_bytes(), auth.auction_id.as_bytes(),
        auth.bidder.as_bytes(), auth.mint_url.as_bytes(),
        auth.proof_state_refs_digest.as_bytes(), auth.active_keyset_id.as_bytes(),
        auth.bundle_digest.as_bytes(), auth.winner_package_digest.as_bytes(),
        auth.return_package_digest.as_bytes(), auth.return_cashu_sigall_digest.as_bytes(),
    ] {
        framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
        framed.extend_from_slice(field);
    }
    framed.extend_from_slice(&auth.pool_amount.to_be_bytes());
    framed.extend_from_slice(&auth.valid_from.to_be_bytes());
    framed.extend_from_slice(&auth.valid_until.to_be_bytes());
    for id in &auth.roster { framed.extend_from_slice(&id.to_be_bytes()); }
    framed.extend_from_slice(&auth.threshold.to_be_bytes());
    Ok((sha256(&framed), receipt))
}

fn signer_roster_digest(config: &Config, final_state: &DkgFinalState) -> AnyResult<(String, String)> {
    let public_bytes = hex::decode(&final_state.public_key_package_hex)?;
    let package = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?.into_even_y(None);
    if package.max_signers() != MAX_SIGNERS || package.min_signers() != Some(MIN_SIGNERS) {
        return Err("admission public package is not exact 3-of-4".into());
    }
    let mut shares = Vec::new();
    for participant_id in 1u16..=4 {
        let share = package.verifying_shares().get(&identifier(participant_id)?)
            .ok_or("admission public package lacks roster share")?;
        shares.push(json!({
            "participant_id": participant_id,
            "verifying_share_hex": hex::encode(share.serialize()?),
        }));
    }
    let committee_public_key = hex::encode(package.verifying_key().serialize()?);
    let digest = hash_json(json!([
        "COCO_DEMO_FROST_SIGNER_ROSTER_V1", config.run_id.as_str(), config.committee_keyset_id.as_str(),
        config.committee_keyset_version.as_str(), sha256_hex(&public_bytes), committee_public_key.as_str(),
        MIN_SIGNERS, MAX_SIGNERS, shares
    ]))?;
    Ok((digest, committee_public_key))
}

fn validate_for_state(config: &Config, state: &StateLock, auth: &AdmissionAuthorization) -> AnyResult<()> {
    if auth.dkg_run_id != config.run_id || auth.committee_keyset_id != config.committee_keyset_id
        || auth.committee_keyset_version != config.committee_keyset_version
    {
        return Err("admission authorization belongs to another DKG/keyset".into());
    }
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    if final_state.run_id != config.run_id || final_state.committee_keyset_id != config.committee_keyset_id
        || final_state.committee_keyset_version != config.committee_keyset_version
        || final_state.participant_id != config.participant_id
    {
        return Err("admission participant state differs from config".into());
    }
    let public_bytes = hex::decode(&final_state.public_key_package_hex)?;
    if sha256_hex(&public_bytes) != auth.public_key_package_sha256 {
        return Err("admission public package hash differs from participant state".into());
    }
    let (roster_digest, committee_public_key) = signer_roster_digest(config, &final_state)?;
    if roster_digest != auth.signer_roster_digest || committee_public_key != auth.committee_public_key {
        return Err("admission signer roster or committee key differs from participant state".into());
    }
    Ok(())
}

fn state_directory_identity(state: &StateLock) -> String {
    let mut material = Vec::new();
    material.extend_from_slice(b"COCO_DEMO_FROST_ADMISSION_STATE_DIRECTORY_V1");
    material.extend_from_slice(state.root.to_string_lossy().as_bytes());
    sha256_hex(&material)
}

fn prepare_durable_binding(
    config: &Config,
    state: &StateLock,
    auth: &AdmissionAuthorization,
) -> AnyResult<AdmissionDurableBinding> {
    let path = state.path("admission-durable-binding.json");
    let directory_identity = state_directory_identity(state);
    let binding = if path.exists() {
        let mut prior: AdmissionDurableBinding = read_secret_json(&path)?;
        if prior.version != ADMISSION_VERSION || prior.participant_id != config.participant_id
            || prior.dkg_run_id != config.run_id
            || prior.public_key_package_sha256 != auth.public_key_package_sha256
            || prior.signer_roster_digest != auth.signer_roster_digest
            || prior.state_directory_identity != directory_identity
            || exact_hex::<32>(&prior.journal_generation, "journal_generation").is_err()
        {
            return Err("ADMISSION_SIGNER_QUARANTINED: durable signer identity changed".into());
        }
        prior.restart_epoch = prior.restart_epoch.checked_add(1)
            .ok_or("ADMISSION_SIGNER_QUARANTINED: restart epoch overflow")?;
        prior
    } else {
        let mut generation = [0u8; 32];
        OsRng.fill_bytes(&mut generation);
        AdmissionDurableBinding {
            version: ADMISSION_VERSION.to_string(), participant_id: config.participant_id,
            dkg_run_id: config.run_id.clone(), public_key_package_sha256: auth.public_key_package_sha256.clone(),
            signer_roster_digest: auth.signer_roster_digest.clone(), state_directory_identity: directory_identity,
            journal_generation: hex::encode(generation), restart_epoch: 1,
        }
    };
    Ok(binding)
}

fn check_operation(state: &StateLock, auth: &AdmissionAuthorization) -> AnyResult<()> {
    let operations = state.path("admission-operations");
    refuse_symlink(&operations)?;
    if operations.exists() && !operations.is_dir() { return Err("admission operations is not a directory".into()); }
    let path = operations.join(format!("{}.json", sha256_hex(auth.operation_id.as_bytes())));
    refuse_symlink(&path)?;
    if path.exists() {
        let actual: AdmissionOperationClaim = read_json(&path)?;
        let expected = AdmissionOperationClaim { version: ADMISSION_VERSION.into(), operation_id: auth.operation_id.clone(),
            operation_root: auth.operation_root.clone(), receipt_digest: auth.receipt_digest.clone() };
        if actual != expected { return Err("DUPLICATE_OPERATION_OWNER: admission operation owns another receipt/root".into()); }
    }
    Ok(())
}

fn validate_journal(config: &Config, auth: &AdmissionAuthorization, digest: &[u8; 32], journal: &AdmissionSignJournal) -> AnyResult<()> {
    if journal.version != ADMISSION_VERSION || journal.operation_id != auth.operation_id
        || journal.authorization_digest != hex::encode(digest) || journal.session_id != auth.session_id
        || journal.participant_id != config.participant_id {
        return Err("admission journal authorization mismatch".into());
    }
    Ok(())
}

fn claim_operation(state: &StateLock, auth: &AdmissionAuthorization) -> AnyResult<()> {
    let operations = state.path("admission-operations");
    if !operations.exists() {
        fs::create_dir(&operations)?;
        fs::set_permissions(&operations, fs::Permissions::from_mode(0o700))?;
    }
    refuse_symlink(&operations)?;
    let path = operations.join(format!("{}.json", sha256_hex(auth.operation_id.as_bytes())));
    let expected = AdmissionOperationClaim {
        version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id.clone(),
        operation_root: auth.operation_root.clone(), receipt_digest: auth.receipt_digest.clone(),
    };
    if path.exists() {
        let actual: AdmissionOperationClaim = read_json(&path)?;
        if actual != expected {
            return Err("DUPLICATE_OPERATION_OWNER: admission operation owns another receipt/root".into());
        }
        return Ok(());
    }
    replace_json(&path, &expected)
}

fn journal_path(state: &StateLock, operation_id: &str, session_id: &str) -> PathBuf {
    state.path(&format!(
        "admission-sign-{}.journal",
        sha256_hex(format!("{}:{}", operation_id, session_id).as_bytes())
    ))
}

pub(super) fn sign_commit(config_path: &Path, root: &Path, auth_path: &Path, public_out: &Path) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let auth: AdmissionAuthorization = read_json(auth_path)?;
    let (auth_digest, _) = validate_authorization(&auth)?;
    let state = StateLock::acquire(root)?;
    validate_for_state(&config, &state, &auth)?;
    check_operation(&state, &auth)?;
    let path = journal_path(&state, &auth.operation_id, &auth.session_id);
    refuse_symlink(&path)?;
    let fresh = !path.exists();
    let journal = if !fresh {
        let existing: AdmissionSignJournal = read_secret_json(&path)?;
        validate_journal(&config, &auth, &auth_digest, &existing)?;
        existing
    } else {
        let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
        let key_package = frost::keys::KeyPackage::deserialize(&hex::decode(&final_state.key_package_hex)?)?;
        if key_package.identifier() != &identifier(config.participant_id)? || key_package.min_signers() != &MIN_SIGNERS {
            return Err("admission key package does not belong to exact 3-of-4 participant".into());
        }
        let (nonces, commitment) = frost::round1::commit(key_package.signing_share(), &mut OsRng);
        AdmissionSignJournal {
            version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id.clone(),
            session_id: auth.session_id.clone(), authorization_digest: hex::encode(auth_digest),
            participant_id: config.participant_id, state: SignState::Committed,
            commitments_digest: None, nonces_hex: Some(hex::encode(nonces.serialize()?)),
            commitment_hex: hex::encode(commitment.serialize()?), share_hex: None,
        }
    };
    let commitments = frost::round1::SigningCommitments::deserialize(&hex::decode(&journal.commitment_hex)?)?;
    let durable_binding = prepare_durable_binding(&config, &state, &auth)?;
    let output = AdmissionCommitmentEnvelope {
        version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id.clone(),
        session_id: auth.session_id.clone(), authorization_digest: hex::encode(auth_digest),
        participant_id: config.participant_id, durable_binding: Some(durable_binding.clone()),
        hiding_hex: hex::encode(commitments.hiding().serialize()?), binding_hex: hex::encode(commitments.binding().serialize()?),
    };
    preflight_public_output(public_out, &output)?;
    // No safety writes until deterministic read-only checks have passed.
    replace_json(&state.path("admission-durable-binding.json"), &durable_binding)?;
    claim_operation(&state, &auth)?;
    if fresh { replace_json(&path, &journal)?; }
    publish_json_exact(public_out, &output)
}

fn signing_package(
    auth: &AdmissionAuthorization,
    auth_digest: &[u8; 32],
    bundle: &EnvelopeBundle<AdmissionCommitmentEnvelope>,
) -> AnyResult<(frost::SigningPackage, String)> {
    if bundle.version != ADMISSION_VERSION || bundle.entries.len() != usize::from(MIN_SIGNERS) {
        return Err("three admission commitment envelopes are required".into());
    }
    let actual: BTreeSet<_> = bundle.entries.iter().map(|entry| entry.participant_id).collect();
    let allowed: BTreeSet<_> = auth.roster.iter().copied().collect();
    if actual.len() != usize::from(MIN_SIGNERS) || actual.len() != bundle.entries.len() || !actual.is_subset(&allowed) {
        return Err("admission commitments must be three distinct enrolled participants".into());
    }
    let mut entries = bundle.entries.clone();
    entries.sort_by_key(|entry| entry.participant_id);
    let mut commitments = BTreeMap::new();
    for entry in &entries {
        if entry.version != ADMISSION_VERSION || entry.operation_id != auth.operation_id
            || entry.session_id != auth.session_id || entry.authorization_digest != hex::encode(auth_digest)
        {
            return Err("admission commitment authorization binding mismatch".into());
        }
        let hiding = hex::decode(&entry.hiding_hex)?;
        let binding = hex::decode(&entry.binding_hex)?;
        if hex::encode(&hiding) != entry.hiding_hex || hex::encode(&binding) != entry.binding_hex {
            return Err("admission commitment points are not canonical hex".into());
        }
        commitments.insert(identifier(entry.participant_id)?, frost::round1::SigningCommitments::new(
            frost::round1::NonceCommitment::deserialize(&hiding)?,
            frost::round1::NonceCommitment::deserialize(&binding)?,
        ));
    }
    let digest = admission_signature_digest(&auth.receipt_digest, &auth.participant_evidence_digest)?;
    let package = frost::SigningPackage::new(commitments, &digest);
    let mut transcript = Vec::new();
    transcript.extend_from_slice(ADMISSION_TRANSCRIPT_CONTEXT);
    transcript.extend_from_slice(auth_digest);
    let transcript_entries: Vec<_> = entries.iter().map(|entry| json!({
        "version": entry.version, "operation_id": entry.operation_id,
        "session_id": entry.session_id, "authorization_digest": entry.authorization_digest,
        "participant_id": entry.participant_id, "hiding_hex": entry.hiding_hex,
        "binding_hex": entry.binding_hex,
    })).collect();
    transcript.extend_from_slice(&serde_json::to_vec(&transcript_entries)?);
    Ok((package, sha256_hex(&transcript)))
}

fn validate_subset(auth: &AdmissionAuthorization, request: &AdmissionAggregateRequest) -> AnyResult<()> {
    let share_ids: BTreeSet<_> = request.shares.iter().map(|entry| entry.participant_id).collect();
    let commitment_ids: BTreeSet<_> = request.commitments.iter().map(|entry| entry.participant_id).collect();
    let allowed: BTreeSet<_> = auth.roster.iter().copied().collect();
    if request.shares.len() != usize::from(MIN_SIGNERS) || share_ids.len() != request.shares.len()
        || request.commitments.len() != usize::from(MIN_SIGNERS)
        || commitment_ids.len() != request.commitments.len() || share_ids != commitment_ids
        || !share_ids.is_subset(&allowed)
    {
        return Err("PAYMENT_BLOCKED_MISSING_PARTICIPANT: admission requires matching three-member subset".into());
    }
    Ok(())
}

pub(super) fn sign_share(
    config_path: &Path,
    root: &Path,
    auth_path: &Path,
    commitment_path: &Path,
    public_out: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let auth: AdmissionAuthorization = read_json(auth_path)?;
    let (auth_digest, _) = validate_authorization(&auth)?;
    let bundle: EnvelopeBundle<AdmissionCommitmentEnvelope> = read_json(commitment_path)?;
    let (package, commitments_digest) = signing_package(&auth, &auth_digest, &bundle)?;
    let state = StateLock::acquire(root)?;
    validate_for_state(&config, &state, &auth)?;
    check_operation(&state, &auth)?;
    let path = journal_path(&state, &auth.operation_id, &auth.session_id);
    let mut journal: AdmissionSignJournal = read_secret_json(&path)?;
    validate_journal(&config, &auth, &auth_digest, &journal)?;
    if journal.state != SignState::Committed && journal.commitments_digest.as_deref() != Some(&commitments_digest) {
        return Err("admission nonce is already bound to another transcript".into());
    }
    let durable_binding = prepare_durable_binding(&config, &state, &auth)?;
    if journal.state == SignState::Consumed {
        let share_hex = journal.share_hex.clone().ok_or("consumed admission journal lacks share")?;
        frost::round2::SignatureShare::deserialize(&hex::decode(&share_hex)?)?;
        let output = AdmissionShareEnvelope {
            version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id.clone(), session_id: auth.session_id.clone(),
            authorization_digest: hex::encode(auth_digest), commitments_digest, participant_id: config.participant_id,
            durable_binding: durable_binding.clone(), share_hex,
        };
        preflight_public_output(public_out, &output)?;
        replace_json(&state.path("admission-durable-binding.json"), &durable_binding)?;
        claim_operation(&state, &auth)?;
        return publish_json_exact(public_out, &output);
    }
    // Decode and check public commitment ownership before binding or nonce state writes.
    let nonces = frost::round1::SigningNonces::deserialize(
        &hex::decode(journal.nonces_hex.as_ref().ok_or("admission nonce unavailable")?)?,
    )?;
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    let key_package = frost::keys::KeyPackage::deserialize(&hex::decode(&final_state.key_package_hex)?)?;
    validate_signing_material(config.participant_id, &package, &nonces, &key_package)?;
    preflight_new_share_output(public_out)?;
    replace_json(&state.path("admission-durable-binding.json"), &durable_binding)?;
    claim_operation(&state, &auth)?;
    if journal.state == SignState::Committed {
        journal.state = SignState::Consuming;
        journal.commitments_digest = Some(commitments_digest.clone());
        replace_json(&path, &journal)?;
    }
    let share = frost::round2::sign(&package, &nonces, &key_package)?;
    let share_hex = hex::encode(share.serialize());
    journal.state = SignState::Consumed;
    journal.nonces_hex = None;
    journal.share_hex = Some(share_hex.clone());
    replace_json(&path, &journal)?;
    publish_json_exact(public_out, &AdmissionShareEnvelope {
        version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id,
        session_id: auth.session_id, authorization_digest: hex::encode(auth_digest),
        commitments_digest, participant_id: config.participant_id, share_hex, durable_binding,
    })
}

pub(super) fn aggregate(auth_path: &Path, public_key_path: &Path, share_path: &Path, out: &Path) -> AnyResult<()> {
    let auth: AdmissionAuthorization = read_json(auth_path)?;
    let (auth_digest, _) = validate_authorization(&auth)?;
    let request: AdmissionAggregateRequest = read_json(share_path)?;
    if request.version != ADMISSION_VERSION || request.operation_id != auth.operation_id
        || request.session_id != auth.session_id
    {
        return Err("admission aggregate request authorization mismatch".into());
    }
    validate_subset(&auth, &request)?;
    let public: FinalPublicPackage = read_json(public_key_path)?;
    if public.version != VERSION || public.run_id != auth.dkg_run_id
        || public.committee_keyset_id != auth.committee_keyset_id
        || public.committee_keyset_version != auth.committee_keyset_version
        || public.public_key_package_sha256 != auth.public_key_package_sha256
    {
        return Err("admission aggregate public key belongs to another DKG/keyset".into());
    }
    let public_bytes = hex::decode(&public.public_key_package_hex)?;
    if hex::encode(&public_bytes) != public.public_key_package_hex
        || sha256_hex(&public_bytes) != public.public_key_package_sha256
    {
        return Err("admission public package hash or encoding mismatch".into());
    }
    let public_key_package = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?;
    let commitment_bundle = EnvelopeBundle {
        version: ADMISSION_VERSION.to_string(),
        entries: request.commitments.iter().map(|entry| AdmissionCommitmentEnvelope {
            version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id.clone(),
            session_id: auth.session_id.clone(), authorization_digest: hex::encode(auth_digest),
            participant_id: entry.participant_id, durable_binding: None, hiding_hex: entry.hiding_hex.clone(),
            binding_hex: entry.binding_hex.clone(),
        }).collect(),
    };
    let (package, commitments_digest) = signing_package(&auth, &auth_digest, &commitment_bundle)?;
    let mut shares = BTreeMap::new();
    for entry in &request.shares {
        let bytes = hex::decode(&entry.share_hex)?;
        if hex::encode(&bytes) != entry.share_hex {
            return Err("admission share is not canonical hex".into());
        }
        shares.insert(identifier(entry.participant_id)?, frost::round2::SignatureShare::deserialize(&bytes)?);
    }
    let signature = frost::aggregate(&package, &shares, &public_key_package)?;
    let digest = admission_signature_digest(&auth.receipt_digest, &auth.participant_evidence_digest)?;
    public_key_package.verifying_key().verify(&digest, &signature)?;
    let mut participant_ids: Vec<_> = request.commitments.iter().map(|entry| entry.participant_id).collect();
    participant_ids.sort_unstable();
    publish_json_exact(out, &AdmissionAggregateSignature {
        version: ADMISSION_VERSION.to_string(), operation_id: auth.operation_id,
        operation_root: auth.operation_root, session_id: auth.session_id,
        authorization_digest: hex::encode(auth_digest), commitments_digest,
        receipt_digest: auth.receipt_digest,
        admission_signature_digest: hex::encode(digest), bid_intent_id: auth.bid_intent_id,
        signer_roster_digest: auth.signer_roster_digest, participant_ids,
        signature_hex: hex::encode(signature.serialize()?),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell() -> AdmissionAuthorization {
        let now = now_seconds().unwrap();
        AdmissionAuthorization {
            version: ADMISSION_VERSION.to_string(), dkg_run_id: "dkg".into(),
            committee_keyset_id: "committee".into(), committee_keyset_version: "1".into(),
            public_key_package_sha256: "01".repeat(32), signer_roster_digest: "02".repeat(32),
            committee_public_key: format!("02{}", "03".repeat(32)), operation_id: "funding-1".into(),
            operation_root: "04".repeat(32), session_id: "05".repeat(32), receipt_hex: "00".into(),
            receipt_sha256: "06".repeat(32), receipt_digest: "07".repeat(32),
            participant_evidence_digest: "08".repeat(32), bid_intent_id: "09".repeat(32),
            auth_network_id: "demo-network".into(), chain_id: "demo-chain".into(),
            auction_id: "auction-1".into(), bidder: "0a".repeat(32), mint_url: "http://127.0.0.1:3338".into(),
            pool_amount: 1000, proof_state_refs_digest: "0b".repeat(32), active_keyset_id: "zero-fee".into(),
            bundle_digest: "0c".repeat(32), winner_package_digest: "0d".repeat(32),
            return_package_digest: "0e".repeat(32), return_cashu_sigall_digest: "0f".repeat(32),
            valid_from: now.saturating_sub(1), valid_until: now + 60, roster: vec![1, 2, 3, 4], threshold: 3,
        }
    }

    #[test]
    fn disposition_authorization_cannot_cross_into_admission_domain() {
        let disposition = super::super::Authorization {
            version: VERSION.to_string(), dkg_run_id: "dkg".into(), committee_keyset_id: "committee".into(),
            committee_keyset_version: "1".into(), public_key_package_sha256: "00".repeat(32),
            operation_id: "operation".into(), operation_root: "01".repeat(32), session_id: "02".repeat(32),
            policy_package_digest: "03".repeat(32), cashu_sigall_digest: "04".repeat(32),
            full_package_digest: "05".repeat(32), certified_closure_digest: "06".repeat(32),
            signed_bid_evidence_digest: "07".repeat(32), committee_locked_proofs_digest: "08".repeat(32),
            bidder_payout_binding_digest: "09".repeat(32), roster: vec![1, 2, 3, 4], threshold: 3,
        };
        let wire = serde_json::to_vec(&disposition).unwrap();
        assert!(serde_json::from_slice::<AdmissionAuthorization>(&wire).is_err());
        let raw = "11".repeat(32);
        let evidence = "12".repeat(32);
        assert_ne!(admission_signature_digest(&raw, &evidence).unwrap(), exact_hex::<32>(&raw, "raw").unwrap());
    }

    #[test]
    fn shared_admission_signature_domain_golden_matches_go_and_typescript() {
        let value: serde_json::Value = serde_json::from_str(include_str!("../../fixtures/admission-signature-domain-v1.json")).unwrap();
        assert_eq!(value["schema"], "CocoDemoFrostAdmissionSignatureGoldenV1");
        assert_eq!(value["domain_utf8"], std::str::from_utf8(ADMISSION_SIGNATURE_CONTEXT).unwrap());
        let receipt = value["receipt_digest"].as_str().unwrap();
        let evidence = value["participant_policy_digest"].as_str().unwrap();
        assert_eq!(hex::encode(admission_signature_digest(receipt, evidence).unwrap()), value["signature_digest"].as_str().unwrap());
    }

    #[test]
    fn v4_browser_authorization_golden_matches_typescript() {
        let value: serde_json::Value = serde_json::from_str(include_str!(
            "../../fixtures/integrated-funding-v4-browser-golden.json"
        ))
        .unwrap();
        let receipt: AdmissionReceipt = serde_json::from_value(value["receipt"].clone()).unwrap();
        verify_v4_browser_authorization(&receipt).unwrap();
        assert_eq!(
            receipt_bundle_digest(&receipt).unwrap(),
            receipt.bundle_digest
        );
        assert_eq!(
            receipt_digest(&receipt).unwrap(),
            value["receiptDigest"].as_str().unwrap()
        );
        let mut changed = receipt.clone();
        changed.prepared_bundle_digest = Some("77".repeat(32));
        assert!(verify_v4_browser_authorization(&changed).is_err());
    }

    #[test]
    fn wrong_roster_is_rejected_before_nonce_creation() {
        let mut auth = shell();
        auth.roster = vec![1, 2, 3];
        assert!(validate_authorization(&auth).unwrap_err().to_string().contains("exact 3-of-4 roster"));
    }

    #[test]
    fn expired_admission_is_rejected_before_receipt_or_nonce_processing() {
        let mut auth = shell();
        auth.valid_from = 1;
        auth.valid_until = 2;
        assert!(validate_authorization(&auth).unwrap_err().to_string().contains("outside its validity interval"));
    }

    #[test]
    fn admission_validity_longer_than_five_minutes_is_rejected_before_nonce_creation() {
        let mut auth = shell();
        auth.valid_until = auth.valid_from + 301;
        assert!(validate_authorization(&auth).unwrap_err().to_string().contains("validity interval"));
    }

    #[test]
    fn mutated_receipt_bytes_are_rejected_by_exact_hash() {
        let auth = shell();
        assert!(validate_authorization(&auth).unwrap_err().to_string().contains("hash-mismatched"));
    }
}
