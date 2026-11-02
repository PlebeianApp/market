#![forbid(unsafe_code)]

use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

const CONFIG: &str = "{\"version\":\"COCO_DEMO_FROST_PARTICIPANT_3OF4_V1\",\"run_id\":\"offline-diagnostic-run\",\"committee_keyset_id\":\"offline-diagnostic-keyset\",\"committee_keyset_version\":\"1\",\"participant_id\":1,\"max_signers\":4,\"min_signers\":3,\"roster\":[1,2,3,4]}\n";
const TRANSPORT: &str = "{\"version\":\"COCO_DEMO_FROST_PARTICIPANT_3OF4_V1\",\"run_id\":\"offline-diagnostic-run\",\"committee_keyset_id\":\"offline-diagnostic-keyset\",\"committee_keyset_version\":\"1\",\"participant_id\":1,\"identity_signing_key_hex\":\"0000000000000000000000000000000000000000000000000000000000000001\",\"identity_verifying_keys\":[{\"participant_id\":1,\"verifying_key_hex\":\"79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798\"},{\"participant_id\":2,\"verifying_key_hex\":\"c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5\"},{\"participant_id\":3,\"verifying_key_hex\":\"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9\"},{\"participant_id\":4,\"verifying_key_hex\":\"e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13\"}],\"round2_pairwise_keys\":[{\"peer_id\":2,\"key_hex\":\"1212121212121212121212121212121212121212121212121212121212121212\"},{\"peer_id\":3,\"key_hex\":\"1313131313131313131313131313131313131313131313131313131313131313\"},{\"peer_id\":4,\"key_hex\":\"1414141414141414141414141414141414141414141414141414141414141414\"}]}\n";

#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
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
    digest: [u8; 32],
}

fn snapshot(path: &Path) -> Snapshot {
    let metadata = fs::metadata(path).unwrap();
    Snapshot {
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
        digest: Sha256::digest(fs::read(path).unwrap()).into(),
    }
}

fn fixture() -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "friday-dkg-validator-cli-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed),
    ));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let config = root.join("participant.config.json");
    let transport = root.join("transport-secrets.json");
    let invalid = root.join("transport-invalid.json");
    fs::write(&config, CONFIG).unwrap();
    fs::write(&transport, TRANSPORT).unwrap();
    fs::write(&invalid, "{\"private_secret_sentinel\":\"MUST_NOT_ESCAPE\"}\n").unwrap();
    for path in [&config, &transport, &invalid] {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    (root, config, transport, invalid)
}

#[test]
fn standalone_validator_is_read_only_and_has_a_fixed_output_contract() {
    let (root, config, transport, invalid) = fixture();
    let entries_before: BTreeSet<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    let config_before = snapshot(&config);
    let transport_before = snapshot(&transport);
    let binary = env!("CARGO_BIN_EXE_coco-demo-frost-dkg-input-validator");

    let success = Command::new(binary)
        .arg(&config)
        .arg(&transport)
        .output()
        .unwrap();
    assert!(success.status.success());
    assert_eq!(success.stdout, b"DKG_INPUT_VALIDATION_OK\n");
    assert!(success.stderr.is_empty());
    assert_eq!(snapshot(&config), config_before);
    assert_eq!(snapshot(&transport), transport_before);
    let entries_after: BTreeSet<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries_after, entries_before);

    let rejected = Command::new(binary)
        .arg(&config)
        .arg(&invalid)
        .output()
        .unwrap();
    assert_eq!(rejected.status.code(), Some(1));
    assert!(rejected.stdout.is_empty());
    assert_eq!(
        rejected.stderr,
        b"DKG_INPUT_VALIDATION_FAILED:TRANSPORT_READ\n"
    );
    assert!(!rejected.stderr.windows(15).any(|value| value == b"MUST_NOT_ESCAPE"));

    let linked = root.join("transport-hardlink.json");
    fs::hard_link(&transport, &linked).unwrap();
    let linked_rejected = Command::new(binary)
        .arg(&config)
        .arg(&transport)
        .output()
        .unwrap();
    assert_eq!(linked_rejected.status.code(), Some(1));
    assert!(linked_rejected.stdout.is_empty());
    assert_eq!(
        linked_rejected.stderr,
        b"DKG_INPUT_VALIDATION_FAILED:TRANSPORT_READ\n"
    );
    fs::remove_file(linked).unwrap();

    let bad_arguments = Command::new(binary).output().unwrap();
    assert_eq!(bad_arguments.status.code(), Some(1));
    assert!(bad_arguments.stdout.is_empty());
    assert_eq!(
        bad_arguments.stderr,
        b"DKG_INPUT_VALIDATION_FAILED:ARGUMENTS\n"
    );
    fs::remove_dir_all(root).unwrap();
}
