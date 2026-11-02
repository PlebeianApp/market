package poc

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	fridayFixtureDeployment  = "friday-demo-r12"
	fridayFixtureChain       = "plebeian-friday-r12"
	fridayFixtureTime        = "2026-10-23T10:00:00Z"
	fridayFixtureCommittee   = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	fridayGoldenRoster       = "e9dae7d8d5c20b0227479ff66ea7eac316b160b4e357a94cb42d05e0c5d8e228"
	fridayGoldenManifest     = "9a896a773506b5fcd39983b1a557e55eac57dc71394c8c2314e57465ace347c9"
	fridayGoldenShares       = "cc4e073e18786b7f21b31603fd1de1c4de73e4419f197d3818a54452294ca1f0"
	fridayGoldenSummary      = "5e13f9fa0e09d1dda67a8476029e1e4f91ee574c1dfcfae579419dcfce7a0f5c"
	fridayGoldenSignerRoster = "ee3d9e3d8c5b8e4425c2556c25a3a19e0b099a276280cbacd55faeddb6a14b1d"
)

var fridayGoldenAttestations = [...]string{
	"07ac124c108503899f0254f5e71fdf658d9c30aac58b1aae72aa8123fea62f86",
	"e141cdde95bf48a9e69ca8f0f23730bf0bb55fbf72385c4fd211f59c7bc2a251",
	"a19c50e37f71c498e9115913b00cff0cbebc39ee20153d5406aa2de83001acd8",
	"34a83dd2975109f62d7394edd0460538511db2d28839ae845edfeb43a768100d",
}

func literalFridayPrivate(slot int) cmted25519.PrivKey {
	return cmted25519.GenPrivKeyFromSecret([]byte{0x20, byte(slot)})
}

func literalFridayKeys(slot int) fridayCometKeySource {
	return func() (cmtcrypto.PrivKey, cmtcrypto.PrivKey, error) {
		return cmted25519.GenPrivKeyFromSecret([]byte{0x10, byte(slot)}), literalFridayPrivate(slot), nil
	}
}

func literalCompressedKey(seed byte) string {
	private, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{seed}, 32))
	return hex.EncodeToString(private.PubKey().SerializeCompressed())
}

type fridayAuthorityFixture struct {
	anchorPath     string
	frostPath      string
	bootstrapPath  string
	ownerPublic    string
	ownerPrivate   ed25519.PrivateKey
	manifestDigest string
	frost          FridayAuthenticatedDKGResultV2
}

func literalSchnorrPrivate(seed byte) *btcec.PrivateKey {
	private, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{seed}, 32))
	return private
}

func literalSchnorrIdentity(seed byte) string {
	return hex.EncodeToString(schnorr.SerializePubKey(literalSchnorrPrivate(seed).PubKey()))
}

func literalSchnorrSignature(t *testing.T, private *btcec.PrivateKey, digestHex string, auxSeed byte) string {
	t.Helper()
	digest, err := hex.DecodeString(digestHex)
	if err != nil {
		t.Fatal(err)
	}
	var aux [32]byte
	copy(aux[:], bytes.Repeat([]byte{auxSeed}, len(aux)))
	signature, err := schnorr.Sign(private, digest, schnorr.CustomNonce(aux))
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(signature.Serialize())
}

