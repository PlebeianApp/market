#![forbid(unsafe_code)]

// Task-local fake-money extension of the pinned generated 3-of-4 signer.
// See SOURCE-PROVENANCE.md.  The original disposition commands remain
// unchanged; admission receipts use separate commands and domains.
mod admission;
mod funding_abort;

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use frost_secp256k1_tr as frost;
use fs2::FileExt;
use k256::schnorr::{
	signature::{hazmat::PrehashVerifier, Signer, Verifier},
    Signature as IdentitySignature, SigningKey as IdentitySigningKey,
    VerifyingKey as IdentityVerifyingKey,
};
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const VERSION: &str = "COCO_DEMO_FROST_PARTICIPANT_3OF4_V1";
const AUTH_CONTEXT: &[u8] = b"COCO_DEMO_FROST_SIGALL_AUTH_V1";
const OPERATION_ROOT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_THRESHOLD3_OPERATION_ROOT_V1";
const TRANSCRIPT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_SIGNING_TRANSCRIPT_V1";
const DKG_ROUND1_AUTH_CONTEXT: &[u8] = b"COCO_DEMO_FROST_DKG_ROUND1_AUTH_V1";
const DKG_ROUND1_AGREEMENT_CONTEXT: &[u8] = b"COCO_DEMO_FROST_DKG_ROUND1_AGREEMENT_V1";
const DKG_ROUND2_AEAD_CONTEXT: &[u8] = b"COCO_DEMO_FROST_DKG_ROUND2_AEAD_V1";
const MAX_SIGNERS: u16 = 4;
const MIN_SIGNERS: u16 = 3;
const MAX_DKG_VALIDATOR_INPUT_BYTES: u64 = 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

