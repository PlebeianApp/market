//! Read-only verifier for already-public admission commitments and shares.
//!
//! This diagnostic never reads a key package or signer state. It accepts only
//! the public transcript, aggregates it against the pinned public package, and
//! emits a digest of the resulting signature rather than the signature itself.

use frost_secp256k1_tr as frost;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, error::Error, fs, io::{self, Read}, path::Path};

type AnyResult<T> = Result<T, Box<dyn Error>>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commitment {
    participant_id: u16,
    hiding_hex: String,
    binding_hex: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Share {
    participant_id: u16,
    share_hex: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Transcript {
    message_digest: String,
    commitments: Vec<Commitment>,
    shares: Vec<Share>,
}

fn identifier(value: u16) -> AnyResult<frost::Identifier> {
    Ok(frost::Identifier::try_from(value)?)
}

fn main() -> AnyResult<()> {
    let mut args = std::env::args().skip(1);
    let public_path = args.next().ok_or("usage: public-admission-transcript-verify PUBLIC_PACKAGE")?;
    if args.next().is_some() {
        return Err("usage: public-admission-transcript-verify PUBLIC_PACKAGE".into());
    }
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let transcript: Transcript = serde_json::from_str(&input)?;
    if transcript.commitments.len() != 3 || transcript.shares.len() != 3 {
        return Err("exactly three commitments and shares are required".into());
    }
    let expected = [1u16, 2, 3];
    let commitment_ids: Vec<_> = transcript.commitments.iter().map(|entry| entry.participant_id).collect();
    let share_ids: Vec<_> = transcript.shares.iter().map(|entry| entry.participant_id).collect();
    if commitment_ids != expected || share_ids != expected {
        return Err("the public diagnostic accepts only ordered participants 1,2,3".into());
    }
    let message: [u8; 32] = hex::decode(&transcript.message_digest)?.try_into()
        .map_err(|_| "message digest must be 32 bytes")?;
    let mut commitments = BTreeMap::new();
    for entry in transcript.commitments {
        commitments.insert(identifier(entry.participant_id)?, frost::round1::SigningCommitments::new(
            frost::round1::NonceCommitment::deserialize(&hex::decode(entry.hiding_hex)?)?,
            frost::round1::NonceCommitment::deserialize(&hex::decode(entry.binding_hex)?)?,
        ));
    }
    let package = frost::SigningPackage::new(commitments, &message);
    let mut shares = BTreeMap::new();
    for entry in transcript.shares {
        shares.insert(identifier(entry.participant_id)?,
            frost::round2::SignatureShare::deserialize(&hex::decode(entry.share_hex)?)?);
    }
    let public_bytes = fs::read(Path::new(&public_path))?;
    let public = frost::keys::PublicKeyPackage::deserialize(&public_bytes)?;
    let signature = frost::aggregate(&package, &shares, &public)?;
    public.verifying_key().verify(&message, &signature)?;
    let signature_sha256 = hex::encode(Sha256::digest(signature.serialize()?));
    println!("{{\"schema\":\"PLEBEIAN_PUBLIC_ADMISSION_TRANSCRIPT_VERIFY_V1\",\"status\":\"PASS\",\"participantIds\":[1,2,3],\"signatureSha256\":\"{}\"}}", signature_sha256);
    Ok(())
}