func literalFridayAuthority(t *testing.T, parent string) fridayAuthorityFixture {
	t.Helper()
	manifest := FridayDKGManifestV1{Schema: fridayDKGManifestV1Schema, ValueProfile: "FAKE_MONEY_ONLY",
		DeploymentID: fridayFixtureDeployment, ApplicationRunID: "friday-application-run",
		DKGRunID: "friday-dkg-run", CommitteeKeysetID: "friday-committee", CommitteeKeysetVersion: "1",
		Roster: []int{1, 2, 3, 4}, CoordinatorParticipantID: 1, CoordinatorIdentity: literalSchnorrIdentity(90)}
	npubCharacters := []byte{'p', 'q', 'r', 's'}
	for slot := 1; slot <= 4; slot++ {
		fipsULA := "fd42::" + strconv.Itoa(slot)
		manifest.Participants = append(manifest.Participants, FridayDKGManifestParticipantV1{
			ParticipantID: slot, HostID: "linode-10000" + strconv.Itoa(slot),
			UnderlayIPv4: "10.0.0." + strconv.Itoa(slot), FIPSNpub: "npub1" + strings.Repeat(string(npubCharacters[slot-1]), 58),
			FIPSULA: fipsULA, DKGIdentity: literalSchnorrIdentity(byte(10 + slot)),
			SignerIdentity:          literalSchnorrIdentity(byte(20 + slot)),
			KEXPublicKey:            hex.EncodeToString(bytes.Repeat([]byte{byte(30 + slot)}, 32)),
			SignerEndpoint:          "http://[" + fipsULA + "]:39101/v1/frost",
			ParticipantBinarySHA256: hex.EncodeToString(bytes.Repeat([]byte{byte(40 + slot)}, 32)),
			InspectorBinarySHA256:   hex.EncodeToString(bytes.Repeat([]byte{byte(50 + slot)}, 32)),
			ConfigPath:              fridayDKGRoot + "/participant.config.json", StateDirectory: fridayDKGRoot + "/state",
		})
	}
	var err error
	manifest.RosterDigest, err = fridayDKGRosterDigest(manifest.Participants)
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest, err := validateFridayDKGManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	frost := FridayAuthenticatedDKGResultV2{Schema: fridayAuthenticatedDKGResultV2Schema, Manifest: manifest,
		ManifestDigest: manifestDigest, RosterDigest: manifest.RosterDigest,
		Round1TranscriptDigest: strings.Repeat("6", 64), RunID: manifest.ApplicationRunID,
		DKGRunID: manifest.DKGRunID, CommitteeKeysetID: manifest.CommitteeKeysetID,
		CommitteeKeysetVersion: manifest.CommitteeKeysetVersion,
		PublicKeyPackagePath:   filepath.Join(fridayDKGRoot, "exchange", manifest.DKGRunID, "participant-1.public.json"),
		PublicKeyPackageHex:    hex.EncodeToString([]byte("literal authenticated public package")),
		CommitteePublicKey:     fridayFixtureCommittee, CoordinatorIdentity: manifest.CoordinatorIdentity}
	packageBytes, _ := hex.DecodeString(frost.PublicKeyPackageHex)
	frost.PublicKeyPackageSHA256 = hashBytes(packageBytes)
	frost.InspectionPublicKeyPackageSHA256 = frost.PublicKeyPackageSHA256
	shares := make([]fridayDKGVerifyingShare, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		participant := manifest.Participants[slot-1]
		enrollmentDigest, digestErr := fridayDKGEnrollmentDigest(manifest, manifestDigest, slot)
		if digestErr != nil {
			t.Fatal(digestErr)
		}
		frost.Enrollments = append(frost.Enrollments, FridayDKGEnrollmentV1{Schema: fridayDKGEnrollmentV1Schema,
			ManifestDigest: manifestDigest, RosterDigest: manifest.RosterDigest, ParticipantID: slot,
			DKGIdentity: participant.DKGIdentity,
			Signature:   literalSchnorrSignature(t, literalSchnorrPrivate(byte(10+slot)), enrollmentDigest, byte(60+slot))})
		share := fridayDKGVerifyingShare{ParticipantID: slot, VerifyingShareHex: literalCompressedKey(byte(70 + slot))}
		shares = append(shares, share)
		frost.Participants = append(frost.Participants, FridayAuthenticatedDKGParticipantV2{
			FridayDKGManifestParticipantV1: participant, VerifyingShare: share.VerifyingShareHex})
	}
	frost.PublicSummaryDigest, err = fridayDKGPublicSummaryDigest(frost, manifestDigest, shares)
	if err != nil {
		t.Fatal(err)
	}
	frost.SignerRosterDigest, err = fridayDKGSignerRosterDigest(frost, shares)
	if err != nil {
		t.Fatal(err)
	}
	verifyingSharesDigest, err := fridayDKGVerifyingSharesDigest(shares)
	if err != nil {
		t.Fatal(err)
	}
	for slot := 1; slot <= 4; slot++ {
		participant := manifest.Participants[slot-1]
		attestation := FridayDKGFinalAttestationV2{Schema: fridayDKGFinalAttestationV2Schema,
			ManifestDigest: manifestDigest, RosterDigest: manifest.RosterDigest,
			Round1TranscriptDigest: frost.Round1TranscriptDigest, ParticipantID: slot,
			DKGIdentity: participant.DKGIdentity, SignerIdentity: participant.SignerIdentity,
			SignerEndpoint: participant.SignerEndpoint, ParticipantBinarySHA256: participant.ParticipantBinarySHA256,
			InspectorBinarySHA256:   participant.InspectorBinarySHA256,
			PackageBytesSHA256:      frost.PublicKeyPackageSHA256,
			InspectionPackageSHA256: frost.InspectionPublicKeyPackageSHA256,
			CommitteePublicKey:      frost.CommitteePublicKey, VerifyingSharesDigest: verifyingSharesDigest,
			PublicSummaryDigest: frost.PublicSummaryDigest}
		attestationDigest, digestErr := fridayDKGFinalAttestationDigest(attestation)
		if digestErr != nil {
			t.Fatal(digestErr)
		}
		attestation.Signature = literalSchnorrSignature(t, literalSchnorrPrivate(byte(10+slot)), attestationDigest, byte(80+slot))
		frost.FinalAttestations = append(frost.FinalAttestations, attestation)
	}
	if err := verifyFridayAuthenticatedDKGResultV2(manifestDigest, frost); err != nil {
		t.Fatal(err)
	}
	frostRaw, err := marshalJSON(frost, false)
	if err != nil {
		t.Fatal(err)
	}
	frostPath := filepath.Join(parent, "frost-final-public.json")
	if err := os.WriteFile(frostPath, frostRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	bootstrap := FundingAbortBootstrapV1{Schema: "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1",
		ActiveKeysetID: "active-sat-keyset", CommitteeKeysetID: frost.CommitteeKeysetID,
		CommitteeKeysetVersion: frost.CommitteeKeysetVersion, DKGRunID: frost.DKGRunID,
		PublicKeyPackageSHA256: frost.PublicKeyPackageSHA256, SignerRosterDigest: frost.SignerRosterDigest}
	bootstrapRaw, err := marshalJSON(bootstrap, false)
	if err != nil {
		t.Fatal(err)
	}
	bootstrapPath := filepath.Join(parent, "funding-abort-bootstrap.json")
	if err := os.WriteFile(bootstrapPath, bootstrapRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	ownerPrivate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x44}, ed25519.SeedSize))
	ownerPublic := hex.EncodeToString(ownerPrivate.Public().(ed25519.PublicKey))
	anchor := FridayCometDeploymentAnchorV1{Schema: fridayCometDeploymentAnchorSchema,
		DeploymentID: fridayFixtureDeployment, ChainID: fridayFixtureChain,
		ApplicationRunID: frost.RunID, ExpectedManifestDigest: manifestDigest,
		GenesisTime: fridayFixtureTime, ActiveKeysetID: bootstrap.ActiveKeysetID,
		FROSTFinalPackageSHA256: hashBytes(frostRaw), FundingAbortBootstrapSHA256: hashBytes(bootstrapRaw),
		OwnerApprovalPublicKey: ownerPublic}
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
	anchorPath := filepath.Join(parent, "deployment-anchor.json")
	if err := os.WriteFile(anchorPath, anchorRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	return fridayAuthorityFixture{anchorPath: anchorPath, frostPath: frostPath,
		bootstrapPath: bootstrapPath, ownerPublic: ownerPublic, ownerPrivate: ownerPrivate,
		manifestDigest: manifestDigest, frost: frost}
}

