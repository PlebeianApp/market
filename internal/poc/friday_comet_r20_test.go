package poc

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func literalFridayR20Authority(t *testing.T, parent string) (fridayAuthorityFixture, string) {
	t.Helper()
	binding := literalFridayR20Binding(t)
	frost := binding.Result
	frostRaw, err := marshalJSON(frost, false)
	if err != nil {
		t.Fatal(err)
	}
	frostPath := filepath.Join(parent, "r20-frost-final-public.json")
	if err := os.WriteFile(frostPath, frostRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	bootstrap := FundingAbortBootstrapV1{Schema: "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1",
		ActiveKeysetID: "active-sat-keyset-r20", CommitteeKeysetID: frost.CommitteeKeysetID,
		CommitteeKeysetVersion: frost.CommitteeKeysetVersion, DKGRunID: frost.DKGRunID,
		PublicKeyPackageSHA256: frost.PublicKeyPackageSHA256, SignerRosterDigest: frost.SignerRosterDigest}
	bootstrapRaw, err := marshalJSON(bootstrap, false)
	if err != nil {
		t.Fatal(err)
	}
	bootstrapPath := filepath.Join(parent, "r20-funding-abort-bootstrap.json")
	if err := os.WriteFile(bootstrapPath, bootstrapRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	bindingRaw, err := marshalJSON(binding, false)
	if err != nil {
		t.Fatal(err)
	}
	bindingPath := filepath.Join(parent, "r20-runtime-binding.json")
	if err := os.WriteFile(bindingPath, bindingRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	ownerPrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x45}, ed25519.SeedSize))
	ownerPublic := hex.EncodeToString(ownerPrivate.Public().(ed25519.PublicKey))
	anchor := FridayCometDeploymentAnchorV1{Schema: fridayCometDeploymentAnchorSchema,
		DeploymentID: fridayR20DeploymentID, ChainID: "plebeian-friday-r20",
		ApplicationRunID: fridayR20ApplicationRunID, ExpectedManifestDigest: binding.ManifestDigest,
		GenesisTime: fridayFixtureTime, ActiveKeysetID: bootstrap.ActiveKeysetID,
		FROSTFinalPackageSHA256: hashBytes(frostRaw), FundingAbortBootstrapSHA256: hashBytes(bootstrapRaw),
		R20RuntimeBindingDigest: binding.BindingDigest, R20PredecessorAbortDigest: binding.PredecessorAbortDigest,
		R20RuntimeBindingSHA256: hashBytes(bindingRaw), OwnerApprovalPublicKey: ownerPublic}
	for slot := 1; slot <= 4; slot++ {
		anchor.Roster = append(anchor.Roster, FridayCometRosterAnchorV1{Slot: slot,
			HostID: frost.Participants[slot-1].HostID, FIPSULA: frost.Participants[slot-1].FIPSULA,
			SignerIdentity: frost.Participants[slot-1].SignerIdentity})
	}
	message, err := fridayAnchorSigningBytes(anchor)
	if err != nil {
		t.Fatal(err)
	}
	anchor.OwnerApprovalSignature = hex.EncodeToString(ed25519.Sign(ownerPrivate, message))
	anchorRaw, err := marshalJSON(anchor, false)
	if err != nil {
		t.Fatal(err)
	}
	anchorPath := filepath.Join(parent, "r20-deployment-anchor.json")
	if err := os.WriteFile(anchorPath, anchorRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	return fridayAuthorityFixture{anchorPath: anchorPath, frostPath: frostPath,
		bootstrapPath: bootstrapPath, ownerPublic: ownerPublic, ownerPrivate: ownerPrivate,
		manifestDigest: binding.ManifestDigest, frost: frost}, bindingPath
}

func readyFridayR20LaunchWithPredecessorSeal(t *testing.T) (string, fridayR20PredecessorSealProfile, fridayR18PermissionSealV1) {
	t.Helper()
	parent := t.TempDir()
	authority, bindingPath := literalFridayR20Authority(t, parent)
	roots, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "r20-bundle")
	if _, err := AssembleFridayCometGenesis(bundle, paths, literalFridayR20Assembly(authority, bindingPath)); err != nil {
		t.Fatal(err)
	}
	ackPaths := make([]string, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		if _, err := FinalizeFridayCometValidator(roots[slot-1], bundle, slot); err != nil {
			t.Fatal(err)
		}
		ackPaths = append(ackPaths, filepath.Join(roots[slot-1], "validator-final-ack.json"))
	}
	if _, err := SealFridayCometLaunch(bundle, ackPaths); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallFridayCometLaunch(roots[0], bundle, 1); err != nil {
		t.Fatal(err)
	}
	var binding FridayR20RuntimeDKGBindingV1
	if err := readStrictJSON(filepath.Join(roots[0], "r20-runtime-binding.json"), &binding); err != nil {
		t.Fatal(err)
	}
	sealedParent := filepath.Join(parent, "sealed-frost")
	sealedRoot := filepath.Join(sealedParent, "keyset-v1")
	if err := os.Mkdir(sealedParent, 0o711); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(sealedRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(sealedParent, 0o711); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(sealedRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	uid, gid := uint32(os.Getuid()), uint32(os.Getgid())
	sealPath := filepath.Join(parent, "r18-abort-seal.json")
	profile := fridayR20PredecessorSealProfile{SealPath: sealPath, SealedRoot: sealedRoot, SealedParent: sealedParent,
		SealUID: uid, SealGID: gid, SealedUID: uid, SealedGID: gid, PriorUID: 997, PriorGID: 986,
		SealMode: 0o444, SealedMode: 0o700, SealedParentMode: 0o711}
	seal := fridayR18PermissionSealV1{Schema: fridayR18PermissionSealSchema, ParticipantID: 1,
		AbortDigest: binding.PredecessorAbortDigest, PredecessorManifestDigest: binding.PredecessorManifestDigest,
		AcknowledgementsDigest: binding.AbortAcknowledgementsDigest, SealedRoot: sealedRoot, SealedParent: sealedParent,
		PriorOwnerUID: 997, PriorOwnerGID: 986, SealedOwnerUID: int(uid), SealedOwnerGID: int(gid),
		SealedMode: "0700", SealedParentMode: "0711", Status: "R18_PRIVATE_ROOT_SEALED_NO_REPLAY"}
	return roots[0], profile, seal
}

func writeFridayR18PermissionSealFixture(t *testing.T, profile fridayR20PredecessorSealProfile,
	seal fridayR18PermissionSealV1) {
	t.Helper()
	raw, err := marshalJSON(seal, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(profile.SealPath, raw, profile.SealMode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(profile.SealPath, profile.SealMode); err != nil {
		t.Fatal(err)
	}
}

func TestFridayR20PredecessorRevocationGateAcceptsExactLocalSeal(t *testing.T) {
	root, profile, seal := readyFridayR20LaunchWithPredecessorSeal(t)
	writeFridayR18PermissionSealFixture(t, profile, seal)
	if err := requireFridayR20PredecessorRevocation(root, 1, profile); err != nil {
		t.Fatalf("exact local predecessor revocation rejected: %v", err)
	}
}

func TestFridaySealedDirectoryMetadataUsesSearchOnlyDescriptorAndRejectsSymlink(t *testing.T) {
	base := t.TempDir()
	parent := filepath.Join(base, "frost")
	root := filepath.Join(parent, "keyset-v1")
	if err := os.Mkdir(parent, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0o711); err != nil {
		t.Fatal(err)
	}
	uid, gid := uint32(os.Getuid()), uint32(os.Getgid())
	if err := verifyFridaySealedDirectory(parent, uid, gid, 0o711); err != nil {
		t.Fatalf("search-only parent rejected: %v", err)
	}
	if err := verifyFridaySealedDirectory(root, uid, gid, 0o700); err != nil {
		t.Fatalf("sealed root rejected: %v", err)
	}
	linked := filepath.Join(base, "linked-root")
	if err := os.Symlink(root, linked); err != nil {
		t.Fatal(err)
	}
	if err := verifyFridaySealedDirectory(linked, uid, gid, 0o700); err == nil {
		t.Fatal("symlinked sealed root accepted")
	}
}

func TestRunValidatorNodeR20PredecessorRevocationGateRejectsBeforePrivateKeyAccess(t *testing.T) {
	tests := []struct {
		name string
		edit func(*testing.T, string, fridayR20PredecessorSealProfile, *fridayR18PermissionSealV1)
		want string
	}{
		{"missing-seal", func(t *testing.T, _ string, _ fridayR20PredecessorSealProfile, _ *fridayR18PermissionSealV1) {}, "permission seal"},
		{"tampered-seal", func(_ *testing.T, _ string, _ fridayR20PredecessorSealProfile, seal *fridayR18PermissionSealV1) {
			seal.AbortDigest = strings.Repeat("f", 64)
		}, "differs"},
		{"seal-root-mismatch", func(_ *testing.T, _ string, _ fridayR20PredecessorSealProfile, seal *fridayR18PermissionSealV1) {
			seal.SealedRoot += "-other"
		}, "differs"},
		{"wrong-slot", func(_ *testing.T, _ string, _ fridayR20PredecessorSealProfile, seal *fridayR18PermissionSealV1) {
			seal.ParticipantID = 2
		}, "differs"},
		{"mutable-root", func(t *testing.T, _ string, profile fridayR20PredecessorSealProfile, _ *fridayR18PermissionSealV1) {
			if err := os.Chmod(profile.SealedRoot, 0o770); err != nil {
				t.Fatal(err)
			}
		}, "metadata differs"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root, profile, seal := readyFridayR20LaunchWithPredecessorSeal(t)
			test.edit(t, root, profile, &seal)
			if test.name != "missing-seal" {
				writeFridayR18PermissionSealFixture(t, profile, seal)
			}
			// If the revocation gate ever falls through, this missing private key
			// produces a different error. The expected seal error therefore proves
			// the direct-call boundary executes before private runtime access.
			if err := os.Remove(filepath.Join(root, "validator-1", "config", "priv_validator_key.json")); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			err := runValidatorNode(ctx, root, 1, profile)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("R20 predecessor gate error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestRunValidatorNodeR20PredecessorRevocationGateRejectsWrongDeploymentAndRunBeforePrivateKeyAccess(t *testing.T) {
	for _, test := range []struct{ field, value string }{
		{"deployment_id", "friday-demo-20261023-r19"},
		{"application_run_id", "friday-demo-20261023-r19-run1"},
	} {
		t.Run(test.field, func(t *testing.T) {
			root, profile, seal := readyFridayR20LaunchWithPredecessorSeal(t)
			writeFridayR18PermissionSealFixture(t, profile, seal)
			path := filepath.Join(root, "network.json")
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var manifest map[string]any
			if err := json.Unmarshal(raw, &manifest); err != nil {
				t.Fatal(err)
			}
			manifest[test.field] = test.value
			changed, err := json.MarshalIndent(manifest, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, append(changed, '\n'), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Remove(filepath.Join(root, "validator-1", "config", "priv_validator_key.json")); err != nil {
				t.Fatal(err)
			}
			err = runValidatorNode(context.Background(), root, 1, profile)
			if err == nil || strings.Contains(err.Error(), "private key") {
				t.Fatalf("wrong R20 deployment/run reached private runtime: %v", err)
			}
		})
	}
}

func literalFridayR20Assembly(authority fridayAuthorityFixture, bindingPath string) FridayCometGenesisAssembly {
	input := literalFridayAssembly(authority)
	input.R20RuntimeBindingPath = bindingPath
	return input
}

func TestFridayR20CometBundleBindsReviewedFundingPolicyWithoutARebuild(t *testing.T) {
	parent := t.TempDir()
	authority, bindingPath := literalFridayR20Authority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	input := literalFridayR20Assembly(authority, bindingPath)
	input.Policy.FaucetAmount, input.Policy.FaucetCap = 25_000, 50_000
	bundle := filepath.Join(parent, "funding-policy-bundle")
	if _, err := AssembleFridayCometGenesis(bundle, paths, input); err != nil {
		t.Fatal(err)
	}
	manifest, err := LoadNetworkManifest(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Policy.FaucetAmount != 25_000 || manifest.Policy.FaucetCap != 50_000 {
		t.Fatalf("funding policy=%+v", manifest.Policy)
	}
	if _, _, _, err := validateFridayCometBundle(bundle); err != nil {
		t.Fatalf("validated custom policy: %v", err)
	}

	input.Policy.FaucetCap = 50_001
	if _, err := AssembleFridayCometGenesis(filepath.Join(parent, "too-large-policy"), paths, input); err == nil ||
		!strings.Contains(err.Error(), "exceeds the reviewed browser payment bound") {
		t.Fatalf("oversized funding policy error=%v", err)
	}
}

func TestFridayR20CometBundleAndLaunchGateBindOwnerApprovedRuntimeBeforePrivateRuntime(t *testing.T) {
	parent := t.TempDir()
	authority, bindingPath := literalFridayR20Authority(t, parent)
	roots, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "r20-bundle")
	receipt, err := AssembleFridayCometGenesis(bundle, paths, literalFridayR20Assembly(authority, bindingPath))
	if err != nil {
		t.Fatal(err)
	}
	if receipt.DeploymentID != fridayR20DeploymentID || receipt.R20RuntimeBindingDigest == "" ||
		receipt.R20PredecessorAbortDigest == "" || receipt.R20RuntimeBindingSHA256 == "" {
		t.Fatalf("R20 bundle receipt lost owner authority: %+v", receipt)
	}
	ackPaths := make([]string, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		if _, err := FinalizeFridayCometValidator(roots[slot-1], bundle, slot); err != nil {
			t.Fatal(err)
		}
		ackPaths = append(ackPaths, filepath.Join(roots[slot-1], "validator-final-ack.json"))
	}
	if _, err := SealFridayCometLaunch(bundle, ackPaths); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallFridayCometLaunch(roots[0], bundle, 1); err != nil {
		t.Fatal(err)
	}
	if err := RequireFridayCometLaunch(roots[0], 1); err != nil {
		t.Fatalf("valid owner-bound R20 launch rejected: %v", err)
	}

	// The authoritative runtime gate reads and validates this sidecar through
	// the owner-signed anchor and bundle before RunValidatorNode reaches any
	// private validator key. Removing it must therefore fail at the gate.
	if err := os.Remove(filepath.Join(roots[0], "r20-runtime-binding.json")); err != nil {
		t.Fatal(err)
	}
	if err := RequireFridayCometLaunch(roots[0], 1); err == nil || !strings.Contains(err.Error(), "runtime binding") {
		t.Fatalf("missing R20 runtime binding error = %v", err)
	}
}

func TestFridayR20CometAssemblyRejectsTamperedAndCrossRunRuntimeBindings(t *testing.T) {
	parent := t.TempDir()
	authority, bindingPath := literalFridayR20Authority(t, parent)
	var anchor FridayCometDeploymentAnchorV1
	if err := readStrictJSON(authority.anchorPath, &anchor); err != nil {
		t.Fatal(err)
	}
	var base FridayR20RuntimeDKGBindingV1
	if err := readStrictJSON(bindingPath, &base); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		edit func(*FridayR20RuntimeDKGBindingV1)
	}{
		{"wrong-run", func(value *FridayR20RuntimeDKGBindingV1) { value.DKGRunID = "friday-demo-20261023-r19-dkg1" }},
		{"wrong-predecessor", func(value *FridayR20RuntimeDKGBindingV1) { value.PredecessorAbortDigest = strings.Repeat("4", 64) }},
		{"wrong-keyset", func(value *FridayR20RuntimeDKGBindingV1) { value.CommitteeKeysetID = "friday-demo-frost-keyset-v1" }},
		{"tampered-result", func(value *FridayR20RuntimeDKGBindingV1) { value.Result.CommitteePublicKey = literalCompressedKey(97) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := base
			test.edit(&value)
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "binding.json")
			if err := os.WriteFile(path, raw, 0o644); err != nil {
				t.Fatal(err)
			}
			candidate := anchor
			candidate.R20RuntimeBindingSHA256 = hashBytes(raw)
			if _, _, err := loadFridayR20RuntimeBinding(path, candidate, authority.frost); err == nil {
				t.Fatal("cross-run R20 runtime binding was accepted")
			}
		})
	}
}
