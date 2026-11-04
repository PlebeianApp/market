//! Distinct fake-money FundingAbortV1 threshold-signing domain.
//!
//! This signs only a canonical validator-consumable abort certificate. It
//! cannot sign a Cashu disposition or an admission receipt. Signer-local
//! mint/consensus policy runs before these commands through authenticated RPC;
//! this module independently checks the certificate, actor/bidder signatures,
//! DKG binding, operation ownership, and durable nonce/restart state.

use super::*;
use frost::keys::EvenY;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

const ABORT_VERSION: &str = "COCO_DEMO_FROST_FUNDING_ABORT_3OF4_V1";
const AUTH_CONTEXT: &[u8] = b"COCO_DEMO_FROST_FUNDING_ABORT_AUTH_V1";
const ROOT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_FUNDING_ABORT_OPERATION_ROOT_V1";
const TRANSCRIPT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_FUNDING_ABORT_TRANSCRIPT_V1";
const COMMITTEE_CONTEXT: &[u8] = b"PLEBEIAN_FRIDAY_FUNDING_ABORT_COMMITTEE_V1";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct NostrEvent {
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
struct CommitteeUnsigned {
    schema: String,
    auth_network_id: String,
    chain_id: String,
    genesis_sha256: String,
    auction_id: String,
    operation_id: String,
    actor: String,
    mint_url: String,
    active_keyset_id: String,
    amount: u64,
    proof_ys: Vec<String>,
    pool_digest: String,
    nut11_lock_public_keys: Vec<String>,
    locktime: u64,
    payment_public_key: String,
    refund_public_key: String,
    committee_public_key: String,
    return_package_digest: String,
    return_cashu_sig_all_digest: String,
    bidder_return_signature: String,
    funding_authorization_event_id: String,
    abort_not_before: u64,
    abort_expires_at: u64,
    abort_reason: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    dkg_run_id: String,
    public_key_package_sha256: String,
    signer_roster_digest: String,
    participant_policy_digest: String,
    actor_abort_event: NostrEvent,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Authorization {
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
    committee_unsigned_hex: String,
    committee_unsigned_sha256: String,
    committee_digest: String,
    participant_policy_digest: String,
    valid_from: u64,
    valid_until: u64,
    roster: Vec<u16>,
    threshold: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct OperationClaim { version: String, operation_id: String, operation_root: String, committee_digest: String }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: String, operation_id: String, session_id: String, authorization_digest: String,
    participant_id: u16, #[zeroize(skip)] state: SignState, commitments_digest: Option<String>,
    nonces_hex: Option<String>, commitment_hex: String, share_hex: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct DurableBinding {
    version: String, participant_id: u16, dkg_run_id: String, public_key_package_sha256: String,
    signer_roster_digest: String, state_directory_identity: String, journal_generation: String,
    restart_epoch: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Commitment {
    version: String, operation_id: String, session_id: String, authorization_digest: String,
    participant_id: u16, durable_binding: Option<DurableBinding>, hiding_hex: String, binding_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Share {
    version: String, operation_id: String, session_id: String, authorization_digest: String,
    commitments_digest: String, participant_id: u16, durable_binding: DurableBinding, share_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateRequest {
    version: String, operation_id: String, session_id: String,
    commitments: Vec<AggregateCommitment>, shares: Vec<AggregateShare>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateSignature {
    version: String, operation_id: String, operation_root: String, session_id: String,
    authorization_digest: String, commitments_digest: String, committee_digest: String,
    participant_policy_digest: String, signer_roster_digest: String, participant_ids: Vec<u16>,
    signature_hex: String,
}

fn canonical(value: &Value) -> AnyResult<String> {
    Ok(match value {
        Value::Null => "null".into(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.as_u64().ok_or("canonical abort number is not unsigned")?.to_string(),
        Value::String(value) => serde_json::to_string(value)?,
        Value::Array(values) => format!("[{}]", values.iter().map(canonical).collect::<AnyResult<Vec<_>>>()?.join(",")),
        Value::Object(values) => {
            let mut entries: Vec<_> = values.iter().collect(); entries.sort_by(|a, b| a.0.cmp(b.0));
            format!("{{{}}}", entries.into_iter().map(|(key, value)|
                Ok(format!("{}:{}", serde_json::to_string(key)?, canonical(value)?)))
                .collect::<AnyResult<Vec<_>>>()?.join(","))
        }
    })
}

fn frame(target: &mut Vec<u8>, value: &[u8]) {
    target.extend_from_slice(&(value.len() as u32).to_be_bytes()); target.extend_from_slice(value);
}

fn now_seconds() -> AnyResult<u64> { Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs()) }

fn verify_signature(signature: &str, digest: &str, compressed_key: &str) -> AnyResult<()> {
    let signature = IdentitySignature::try_from(exact_hex::<64>(signature, "signature")?.as_slice())?;
    let digest = exact_hex::<32>(digest, "digest")?;
    let compressed = exact_hex::<33>(compressed_key, "compressed key")?;
    if compressed[0] != 2 && compressed[0] != 3 { return Err("invalid compressed key prefix".into()); }
    IdentityVerifyingKey::from_bytes(&compressed[1..])?.verify_prehash(&digest, &signature)?; Ok(())
}

fn validate_actor(unsigned: &CommitteeUnsigned) -> AnyResult<()> {
    let event = &unsigned.actor_abort_event;
    if event.kind != 28650 || event.pubkey != unsigned.actor || event.created_at == 0
        || event.created_at > unsigned.abort_expires_at || event.tags != vec![
            vec!["t".into(), "plebeian-friday-funding-abort-v1".into()],
            vec!["a".into(), unsigned.auction_id.clone()], vec!["operation".into(), unsigned.operation_id.clone()],
        ] { return Err("abort actor event identity differs".into()); }
    let mut terms = serde_json::to_value(unsigned)?; let object = terms.as_object_mut().ok_or("abort terms are not object")?;
    object.remove("schema"); object.remove("participantPolicyDigest"); object.remove("actorAbortEvent");
    object.insert("schema".into(), Value::String("PLEBEIAN_FRIDAY_FUNDING_ABORT_ACTOR_TERMS_V1".into()));
    if event.content != canonical(&terms)? { return Err("abort actor content differs".into()); }
    let event_value = serde_json::json!([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
    let event_id = sha256_hex(serde_json::to_string(&event_value)?.as_bytes());
    if event_id != event.id { return Err("abort actor event id differs".into()); }
    verify_signature(&event.sig, &event_id, &format!("02{}", event.pubkey))
}

fn operation_root(auth: &Authorization) -> String {
    let mut bytes = Vec::from(ROOT_CONTEXT);
    for value in [&auth.dkg_run_id, &auth.committee_keyset_id, &auth.committee_keyset_version,
        &auth.public_key_package_sha256, &auth.signer_roster_digest, &auth.committee_public_key,
        &auth.operation_id, &auth.committee_unsigned_sha256, &auth.committee_digest,
        &auth.participant_policy_digest] { frame(&mut bytes, value.as_bytes()); }
    bytes.extend_from_slice(&auth.valid_from.to_be_bytes()); bytes.extend_from_slice(&auth.valid_until.to_be_bytes());
    for id in &auth.roster { bytes.extend_from_slice(&id.to_be_bytes()); } bytes.extend_from_slice(&auth.threshold.to_be_bytes());
    sha256_hex(&bytes)
}

fn validate_authorization(auth: &Authorization) -> AnyResult<([u8; 32], CommitteeUnsigned)> {
    if auth.version != ABORT_VERSION || auth.dkg_run_id.is_empty() || auth.committee_keyset_id.is_empty()
        || auth.committee_keyset_version.is_empty() || auth.operation_id.is_empty()
        || auth.roster != [1, 2, 3, 4] || auth.threshold != MIN_SIGNERS
    { return Err("invalid abort authorization or roster".into()); }
    for value in [&auth.public_key_package_sha256, &auth.signer_roster_digest, &auth.operation_root,
        &auth.session_id, &auth.committee_unsigned_sha256, &auth.committee_digest, &auth.participant_policy_digest]
    { exact_hex::<32>(value, "abort digest")?; }
    let committee = exact_hex::<33>(&auth.committee_public_key, "committee key")?;
    if committee[0] != 2 { return Err("abort committee key is not even compressed".into()); }
    if auth.valid_from == 0 || auth.valid_until < auth.valid_from || auth.valid_until - auth.valid_from > 4_200 {
        return Err("abort validity is invalid".into());
    }
    let now = now_seconds()?; if now < auth.valid_from || now > auth.valid_until { return Err("abort authorization expired".into()); }
    let raw = hex::decode(&auth.committee_unsigned_hex)?;
    if hex::encode(&raw) != auth.committee_unsigned_hex || sha256_hex(&raw) != auth.committee_unsigned_sha256 {
        return Err("abort unsigned bytes differ".into());
    }
    let value: Value = serde_json::from_slice(&raw)?;
    if canonical(&value)?.as_bytes() != raw.as_slice() { return Err("abort unsigned JSON is not canonical".into()); }
    let unsigned: CommitteeUnsigned = serde_json::from_value(value.clone())?;
    if unsigned.schema != "PLEBEIAN_FRIDAY_FUNDING_ABORT_V1" || unsigned.operation_id != auth.operation_id
        || unsigned.dkg_run_id != auth.dkg_run_id || unsigned.committee_keyset_id != auth.committee_keyset_id
        || unsigned.committee_keyset_version != auth.committee_keyset_version
        || unsigned.public_key_package_sha256 != auth.public_key_package_sha256
        || unsigned.signer_roster_digest != auth.signer_roster_digest
        || unsigned.committee_public_key != auth.committee_public_key
        || unsigned.participant_policy_digest != auth.participant_policy_digest
        || unsigned.abort_not_before != auth.valid_from || unsigned.abort_expires_at != auth.valid_until
        || unsigned.amount == 0 || unsigned.amount > 50_000 || unsigned.locktime < unsigned.abort_expires_at
        || !matches!(unsigned.abort_reason.as_str(), "prebroadcast_client_abandonment" | "prebroadcast_service_failure")
        || unsigned.proof_ys.is_empty() || unsigned.proof_ys.len() > 32
        || unsigned.proof_ys.windows(2).any(|pair| pair[0] >= pair[1])
        || unsigned.nut11_lock_public_keys != [unsigned.payment_public_key.clone(), unsigned.committee_public_key.clone()]
    { return Err("abort authorization differs from certificate".into()); }
    for value in [&unsigned.genesis_sha256, &unsigned.pool_digest, &unsigned.return_package_digest,
        &unsigned.return_cashu_sig_all_digest, &unsigned.funding_authorization_event_id,
        &unsigned.public_key_package_sha256, &unsigned.signer_roster_digest, &unsigned.participant_policy_digest]
    { exact_hex::<32>(value, "certificate digest")?; }
    for proof in &unsigned.proof_ys { let point = exact_hex::<33>(proof, "proof Y")?;
        if point[0] != 2 && point[0] != 3 { return Err("proof Y prefix is invalid".into()); } }
    verify_signature(&unsigned.bidder_return_signature, &unsigned.return_cashu_sig_all_digest, &unsigned.payment_public_key)?;
    validate_actor(&unsigned)?;
    let computed = sha256_hex([COMMITTEE_CONTEXT, canonical(&value)?.as_bytes()].concat().as_slice());
    if computed != auth.committee_digest || operation_root(auth) != auth.operation_root {
        return Err("abort committee digest or operation root differs".into());
    }
    let mut bytes = Vec::from(AUTH_CONTEXT);
    for value in [&auth.dkg_run_id, &auth.committee_keyset_id, &auth.committee_keyset_version,
        &auth.public_key_package_sha256, &auth.signer_roster_digest, &auth.committee_public_key,
        &auth.operation_id, &auth.operation_root, &auth.session_id, &auth.committee_unsigned_sha256,
        &auth.committee_digest, &auth.participant_policy_digest] { frame(&mut bytes, value.as_bytes()); }
    bytes.extend_from_slice(&auth.valid_from.to_be_bytes()); bytes.extend_from_slice(&auth.valid_until.to_be_bytes());
    for id in &auth.roster { bytes.extend_from_slice(&id.to_be_bytes()); } bytes.extend_from_slice(&auth.threshold.to_be_bytes());
    Ok((sha256(&bytes), unsigned))
}

fn validate_for_state(config: &Config, state: &StateLock, auth: &Authorization) -> AnyResult<()> {
    if auth.dkg_run_id != config.run_id || auth.committee_keyset_id != config.committee_keyset_id
        || auth.committee_keyset_version != config.committee_keyset_version { return Err("abort belongs to another DKG".into()); }
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    let public_bytes = hex::decode(&final_state.public_key_package_hex)?;
    let package = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?.into_even_y(None);
    if final_state.participant_id != config.participant_id || final_state.run_id != config.run_id
        || sha256_hex(&public_bytes) != auth.public_key_package_sha256
        || hex::encode(package.verifying_key().serialize()?) != auth.committee_public_key
        || package.max_signers() != MAX_SIGNERS || package.min_signers() != Some(MIN_SIGNERS)
    { return Err("abort DKG state or committee differs".into()); }
    Ok(())
}

fn state_identity(state: &StateLock) -> String {
    sha256_hex([b"COCO_DEMO_FROST_FUNDING_ABORT_STATE_DIRECTORY_V1".as_slice(),
        state.root.to_string_lossy().as_bytes()].concat().as_slice())
}

fn prepare_binding(config: &Config, state: &StateLock, auth: &Authorization) -> AnyResult<DurableBinding> {
    let path = state.path("funding-abort-durable-binding.json"); let identity = state_identity(state);
    let result = if path.exists() {
        let mut prior: DurableBinding = read_secret_json(&path)?;
        if prior.version != ABORT_VERSION || prior.participant_id != config.participant_id
            || prior.dkg_run_id != config.run_id || prior.public_key_package_sha256 != auth.public_key_package_sha256
            || prior.signer_roster_digest != auth.signer_roster_digest || prior.state_directory_identity != identity
            || exact_hex::<32>(&prior.journal_generation, "journal generation").is_err()
        { return Err("FUNDING_ABORT_SIGNER_QUARANTINED: durable identity changed".into()); }
        prior.restart_epoch = prior.restart_epoch.checked_add(1).ok_or("abort restart epoch overflow")?; prior
    } else {
        let mut generation = [0u8; 32]; OsRng.fill_bytes(&mut generation);
        DurableBinding { version: ABORT_VERSION.into(), participant_id: config.participant_id,
            dkg_run_id: config.run_id.clone(), public_key_package_sha256: auth.public_key_package_sha256.clone(),
            signer_roster_digest: auth.signer_roster_digest.clone(), state_directory_identity: identity,
            journal_generation: hex::encode(generation), restart_epoch: 1 }
    };
    Ok(result)
}

fn check_claim(state: &StateLock, auth: &Authorization) -> AnyResult<()> {
    let directory = state.path("funding-abort-operations");
    refuse_symlink(&directory)?;
    if directory.exists() && !directory.is_dir() { return Err("abort operations is not a directory".into()); }
    let path = directory.join(format!("{}.json", sha256_hex(auth.operation_id.as_bytes())));
    refuse_symlink(&path)?;
    let wanted = OperationClaim { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
        operation_root: auth.operation_root.clone(), committee_digest: auth.committee_digest.clone() };
    if path.exists() && read_json::<OperationClaim>(&path)? != wanted {
        return Err("DUPLICATE_OPERATION_OWNER: abort root differs".into());
    }
    Ok(())
}

fn claim(state: &StateLock, auth: &Authorization) -> AnyResult<()> {
    let directory = state.path("funding-abort-operations");
    if !directory.exists() { fs::create_dir(&directory)?; fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?; }
    refuse_symlink(&directory)?;
    let path = directory.join(format!("{}.json", sha256_hex(auth.operation_id.as_bytes())));
    let wanted = OperationClaim { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
        operation_root: auth.operation_root.clone(), committee_digest: auth.committee_digest.clone() };
    if path.exists() { if read_json::<OperationClaim>(&path)? != wanted { return Err("DUPLICATE_OPERATION_OWNER: abort root differs".into()); } return Ok(()); }
    replace_json(&path, &wanted)
}

fn journal_path(state: &StateLock, auth: &Authorization) -> PathBuf {
    state.path(&format!("funding-abort-sign-{}.journal", sha256_hex(format!("{}:{}", auth.operation_id, auth.session_id).as_bytes())))
}

pub(super) fn sign_commit(config_path: &Path, root: &Path, auth_path: &Path, out: &Path) -> AnyResult<()> {
    let config: Config = read_json(config_path)?; validate_config(&config)?;
    let auth: Authorization = read_json(auth_path)?; let (digest, _) = validate_authorization(&auth)?;
    let state = StateLock::acquire(root)?; validate_for_state(&config, &state, &auth)?;
    check_claim(&state, &auth)?;
    let path = journal_path(&state, &auth); refuse_symlink(&path)?; let fresh = !path.exists();
    let journal = commitment_journal(&config, &state, &auth, &digest)?;
    let commitment = frost::round1::SigningCommitments::deserialize(&hex::decode(journal.commitment_hex.clone())?)?;
    let durable = prepare_binding(&config, &state, &auth)?;
    let output = Commitment { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
        session_id: auth.session_id.clone(), authorization_digest: hex::encode(digest), participant_id: config.participant_id,
        durable_binding: Some(durable.clone()), hiding_hex: hex::encode(commitment.hiding().serialize()?),
        binding_hex: hex::encode(commitment.binding().serialize()?) };
    preflight_public_output(out, &output)?;
    replace_json(&state.path("funding-abort-durable-binding.json"), &durable)?;
    claim(&state, &auth)?;
    if fresh { replace_json(&path, &journal)?; }
    publish_json_exact(out, &output)
}

// Idempotent commitment retries must never replace an existing nonce lifecycle.
fn commitment_journal(config: &Config, state: &StateLock, auth: &Authorization,
    digest: &[u8; 32]) -> AnyResult<Journal> {
    let path = journal_path(state, auth); refuse_symlink(&path)?;
    let journal = if path.exists() {
        let prior: Journal = read_secret_json(&path)?;
        if prior.version != ABORT_VERSION || prior.operation_id != auth.operation_id
            || prior.session_id != auth.session_id || prior.authorization_digest != hex::encode(digest)
            || prior.participant_id != config.participant_id { return Err("abort journal differs".into()); }
        prior
    } else {
        let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
        let key = frost::keys::KeyPackage::deserialize(&hex::decode(&final_state.key_package_hex)?)?;
        if key.identifier() != &identifier(config.participant_id)? || key.min_signers() != &MIN_SIGNERS {
            return Err("abort key is not exact 3-of-4 participant".into());
        }
        let (nonces, commitment) = frost::round1::commit(key.signing_share(), &mut OsRng);
        let created = Journal { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(), session_id: auth.session_id.clone(),
            authorization_digest: hex::encode(digest), participant_id: config.participant_id, state: SignState::Committed,
            commitments_digest: None, nonces_hex: Some(hex::encode(nonces.serialize()?)),
            commitment_hex: hex::encode(commitment.serialize()?), share_hex: None };
        created
    };
    Ok(journal)
}

fn signing_package(auth: &Authorization, digest: &[u8; 32], bundle: &EnvelopeBundle<Commitment>)
    -> AnyResult<(frost::SigningPackage, String, Vec<u16>)> {
    if bundle.version != ABORT_VERSION || bundle.entries.len() != usize::from(MIN_SIGNERS) { return Err("three abort commitments required".into()); }
    let mut entries = bundle.entries.clone(); entries.sort_by_key(|entry| entry.participant_id);
    let ids: Vec<_> = entries.iter().map(|entry| entry.participant_id).collect();
    if ids.windows(2).any(|pair| pair[0] >= pair[1]) || ids.iter().any(|id| !auth.roster.contains(id)) { return Err("abort commitment roster differs".into()); }
    let mut commitments = BTreeMap::new();
    for entry in &entries {
        if entry.version != ABORT_VERSION || entry.operation_id != auth.operation_id || entry.session_id != auth.session_id
            || entry.authorization_digest != hex::encode(digest) { return Err("abort commitment binding differs".into()); }
        commitments.insert(identifier(entry.participant_id)?, frost::round1::SigningCommitments::new(
            frost::round1::NonceCommitment::deserialize(&hex::decode(&entry.hiding_hex)?)?,
            frost::round1::NonceCommitment::deserialize(&hex::decode(&entry.binding_hex)?)?));
    }
    let package = frost::SigningPackage::new(commitments, &exact_hex::<32>(&auth.committee_digest, "committee digest")?);
    let mut transcript = Vec::from(TRANSCRIPT_CONTEXT); transcript.extend_from_slice(digest);
    for entry in &entries { transcript.extend_from_slice(&entry.participant_id.to_be_bytes());
        frame(&mut transcript, entry.hiding_hex.as_bytes()); frame(&mut transcript, entry.binding_hex.as_bytes()); }
    Ok((package, sha256_hex(&transcript), ids))
}

pub(super) fn sign_share(config_path: &Path, root: &Path, auth_path: &Path, commitments_path: &Path, out: &Path) -> AnyResult<()> {
    let config: Config = read_json(config_path)?; validate_config(&config)?;
    let auth: Authorization = read_json(auth_path)?; let (digest, _) = validate_authorization(&auth)?;
    let commitments: EnvelopeBundle<Commitment> = read_json(commitments_path)?;
    let state = StateLock::acquire(root)?; validate_for_state(&config, &state, &auth)?;
    check_claim(&state, &auth)?;
    let (package, transcript, _) = signing_package(&auth, &digest, &commitments)?;
    sign_share_journal(&config, &state, &auth, &digest, &package, &transcript, out)
}

// The caller has already validated authorization, DKG state, operation ownership,
// and the commitment bundle. Keep the durable nonce transition in one testable path.
fn sign_share_journal(config: &Config, state: &StateLock, auth: &Authorization, digest: &[u8; 32],
    package: &frost::SigningPackage, transcript: &str, out: &Path) -> AnyResult<()> {
    check_claim(state, auth)?;
    let path = journal_path(state, auth); let mut journal: Journal = read_secret_json(&path)?;
    if journal.version != ABORT_VERSION || journal.operation_id != auth.operation_id
        || journal.authorization_digest != hex::encode(digest) || journal.session_id != auth.session_id
        || journal.participant_id != config.participant_id { return Err("abort share journal differs".into()); }
    if journal.state == SignState::Consumed {
        if journal.commitments_digest.as_deref() != Some(transcript) {
            return Err("consumed abort nonce cannot be replayed for another transcript".into());
        }
        let share_hex = journal.share_hex.clone().ok_or("abort share absent")?;
        frost::round2::SignatureShare::deserialize(&hex::decode(&share_hex)?)?;
        let durable = prepare_binding(config, state, auth)?;
        let output = Share { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
            session_id: auth.session_id.clone(), authorization_digest: hex::encode(digest), commitments_digest: transcript.to_string(),
            participant_id: config.participant_id, durable_binding: durable.clone(), share_hex };
        preflight_public_output(out, &output)?;
        replace_json(&state.path("funding-abort-durable-binding.json"), &durable)?;
        claim(state, auth)?;
        return publish_json_exact(out, &output);
    }
    if journal.state == SignState::Consuming && journal.commitments_digest.as_deref() != Some(transcript) {
        return Err("abort nonce is already bound to another transcript".into());
    }
    let nonces = frost::round1::SigningNonces::deserialize(&hex::decode(journal.nonces_hex.as_ref().ok_or("abort nonces absent")?)?)?;
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    let key = frost::keys::KeyPackage::deserialize(&hex::decode(final_state.key_package_hex.clone())?)?;
    validate_signing_material(config.participant_id, package, &nonces, &key)?;
    let durable = prepare_binding(config, state, auth)?;
    preflight_new_share_output(out)?;
    replace_json(&state.path("funding-abort-durable-binding.json"), &durable)?;
    claim(state, auth)?;
    if journal.state == SignState::Committed {
        journal.state = SignState::Consuming;
        journal.commitments_digest = Some(transcript.to_string());
        replace_json(&path, &journal)?;
    }
    let share = frost::round2::sign(package, &nonces, &key)?; journal.state = SignState::Consumed;
    journal.nonces_hex = None; journal.share_hex = Some(hex::encode(share.serialize())); replace_json(&path, &journal)?;
    publish_json_exact(out, &Share { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
        session_id: auth.session_id.clone(), authorization_digest: hex::encode(digest), commitments_digest: transcript.to_string(),
        participant_id: config.participant_id, durable_binding: durable,
        share_hex: journal.share_hex.clone().ok_or("abort share absent")? })
}

pub(super) fn aggregate(auth_path: &Path, public_path: &Path, shares_path: &Path, out: &Path) -> AnyResult<()> {
    let auth: Authorization = read_json(auth_path)?; let (digest, _) = validate_authorization(&auth)?;
    let request: AggregateRequest = read_json(shares_path)?;
    if request.version != ABORT_VERSION || request.operation_id != auth.operation_id || request.session_id != auth.session_id {
        return Err("abort aggregate binding differs".into());
    }
    let public_bytes = read_public_key_package_bytes(public_path, &auth.dkg_run_id,
        &auth.committee_keyset_id, &auth.committee_keyset_version, &auth.public_key_package_sha256)?;
    let bundle = EnvelopeBundle { version: ABORT_VERSION.into(), entries: request.commitments.iter().map(|entry| Commitment {
        version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(), session_id: auth.session_id.clone(),
        authorization_digest: hex::encode(digest), participant_id: entry.participant_id, durable_binding: None,
        hiding_hex: entry.hiding_hex.clone(), binding_hex: entry.binding_hex.clone() }).collect() };
    let (package, transcript, ids) = signing_package(&auth, &digest, &bundle)?;
    if request.shares.len() != ids.len() { return Err("abort share subset differs".into()); }
    let mut shares = BTreeMap::new();
    for share in &request.shares {
        if !ids.contains(&share.participant_id) || shares.insert(identifier(share.participant_id)?,
            frost::round2::SignatureShare::deserialize(&hex::decode(&share.share_hex)?)?).is_some()
        { return Err("abort shares contain duplicate or unenrolled signer".into()); }
    }
    let public_package = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?.into_even_y(None);
    let signature = frost::aggregate(&package, &shares, &public_package)?;
    public_package.verifying_key().verify(&exact_hex::<32>(&auth.committee_digest, "committee digest")?, &signature)?;
    publish_json_exact(out, &AggregateSignature { version: ABORT_VERSION.into(), operation_id: auth.operation_id,
        operation_root: auth.operation_root, session_id: auth.session_id, authorization_digest: hex::encode(digest),
        commitments_digest: transcript, committee_digest: auth.committee_digest,
        participant_policy_digest: auth.participant_policy_digest, signer_roster_digest: auth.signer_roster_digest,
        participant_ids: ids, signature_hex: hex::encode(signature.serialize()?) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_sorts_nested_keys() {
        let value: Value = serde_json::from_str(r#"{"z":1,"a":{"y":2,"x":3}}"#).unwrap();
        assert_eq!(canonical(&value).unwrap(), r#"{"a":{"x":3,"y":2},"z":1}"#);
    }

    #[test]
    fn root_binds_policy_digest() {
        let auth = Authorization { version: ABORT_VERSION.into(), dkg_run_id: "run".into(),
            committee_keyset_id: "keyset".into(), committee_keyset_version: "v1".into(),
            public_key_package_sha256: "1".repeat(64), signer_roster_digest: "2".repeat(64),
            committee_public_key: format!("02{}", "3".repeat(64)), operation_id: "operation".into(),
            operation_root: String::new(), session_id: "4".repeat(64), committee_unsigned_hex: "00".into(),
            committee_unsigned_sha256: "5".repeat(64), committee_digest: "6".repeat(64),
            participant_policy_digest: "7".repeat(64), valid_from: 1, valid_until: 2,
            roster: vec![1,2,3,4], threshold: 3 };
        let root = operation_root(&auth); let mut changed = auth.clone(); changed.participant_policy_digest = "8".repeat(64);
        assert_ne!(root, operation_root(&changed));
    }
    // Fixed synthetic scalar and seeded nonce fixtures: no DKG, live signer,
    // Nostr event signing, mint, network or production share is involved.
    struct JournalFixture {
        root: PathBuf,
        config: Config,
        auth: Authorization,
        digest: [u8; 32],
        bundle: EnvelopeBundle<Commitment>,
    }

    impl Drop for JournalFixture {
        fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); }
    }

    impl JournalFixture {
        fn new() -> Self {
            use rand::SeedableRng;
            let root = std::env::temp_dir().join(format!("abort-transcript-unit-{}-{}",
                std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)));
            let state = StateLock::acquire(&root).unwrap();
            let config = Config { version: VERSION.into(), run_id: "synthetic".into(),
                committee_keyset_id: "unit".into(), committee_keyset_version: "1".into(),
                participant_id: 1, max_signers: MAX_SIGNERS, min_signers: MIN_SIGNERS, roster: vec![1,2,3,4] };
            let auth = Authorization { version: ABORT_VERSION.into(), dkg_run_id: config.run_id.clone(),
                committee_keyset_id: config.committee_keyset_id.clone(), committee_keyset_version: "1".into(),
                public_key_package_sha256: "11".repeat(32), signer_roster_digest: "22".repeat(32),
                committee_public_key: String::new(), operation_id: "synthetic-operation".into(),
                operation_root: "33".repeat(32), session_id: "44".repeat(32), committee_unsigned_hex: String::new(),
                committee_unsigned_sha256: "55".repeat(32), committee_digest: "66".repeat(32),
                participant_policy_digest: "77".repeat(32), valid_from: 1, valid_until: 2,
                roster: vec![1,2,3,4], threshold: MIN_SIGNERS };
            let digest = [0x88; 32];
            let mut scalar = [0u8; 32]; scalar[31] = 1;
            let point = hex::decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798").unwrap();
            let key = frost::keys::KeyPackage::new(identifier(1).unwrap(),
                frost::keys::SigningShare::deserialize(&scalar).unwrap(),
                frost::keys::VerifyingShare::deserialize(&point).unwrap(),
                frost::VerifyingKey::deserialize(&point).unwrap(), MIN_SIGNERS);
            let final_state = DkgFinalState { version: VERSION.into(), run_id: config.run_id.clone(),
                committee_keyset_id: config.committee_keyset_id.clone(), committee_keyset_version: "1".into(),
                participant_id: 1, key_package_hex: hex::encode(key.serialize().unwrap()), public_key_package_hex: String::new(),
                public_output: FinalPublicPackage { version: VERSION.into(), run_id: config.run_id.clone(),
                    committee_keyset_id: config.committee_keyset_id.clone(), committee_keyset_version: "1".into(),
                    participant_id: 1, public_key_package_hex: String::new(), public_key_package_sha256: auth.public_key_package_sha256.clone() } };
            replace_json(&state.path("dkg-final.state"), &final_state).unwrap();
            let mut rng = rand::rngs::StdRng::seed_from_u64(0xabcdef);
            let mut entries = Vec::new();
            for participant_id in 1..=3 {
                let (nonces, commitment) = frost::round1::commit(key.signing_share(), &mut rng);
                if participant_id == 1 {
                    replace_json(&journal_path(&state, &auth), &Journal { version: ABORT_VERSION.into(),
                        operation_id: auth.operation_id.clone(), session_id: auth.session_id.clone(),
                        authorization_digest: hex::encode(digest), participant_id: 1, state: SignState::Committed,
                        commitments_digest: None, nonces_hex: Some(hex::encode(nonces.serialize().unwrap())),
                        commitment_hex: hex::encode(commitment.serialize().unwrap()), share_hex: None }).unwrap();
                }
                entries.push(Commitment { version: ABORT_VERSION.into(), operation_id: auth.operation_id.clone(),
                    session_id: auth.session_id.clone(), authorization_digest: hex::encode(digest), participant_id,
                    durable_binding: None, hiding_hex: hex::encode(commitment.hiding().serialize().unwrap()),
                    binding_hex: hex::encode(commitment.binding().serialize().unwrap()) });
            }
            replace_json(&state.path("funding-abort-durable-binding.json"), &DurableBinding {
                version: ABORT_VERSION.into(), participant_id: 1, dkg_run_id: config.run_id.clone(),
                public_key_package_sha256: auth.public_key_package_sha256.clone(), signer_roster_digest: auth.signer_roster_digest.clone(),
                state_directory_identity: state_identity(&state), journal_generation: "99".repeat(32), restart_epoch: 1 }).unwrap();
            Self { root, config, auth, digest, bundle: EnvelopeBundle { version: ABORT_VERSION.into(), entries } }
        }

        fn package(&self, changed: bool) -> (frost::SigningPackage, String) {
            let mut bundle = self.bundle.clone();
            if changed { bundle.entries[2].binding_hex = bundle.entries[1].binding_hex.clone(); }
            let (package, transcript, _) = signing_package(&self.auth, &self.digest, &bundle).unwrap();
            (package, transcript)
        }

        fn run(&self, changed: bool, name: &str) -> AnyResult<()> {
            let (package, transcript) = self.package(changed);
            let state = StateLock::acquire(&self.root)?;
            sign_share_journal(&self.config, &state, &self.auth, &self.digest, &package, &transcript, &self.root.join(name))
        }

        fn journal(&self) -> PathBuf {
            self.root.join(format!("funding-abort-sign-{}.journal",
                sha256_hex(format!("{}:{}", self.auth.operation_id, self.auth.session_id).as_bytes())))
        }

        fn consuming(&self, missing: bool) {
            let mut journal: Journal = read_secret_json(&self.journal()).unwrap();
            journal.state = SignState::Consuming;
            journal.commitments_digest = if missing { None } else { Some(self.package(false).1) };
            replace_json(&self.journal(), &journal).unwrap();
        }
    }

    #[test]
    fn abort_committed_and_consuming_exact_retries_keep_share_and_journal_bytes() {
        for crash_after_binding in [false, true] {
            let fixture = JournalFixture::new();
            if crash_after_binding { fixture.consuming(false); }
            fixture.run(false, "first.json").unwrap();
            let bytes = fs::read(fixture.journal()).unwrap();
            let journal: Journal = read_secret_json(&fixture.journal()).unwrap();
            assert_eq!(journal.state, SignState::Consumed);
            assert!(journal.nonces_hex.is_none());
            assert_eq!(journal.commitments_digest, Some(fixture.package(false).1));
            fixture.run(false, "retry.json").unwrap();
            assert_eq!(fs::read(fixture.journal()).unwrap(), bytes);
            let mut first: Share = read_json(&fixture.root.join("first.json")).unwrap();
            let replay: Share = read_json(&fixture.root.join("retry.json")).unwrap();
            // The existing per-command durable epoch advances; signed share and
            // transcript remain byte-identical, while metadata reports that epoch.
            assert_eq!(replay.durable_binding.restart_epoch, first.durable_binding.restart_epoch + 1);
            first.durable_binding.restart_epoch = replay.durable_binding.restart_epoch;
            assert_eq!(encoded_json(&first).unwrap(), encoded_json(&replay).unwrap());
        }
    }

    #[test]
    fn abort_t2_cannot_rebind_consuming_or_relabel_consumed_across_restart() {
        for consumed in [false, true] {
            let fixture = JournalFixture::new();
            if consumed { fixture.run(false, "first.json").unwrap(); }
            else { fixture.consuming(false); }
            let journal = fs::read(fixture.journal()).unwrap();
            let binding = fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap();
            // Each run reacquires the durable state as a restarted command does.
            for _ in 0..2 {
                let error = fixture.run(true, "rejected.json").unwrap_err().to_string();
                assert!(error.contains("transcript"));
                assert_eq!(fs::read(fixture.journal()).unwrap(), journal);
                assert_eq!(fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap(), binding);
                assert!(!fixture.root.join("rejected.json").exists());
            }
            fixture.run(false, "exact-recovery.json").unwrap();
        }
    }

    #[test]
    fn abort_missing_transcript_in_consuming_or_consumed_fails_closed() {
        for consumed in [false, true] {
            let fixture = JournalFixture::new();
            if consumed {
                fixture.run(false, "first.json").unwrap();
                let mut journal: Journal = read_secret_json(&fixture.journal()).unwrap();
                journal.commitments_digest = None; replace_json(&fixture.journal(), &journal).unwrap();
            } else { fixture.consuming(true); }
            let before = fs::read(fixture.journal()).unwrap();
            assert!(fixture.run(false, "rejected.json").is_err());
            assert_eq!(fs::read(fixture.journal()).unwrap(), before);
            assert!(!fixture.root.join("rejected.json").exists());
        }
    }

    #[test]
    fn abort_failure_loading_nonce_or_key_rejects_before_safety_writes() {
        for corrupt_key in [false, true] {
            let fixture = JournalFixture::new();
            if corrupt_key { replace_secret(&fixture.root.join("dkg-final.state"), b"{}").unwrap(); }
            else {
                let mut journal: Journal = read_secret_json(&fixture.journal()).unwrap();
                journal.nonces_hex = Some("invalid-synthetic-nonce".into());
                replace_json(&fixture.journal(), &journal).unwrap();
            }
            let before = fs::read(fixture.journal()).unwrap();
            let binding = fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap();
            assert!(fixture.run(false, "unpublished.json").is_err());
            assert_eq!(fs::read(fixture.journal()).unwrap(), before);
            assert_eq!(fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap(), binding);
            assert!(fixture.run(true, "rejected.json").is_err());
            assert_eq!(fs::read(fixture.journal()).unwrap(), before);
            assert!(!fixture.root.join("unpublished.json").exists());
        }
    }

    #[test]
    fn abort_output_failure_after_consumed_recovers_only_exact_share() {
        let fixture = JournalFixture::new();
        fixture.run(false, "lost-output.json").unwrap();
        fs::remove_file(fixture.root.join("lost-output.json")).unwrap();
        // Synthetic Consumed-before-output/lost-response snapshot, not a power-loss test.
        assert!(fixture.run(false, "absent-directory/share.json").is_err());
        let journal: Journal = read_secret_json(&fixture.journal()).unwrap();
        assert_eq!(journal.state, SignState::Consumed);
        assert!(journal.nonces_hex.is_none());
        let before = fs::read(fixture.journal()).unwrap();
        assert!(fixture.run(true, "rejected.json").unwrap_err().to_string().contains("transcript"));
        fixture.run(false, "recovered.json").unwrap();
        let recovered: Share = read_json(&fixture.root.join("recovered.json")).unwrap();
        assert_eq!(Some(recovered.share_hex), journal.share_hex.clone());
        assert_eq!(fs::read(fixture.journal()).unwrap(), before);
    }


    #[test]
    fn abort_all_commitment_permutations_replay_one_transcript_and_share() {
        let mut fixture = JournalFixture::new();
        let transcript = fixture.package(false).1;
        fixture.run(false, "first.json").unwrap();
        let first: Share = read_json(&fixture.root.join("first.json")).unwrap();
        let journal = fs::read(fixture.journal()).unwrap();
        let entries = fixture.bundle.entries.clone();
        for order in [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]] {
            fixture.bundle.entries = order.iter().map(|index| entries[*index].clone()).collect();
            assert_eq!(fixture.package(false).1, transcript);
            fixture.run(false, "permutation.json").unwrap();
            let replay: Share = read_json(&fixture.root.join("permutation.json")).unwrap();
            assert_eq!(replay.share_hex, first.share_hex);
            assert_eq!(replay.commitments_digest, first.commitments_digest);
            assert_eq!(fs::read(fixture.journal()).unwrap(), journal);
            fs::remove_file(fixture.root.join("permutation.json")).unwrap();
        }
    }

    #[test]
    fn abort_real_round2_shares_aggregate_and_verify_with_fixed_synthetic_keys() {
        use rand::SeedableRng;
        let fixture = JournalFixture::new();
        fixture.run(false, "first.json").unwrap();
        let first: Share = read_json(&fixture.root.join("first.json")).unwrap();
        let (package, _) = fixture.package(false);
        let mut shares = BTreeMap::new();
        shares.insert(identifier(1).unwrap(), frost::round2::SignatureShare::deserialize(&hex::decode(first.share_hex).unwrap()).unwrap());
        let mut rng = rand::rngs::StdRng::seed_from_u64(0xabcdef);
        let mut scalar = [0u8; 32]; scalar[31] = 1;
        let point = hex::decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798").unwrap();
        let mut verifying_shares = BTreeMap::new();
        for id in 1..=4 {
            let key = frost::keys::KeyPackage::new(identifier(id).unwrap(),
                frost::keys::SigningShare::deserialize(&scalar).unwrap(),
                frost::keys::VerifyingShare::deserialize(&point).unwrap(),
                frost::VerifyingKey::deserialize(&point).unwrap(), MIN_SIGNERS);
            verifying_shares.insert(identifier(id).unwrap(), *key.verifying_share());
            if id <= 3 {
                let (nonces, _) = frost::round1::commit(key.signing_share(), &mut rng);
                if id != 1 { shares.insert(identifier(id).unwrap(), frost::round2::sign(&package, &nonces, &key).unwrap()); }
            }
        }
        let public = frost::keys::PublicKeyPackage::new(verifying_shares,
            frost::VerifyingKey::deserialize(&point).unwrap(), Some(MIN_SIGNERS));
        let signature = frost::aggregate(&package, &shares, &public).unwrap();
        public.verifying_key().verify(&hex::decode(&fixture.auth.committee_digest).unwrap(), &signature).unwrap();
    }

    #[test]
    fn abort_invalid_bundle_bindings_are_rejected_before_journal_changes() {
        let fixture = JournalFixture::new();
        let before = fs::read(fixture.journal()).unwrap();
        for case in 0..4 {
            let mut bundle = fixture.bundle.clone();
            match case {
                0 => bundle.entries[2].participant_id = 2,
                1 => bundle.entries[2].participant_id = 5,
                2 => bundle.entries[2].session_id = "ff".repeat(32),
                _ => bundle.entries[2].authorization_digest = "ff".repeat(32),
            }
            let error = signing_package(&fixture.auth, &fixture.digest, &bundle).unwrap_err().to_string();
            assert!(error.contains(if case < 2 { "roster" } else { "binding" }));
            assert_eq!(fs::read(fixture.journal()).unwrap(), before);
        }
    }

    #[test]
    fn abort_malformed_or_misbound_journals_do_not_sign_or_advance_binding() {
        for case in 0..7 {
            let fixture = JournalFixture::new();
            fixture.run(false, "first.json").unwrap();
            let mut journal: Journal = read_secret_json(&fixture.journal()).unwrap();
            match case {
                0 => journal.participant_id = 2,
                1 => journal.session_id = "ff".repeat(32),
                2 => journal.operation_id = "wrong".into(),
                3 => journal.authorization_digest = "ff".repeat(32),
                4 => journal.version = "wrong".into(),
                5 => journal.share_hex = None,
                _ => {},
            }
            replace_json(&fixture.journal(), &journal).unwrap();
            if case == 6 { replace_secret(&fixture.journal(), b"{").unwrap(); }
            let before = fs::read(fixture.journal()).unwrap();
            let binding = fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap();
            assert!(fixture.run(false, "rejected.json").is_err());
            assert_eq!(fs::read(fixture.journal()).unwrap(), before);
            assert_eq!(fs::read(fixture.root.join("funding-abort-durable-binding.json")).unwrap(), binding);
            assert!(!fixture.root.join("rejected.json").exists());
        }
    }

    #[test]
    fn abort_commit_after_consumption_returns_original_commitment_without_reset() {
        let fixture = JournalFixture::new();
        fixture.run(false, "first.json").unwrap();
        let before = fs::read(fixture.journal()).unwrap();
        let state = StateLock::acquire(&fixture.root).unwrap();
        let replay = commitment_journal(&fixture.config, &state, &fixture.auth, &fixture.digest).unwrap();
        let commitment = frost::round1::SigningCommitments::deserialize(&hex::decode(&replay.commitment_hex).unwrap()).unwrap();
        assert_eq!(hex::encode(commitment.hiding().serialize().unwrap()), fixture.bundle.entries[0].hiding_hex);
        assert_eq!(hex::encode(commitment.binding().serialize().unwrap()), fixture.bundle.entries[0].binding_hex);
        assert_eq!(replay.state, SignState::Consumed);
        assert!(replay.nonces_hex.is_none());
        assert_eq!(fs::read(fixture.journal()).unwrap(), before);
    }

}