func literalFridayValidator(t *testing.T, parent string, authority fridayAuthorityFixture, slot int) (string, FridayCometValidatorPublicV1) {
	t.Helper()
	root := filepath.Join(parent, "host-"+strconv.Itoa(slot))
	value, err := initFridayCometValidator(root, FridayCometValidatorInit{
		DeploymentAnchorPath: authority.anchorPath, OwnerApprovalPublicKey: authority.ownerPublic, Slot: slot,
	}, literalFridayKeys(slot))
	if err != nil {
		t.Fatal(err)
	}
	return root, value
}

func literalFridayRoster(t *testing.T, parent string, authority fridayAuthorityFixture) ([]string, []string) {
	t.Helper()
	roots, paths := make([]string, 0, 4), make([]string, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		root, _ := literalFridayValidator(t, parent, authority, slot)
		roots = append(roots, root)
		paths = append(paths, filepath.Join(root, "validator-public.json"))
	}
	return roots, paths
}

func literalFridayAssembly(authority fridayAuthorityFixture) FridayCometGenesisAssembly {
	return FridayCometGenesisAssembly{DeploymentAnchorPath: authority.anchorPath,
		FROSTFinalPackagePath: authority.frostPath, FundingAbortBootstrapPath: authority.bootstrapPath,
		OwnerApprovalPublicKey: authority.ownerPublic, MintURL: "http://127.0.0.1:8180/test-mint",
		CashuMintURL: "https://172.105.95.57", Policy: DefaultPolicy()}
}

