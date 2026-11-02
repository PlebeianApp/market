use frost_secp256k1_tr as frost;
use frost::keys::EvenY;
use serde::{Deserialize, Serialize};
use std::{error::Error, fs, path::Path};

type AnyResult<T> = Result<T, Box<dyn Error>>;

#[derive(Deserialize)]
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

#[derive(Serialize)]
struct PublicShare {
    participant_id: u16,
    verifying_share_hex: String,
}

#[derive(Serialize)]
struct Inspection {
    version: String,
    run_id: String,
    committee_keyset_id: String,
    committee_keyset_version: String,
    source_participant_id: u16,
    public_key_package_sha256: String,
    committee_public_key: String,
    min_signers: u16,
    max_signers: u16,
    verifying_shares: Vec<PublicShare>,
}

fn inspect(input: &Path, output: &Path) -> AnyResult<()> {
    let wire: FinalPublicPackage = serde_json::from_slice(&fs::read(input)?)?;
    let package = frost::keys::PublicKeyPackage::deserialize(&hex::decode(
        &wire.public_key_package_hex,
    )?)?
    .into_even_y(None);
    let mut shares = Vec::new();
    for participant_id in 1u16..=4 {
        let identifier = frost::Identifier::try_from(participant_id)?;
        let share = package
            .verifying_shares()
            .get(&identifier)
            .ok_or("public package is missing an expected participant")?;
        shares.push(PublicShare {
            participant_id,
            verifying_share_hex: hex::encode(share.serialize()?),
        });
    }
    if package.max_signers() != 4 || package.min_signers() != Some(3) {
        return Err("public package is not an exact 3-of-4 keyset".into());
    }
    let group = package.verifying_key().serialize()?;
    if group.len() != 33 || group[0] != 2 {
        return Err("even-Y committee key did not serialize as a compressed point".into());
    }
    let inspection = Inspection {
        version: "COCO_DEMO_FROST_PUBLIC_INSPECTION_V1".to_string(),
        run_id: wire.run_id,
        committee_keyset_id: wire.committee_keyset_id,
        committee_keyset_version: wire.committee_keyset_version,
        source_participant_id: wire.participant_id,
        public_key_package_sha256: wire.public_key_package_sha256,
        committee_public_key: hex::encode(group),
        min_signers: 3,
        max_signers: 4,
        verifying_shares: shares,
    };
    fs::write(output, format!("{}\n", serde_json::to_string_pretty(&inspection)?))?;
    Ok(())
}

fn main() -> AnyResult<()> {
    let mut args = std::env::args().skip(1);
    let input = args.next().ok_or("usage: coco-demo-frost-public-inspect INPUT OUTPUT")?;
    let output = args.next().ok_or("usage: coco-demo-frost-public-inspect INPUT OUTPUT")?;
    if args.next().is_some() {
        return Err("usage: coco-demo-frost-public-inspect INPUT OUTPUT".into());
    }
    inspect(Path::new(&input), Path::new(&output))
}