type AnyResult<T> = Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Config {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    max_signers: u16,
    min_signers: u16,
    roster: Vec<u16>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct IdentityVerifyingKeyEntry {
    participant_id: u16,
    verifying_key_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct PairwiseKeyEntry {
    peer_id: u16,
    key_hex: String,
}

/// Pre-provisioned transport credentials owned by one participant. This file is
/// read only through `read_secret_json`, so it must be a regular 0600-style
/// file. The program never generates these credentials.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct TransportSecrets {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    identity_signing_key_hex: String,
    identity_verifying_keys: Vec<IdentityVerifyingKeyEntry>,
    round2_pairwise_keys: Vec<PairwiseKeyEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct PublicEnvelope {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    sender: u16,
    payload_hex: String,
    auth_signature_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Round1Agreement {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    round1_digest: String,
    auth_signature_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct PrivateEnvelope {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    round1_digest: String,
    sender: u16,
    recipient: u16,
    nonce_hex: String,
    ciphertext_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct EnvelopeBundle<T> {
    version: String,
    entries: Vec<T>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct FinalPublicPackage {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    public_key_package_hex: String,
    public_key_package_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct DkgRound1State {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    secret_hex: String,
    public_envelope: PublicEnvelope,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct DkgRound2State {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    round1_digest: String,
    secret_hex: String,
    outbound: Vec<PrivateEnvelope>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct DkgFinalState {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    participant_id: u16,
    key_package_hex: String,
    public_key_package_hex: String,
    public_output: FinalPublicPackage,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Authorization {
    version: String,
    dkg_run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    public_key_package_sha256: String,
    operation_id: String,
    operation_root: String,
    session_id: String,
    policy_package_digest: String,
    cashu_sigall_digest: String,
    full_package_digest: String,
    certified_closure_digest: String,
    signed_bid_evidence_digest: String,
    committee_locked_proofs_digest: String,
    bidder_payout_binding_digest: String,
    roster: Vec<u16>,
    threshold: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct OperationClaim {
    version: String,
    operation_id: String,
    operation_root: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum SignState {
    Committed,
    Consuming,
    Consumed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct SignJournal {
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
struct CommitmentEnvelope {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    participant_id: u16,
    hiding_hex: String,
    binding_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ShareEnvelope {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    commitments_digest: String,
    participant_id: u16,
    share_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateCommitment {
    participant_id: u16,
    hiding_hex: String,
    binding_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateShare {
    participant_id: u16,
    share_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateRequest {
    version: String,
    operation_id: String,
    session_id: String,
    commitments: Vec<AggregateCommitment>,
    shares: Vec<AggregateShare>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct AggregateSignature {
    version: String,
    operation_id: String,
    session_id: String,
    authorization_digest: String,
    commitments_digest: String,
    cashu_sigall_digest: String,
    signature_hex: String,
}

struct StateLock {
    root: PathBuf,
    _file: File,
}

impl StateLock {
    fn acquire(root: &Path) -> AnyResult<Self> {
        if !root.is_absolute() {
            return Err("state directory must be absolute".into());
        }
        match fs::symlink_metadata(root) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err("state path must be a real directory".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(root)?;
            }
            Err(error) => return Err(error.into()),
        }
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
        if fs::canonicalize(root)? != root {
            return Err("state directory must be an absolute canonical path without symlinked ancestors".into());
        }
        let lock_path = root.join("participant.lock");
        refuse_symlink(&lock_path)?;
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&lock_path)?;
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o600))?;
        file.lock_exclusive()?;
        Ok(Self {
            root: root.to_path_buf(),
            _file: file,
        })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for StateLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self._file);
    }
}

fn refuse_symlink(path: &Path) -> AnyResult<()> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err(format!("symlink refused: {}", path.display()).into());
        }
    }
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> AnyResult<T> {
    refuse_symlink(path)?;
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Load the committee public package from either the historical DKG JSON
/// envelope or the separated-runtime raw package.  The runtime binding pins
/// the SHA-256 of the serialized FROST package, so both representations end
/// at the same exact byte check before deserialization.
fn read_public_key_package_bytes(
    path: &Path,
    expected_run_id: &str,
    expected_keyset_id: &str,
    expected_keyset_version: &str,
    expected_sha256: &str,
) -> AnyResult<Vec<u8>> {
    refuse_symlink(path)?;
    let encoded = fs::read(path)?;
    let package = match serde_json::from_slice::<FinalPublicPackage>(&encoded) {
        Ok(public) => {
            if public.version != VERSION
                || public.run_id != expected_run_id
                || public.committee_keyset_id != expected_keyset_id
                || public.committee_keyset_version != expected_keyset_version
                || public.public_key_package_sha256 != expected_sha256
            {
                return Err("public key package envelope belongs to another DKG run or committee keyset".into());
            }
            let bytes = hex::decode(&public.public_key_package_hex)?;
            if hex::encode(&bytes) != public.public_key_package_hex {
                return Err("public key package envelope is not canonical hex".into());
            }
            bytes
        }
        Err(_) => encoded,
    };
    if sha256_hex(&package) != expected_sha256 {
        return Err("public key package hash mismatch".into());
    }
    Ok(package)
}

fn read_secret(path: &Path) -> AnyResult<Vec<u8>> {
    if !path.is_absolute() {
        return Err(format!("secret path must be absolute: {}", path.display()).into());
    }
    refuse_symlink(path)?;
    let meta = fs::metadata(path)?;
    if !meta.is_file() || meta.permissions().mode() & 0o077 != 0 {
        return Err(format!("secret file must be a regular 0600-style file: {}", path.display()).into());
    }
    if fs::canonicalize(path)? != path {
        return Err(format!("secret path must be canonical without symlinked ancestors: {}", path.display()).into());
    }
    let mut bytes = Vec::new();
    File::open(path)?.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn read_secret_json<T: DeserializeOwned>(path: &Path) -> AnyResult<T> {
    let bytes = Zeroizing::new(read_secret(path)?);
    Ok(serde_json::from_slice(&bytes)?)
}

fn encoded_json(value: &impl Serialize) -> AnyResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn publish_json_exact(path: &Path, value: &impl Serialize) -> AnyResult<()> {
    refuse_symlink(path)?;
    let expected = encoded_json(value)?;
    if path.exists() {
        if fs::read(path)? == expected {
            return Ok(());
        }
        return Err(format!("existing output differs from durable replay: {}", path.display()).into());
    }
    replace_secret(path, &expected)
}

// Read-only checks. Later I/O can still fail; such failures remain uncertain and
// are never grounds for rolling back/adopting signer state in the service.
fn preflight_output_path(path: &Path) -> AnyResult<()> {
    refuse_symlink(path)?;
    let parent = path.parent().ok_or("output path has no parent")?;
    if !parent.is_dir() { return Err("output parent is not an existing directory".into()); }
    if path.exists() && !path.is_file() { return Err("output is not a regular file".into()); }
    Ok(())
}

fn preflight_public_output(path: &Path, value: &impl Serialize) -> AnyResult<()> {
    preflight_output_path(path)?;
    if path.exists() && fs::read(path)? != encoded_json(value)? {
        return Err("existing output differs from durable replay".into());
    }
    Ok(())
}

fn preflight_new_share_output(path: &Path) -> AnyResult<()> {
    preflight_output_path(path)?;
    // A first share cannot have a prior legitimate output because Consumed is
    // durable before publication. Do not compute a share to compare untrusted output.
    if path.exists() { return Err("new share output already exists".into()); }
    Ok(())
}

fn validate_signing_material(participant_id: u16, package: &frost::SigningPackage,
    nonces: &frost::round1::SigningNonces, key: &frost::keys::KeyPackage) -> AnyResult<()> {
    if key.identifier() != &identifier(participant_id)? || key.min_signers() != &MIN_SIGNERS {
        return Err("signing key is not the exact 3-of-4 participant".into());
    }
    if package.signing_commitments().len() != usize::from(MIN_SIGNERS)
        || package.signing_commitment(key.identifier()).as_ref() != Some(nonces.commitments()) {
        return Err("signing commitment differs from local nonce".into());
    }
    Ok(())
}

fn replace_secret(path: &Path, bytes: &[u8]) -> AnyResult<()> {
    refuse_symlink(path)?;
    let parent = path.parent().ok_or("secret path has no parent")?;
    let name = path.file_name().and_then(|v| v.to_str()).ok_or("invalid secret filename")?;
    let temporary = parent.join(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
    ));
    refuse_symlink(&temporary)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    sync_parent(path)?;
    Ok(())
}

fn replace_json(path: &Path, value: &impl Serialize) -> AnyResult<()> {
    let bytes = Zeroizing::new(serde_json::to_vec(value)?);
    replace_secret(path, &bytes)
}

fn sync_parent(path: &Path) -> AnyResult<()> {
    File::open(path.parent().ok_or("path has no parent")?)?.sync_all()?;
    Ok(())
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(sha256(bytes))
}

fn exact_hex<const N: usize>(value: &str, label: &str) -> AnyResult<[u8; N]> {
    let bytes = hex::decode(value)?;
    if bytes.len() != N || hex::encode(&bytes) != value {
        return Err(format!("{label} must be exact canonical lowercase {}-byte hex", N).into());
    }
    Ok(bytes.try_into().map_err(|_| "wrong decoded length")?)
}

fn frame_fields(context: &[u8], fields: &[&[u8]]) -> Vec<u8> {
    let mut framed = Vec::new();
    framed.extend_from_slice(context);
    for field in fields {
        framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
        framed.extend_from_slice(field);
    }
    framed
}

fn identity_signing_key(transport: &TransportSecrets) -> AnyResult<IdentitySigningKey> {
    let bytes = Zeroizing::new(exact_hex::<32>(
        &transport.identity_signing_key_hex,
        "identity_signing_key_hex",
    )?);
    Ok(IdentitySigningKey::from_bytes(bytes.as_ref())?)
}

fn identity_verifying_key(
    transport: &TransportSecrets,
    participant_id: u16,
) -> AnyResult<IdentityVerifyingKey> {
    let entry = transport
        .identity_verifying_keys
        .iter()
        .find(|entry| entry.participant_id == participant_id)
        .ok_or("missing identity verifying key")?;
    let bytes = exact_hex::<32>(&entry.verifying_key_hex, "identity_verifying_key_hex")?;
    Ok(IdentityVerifyingKey::from_bytes(&bytes)?)
}

fn pairwise_key(transport: &TransportSecrets, peer_id: u16) -> AnyResult<Zeroizing<[u8; 32]>> {
    let entry = transport
        .round2_pairwise_keys
        .iter()
        .find(|entry| entry.peer_id == peer_id)
        .ok_or("missing round-two pairwise key")?;
    Ok(Zeroizing::new(exact_hex::<32>(
        &entry.key_hex,
        "round2_pairwise_key_hex",
    )?))
}

fn validate_transport(config: &Config, transport: &TransportSecrets) -> AnyResult<()> {
    if transport.version != VERSION
        || transport.run_id != config.run_id
        || transport.committee_keyset_id != config.committee_keyset_id
        || transport.committee_keyset_version != config.committee_keyset_version
        || transport.participant_id != config.participant_id
    {
        return Err("transport credentials belong to another participant, run, or keyset".into());
    }
    let verifying_ids: BTreeSet<_> = transport
        .identity_verifying_keys
        .iter()
        .map(|entry| entry.participant_id)
        .collect();
    let roster: BTreeSet<_> = config.roster.iter().copied().collect();
    if verifying_ids != roster || verifying_ids.len() != transport.identity_verifying_keys.len() {
        return Err("transport identity roster must contain each participant exactly once".into());
    }
    let pairwise_ids: BTreeSet<_> = transport
        .round2_pairwise_keys
        .iter()
        .map(|entry| entry.peer_id)
        .collect();
    let peers: BTreeSet<_> = other_ids(config).collect();
    if pairwise_ids != peers || pairwise_ids.len() != transport.round2_pairwise_keys.len() {
        return Err("transport pairwise keys must contain each peer exactly once".into());
    }
    let mut verifying_keys = BTreeSet::new();
    for entry in &transport.identity_verifying_keys {
        let key = exact_hex::<32>(&entry.verifying_key_hex, "identity_verifying_key_hex")?;
        identity_verifying_key(transport, entry.participant_id)?;
        if !verifying_keys.insert(key) {
            return Err("transport identity verifying keys must be distinct".into());
        }
    }
    // Retain only references to the already-zeroizing source strings for the
    // duplicate check.  Decoded secret bytes live in a Zeroizing guard and
    // are never copied into an ordinary collection.
    let mut pairwise_key_hexes = BTreeSet::new();
    for entry in &transport.round2_pairwise_keys {
        let key = Zeroizing::new(exact_hex::<32>(
            &entry.key_hex,
            "round2_pairwise_key_hex",
        )?);
        if key.as_ref() == &[0u8; 32] {
            return Err("transport round-two pairwise keys must not be zero".into());
        }
        if !pairwise_key_hexes.insert(entry.key_hex.as_str()) {
            return Err("transport round-two pairwise keys must be distinct".into());
        }
    }
    let signing = identity_signing_key(transport)?;
    let enrolled = identity_verifying_key(transport, config.participant_id)?;
    if signing.verifying_key().to_bytes() != enrolled.to_bytes() {
        return Err("identity signing key does not match this participant's enrolled verifying key".into());
    }
    Ok(())
}

#[derive(Debug)]
struct DkgInputValidationFailure(&'static str);

impl Display for DkgInputValidationFailure {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "DKG_INPUT_VALIDATION_FAILED:{}", self.0)
    }
}

impl Error for DkgInputValidationFailure {}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ValidatorFileIdentity {
    device: u64,
    inode: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

fn validator_file_identity(metadata: &fs::Metadata) -> ValidatorFileIdentity {
    ValidatorFileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        mode: metadata.mode(),
        uid: metadata.uid(),
        gid: metadata.gid(),
        size: metadata.size(),
        modified_seconds: metadata.mtime(),
        modified_nanoseconds: metadata.mtime_nsec(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    }
}

fn read_dkg_validator_json<T: DeserializeOwned>(path: &Path, private: bool) -> AnyResult<T> {
    if !path.is_absolute() || fs::canonicalize(path)? != path {
        return Err("validator input path must be absolute, canonical, and free of symlinked ancestors".into());
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NOATIME);
    let mut file = options.open(path)?;
    let before_metadata = file.metadata()?;
    let before = validator_file_identity(&before_metadata);
    if !before_metadata.is_file()
        || before_metadata.nlink() != 1
        || before.size == 0
        || before.size > MAX_DKG_VALIDATOR_INPUT_BYTES
    {
        return Err("validator input must be a bounded regular file".into());
    }
    if private && before.mode & 0o077 != 0 {
        return Err("private validator input must deny group and world access".into());
    }
    let path_metadata = fs::metadata(path)?;
    if path_metadata.dev() != before.device || path_metadata.ino() != before.inode {
        return Err("validator input path identity changed after open".into());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(before.size as usize));
    file.read_to_end(bytes.as_mut())?;
    let after_metadata = file.metadata()?;
    let after = validator_file_identity(&after_metadata);
    if before != after || bytes.len() as u64 != before.size {
        return Err("validator input changed while it was being read".into());
    }
    let final_path_metadata = fs::symlink_metadata(path)?;
    if !final_path_metadata.is_file()
        || final_path_metadata.file_type().is_symlink()
        || final_path_metadata.nlink() != 1
        || final_path_metadata.dev() != after.device
        || final_path_metadata.ino() != after.inode
        || fs::canonicalize(path)? != path
    {
        return Err("validator input pathname changed while it was being read".into());
    }
    Ok(serde_json::from_slice(bytes.as_ref())?)
}

/// Parses and semantically validates the exact inputs consumed before
/// `dkg_round1` acquires its state lock. This command intentionally has no
/// state path, entropy source, output path, listener, or network operation.
fn dkg_validate_inputs(config_path: &Path, transport_path: &Path) -> AnyResult<()> {
    let config: Config = read_dkg_validator_json(config_path, false)
        .map_err(|_| DkgInputValidationFailure("CONFIG_READ"))?;
    validate_config(&config)
        .map_err(|_| DkgInputValidationFailure("CONFIG_INVALID"))?;
    let transport: TransportSecrets = read_dkg_validator_json(transport_path, true)
        .map_err(|_| DkgInputValidationFailure("TRANSPORT_READ"))?;
    validate_transport(&config, &transport)
        .map_err(|_| DkgInputValidationFailure("TRANSPORT_INVALID"))?;
    Ok(())
}

pub fn run_dkg_input_validator_cli() -> i32 {
    let paths: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    let [config, transport] = paths.as_slice() else {
        eprintln!("DKG_INPUT_VALIDATION_FAILED:ARGUMENTS");
        return 1;
    };
    match dkg_validate_inputs(config, transport) {
        Ok(()) => {
            println!("DKG_INPUT_VALIDATION_OK");
            0
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn public_envelope_auth_bytes(envelope: &PublicEnvelope) -> Vec<u8> {
    frame_fields(
        DKG_ROUND1_AUTH_CONTEXT,
        &[
            envelope.version.as_bytes(),
            envelope.run_id.as_bytes(),
            envelope.committee_keyset_id.as_bytes(),
            envelope.committee_keyset_version.as_bytes(),
            &envelope.sender.to_be_bytes(),
            envelope.payload_hex.as_bytes(),
        ],
    )
}

fn sign_public_envelope(
    transport: &TransportSecrets,
    envelope: &mut PublicEnvelope,
) -> AnyResult<()> {
    let signature: IdentitySignature = identity_signing_key(transport)?
        .sign(&public_envelope_auth_bytes(envelope));
    envelope.auth_signature_hex = hex::encode(signature.to_bytes());
    Ok(())
}

fn verify_public_envelope(
    transport: &TransportSecrets,
    envelope: &PublicEnvelope,
) -> AnyResult<()> {
    let bytes = exact_hex::<64>(&envelope.auth_signature_hex, "round1_auth_signature_hex")?;
    let signature = IdentitySignature::try_from(bytes.as_slice())?;
    identity_verifying_key(transport, envelope.sender)?
        .verify(&public_envelope_auth_bytes(envelope), &signature)?;
    Ok(())
}

fn agreement_auth_bytes(agreement: &Round1Agreement) -> Vec<u8> {
    frame_fields(
        DKG_ROUND1_AGREEMENT_CONTEXT,
        &[
            agreement.version.as_bytes(),
            agreement.run_id.as_bytes(),
            agreement.committee_keyset_id.as_bytes(),
            agreement.committee_keyset_version.as_bytes(),
            &agreement.participant_id.to_be_bytes(),
            agreement.round1_digest.as_bytes(),
        ],
    )
}

fn sign_round1_agreement(
    config: &Config,
    transport: &TransportSecrets,
    round1_digest: String,
) -> AnyResult<Round1Agreement> {
    let mut agreement = Round1Agreement {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        participant_id: config.participant_id,
        round1_digest,
        auth_signature_hex: String::new(),
    };
    let signature: IdentitySignature = identity_signing_key(transport)?
        .sign(&agreement_auth_bytes(&agreement));
    agreement.auth_signature_hex = hex::encode(signature.to_bytes());
    Ok(agreement)
}

fn private_envelope_aad(envelope: &PrivateEnvelope) -> Vec<u8> {
    frame_fields(
        DKG_ROUND2_AEAD_CONTEXT,
        &[
            envelope.version.as_bytes(),
            envelope.run_id.as_bytes(),
            envelope.committee_keyset_id.as_bytes(),
            envelope.committee_keyset_version.as_bytes(),
            envelope.round1_digest.as_bytes(),
            &envelope.sender.to_be_bytes(),
            &envelope.recipient.to_be_bytes(),
            envelope.nonce_hex.as_bytes(),
        ],
    )
}

fn encrypt_round2_payload(
    config: &Config,
    transport: &TransportSecrets,
    recipient: u16,
    round1_digest: &str,
    plaintext: &[u8],
    nonce: [u8; 24],
) -> AnyResult<PrivateEnvelope> {
    let mut envelope = PrivateEnvelope {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        round1_digest: round1_digest.to_string(),
        sender: config.participant_id,
        recipient,
        nonce_hex: hex::encode(nonce),
        ciphertext_hex: String::new(),
    };
    let key_bytes = pairwise_key(transport, recipient)?;
    let nonce = XNonce::from(nonce);
    let cipher = XChaCha20Poly1305::new_from_slice(key_bytes.as_ref())
        .map_err(|_| "round-two key length is invalid")?;
    let ciphertext = cipher.encrypt(
        &nonce,
        Payload {
            msg: plaintext,
            aad: &private_envelope_aad(&envelope),
        },
    )
    .map_err(|_| "round-two encryption failed")?;
    envelope.ciphertext_hex = hex::encode(ciphertext);
    Ok(envelope)
}

fn decrypt_round2_payload(
    transport: &TransportSecrets,
    envelope: &PrivateEnvelope,
) -> AnyResult<Vec<u8>> {
    let nonce = exact_hex::<24>(&envelope.nonce_hex, "round2_nonce_hex")?;
    let ciphertext = hex::decode(&envelope.ciphertext_hex)?;
    if ciphertext.len() < 16 || hex::encode(&ciphertext) != envelope.ciphertext_hex {
        return Err("round-two ciphertext is invalid or noncanonical".into());
    }
    let key_bytes = pairwise_key(transport, envelope.sender)?;
    let nonce = XNonce::from(nonce);
    let cipher = XChaCha20Poly1305::new_from_slice(key_bytes.as_ref())
        .map_err(|_| "round-two key length is invalid")?;
    Ok(cipher.decrypt(
        &nonce,
        Payload {
            msg: &ciphertext,
            aad: &private_envelope_aad(envelope),
        },
    )
    .map_err(|_| "round-two authenticated decryption failed")?)
}

fn validate_roster(roster: &[u16]) -> AnyResult<()> {
    if roster != [1, 2, 3, 4] {
        return Err("demo roster must be exactly [1,2,3,4]".into());
    }
    Ok(())
}

fn validate_config(config: &Config) -> AnyResult<()> {
    if config.version != VERSION
        || config.run_id.is_empty()
        || config.committee_keyset_id.is_empty()
        || config.committee_keyset_version.is_empty()
    {
        return Err("invalid config version, run_id, or committee keyset binding".into());
    }
    validate_roster(&config.roster)?;
    if config.max_signers != MAX_SIGNERS
        || config.min_signers != MIN_SIGNERS
        || !config.roster.contains(&config.participant_id)
    {
        return Err("only the exact three-of-four demo committee is admitted".into());
    }
    Ok(())
}

fn validate_authorization(auth: &Authorization) -> AnyResult<[u8; 32]> {
    if auth.version != VERSION
        || auth.dkg_run_id.is_empty()
        || auth.committee_keyset_id.is_empty()
        || auth.committee_keyset_version.is_empty()
        || auth.operation_id.is_empty()
    {
        return Err("invalid authorization version, DKG/keyset binding, or operation_id".into());
    }
    validate_roster(&auth.roster)?;
    if auth.threshold != MIN_SIGNERS {
        return Err("authorization threshold must be three".into());
    }
    exact_hex::<32>(&auth.public_key_package_sha256, "public_key_package_sha256")?;
    exact_hex::<32>(&auth.operation_root, "operation_root")?;
    exact_hex::<32>(&auth.session_id, "session_id")?;
    exact_hex::<32>(&auth.policy_package_digest, "policy_package_digest")?;
    exact_hex::<32>(&auth.cashu_sigall_digest, "cashu_sigall_digest")?;
    exact_hex::<32>(&auth.full_package_digest, "full_package_digest")?;
    exact_hex::<32>(&auth.certified_closure_digest, "certified_closure_digest")?;
    exact_hex::<32>(&auth.signed_bid_evidence_digest, "signed_bid_evidence_digest")?;
    exact_hex::<32>(
        &auth.committee_locked_proofs_digest,
        "committee_locked_proofs_digest",
    )?;
    exact_hex::<32>(&auth.bidder_payout_binding_digest, "bidder_payout_binding_digest")?;
    let mut operation_framed = Vec::new();
    operation_framed.extend_from_slice(OPERATION_ROOT_CONTEXT);
    for field in [
        auth.dkg_run_id.as_bytes(),
        auth.committee_keyset_id.as_bytes(),
        auth.committee_keyset_version.as_bytes(),
        auth.public_key_package_sha256.as_bytes(),
        auth.operation_id.as_bytes(),
        auth.policy_package_digest.as_bytes(),
        auth.cashu_sigall_digest.as_bytes(),
        auth.full_package_digest.as_bytes(),
        auth.certified_closure_digest.as_bytes(),
        auth.signed_bid_evidence_digest.as_bytes(),
        auth.committee_locked_proofs_digest.as_bytes(),
        auth.bidder_payout_binding_digest.as_bytes(),
    ] {
        operation_framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
        operation_framed.extend_from_slice(field);
    }
    for id in &auth.roster {
        operation_framed.extend_from_slice(&id.to_be_bytes());
    }
    operation_framed.extend_from_slice(&auth.threshold.to_be_bytes());
    if sha256_hex(&operation_framed) != auth.operation_root {
        return Err("authorization operation_root is not derived from the stable payment facts".into());
    }
    let mut framed = Vec::new();
    framed.extend_from_slice(AUTH_CONTEXT);
    for field in [
        auth.dkg_run_id.as_bytes(),
        auth.committee_keyset_id.as_bytes(),
        auth.committee_keyset_version.as_bytes(),
        auth.public_key_package_sha256.as_bytes(),
        auth.operation_id.as_bytes(),
        auth.operation_root.as_bytes(),
        auth.session_id.as_bytes(),
        auth.policy_package_digest.as_bytes(),
        auth.cashu_sigall_digest.as_bytes(),
        auth.full_package_digest.as_bytes(),
        auth.certified_closure_digest.as_bytes(),
        auth.signed_bid_evidence_digest.as_bytes(),
        auth.committee_locked_proofs_digest.as_bytes(),
        auth.bidder_payout_binding_digest.as_bytes(),
    ] {
        framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
        framed.extend_from_slice(field);
    }
    for id in &auth.roster {
        framed.extend_from_slice(&id.to_be_bytes());
    }
    framed.extend_from_slice(&auth.threshold.to_be_bytes());
    Ok(sha256(&framed))
}

fn validate_authorization_for_state(
    config: &Config,
    state: &StateLock,
    auth: &Authorization,
) -> AnyResult<()> {
    if auth.dkg_run_id != config.run_id
        || auth.committee_keyset_id != config.committee_keyset_id
        || auth.committee_keyset_version != config.committee_keyset_version
    {
        return Err("authorization belongs to another DKG run or committee keyset".into());
    }
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    if final_state.run_id != config.run_id
        || final_state.committee_keyset_id != config.committee_keyset_id
        || final_state.committee_keyset_version != config.committee_keyset_version
        || final_state.participant_id != config.participant_id
    {
        return Err("participant final DKG state does not match config".into());
    }
    let public_key_package = hex::decode(&final_state.public_key_package_hex)?;
    if sha256_hex(&public_key_package) != auth.public_key_package_sha256 {
        return Err("authorization public key package does not match participant state".into());
    }
    Ok(())
}

fn validate_state_binding(
    config: &Config,
    version: &str,
    run_id: &str,
    keyset_id: &str,
    keyset_version: &str,
    participant_id: u16,
) -> AnyResult<()> {
    if version != VERSION
        || run_id != config.run_id
        || keyset_id != config.committee_keyset_id
        || keyset_version != config.committee_keyset_version
        || participant_id != config.participant_id
    {
        return Err("durable DKG state belongs to another config".into());
    }
    Ok(())
}

fn publish_private_envelopes(out_dir: &Path, envelopes: &[PrivateEnvelope]) -> AnyResult<()> {
    if !out_dir.is_absolute() {
        return Err("private output directory must be absolute".into());
    }
    match fs::symlink_metadata(out_dir) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err("private output path must be a real directory".into())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(out_dir)?,
        Err(error) => return Err(error.into()),
    }
    fs::set_permissions(out_dir, fs::Permissions::from_mode(0o700))?;
    if fs::canonicalize(out_dir)? != out_dir {
        return Err("private output directory must be canonical without symlinked ancestors".into());
    }
    let expected: BTreeSet<_> = envelopes
        .iter()
        .map(|envelope| format!("to-{}.private.json", envelope.recipient))
        .collect();
    for entry in fs::read_dir(out_dir)? {
        let entry = entry?;
        let name = entry.file_name().into_string().map_err(|_| "invalid private output filename")?;
        if !expected.contains(&name) {
            return Err(format!("unexpected file in private output directory: {name}").into());
        }
    }
    for envelope in envelopes {
        publish_json_exact(
            &out_dir.join(format!("to-{}.private.json", envelope.recipient)),
            envelope,
        )?;
    }
    sync_parent(&out_dir.join("directory-entry"))?;
    Ok(())
}

fn identifier(id: u16) -> AnyResult<frost::Identifier> {
    Ok(frost::Identifier::try_from(id)?)
}

fn claim_operation(state: &StateLock, auth: &Authorization, _digest: &[u8; 32]) -> AnyResult<()> {
    let operations = state.path("operations");
    if !operations.exists() {
        fs::create_dir(&operations)?;
        fs::set_permissions(&operations, fs::Permissions::from_mode(0o700))?;
    }
    refuse_symlink(&operations)?;
    let path = operations.join(format!("{}.json", sha256_hex(auth.operation_id.as_bytes())));
    let expected = OperationClaim {
        version: VERSION.to_string(),
        operation_id: auth.operation_id.clone(),
        operation_root: auth.operation_root.clone(),
    };
    if path.exists() {
        let actual: OperationClaim = read_json(&path)?;
        if actual != expected {
            return Err("DUPLICATE_OPERATION_OWNER: operation_id already owns another authorization root".into());
        }
        return Ok(());
    }
    replace_json(&path, &expected)
}

fn other_ids(config: &Config) -> impl Iterator<Item = u16> + '_ {
    config.roster.iter().copied().filter(|id| *id != config.participant_id)
}

fn validate_round1_bundle(
    config: &Config,
    transport: &TransportSecrets,
    bundle: &EnvelopeBundle<PublicEnvelope>,
) -> AnyResult<(BTreeMap<frost::Identifier, frost::keys::dkg::round1::Package>, String)> {
    if bundle.version != VERSION {
        return Err("wrong round-one bundle version".into());
    }
    // Every participant must authenticate and hash the same all-four broadcast
    // transcript. The FROST library itself receives only the other three
    // packages below, as required by part2/part3.
    let expected: BTreeSet<_> = config.roster.iter().copied().collect();
    let actual: BTreeSet<_> = bundle.entries.iter().map(|entry| entry.sender).collect();
    if actual != expected || bundle.entries.len() != expected.len() {
        return Err("round-one bundle must contain each other participant exactly once".into());
    }
    let mut packages = BTreeMap::new();
    let mut canonical = bundle.entries.clone();
    canonical.sort_by_key(|entry| entry.sender);
    for entry in &canonical {
        if entry.version != VERSION
            || entry.run_id != config.run_id
            || entry.committee_keyset_id != config.committee_keyset_id
            || entry.committee_keyset_version != config.committee_keyset_version
        {
            return Err("round-one envelope run/keyset/version mismatch".into());
        }
        verify_public_envelope(transport, entry)
            .map_err(|_| "round-one broadcast identity authentication failed")?;
        let payload = hex::decode(&entry.payload_hex)?;
        if hex::encode(&payload) != entry.payload_hex {
            return Err("round-one payload hex is not canonical".into());
        }
        let package = frost::keys::dkg::round1::Package::deserialize(&payload)?;
        if entry.sender != config.participant_id {
            packages.insert(identifier(entry.sender)?, package);
        }
    }
    Ok((packages, sha256_hex(&serde_json::to_vec(&canonical)?)))
}

fn validate_round1_agreements(
    config: &Config,
    transport: &TransportSecrets,
    bundle: &EnvelopeBundle<Round1Agreement>,
    expected_digest: &str,
) -> AnyResult<()> {
    if bundle.version != VERSION {
        return Err("wrong round-one agreement bundle version".into());
    }
    let expected: BTreeSet<_> = config.roster.iter().copied().collect();
    let actual: BTreeSet<_> = bundle
        .entries
        .iter()
        .map(|entry| entry.participant_id)
        .collect();
    if actual != expected || bundle.entries.len() != expected.len() {
        return Err("round-one agreement requires all four participants".into());
    }
    for agreement in &bundle.entries {
        if agreement.version != VERSION
            || agreement.run_id != config.run_id
            || agreement.committee_keyset_id != config.committee_keyset_id
            || agreement.committee_keyset_version != config.committee_keyset_version
            || agreement.round1_digest != expected_digest
        {
            return Err("round-one agreement transcript mismatch".into());
        }
        let bytes = exact_hex::<64>(
            &agreement.auth_signature_hex,
            "round1_agreement_auth_signature_hex",
        )?;
        let signature = IdentitySignature::try_from(bytes.as_slice())?;
        identity_verifying_key(transport, agreement.participant_id)?
            .verify(&agreement_auth_bytes(agreement), &signature)
            .map_err(|_| "round-one agreement identity authentication failed")?;
    }
    Ok(())
}

fn validate_local_round1_envelope(
    config: &Config,
    state: &DkgRound1State,
    bundle: &EnvelopeBundle<PublicEnvelope>,
) -> AnyResult<()> {
    validate_state_binding(
        config,
        &state.version,
        &state.run_id,
        &state.committee_keyset_id,
        &state.committee_keyset_version,
        state.participant_id,
    )?;
    let own = bundle
        .entries
        .iter()
        .find(|entry| entry.sender == config.participant_id)
        .ok_or("round-one bundle is missing this participant's envelope")?;
    if own != &state.public_envelope {
        return Err("round-one bundle does not contain this participant's durable envelope".into());
    }
    Ok(())
}

fn dkg_round1(
    config_path: &Path,
    root: &Path,
    transport_path: &Path,
    public_out: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let transport: TransportSecrets = read_secret_json(transport_path)?;
    validate_transport(&config, &transport)?;
    let state = StateLock::acquire(root)?;
    let state_path = state.path("dkg-round1.state");
    if state_path.exists() {
        let saved: DkgRound1State = read_secret_json(&state_path)?;
        validate_state_binding(
            &config,
            &saved.version,
            &saved.run_id,
            &saved.committee_keyset_id,
            &saved.committee_keyset_version,
            saved.participant_id,
        )?;
        return publish_json_exact(public_out, &saved.public_envelope);
    }
    if state.path("dkg-round2.state").exists() || state.path("dkg-final.state").exists() {
        return Err("DKG state already exists; refusing a second key generation".into());
    }
    let (secret, package) = frost::keys::dkg::part1(
        identifier(config.participant_id)?,
        config.max_signers,
        config.min_signers,
        &mut OsRng,
    )?;
    let mut envelope = PublicEnvelope {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        sender: config.participant_id,
        payload_hex: hex::encode(package.serialize()?),
        auth_signature_hex: String::new(),
    };
    sign_public_envelope(&transport, &mut envelope)?;
    let saved = DkgRound1State {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        participant_id: config.participant_id,
        secret_hex: hex::encode(secret.serialize()?),
        public_envelope: envelope,
    };
    replace_json(&state_path, &saved)?;
    publish_json_exact(public_out, &saved.public_envelope)
}

fn dkg_round1_agree(
    config_path: &Path,
    root: &Path,
    transport_path: &Path,
    round1_path: &Path,
    public_out: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let transport: TransportSecrets = read_secret_json(transport_path)?;
    validate_transport(&config, &transport)?;
    let state = StateLock::acquire(root)?;
    let round1_state: DkgRound1State = read_secret_json(&state.path("dkg-round1.state"))?;
    let bundle: EnvelopeBundle<PublicEnvelope> = read_json(round1_path)?;
    let (_, round1_digest) = validate_round1_bundle(&config, &transport, &bundle)?;
    validate_local_round1_envelope(&config, &round1_state, &bundle)?;
    let agreement = sign_round1_agreement(&config, &transport, round1_digest)?;
    publish_json_exact(public_out, &agreement)
}

fn dkg_round2(
    config_path: &Path,
    root: &Path,
    transport_path: &Path,
    round1_path: &Path,
    agreement_path: &Path,
    out_dir: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let transport: TransportSecrets = read_secret_json(transport_path)?;
    validate_transport(&config, &transport)?;
    let state = StateLock::acquire(root)?;
    let state_path = state.path("dkg-round2.state");
    if state_path.exists() {
        let saved: DkgRound2State = read_secret_json(&state_path)?;
        validate_state_binding(
            &config,
            &saved.version,
            &saved.run_id,
            &saved.committee_keyset_id,
            &saved.committee_keyset_version,
            saved.participant_id,
        )?;
        return publish_private_envelopes(out_dir, &saved.outbound);
    }
    if state.path("dkg-final.state").exists() {
        return Err("DKG already finalized".into());
    }
    let round1_state: DkgRound1State = read_secret_json(&state.path("dkg-round1.state"))?;
    validate_state_binding(
        &config,
        &round1_state.version,
        &round1_state.run_id,
        &round1_state.committee_keyset_id,
        &round1_state.committee_keyset_version,
        round1_state.participant_id,
    )?;
    let secret = frost::keys::dkg::round1::SecretPackage::deserialize(&hex::decode(
        &round1_state.secret_hex,
    )?)?;
    let bundle: EnvelopeBundle<PublicEnvelope> = read_json(round1_path)?;
    let (packages, round1_digest) = validate_round1_bundle(&config, &transport, &bundle)?;
    validate_local_round1_envelope(&config, &round1_state, &bundle)?;
    let agreements: EnvelopeBundle<Round1Agreement> = read_json(agreement_path)?;
    validate_round1_agreements(&config, &transport, &agreements, &round1_digest)?;
    let (round2_secret, outbound) = frost::keys::dkg::part2(secret, &packages)?;
    let mut envelopes = Vec::new();
    for recipient in other_ids(&config) {
        let package = outbound.get(&identifier(recipient)?).ok_or("missing outbound round-two package")?;
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        envelopes.push(encrypt_round2_payload(
            &config,
            &transport,
            recipient,
            &round1_digest,
            &package.serialize()?,
            nonce.into(),
        )?);
    }
    let saved = DkgRound2State {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        participant_id: config.participant_id,
        round1_digest,
        secret_hex: hex::encode(round2_secret.serialize()?),
        outbound: envelopes,
    };
    replace_json(&state_path, &saved)?;
    fs::remove_file(state.path("dkg-round1.state"))?;
    sync_parent(&state.path("dkg-round1.state"))?;
    publish_private_envelopes(out_dir, &saved.outbound)
}

fn dkg_finalize(
    config_path: &Path,
    root: &Path,
    transport_path: &Path,
    round1_path: &Path,
    agreement_path: &Path,
    round2_path: &Path,
    public_out: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let transport: TransportSecrets = read_secret_json(transport_path)?;
    validate_transport(&config, &transport)?;
    let state = StateLock::acquire(root)?;
    let state_path = state.path("dkg-final.state");
    if state_path.exists() {
        let saved: DkgFinalState = read_secret_json(&state_path)?;
        validate_state_binding(
            &config,
            &saved.version,
            &saved.run_id,
            &saved.committee_keyset_id,
            &saved.committee_keyset_version,
            saved.participant_id,
        )?;
        return publish_json_exact(public_out, &saved.public_output);
    }
    let round2_state: DkgRound2State = read_secret_json(&state.path("dkg-round2.state"))?;
    validate_state_binding(
        &config,
        &round2_state.version,
        &round2_state.run_id,
        &round2_state.committee_keyset_id,
        &round2_state.committee_keyset_version,
        round2_state.participant_id,
    )?;
    let r2_secret = frost::keys::dkg::round2::SecretPackage::deserialize(&hex::decode(
        &round2_state.secret_hex,
    )?)?;
    let r1_bundle: EnvelopeBundle<PublicEnvelope> = read_json(round1_path)?;
    let (r1_packages, round1_digest) = validate_round1_bundle(&config, &transport, &r1_bundle)?;
    if round2_state.round1_digest != round1_digest {
        return Err("round-one transcript changed between DKG rounds".into());
    }
    let agreements: EnvelopeBundle<Round1Agreement> = read_json(agreement_path)?;
    validate_round1_agreements(&config, &transport, &agreements, &round1_digest)?;
    let r2_bundle: EnvelopeBundle<PrivateEnvelope> = read_json(round2_path)?;
    if r2_bundle.version != VERSION {
        return Err("wrong round-two bundle version".into());
    }
    let expected: BTreeSet<_> = other_ids(&config).collect();
    let actual: BTreeSet<_> = r2_bundle.entries.iter().map(|entry| entry.sender).collect();
    if actual != expected || r2_bundle.entries.len() != expected.len() {
        return Err("round-two bundle must contain each other participant exactly once".into());
    }
    let mut r2_packages = BTreeMap::new();
    for entry in &r2_bundle.entries {
        if entry.version != VERSION
            || entry.run_id != config.run_id
            || entry.committee_keyset_id != config.committee_keyset_id
            || entry.committee_keyset_version != config.committee_keyset_version
            || entry.round1_digest != round1_digest
            || entry.recipient != config.participant_id
        {
            return Err("round-two private envelope binding mismatch".into());
        }
        let payload = decrypt_round2_payload(&transport, entry)
            .map_err(|_| "round-two private envelope authentication or decryption failed")?;
        r2_packages.insert(identifier(entry.sender)?, frost::keys::dkg::round2::Package::deserialize(&payload)?);
    }
    let (key_package, public_key_package) = frost::keys::dkg::part3(&r2_secret, &r1_packages, &r2_packages)?;
    let public_bytes = public_key_package.serialize()?;
    let output = FinalPublicPackage {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        participant_id: config.participant_id,
        public_key_package_hex: hex::encode(&public_bytes),
        public_key_package_sha256: sha256_hex(&public_bytes),
    };
    let saved = DkgFinalState {
        version: VERSION.to_string(),
        run_id: config.run_id.clone(),
        committee_keyset_id: config.committee_keyset_id.clone(),
        committee_keyset_version: config.committee_keyset_version.clone(),
        participant_id: config.participant_id,
        key_package_hex: hex::encode(key_package.serialize()?),
        public_key_package_hex: hex::encode(&public_bytes),
        public_output: output,
    };
    replace_json(&state_path, &saved)?;
    fs::remove_file(state.path("dkg-round2.state"))?;
    sync_parent(&state.path("dkg-round2.state"))?;
    publish_json_exact(public_out, &saved.public_output)
}

fn journal_path(state: &StateLock, operation_id: &str, session_id: &str) -> PathBuf {
    state.path(&format!(
        "sign-{}.journal",
        sha256_hex(format!("{}:{}", operation_id, session_id).as_bytes())
    ))
}

fn sign_commit(config_path: &Path, root: &Path, auth_path: &Path, public_out: &Path) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let auth: Authorization = read_json(auth_path)?;
    let auth_digest = validate_authorization(&auth)?;
    let state = StateLock::acquire(root)?;
    validate_authorization_for_state(&config, &state, &auth)?;
    claim_operation(&state, &auth, &auth_digest)?;
    let path = journal_path(&state, &auth.operation_id, &auth.session_id);
    let journal = if path.exists() {
        let existing: SignJournal = read_secret_json(&path)?;
        if existing.authorization_digest != hex::encode(auth_digest)
            || existing.session_id != auth.session_id
            || existing.participant_id != config.participant_id
        {
            return Err("existing signing journal belongs to another authorization".into());
        }
        existing
    } else {
        let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
        let key_package = frost::keys::KeyPackage::deserialize(&hex::decode(
            &final_state.key_package_hex,
        )?)?;
        if key_package.identifier() != &identifier(config.participant_id)? || key_package.min_signers() != &MIN_SIGNERS {
            return Err("key package does not belong to this four-of-four participant".into());
        }
        let (nonces, commitment) = frost::round1::commit(key_package.signing_share(), &mut OsRng);
        let journal = SignJournal {
            version: VERSION.to_string(),
            operation_id: auth.operation_id.clone(),
            session_id: auth.session_id.clone(),
            authorization_digest: hex::encode(auth_digest),
            participant_id: config.participant_id,
            state: SignState::Committed,
            commitments_digest: None,
            nonces_hex: Some(hex::encode(nonces.serialize()?)),
            commitment_hex: hex::encode(commitment.serialize()?),
            share_hex: None,
        };
        replace_json(&path, &journal)?;
        journal
    };
    let envelope = CommitmentEnvelope {
        version: VERSION.to_string(),
        operation_id: auth.operation_id,
        session_id: auth.session_id,
        authorization_digest: hex::encode(auth_digest),
        participant_id: config.participant_id,
        hiding_hex: hex::encode(
            frost::round1::SigningCommitments::deserialize(&hex::decode(&journal.commitment_hex)?)?
                .hiding()
                .serialize()?,
        ),
        binding_hex: hex::encode(
            frost::round1::SigningCommitments::deserialize(&hex::decode(&journal.commitment_hex)?)?
                .binding()
                .serialize()?,
        ),
    };
    publish_json_exact(public_out, &envelope)
}

fn signing_package(
    auth: &Authorization,
    auth_digest: &[u8; 32],
    bundle: &EnvelopeBundle<CommitmentEnvelope>,
) -> AnyResult<(frost::SigningPackage, String)> {
    if bundle.version != VERSION || bundle.entries.len() != usize::from(MIN_SIGNERS) {
        return Err("three commitment envelopes are required".into());
    }
    let actual: BTreeSet<_> = bundle.entries.iter().map(|entry| entry.participant_id).collect();
    let allowed: BTreeSet<_> = auth.roster.iter().copied().collect();
    if actual.len() != usize::from(MIN_SIGNERS)
        || actual.len() != bundle.entries.len()
        || !actual.is_subset(&allowed)
    {
        return Err("commitment bundle must contain exactly three distinct enrolled participants".into());
    }
    let mut entries = bundle.entries.clone();
    entries.sort_by_key(|entry| entry.participant_id);
    let mut commitments = BTreeMap::new();
    for entry in &entries {
        if entry.version != VERSION
            || entry.operation_id != auth.operation_id
            || entry.session_id != auth.session_id
            || entry.authorization_digest != hex::encode(auth_digest)
        {
            return Err("commitment authorization binding mismatch".into());
        }
        let hiding_bytes = hex::decode(&entry.hiding_hex)?;
        let binding_bytes = hex::decode(&entry.binding_hex)?;
        if hex::encode(&hiding_bytes) != entry.hiding_hex
            || hex::encode(&binding_bytes) != entry.binding_hex
        {
            return Err("commitment point fields are not canonical".into());
        }
        commitments.insert(
            identifier(entry.participant_id)?,
            frost::round1::SigningCommitments::new(
                frost::round1::NonceCommitment::deserialize(&hiding_bytes)?,
                frost::round1::NonceCommitment::deserialize(&binding_bytes)?,
            ),
        );
    }
    let cashu_digest = exact_hex::<32>(&auth.cashu_sigall_digest, "cashu_sigall_digest")?;
    let package = frost::SigningPackage::new(commitments, &cashu_digest);
    let mut transcript = Vec::new();
    transcript.extend_from_slice(TRANSCRIPT_CONTEXT);
    transcript.extend_from_slice(auth_digest);
    transcript.extend_from_slice(&serde_json::to_vec(&entries)?);
    Ok((package, sha256_hex(&transcript)))
}

fn validate_aggregate_request_roster(
    auth: &Authorization,
    request: &AggregateRequest,
) -> AnyResult<()> {
    let share_ids: BTreeSet<_> = request
        .shares
        .iter()
        .map(|entry| entry.participant_id)
        .collect();
    let commitment_ids: BTreeSet<_> = request
        .commitments
        .iter()
        .map(|entry| entry.participant_id)
        .collect();
    let allowed_ids: BTreeSet<_> = auth.roster.iter().copied().collect();
    if request.shares.len() != usize::from(MIN_SIGNERS)
        || share_ids.len() != request.shares.len()
        || request.commitments.len() != usize::from(MIN_SIGNERS)
        || commitment_ids.len() != request.commitments.len()
        || share_ids != commitment_ids
        || !share_ids.is_subset(&allowed_ids)
    {
        return Err("PAYMENT_BLOCKED_MISSING_PARTICIPANT: aggregation requires the same three enrolled shares and commitments".into());
    }
    Ok(())
}

fn sign_share(
    config_path: &Path,
    root: &Path,
    auth_path: &Path,
    commitment_path: &Path,
    public_out: &Path,
) -> AnyResult<()> {
    let config: Config = read_json(config_path)?;
    validate_config(&config)?;
    let auth: Authorization = read_json(auth_path)?;
    let auth_digest = validate_authorization(&auth)?;
    let bundle: EnvelopeBundle<CommitmentEnvelope> = read_json(commitment_path)?;
    let (package, commitments_digest) = signing_package(&auth, &auth_digest, &bundle)?;
    let state = StateLock::acquire(root)?;
    validate_authorization_for_state(&config, &state, &auth)?;
    claim_operation(&state, &auth, &auth_digest)?;
    let path = journal_path(&state, &auth.operation_id, &auth.session_id);
    let mut journal: SignJournal = read_secret_json(&path)?;
    if journal.authorization_digest != hex::encode(auth_digest)
        || journal.participant_id != config.participant_id
    {
        return Err("signing journal authorization mismatch".into());
    }
    if journal.state == SignState::Consumed {
        if journal.commitments_digest.as_deref() != Some(&commitments_digest) {
            return Err("consumed nonce cannot be replayed for another transcript".into());
        }
        let envelope = ShareEnvelope {
            version: VERSION.to_string(),
            operation_id: auth.operation_id,
            session_id: auth.session_id,
            authorization_digest: hex::encode(auth_digest),
            commitments_digest,
            participant_id: config.participant_id,
            share_hex: journal.share_hex.clone().ok_or("consumed journal lacks share")?,
        };
        return publish_json_exact(public_out, &envelope);
    }
    if journal.state == SignState::Consuming
        && journal.commitments_digest.as_deref() != Some(&commitments_digest)
    {
        return Err("nonce is already bound to another signing transcript".into());
    }
    if journal.state == SignState::Committed {
        journal.state = SignState::Consuming;
        journal.commitments_digest = Some(commitments_digest.clone());
        replace_json(&path, &journal)?;
    }
    let nonce_bytes = hex::decode(journal.nonces_hex.as_ref().ok_or("journal nonce unavailable")?)?;
    let nonces = frost::round1::SigningNonces::deserialize(&nonce_bytes)?;
    let final_state: DkgFinalState = read_secret_json(&state.path("dkg-final.state"))?;
    let key_package = frost::keys::KeyPackage::deserialize(&hex::decode(
        &final_state.key_package_hex,
    )?)?;
    let share = frost::round2::sign(&package, &nonces, &key_package)?;
    let share_hex = hex::encode(share.serialize());
    journal.state = SignState::Consumed;
    journal.nonces_hex = None;
    journal.share_hex = Some(share_hex.clone());
    replace_json(&path, &journal)?;
    let envelope = ShareEnvelope {
        version: VERSION.to_string(),
        operation_id: auth.operation_id,
        session_id: auth.session_id,
        authorization_digest: hex::encode(auth_digest),
        commitments_digest,
        participant_id: config.participant_id,
        share_hex,
    };
    publish_json_exact(public_out, &envelope)
}

fn aggregate(auth_path: &Path, public_key_path: &Path, share_path: &Path, out: &Path) -> AnyResult<()> {
    let auth: Authorization = read_json(auth_path)?;
    let auth_digest = validate_authorization(&auth)?;
    let request: AggregateRequest = read_json(share_path)?;
    if request.version != VERSION
        || request.operation_id != auth.operation_id
        || request.session_id != auth.session_id
    {
        return Err("aggregate request authorization binding mismatch".into());
    }
    validate_aggregate_request_roster(&auth, &request)?;
    let public_bytes = read_public_key_package_bytes(
        public_key_path,
        &auth.dkg_run_id,
        &auth.committee_keyset_id,
        &auth.committee_keyset_version,
        &auth.public_key_package_sha256,
    )?;
    let public_key_package = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?;
    let commitment_bundle = EnvelopeBundle {
        version: VERSION.to_string(),
        entries: request
            .commitments
            .iter()
            .map(|entry| CommitmentEnvelope {
                version: VERSION.to_string(),
                operation_id: auth.operation_id.clone(),
                session_id: auth.session_id.clone(),
                authorization_digest: hex::encode(auth_digest),
                participant_id: entry.participant_id,
                hiding_hex: entry.hiding_hex.clone(),
                binding_hex: entry.binding_hex.clone(),
            })
            .collect(),
    };
    let (package, commitments_digest) = signing_package(&auth, &auth_digest, &commitment_bundle)?;
    let mut signature_shares = BTreeMap::new();
    for entry in &request.shares {
        let bytes = hex::decode(&entry.share_hex)?;
        if hex::encode(&bytes) != entry.share_hex {
            return Err("signature share is not canonical hex".into());
        }
        signature_shares.insert(identifier(entry.participant_id)?, frost::round2::SignatureShare::deserialize(&bytes)?);
    }
    let signature = frost::aggregate(&package, &signature_shares, &public_key_package)?;
    let cashu_digest = exact_hex::<32>(&auth.cashu_sigall_digest, "cashu_sigall_digest")?;
    public_key_package.verifying_key().verify(&cashu_digest, &signature)?;
    let output = AggregateSignature {
        version: VERSION.to_string(),
        operation_id: auth.operation_id,
        session_id: auth.session_id,
        authorization_digest: hex::encode(auth_digest),
        commitments_digest,
        cashu_sigall_digest: auth.cashu_sigall_digest,
        signature_hex: hex::encode(signature.serialize()?),
    };
    publish_json_exact(out, &output)
}

fn usage() -> &'static str {
    "usage:\n  coco-demo-frost-participant dkg-validate-inputs CONFIG TRANSPORT_SECRETS\n  coco-demo-frost-participant dkg-round1 CONFIG STATE_DIR TRANSPORT_SECRETS PUBLIC_OUT\n  coco-demo-frost-participant dkg-round1-agree CONFIG STATE_DIR TRANSPORT_SECRETS ROUND1_BUNDLE AGREEMENT_OUT\n  coco-demo-frost-participant dkg-round2 CONFIG STATE_DIR TRANSPORT_SECRETS ROUND1_BUNDLE AGREEMENT_BUNDLE PRIVATE_OUT_DIR\n  coco-demo-frost-participant dkg-finalize CONFIG STATE_DIR TRANSPORT_SECRETS ROUND1_BUNDLE AGREEMENT_BUNDLE ROUND2_BUNDLE PUBLIC_OUT\n  coco-demo-frost-participant sign-commit CONFIG STATE_DIR AUTHORIZATION PUBLIC_OUT\n  coco-demo-frost-participant sign-share CONFIG STATE_DIR AUTHORIZATION COMMITMENT_BUNDLE PUBLIC_OUT\n  coco-demo-frost-participant aggregate AUTHORIZATION PUBLIC_KEY SHARE_BUNDLE SIGNATURE_OUT\n  coco-demo-frost-participant admission-commit CONFIG STATE_DIR AUTHORIZATION PUBLIC_OUT\n  coco-demo-frost-participant admission-share CONFIG STATE_DIR AUTHORIZATION COMMITMENT_BUNDLE PUBLIC_OUT\n  coco-demo-frost-participant admission-aggregate AUTHORIZATION PUBLIC_KEY SHARE_BUNDLE SIGNATURE_OUT\n  coco-demo-frost-participant funding-abort-commit CONFIG STATE_DIR AUTHORIZATION PUBLIC_OUT\n  coco-demo-frost-participant funding-abort-share CONFIG STATE_DIR AUTHORIZATION COMMITMENT_BUNDLE PUBLIC_OUT\n  coco-demo-frost-participant funding-abort-aggregate AUTHORIZATION PUBLIC_KEY SHARE_BUNDLE SIGNATURE_OUT"
}

fn run() -> AnyResult<()> {
    let args: Vec<_> = std::env::args_os().collect();
    let command = args.get(1).and_then(|value| value.to_str()).ok_or_else(|| usage())?;
    let paths: Vec<_> = args.iter().skip(2).map(PathBuf::from).collect();
    match (command, paths.as_slice()) {
        ("dkg-validate-inputs", [config, transport]) => dkg_validate_inputs(config, transport)
            .map(|()| println!("DKG_INPUT_VALIDATION_OK")),
        ("dkg-round1", [config, state, transport, output]) => {
            dkg_round1(config, state, transport, output)
        }
        ("dkg-round1-agree", [config, state, transport, round1, output]) => {
            dkg_round1_agree(config, state, transport, round1, output)
        }
        ("dkg-round2", [config, state, transport, round1, agreements, output]) => {
            dkg_round2(config, state, transport, round1, agreements, output)
        }
        ("dkg-finalize", [config, state, transport, round1, agreements, round2, output]) => {
            dkg_finalize(config, state, transport, round1, agreements, round2, output)
        }
        ("sign-commit", [config, state, auth, output]) => sign_commit(config, state, auth, output),
        ("sign-share", [config, state, auth, commitments, output]) => {
            sign_share(config, state, auth, commitments, output)
        }
        ("aggregate", [auth, public, shares, output]) => aggregate(auth, public, shares, output),
        ("admission-commit", [config, state, auth, output]) => {
            admission::sign_commit(config, state, auth, output)
        }
        ("admission-share", [config, state, auth, commitments, output]) => {
            admission::sign_share(config, state, auth, commitments, output)
        }
        ("admission-aggregate", [auth, public, shares, output]) => {
            admission::aggregate(auth, public, shares, output)
        }
        ("funding-abort-commit", [config, state, auth, output]) => {
            funding_abort::sign_commit(config, state, auth, output)
        }
        ("funding-abort-share", [config, state, auth, commitments, output]) => {
            funding_abort::sign_share(config, state, auth, commitments, output)
        }
        ("funding-abort-aggregate", [auth, public, shares, output]) => {
            funding_abort::aggregate(auth, public, shares, output)
        }
        _ => Err(usage().into()),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(participant_id: u16) -> Config {
        Config {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            participant_id,
            max_signers: 4,
            min_signers: 3,
            roster: vec![1, 2, 3, 4],
        }
    }

    fn transport(participant_id: u16) -> TransportSecrets {
        let identity_verifying_keys = (1..=4)
            .map(|id| {
                let secret = format!("{id:064x}");
                let signing = IdentitySigningKey::from_bytes(&hex::decode(secret).unwrap()).unwrap();
                IdentityVerifyingKeyEntry {
                    participant_id: id,
                    verifying_key_hex: hex::encode(signing.verifying_key().to_bytes()),
                }
            })
            .collect();
        let round2_pairwise_keys = (1..=4)
            .filter(|id| *id != participant_id)
            .map(|peer_id| {
                let low = participant_id.min(peer_id);
                let high = participant_id.max(peer_id);
                PairwiseKeyEntry {
                    peer_id,
                    key_hex: format!("{:02x}", low * 16 + high).repeat(32),
                }
            })
            .collect();
        TransportSecrets {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            participant_id,
            identity_signing_key_hex: format!("{participant_id:064x}"),
            identity_verifying_keys,
            round2_pairwise_keys,
        }
    }

    fn validation_fixture() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "friday-dkg-input-validation-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let config_path = root.join("participant.config.json");
        let transport_path = root.join("transport-secrets.json");
        fs::write(&config_path, encoded_json(&config(1)).unwrap()).unwrap();
        fs::write(&transport_path, encoded_json(&transport(1)).unwrap()).unwrap();
        fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&transport_path, fs::Permissions::from_mode(0o600)).unwrap();
        (root, config_path, transport_path)
    }

    #[test]
    fn public_package_loader_accepts_pinned_raw_runtime_bytes_and_legacy_envelope() {
        let root = std::env::temp_dir().join(format!(
            "friday-public-package-loader-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        let path = root.join("participant-1.public.json");
        let raw = vec![0, 255, 13, 42, 7];
        let digest = sha256_hex(&raw);

        fs::write(&path, &raw).unwrap();
        assert_eq!(
            read_public_key_package_bytes(
                &path,
                "dkg-demo-1",
                "committee-demo",
                "1",
                &digest,
            )
            .unwrap(),
            raw,
        );

        let envelope = FinalPublicPackage {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            participant_id: 1,
            public_key_package_hex: hex::encode(&raw),
            public_key_package_sha256: digest.clone(),
        };
        fs::write(&path, encoded_json(&envelope).unwrap()).unwrap();
        assert_eq!(
            read_public_key_package_bytes(
                &path,
                "dkg-demo-1",
                "committee-demo",
                "1",
                &digest,
            )
            .unwrap(),
            raw,
        );

        let mut wrong = envelope;
        wrong.run_id = "another-dkg".to_string();
        fs::write(&path, encoded_json(&wrong).unwrap()).unwrap();
        assert!(read_public_key_package_bytes(
            &path,
            "dkg-demo-1",
            "committee-demo",
            "1",
            &digest,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dkg_input_validation_is_read_only_and_emits_only_fixed_categories() {
        let (root, config_path, transport_path) = validation_fixture();
        let entries_before: BTreeSet<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        dkg_validate_inputs(&config_path, &transport_path).unwrap();
        let entries_after: BTreeSet<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries_before, entries_after);

        let mut invalid_config = config(1);
        invalid_config.min_signers = 2;
        fs::write(&config_path, encoded_json(&invalid_config).unwrap()).unwrap();
        assert_eq!(
            dkg_validate_inputs(&config_path, &transport_path)
                .unwrap_err()
                .to_string(),
            "DKG_INPUT_VALIDATION_FAILED:CONFIG_INVALID"
        );

        fs::write(&config_path, encoded_json(&config(1)).unwrap()).unwrap();
        fs::write(
            &transport_path,
            br#"{"private_secret_sentinel":"MUST_NOT_ESCAPE"}"#,
        )
        .unwrap();
        let error = dkg_validate_inputs(&config_path, &transport_path)
            .unwrap_err()
            .to_string();
        assert_eq!(error, "DKG_INPUT_VALIDATION_FAILED:TRANSPORT_READ");
        assert!(!error.contains("MUST_NOT_ESCAPE"));
        fs::remove_dir_all(root).unwrap();
    }

    fn round1_bundle() -> EnvelopeBundle<PublicEnvelope> {
        // Public serialization fixture from frost-secp256k1-tr 3.0.0. No key
        // generation or secret package is created by these regression tests.
        let public_package = "00230f8ab3010279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817984079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9d1c9e899ca306ad27fe1945de0242b81";
        let entries = (1..=4)
            .map(|sender| {
                let mut envelope = PublicEnvelope {
                    version: VERSION.to_string(),
                    run_id: "dkg-demo-1".to_string(),
                    committee_keyset_id: "committee-demo".to_string(),
                    committee_keyset_version: "1".to_string(),
                    sender,
                    payload_hex: public_package.to_string(),
                    auth_signature_hex: String::new(),
                };
                sign_public_envelope(&transport(sender), &mut envelope).unwrap();
                envelope
            })
            .collect();
        EnvelopeBundle {
            version: VERSION.to_string(),
            entries,
        }
    }

    fn authorization() -> Authorization {
        let mut auth = Authorization {
            version: VERSION.to_string(),
            dkg_run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            public_key_package_sha256: "00".repeat(32),
            operation_id: "auction-1:close:7".to_string(),
            operation_root: "00".repeat(32),
            session_id: "09".repeat(32),
            policy_package_digest: "10".repeat(32),
            cashu_sigall_digest: "11".repeat(32),
            full_package_digest: "22".repeat(32),
            certified_closure_digest: "33".repeat(32),
            signed_bid_evidence_digest: "34".repeat(32),
            committee_locked_proofs_digest: "35".repeat(32),
            bidder_payout_binding_digest: "44".repeat(32),
            roster: vec![1, 2, 3, 4],
            threshold: 3,
        };
        let mut framed = Vec::new();
        framed.extend_from_slice(OPERATION_ROOT_CONTEXT);
        for field in [
            auth.dkg_run_id.as_bytes(), auth.committee_keyset_id.as_bytes(),
            auth.committee_keyset_version.as_bytes(), auth.public_key_package_sha256.as_bytes(),
            auth.operation_id.as_bytes(), auth.policy_package_digest.as_bytes(),
            auth.cashu_sigall_digest.as_bytes(), auth.full_package_digest.as_bytes(),
            auth.certified_closure_digest.as_bytes(), auth.signed_bid_evidence_digest.as_bytes(),
            auth.committee_locked_proofs_digest.as_bytes(), auth.bidder_payout_binding_digest.as_bytes(),
        ] {
            framed.extend_from_slice(&(field.len() as u32).to_be_bytes());
            framed.extend_from_slice(field);
        }
        for id in &auth.roster { framed.extend_from_slice(&id.to_be_bytes()); }
        framed.extend_from_slice(&auth.threshold.to_be_bytes());
        auth.operation_root = sha256_hex(&framed);
        auth
    }

    #[test]
    fn authorization_binds_stable_root_and_fresh_session() {
        let base = validate_authorization(&authorization()).unwrap();
        for mutate in [
            |auth: &mut Authorization| auth.bidder_payout_binding_digest = "55".repeat(32),
            |auth: &mut Authorization| auth.certified_closure_digest = "66".repeat(32),
            |auth: &mut Authorization| auth.full_package_digest = "77".repeat(32),
            |auth: &mut Authorization| auth.signed_bid_evidence_digest = "88".repeat(32),
            |auth: &mut Authorization| auth.committee_locked_proofs_digest = "99".repeat(32),
        ] {
            let mut changed = authorization();
            mutate(&mut changed);
            assert!(validate_authorization(&changed).is_err());
        }
        let mut fresh = authorization();
        fresh.session_id = "ab".repeat(32);
        assert_ne!(base, validate_authorization(&fresh).unwrap());
    }

    #[test]
    fn anything_but_three_of_four_is_rejected() {
        let mut auth = authorization();
        auth.threshold = 4;
        assert!(validate_authorization(&auth).is_err());
        auth = authorization();
        auth.roster.pop();
        assert!(validate_authorization(&auth).is_err());
    }

    #[test]
    fn malformed_or_noncanonical_digests_are_rejected() {
        let mut auth = authorization();
        auth.cashu_sigall_digest = "AA".repeat(32);
        assert!(validate_authorization(&auth).is_err());
        auth = authorization();
        auth.full_package_digest = "22".repeat(31);
        assert!(validate_authorization(&auth).is_err());
    }

    #[test]
    fn duplicate_transport_identity_keys_are_rejected() {
        let mut credentials = transport(1);
        credentials.identity_verifying_keys[1].verifying_key_hex =
            credentials.identity_verifying_keys[0].verifying_key_hex.clone();
        assert_eq!(
            validate_transport(&config(1), &credentials)
                .unwrap_err()
                .to_string(),
            "transport identity verifying keys must be distinct"
        );
    }

    #[test]
    fn duplicate_or_zero_transport_pairwise_keys_are_rejected() {
        let mut credentials = transport(1);
        credentials.round2_pairwise_keys[1].key_hex =
            credentials.round2_pairwise_keys[0].key_hex.clone();
        assert_eq!(
            validate_transport(&config(1), &credentials)
                .unwrap_err()
                .to_string(),
            "transport round-two pairwise keys must be distinct"
        );

        let mut credentials = transport(1);
        credentials.round2_pairwise_keys[0].key_hex = "00".repeat(32);
        assert_eq!(
            validate_transport(&config(1), &credentials)
                .unwrap_err()
                .to_string(),
            "transport round-two pairwise keys must not be zero"
        );
    }

    #[test]
    fn one_withheld_participant_allows_three_and_two_withheld_blocks() {
        let auth = authorization();
        let share = |participant_id| AggregateShare { participant_id, share_hex: "00".to_string() };
        let commitment = |participant_id| AggregateCommitment {
            participant_id,
            hiding_hex: "00".to_string(),
            binding_hex: "00".to_string(),
        };
        for ids in [[1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4]] {
            let request = AggregateRequest {
                version: VERSION.to_string(),
                operation_id: auth.operation_id.clone(),
                session_id: auth.session_id.clone(),
                commitments: ids.map(commitment).to_vec(),
                shares: ids.map(share).to_vec(),
            };
            validate_aggregate_request_roster(&auth, &request).unwrap();
        }
        let blocked = AggregateRequest {
            version: VERSION.to_string(),
            operation_id: auth.operation_id.clone(),
            session_id: auth.session_id.clone(),
            commitments: vec![commitment(1), commitment(2)],
            shares: vec![share(1), share(2)],
        };
        assert!(validate_aggregate_request_roster(&auth, &blocked).is_err());
    }

    #[test]
    fn every_participant_hashes_the_same_all_four_round_one_broadcast() {
        let bundle = round1_bundle();
        let (participant_one_packages, participant_one_digest) =
            validate_round1_bundle(&config(1), &transport(1), &bundle).unwrap();
        let (participant_two_packages, participant_two_digest) =
            validate_round1_bundle(&config(2), &transport(2), &bundle).unwrap();
        assert_eq!(participant_one_packages.len(), 3);
        assert_eq!(participant_two_packages.len(), 3);
        assert_eq!(participant_one_digest, participant_two_digest);
    }

    #[test]
    fn forged_round_one_broadcast_is_rejected_before_dkg() {
        let mut bundle = round1_bundle();
        bundle.entries[2].auth_signature_hex = "00".repeat(64);
        let error = validate_round1_bundle(&config(1), &transport(1), &bundle).unwrap_err();
        assert_eq!(
            error.to_string(),
            "round-one broadcast identity authentication failed"
        );
    }

    #[test]
    fn agreement_requires_the_participants_own_durable_round_one_envelope() {
        let mut bundle = round1_bundle();
        let state = DkgRound1State {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            participant_id: 1,
            secret_hex: "not-generated-by-this-test".to_string(),
            public_envelope: bundle.entries[0].clone(),
        };
        validate_local_round1_envelope(&config(1), &state, &bundle).unwrap();

        bundle.entries[0] = bundle.entries[1].clone();
        bundle.entries[0].sender = 1;
        assert_eq!(
            validate_local_round1_envelope(&config(1), &state, &bundle)
                .unwrap_err()
                .to_string(),
            "round-one bundle does not contain this participant's durable envelope"
        );
    }

    #[test]
    fn all_four_authenticated_agreements_are_required_for_one_transcript() {
        let bundle = round1_bundle();
        let (_, digest) = validate_round1_bundle(&config(1), &transport(1), &bundle).unwrap();
        let mut agreements = EnvelopeBundle {
            version: VERSION.to_string(),
            entries: (1..=4)
                .map(|id| sign_round1_agreement(&config(id), &transport(id), digest.clone()).unwrap())
                .collect(),
        };
        validate_round1_agreements(&config(1), &transport(1), &agreements, &digest).unwrap();
        agreements.entries.pop();
        assert!(validate_round1_agreements(&config(1), &transport(1), &agreements, &digest)
            .unwrap_err()
            .to_string()
            .contains("all four"));

        let mut agreements = EnvelopeBundle {
            version: VERSION.to_string(),
            entries: (1..=4)
                .map(|id| sign_round1_agreement(&config(id), &transport(id), digest.clone()).unwrap())
                .collect(),
        };
        agreements.entries[3].round1_digest = "99".repeat(32);
        assert_eq!(
            validate_round1_agreements(&config(1), &transport(1), &agreements, &digest)
                .unwrap_err()
                .to_string(),
            "round-one agreement transcript mismatch"
        );
    }

    #[test]
    fn round_two_payload_is_pairwise_confidential_authenticated_and_bound() {
        let plaintext = b"private frost dkg round two package";
        let envelope = encrypt_round2_payload(
            &config(1),
            &transport(1),
            2,
            &"ab".repeat(32),
            plaintext,
            [7u8; 24],
        )
        .unwrap();
        assert_eq!(
            envelope.ciphertext_hex,
            "39c3d1e20d11275fd722be34f2fb32403c12b36a950a7f12534c7e72ebc13c21ecd355684b5ec0bb792468bfdc2bda412a8b6d"
        );
        assert!(!envelope.ciphertext_hex.contains(&hex::encode(plaintext)));
        assert_eq!(decrypt_round2_payload(&transport(2), &envelope).unwrap(), plaintext);

        let mut tampered = envelope;
        tampered.round1_digest = "cd".repeat(32);
        assert!(decrypt_round2_payload(&transport(2), &tampered).is_err());
    }

    #[test]
    fn durable_round_one_state_replays_an_exact_output_after_failure() {
        let root = std::env::temp_dir().join(format!(
            "coco-frost-replay-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&root).unwrap();
        let config_path = root.join("config.json");
        replace_json(&config_path, &config(1)).unwrap();
        let state_dir = root.join("participant-1");
        let state = StateLock::acquire(&state_dir).unwrap();
        let mut envelope = PublicEnvelope {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            sender: 1,
            payload_hex: "00".to_string(),
            auth_signature_hex: String::new(),
        };
        sign_public_envelope(&transport(1), &mut envelope).unwrap();
        let saved = DkgRound1State {
            version: VERSION.to_string(),
            run_id: "dkg-demo-1".to_string(),
            committee_keyset_id: "committee-demo".to_string(),
            committee_keyset_version: "1".to_string(),
            participant_id: 1,
            secret_hex: "not-generated-by-this-test".to_string(),
            public_envelope: envelope.clone(),
        };
        replace_json(&state.path("dkg-round1.state"), &saved).unwrap();
        drop(state);
        let transport_path = root.join("transport.json");
        replace_json(&transport_path, &transport(1)).unwrap();
        let output = root.join("round1-public.json");
        dkg_round1(&config_path, &state_dir, &transport_path, &output).unwrap();
        dkg_round1(&config_path, &state_dir, &transport_path, &output).unwrap();
        assert_eq!(read_json::<PublicEnvelope>(&output).unwrap(), envelope);
        fs::remove_dir_all(&root).unwrap();
    }
}