func writeFridayFROSTAndResignAnchor(t *testing.T, authority fridayAuthorityFixture, frost FridayAuthenticatedDKGResultV2) {
	t.Helper()
	frostRaw, err := marshalJSON(frost, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(authority.frostPath, frostRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	var anchor FridayCometDeploymentAnchorV1
	if err := readStrictJSON(authority.anchorPath, &anchor); err != nil {
		t.Fatal(err)
	}
	anchor.FROSTFinalPackageSHA256 = hashBytes(frostRaw)
	message, err := fridayAnchorSigningBytes(anchor)
	if err != nil {
		t.Fatal(err)
	}
	anchor.OwnerApprovalSignature = hex.EncodeToString(ed25519.Sign(authority.ownerPrivate, message))
	anchorRaw, err := marshalJSON(anchor, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(authority.anchorPath, anchorRaw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestFridayCometLocalValidatorInitUsesOwnerRosterAndSignedLiteralDescriptor(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	root, descriptor := literalFridayValidator(t, parent, authority, 2)
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if names := []string{entries[0].Name(), entries[1].Name()}; !reflect.DeepEqual(names, []string{"validator-2", "validator-public.json"}) {
		t.Fatalf("local root entries = %v", names)
	}
	if descriptor.HostID != "linode-100002" || descriptor.Validator.P2PExternal != "tcp://[fd42::2]:27656" ||
		descriptor.DescriptorDigest == "" || descriptor.ValidatorSignature == "" {
		t.Fatalf("signed public descriptor = %+v", descriptor)
	}
	if err := exactFridayValidatorPublic(descriptor); err != nil {
		t.Fatal(err)
	}
	tampered := descriptor
	tampered.HostID = "linode-999999"
	if err := exactFridayValidatorPublic(tampered); err == nil {
		t.Fatal("validator descriptor signature accepted a changed host")
	}
	privatePath := filepath.Join(root, "validator-2", "config", "priv_validator_key.json")
	before, err := os.ReadFile(privatePath)
	if err != nil {
		t.Fatal(err)
	}
	publicRaw, err := os.ReadFile(filepath.Join(root, "validator-public.json"))
	if err != nil || bytes.Contains(publicRaw, []byte("priv_key")) || bytes.Contains(publicRaw, []byte("signbytes")) {
		t.Fatalf("public descriptor leaked private material: %v", err)
	}
	if _, err := initFridayCometValidator(root, FridayCometValidatorInit{
		DeploymentAnchorPath: authority.anchorPath, OwnerApprovalPublicKey: authority.ownerPublic, Slot: 2,
	}, literalFridayKeys(9)); err == nil {
		t.Fatal("second local validator initialization overwrote the create-once root")
	}
	after, err := os.ReadFile(privatePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("private key changed after rejected retry: err=%v", err)
	}
}

func TestFridayCometPublicAssemblyIsDeterministicAndPinsAuthenticatedDKGAtGenesis(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	firstRoot, secondRoot := filepath.Join(parent, "bundle-a"), filepath.Join(parent, "bundle-b")
	first, err := AssembleFridayCometGenesis(firstRoot, paths, literalFridayAssembly(authority))
	if err != nil {
		t.Fatal(err)
	}
	second, err := AssembleFridayCometGenesis(secondRoot, []string{paths[3], paths[1], paths[0], paths[2]}, literalFridayAssembly(authority))
	if err != nil {
		t.Fatal(err)
	}
	if first != second || first.BundleDigest == "" || first.GenesisFileSHA256 == first.GenesisSHA256 {
		t.Fatalf("deterministic receipt or non-circular identity differs:\n%+v\n%+v", first, second)
	}
	for _, name := range []string{"genesis.json", "network.json", "network-facts.json", "validator-roster.json",
		"deployment-anchor.json", "frost-final-public.json", "funding-abort-bootstrap.json", "comet-genesis-bundle.json"} {
		left, leftErr := os.ReadFile(filepath.Join(firstRoot, name))
		right, rightErr := os.ReadFile(filepath.Join(secondRoot, name))
		if leftErr != nil || rightErr != nil || !bytes.Equal(left, right) {
			t.Fatalf("deterministic public file %s differs: left=%v right=%v", name, leftErr, rightErr)
		}
	}
	manifest, err := LoadNetworkManifest(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := LoadNetworkFacts(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	genesis, err := cmttypes.GenesisDocFromFile(filepath.Join(firstRoot, "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ApplicationAuthority != ApplicationAuthorityFrostCashu || manifest.FundingAbortPins == nil ||
		*manifest.FundingAbortPins != first.FundingAbortPins || manifest.FundingAbortPins.DKGRunID != "friday-dkg-run" ||
		manifest.FundingAbortPins.PublicKeyPackageSHA256 != authority.frost.PublicKeyPackageSHA256 ||
		facts.GenesisSHA256 != first.GenesisSHA256 || genesis.ChainID != fridayFixtureChain {
		t.Fatalf("authenticated genesis contract differs: manifest=%+v facts=%+v", manifest, facts)
	}
	derived, err := DeriveFrostCashuLegacyNotePublicPin(first.FundingAbortPins)
	if err != nil || manifest.MintPublicKey != hex.EncodeToString(derived) {
		t.Fatalf("derived disabled legacy-note pin differs: %v", err)
	}
	if _, _, _, err := validateFridayCometBundle(firstRoot); err != nil {
		t.Fatal(err)
	}
}

func TestFridayCometRejectsOwnerSignedResultWithInvalidDKGAttestation(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	tampered := authority.frost
	tampered.FinalAttestations = append([]FridayDKGFinalAttestationV2(nil), authority.frost.FinalAttestations...)
	tampered.FinalAttestations[0].Signature = strings.Repeat("0", 128)
	writeFridayFROSTAndResignAnchor(t, authority, tampered)
	_, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "rejected-owner-signed-dkg")
	if _, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority)); err == nil ||
		!strings.Contains(err.Error(), "authenticated V2") {
		t.Fatalf("owner-signed invalid DKG result error = %v", err)
	}
	if _, err := os.Stat(bundle); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid authenticated DKG result created bundle root: %v", err)
	}
}

func TestFridayAuthenticatedDKGV2RejectsInspectionAndLegacyResult(t *testing.T) {
	authority := literalFridayAuthority(t, t.TempDir())
	mismatchedInspection := authority.frost
	mismatchedInspection.InspectionPublicKeyPackageSHA256 = strings.Repeat("e", 64)
	if err := verifyFridayAuthenticatedDKGResultV2(authority.manifestDigest, mismatchedInspection); err == nil ||
		!strings.Contains(err.Error(), "public binding") {
		t.Fatalf("independently mismatched package inspection error = %v", err)
	}
	legacy := authority.frost
	legacy.Schema = "PLEBEIAN_FRIDAY_FIPS_DKG_RESULT_V1"
	if err := verifyFridayAuthenticatedDKGResultV2(authority.manifestDigest, legacy); err == nil ||
		!strings.Contains(err.Error(), "schema") {
		t.Fatalf("legacy Friday DKG result error = %v", err)
	}
}

// The fixture was emitted and accepted by the TypeScript V2 implementation at
// SHA-256 26f525e86cefaa14efa7beb61f97a514cbde929986927f316b74287dac0b7b9b
// using only fixed test keys. Its imported V1 implementation had SHA-256
// 725d4d814ee16503fcb20de3cc4fc225b9c98dc3f6e63b607039c9a24c8de236.
func TestFridayAuthenticatedDKGV2TypeScriptGoldenInterop(t *testing.T) {
	raw, err := os.ReadFile("testdata/friday-authenticated-dkg-v2-typescript-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	decode := func(input []byte) FridayAuthenticatedDKGResultV2 {
		t.Helper()
		decoder := json.NewDecoder(bytes.NewReader(input))
		decoder.DisallowUnknownFields()
		var result FridayAuthenticatedDKGResultV2
		if err := decoder.Decode(&result); err != nil {
			t.Fatal(err)
		}
		if err := requireEOF(decoder); err != nil {
			t.Fatal(err)
		}
		return result
	}
	result := decode(raw)
	rosterDigest, err := fridayDKGRosterDigest(result.Manifest.Participants)
	if err != nil {
		t.Fatal(err)
	}
	manifestDigest, err := validateFridayDKGManifest(result.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	shares := make([]fridayDKGVerifyingShare, 0, len(result.Participants))
	for _, participant := range result.Participants {
		shares = append(shares, fridayDKGVerifyingShare{ParticipantID: participant.ParticipantID,
			VerifyingShareHex: participant.VerifyingShare})
	}
	sharesDigest, err := fridayDKGVerifyingSharesDigest(shares)
	if err != nil {
		t.Fatal(err)
	}
	summaryDigest, err := fridayDKGPublicSummaryDigest(result, manifestDigest, shares)
	if err != nil {
		t.Fatal(err)
	}
	signerRosterDigest, err := fridayDKGSignerRosterDigest(result, shares)
	if err != nil {
		t.Fatal(err)
	}
	if rosterDigest != fridayGoldenRoster || manifestDigest != fridayGoldenManifest ||
		sharesDigest != fridayGoldenShares || summaryDigest != fridayGoldenSummary ||
		signerRosterDigest != fridayGoldenSignerRoster {
		t.Fatalf("cross-language digests differ: roster=%s manifest=%s shares=%s summary=%s signer=%s",
			rosterDigest, manifestDigest, sharesDigest, summaryDigest, signerRosterDigest)
	}
	for index, attestation := range result.FinalAttestations {
		digest, err := fridayDKGFinalAttestationDigest(attestation)
		if err != nil || digest != fridayGoldenAttestations[index] {
			t.Fatalf("cross-language attestation %d digest = %s, err=%v", index+1, digest, err)
		}
	}
	if err := verifyFridayAuthenticatedDKGResultV2(fridayGoldenManifest, result); err != nil {
		t.Fatalf("unmodified TypeScript V2 result was rejected: %v", err)
	}

	mutated := append([]byte(nil), raw...)
	signature := []byte(`"signature":"`)
	index := bytes.Index(mutated, signature)
	if index < 0 {
		t.Fatal("golden fixture has no signature to mutate")
	}
	index += len(signature)
	if mutated[index] == '0' {
		mutated[index] = '1'
	} else {
		mutated[index] = '0'
	}
	mutatedResult := decode(mutated)
	if err := verifyFridayAuthenticatedDKGResultV2(fridayGoldenManifest, mutatedResult); err == nil {
		t.Fatal("one-byte TypeScript fixture mutation was accepted")
	}
}

func TestFridayAuthenticatedDKGV2RejectsNoncanonicalULA(t *testing.T) {
	value := FridayDKGManifestParticipantV1{ParticipantID: 1, HostID: "linode-200001", UnderlayIPv4: "10.20.0.1",
		FIPSNpub: "npub1" + strings.Repeat("p", 58), FIPSULA: "fd42:0:0:0:0:0:0:1",
		DKGIdentity: strings.Repeat("1", 64), SignerIdentity: strings.Repeat("2", 64),
		KEXPublicKey: strings.Repeat("3", 64), SignerEndpoint: "http://[fd42:0:0:0:0:0:0:1]:39101/v1/frost",
		ParticipantBinarySHA256: strings.Repeat("4", 64), InspectorBinarySHA256: strings.Repeat("5", 64),
		ConfigPath: fridayDKGRoot + "/participant.config.json", StateDirectory: fridayDKGRoot + "/state"}
	if err := validateFridayDKGManifestParticipant(value, 1); err == nil {
		t.Fatal("expanded lowercase ULA alias was accepted instead of canonical RFC 5952 spelling")
	}
}

func TestFridayCometAssemblyRejectsSelfSignedDescriptorOutsideOwnerRoster(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	var changed FridayCometValidatorPublicV1
	if err := readStrictJSON(paths[3], &changed); err != nil {
		t.Fatal(err)
	}
	changed.HostID = "linode-999999"
	if err := signFridayDescriptor(&changed, literalFridayPrivate(4)); err != nil {
		t.Fatal(err)
	}
	raw, err := marshalJSON(changed, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths[3], raw, 0o644); err != nil {
		t.Fatal(err)
	}
	bundle := filepath.Join(parent, "rejected-bundle")
	if _, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority)); err == nil || !strings.Contains(err.Error(), "owner-approved") {
		t.Fatalf("outside-roster signed descriptor error = %v", err)
	}
	if _, err := os.Stat(bundle); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rejected assembly created output root: %v", err)
	}
}

func TestFridayCometBundleRejectsSelfConsistentWrongApplicationHash(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "bundle")
	receipt, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority))
	if err != nil {
		t.Fatal(err)
	}
	genesis, err := cmttypes.GenesisDocFromFile(filepath.Join(bundle, "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	genesis.AppHash[0] ^= 0xff
	genesisRaw, err := marshalJSON(genesis, true)
	if err != nil {
		t.Fatal(err)
	}
	receipt.GenesisFileSHA256 = hashBytes(genesisRaw)
	receipt.BundleDigest, err = fridayBundleDigest(receipt)
	if err != nil {
		t.Fatal(err)
	}
	receiptRaw, err := marshalJSON(receipt, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bundle, "genesis.json"), genesisRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bundle, "comet-genesis-bundle.json"), receiptRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := validateFridayCometBundle(bundle); err == nil || !strings.Contains(err.Error(), "application or consensus") {
		t.Fatalf("self-consistent wrong application hash error = %v", err)
	}
}

func TestFridayCometLaunchRequiresAllFourExactFinalAcknowledgements(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	roots, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "bundle")
	receipt, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := FinalizeFridayCometValidator(roots[1], bundle, 1); err == nil || !strings.Contains(err.Error(), "another slot") {
		t.Fatalf("wrong-slot finalization error = %v", err)
	}
	ackPaths := make([]string, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		ack, err := FinalizeFridayCometValidator(roots[slot-1], bundle, slot)
		if err != nil {
			t.Fatal(err)
		}
		if ack.Slot != slot || ack.BundleDigest != receipt.BundleDigest || ack.ValidatorSignature == "" {
			t.Fatalf("final acknowledgement %d = %+v", slot, ack)
		}
		ackPaths = append(ackPaths, filepath.Join(roots[slot-1], "validator-final-ack.json"))
	}
	if _, err := SealFridayCometLaunch(bundle, ackPaths[:3]); err == nil {
		t.Fatal("three acknowledgements authorized launch")
	}
	seal, err := SealFridayCometLaunch(bundle, []string{ackPaths[3], ackPaths[1], ackPaths[0], ackPaths[2]})
	if err != nil {
		t.Fatal(err)
	}
	if len(seal.Acknowledgements) != 4 || seal.BundleDigest != receipt.BundleDigest {
		t.Fatalf("launch seal = %+v", seal)
	}
	if err := RequireFridayCometLaunch(roots[1], 2); err == nil {
		t.Fatal("validator launched before installing the four-ack seal")
	}
	if _, err := InstallFridayCometLaunch(roots[1], bundle, 2); err != nil {
		t.Fatal(err)
	}
	if err := RequireFridayCometLaunch(roots[1], 2); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallFridayCometLaunch(roots[1], bundle, 2); err == nil {
		t.Fatal("launch seal installation overwrote an existing seal")
	}
}

