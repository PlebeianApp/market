//! Test-only fixed synthetic packages. No DKG or production identity generation.
use frost_secp256k1_tr as frost;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, os::unix::fs::PermissionsExt, path::PathBuf};

#[test]
fn write_synthetic_signer_fixture() {
    let Some(root) = std::env::var_os("COCO_SYNTHETIC_SIGNER_FIXTURE_OUTPUT") else { return };
    let root = PathBuf::from(root);
    assert!(root.is_absolute() && root.is_dir());
    let point = hex::decode("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798").unwrap();
    let verifying = frost::VerifyingKey::deserialize(&point).unwrap();
    let share_scalar = |id: u16| { let mut value = [0u8; 32]; value[30..].copy_from_slice(&(1 + 2 * id + 3 * id * id).to_be_bytes()); value };
    let share_point = |id: u16| frost::VerifyingKey::from(frost::SigningKey::deserialize(&share_scalar(id)).unwrap()).serialize().unwrap();
    let verifying_shares = (1u16..=4).map(|id| (id.try_into().unwrap(), frost::keys::VerifyingShare::deserialize(&share_point(id)).unwrap())).collect::<BTreeMap<_, _>>();
    let public = frost::keys::PublicKeyPackage::new(verifying_shares, verifying, Some(3));
    let public_bytes = public.serialize().unwrap();
    let public_hash = hex::encode(Sha256::digest(&public_bytes));
    let write = |path: PathBuf, value: serde_json::Value| {
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    };
    write(root.join("inspection.json"), json!({"version":"COCO_DEMO_FROST_PUBLIC_INSPECTION_V1","run_id":"synthetic-f1","committee_keyset_id":"synthetic-f1","committee_keyset_version":"1","public_key_package_sha256":public_hash,"committee_public_key":hex::encode(&point),"min_signers":3,"max_signers":4,"verifying_shares":(1u16..=4).map(|id|json!({"participant_id":id,"verifying_share_hex":hex::encode(share_point(id))})).collect::<Vec<_>>()}));
    for id in 1u16..=4 {
        let key = frost::keys::KeyPackage::new(id.try_into().unwrap(),
            frost::keys::SigningShare::deserialize(&share_scalar(id)).unwrap(),
            frost::keys::VerifyingShare::deserialize(&share_point(id)).unwrap(), verifying, 3);
        let state = root.join(format!("state-{id}")); fs::create_dir(&state).unwrap();
        fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
        let output = json!({"version":"COCO_DEMO_FROST_PARTICIPANT_3OF4_V1","run_id":"synthetic-f1","committee_keyset_id":"synthetic-f1","committee_keyset_version":"1","participant_id":id,"public_key_package_hex":hex::encode(&public_bytes),"public_key_package_sha256":public_hash});
        write(root.join(format!("config-{id}.json")), json!({"version":"COCO_DEMO_FROST_PARTICIPANT_3OF4_V1","run_id":"synthetic-f1","committee_keyset_id":"synthetic-f1","committee_keyset_version":"1","participant_id":id,"max_signers":4,"min_signers":3,"roster":[1,2,3,4]}));
        write(state.join("dkg-final.state"), json!({"version":"COCO_DEMO_FROST_PARTICIPANT_3OF4_V1","run_id":"synthetic-f1","committee_keyset_id":"synthetic-f1","committee_keyset_version":"1","participant_id":id,"key_package_hex":hex::encode(key.serialize().unwrap()),"public_key_package_hex":hex::encode(&public_bytes),"public_output":output}));
        if id == 1 { write(root.join("public.json"), output); }
    }
}