func TestRunValidatorNodeEnforcesFridayLaunchSealBeforePrivateRuntime(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	roots, paths := literalFridayRoster(t, parent, authority)
	bundle := filepath.Join(parent, "bundle")
	if _, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority)); err != nil {
		t.Fatal(err)
	}
	ackPaths := make([]string, 0, 4)
	for slot := 1; slot <= 4; slot++ {
		if _, err := FinalizeFridayCometValidator(roots[slot-1], bundle, slot); err != nil {
			t.Fatal(err)
		}
		ackPaths = append(ackPaths, filepath.Join(roots[slot-1], "validator-final-ack.json"))
	}
	seal, err := SealFridayCometLaunch(bundle, ackPaths)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	assertRejected := func(name, root string, slot int, contains string) {
		t.Helper()
		err := RunValidatorNode(ctx, root, slot)
		if err == nil || !strings.Contains(err.Error(), contains) {
			t.Fatalf("%s error = %v, want %q", name, err, contains)
		}
	}

	// A direct caller must not get past the runtime boundary without a seal.
	assertRejected("missing seal", roots[0], 1, "comet-launch.json")

	// A Friday V4 manifest may not downgrade its authority string to bypass
	// the launch-seal gate and fall through to the legacy shared-seed path.
	manifestRaw, err := os.ReadFile(filepath.Join(roots[0], "network.json"))
	if err != nil {
		t.Fatal(err)
	}
	var downgraded map[string]any
	if err := json.Unmarshal(manifestRaw, &downgraded); err != nil {
		t.Fatal(err)
	}
	downgraded["application_authority"] = ApplicationAuthorityLegacy
	downgradedRaw, err := json.MarshalIndent(downgraded, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(roots[0], "network.json"), downgradedRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	assertRejected("authority downgrade", roots[0], 1, "requires frost_cashu_v4")
	if err := os.WriteFile(filepath.Join(roots[0], "network.json"), manifestRaw, 0o644); err != nil {
		t.Fatal(err)
	}

	sealRaw, err := marshalJSON(seal, false)
	if err != nil {
		t.Fatal(err)
	}
	var threeAck FridayCometLaunchSealV1
	if err := json.Unmarshal(sealRaw, &threeAck); err != nil {
		t.Fatal(err)
	}
	threeAck.Acknowledgements = threeAck.Acknowledgements[:3]
	threeRaw, err := marshalJSON(threeAck, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(roots[0], "comet-launch.json"), threeRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	assertRejected("three acknowledgements", roots[0], 1, "differs from the exact public bundle")

	// Install a valid seal, then prove a slot mismatch is rejected at the same
	// boundary rather than falling through to another validator's private key.
	if err := os.WriteFile(filepath.Join(roots[0], "comet-launch.json"), sealRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	assertRejected("wrong slot", roots[0], 2, "does not authorize this local validator slot")

	var tampered FridayCometLaunchSealV1
	if err := json.Unmarshal(sealRaw, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered.Acknowledgements[0].ValidatorSignature = strings.Repeat("0", ed25519.SignatureSize*2)
	tamperedRaw, err := marshalJSON(tampered, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(roots[0], "comet-launch.json"), tamperedRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	assertRejected("tampered acknowledgement", roots[0], 1, "signature is invalid")

	var mismatched FridayCometLaunchSealV1
	if err := json.Unmarshal(sealRaw, &mismatched); err != nil {
		t.Fatal(err)
	}
	mismatched.BundleDigest = strings.Repeat("f", 64)
	mismatchedRaw, err := marshalJSON(mismatched, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(roots[0], "comet-launch.json"), mismatchedRaw, 0o644); err != nil {
		t.Fatal(err)
	}
	assertRejected("mismatched bundle", roots[0], 1, "differs from the exact public bundle")
}

// A repinned manifest models a trusted assembler choosing a different policy;
// rejection must come from policy validation, not an incidental stale hash.
func TestFridayGenesisRejectsEveryNonFundingPolicyMutation(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	for i := 0; i < reflect.TypeOf(Policy{}).NumField(); i++ {
		field := reflect.TypeOf(Policy{}).Field(i)
		if field.Name == "FaucetAmount" || field.Name == "FaucetCap" {
			continue
		}
		t.Run(field.Name, func(t *testing.T) {
			assembly := literalFridayAssembly(authority)
			value := reflect.ValueOf(&assembly.Policy).Elem().Field(i)
			value.SetInt(value.Int() + 1)
			if err := assembly.Policy.Validate(); err != nil {
				t.Fatalf("mutation must be generically valid: %v", err)
			}
			root := filepath.Join(t.TempDir(), "rejected")
			if _, err := AssembleFridayCometGenesis(root, paths, assembly); err == nil || !strings.Contains(err.Error(), "non-funding policy") {
				t.Fatalf("assembly accepted %s: %v", field.Name, err)
			}
			if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("rejection wrote output: %v", err)
			}
			bundle := filepath.Join(t.TempDir(), "bundle")
			receipt, err := AssembleFridayCometGenesis(bundle, paths, literalFridayAssembly(authority))
			if err != nil {
				t.Fatal(err)
			}
			manifest, err := LoadNetworkManifest(bundle)
			if err != nil {
				t.Fatal(err)
			}
			manifest.Policy = assembly.Policy
			raw, err := marshalJSON(manifest, false)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(bundle, "network.json"), raw, 0o644); err != nil {
				t.Fatal(err)
			}
			receipt.NetworkManifestSHA256 = hashBytes(raw)
			receipt.BundleDigest, err = fridayBundleDigest(receipt)
			if err != nil {
				t.Fatal(err)
			}
			raw, err = marshalJSON(receipt, false)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(bundle, "comet-genesis-bundle.json"), raw, 0o644); err != nil {
				t.Fatal(err)
			}
			if _, _, _, err := validateFridayCometBundle(bundle); err == nil || !strings.Contains(err.Error(), "non-funding policy") {
				t.Fatalf("bundle load accepted %s or failed at wrong guard: %v", field.Name, err)
			}
		})
	}
}

func TestFridayGenesisFundingPolicyBoundaries(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, paths := literalFridayRoster(t, parent, authority)
	for _, pair := range [][2]int64{{1, 1}, {1, 50000}, {50000, 50000}, {0, 1}, {2, 1}, {1, 50001}, {50001, 50001}, {-1, 1}} {
		t.Run(strconv.FormatInt(pair[0], 10)+"_"+strconv.FormatInt(pair[1], 10), func(t *testing.T) {
			assembly := literalFridayAssembly(authority)
			assembly.Policy.FaucetAmount, assembly.Policy.FaucetCap = pair[0], pair[1]
			bundle := filepath.Join(t.TempDir(), "bundle")
			_, err := AssembleFridayCometGenesis(bundle, paths, assembly)
			valid := pair[0] >= 1 && pair[0] <= pair[1] && pair[1] <= 50000
			if valid {
				if err != nil {
					t.Fatal(err)
				}
				if _, manifest, _, err := validateFridayCometBundle(bundle); err != nil || manifest.Policy != assembly.Policy {
					t.Fatalf("funding pair did not roundtrip: %v", err)
				}
			} else {
				if err == nil {
					t.Fatal("invalid funding pair accepted")
				}
				if _, err := os.Stat(bundle); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("invalid pair wrote output: %v", err)
				}
			}
		})
	}
}
