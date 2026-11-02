package poc

// Synthetic public vectors only. No Rust DKG, listener, real mint or host key.
import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type separatedPublicFixture struct {
	Predecessor     FridayDKGManifestV1    `json:"predecessor"`
	Bootstrap       map[string]any         `json:"bootstrap"`
	BootstrapDigest string                 `json:"bootstrapDigest"`
	OwnerPublic     string                 `json:"ownerPublic"`
	Runtime         FridaySeparatedRuntime `json:"runtime"`
}

func separatedFixture(t *testing.T) separatedPublicFixture {
	t.Helper()
	result := literalFridayR20Result(t)
	raw, _ := json.Marshal(result.Manifest)
	var previous FridayDKGManifestV1
	_ = json.Unmarshal(raw, &previous)
	previous.DeploymentID = "synthetic-prior"
	previous.ApplicationRunID = "synthetic-prior-run"
	previous.DKGRunID = "synthetic-prior-dkg"
	previous.CommitteeKeysetID = "synthetic-prior-keyset"
	previous.CommitteeKeysetVersion = "1"
	fills := []string{"q", "p", "z", "r"}
	for index := range previous.Participants {
		p := &previous.Participants[index]
		p.FIPSNpub = "npub1" + strings.Repeat(fills[index], 58)
		p.FIPSULA = "fd00::" + string(rune('1'+index))
		p.SignerEndpoint = "http://[" + p.FIPSULA + "]:39101/v1/frost"
		p.ConfigPath = fridayDKGRoot + "/participant.config.json"
		p.StateDirectory = fridayDKGRoot + "/state"
		p.DKGIdentity = literalSchnorrIdentity(byte(100 + index))
		p.SignerIdentity = literalSchnorrIdentity(byte(110 + index))
		p.KEXPublicKey = strings.Repeat(hex.EncodeToString([]byte{byte(120 + index)}), 32)
	}
	previous.RosterDigest, _ = fridayDKGRosterDigestForRoot(previous.Participants, fridayDKGRoot)
	previousDigest, err := validateFridayDKGManifestForRoot(previous, fridayDKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	result.Manifest.DeploymentID = fridaySeparatedDeploymentID
	result.Manifest.ApplicationRunID = fridaySeparatedApplicationRunID
	result.Manifest.DKGRunID = fridaySeparatedDKGRunID
	result.Manifest.CommitteeKeysetID = fridaySeparatedKeysetID
	result.Manifest.CommitteeKeysetVersion = "3"
	result.Manifest.CoordinatorIdentity = literalSchnorrIdentity(91)
	hosts := []string{"linode-108175009", "linode-108236985", "linode-108237290", "linode-108237424"}
	ips := []string{"172.105.64.142", "172.105.95.57", "172.104.240.217", "172.104.253.247"}
	fresh := []string{"9", "x", "8", "g"}
	for index := range result.Manifest.Participants {
		p := &result.Manifest.Participants[index]
		p.HostID = hosts[index]
		p.UnderlayIPv4 = ips[index]
		p.FIPSNpub = "npub1" + strings.Repeat(fresh[index], 58)
		p.FIPSULA = "fd42::" + string(rune('1'+index))
		p.SignerEndpoint = "http://[" + p.FIPSULA + "]:39101/v1/frost"
		p.ConfigPath = fridaySeparatedDKGRoot + "/participant.config.json"
		p.StateDirectory = fridaySeparatedDKGRoot + "/state"
		// This deployment installs one reviewed participant/inspector release
		// on all four hosts; the owner bootstrap pins that common release.
		p.ParticipantBinarySHA256 = result.Manifest.Participants[0].ParticipantBinarySHA256
		p.InspectorBinarySHA256 = result.Manifest.Participants[0].InspectorBinarySHA256
	}
	result.Manifest.RosterDigest, _ = fridayDKGRosterDigestForRoot(result.Manifest.Participants, fridaySeparatedDKGRoot)
	result.ManifestDigest, err = validateFridayDKGManifestForRoot(result.Manifest, fridaySeparatedDKGRoot)
	if err != nil {
		t.Fatal(err)
	}
	result.RosterDigest = result.Manifest.RosterDigest
	result.RunID = fridaySeparatedApplicationRunID
	result.DKGRunID = fridaySeparatedDKGRunID
	result.CommitteeKeysetID = fridaySeparatedKeysetID
	result.CommitteeKeysetVersion = "3"
	result.CoordinatorIdentity = result.Manifest.CoordinatorIdentity
	result.PublicKeyPackagePath = filepath.Join(fridaySeparatedDKGRoot, "exchange", fridaySeparatedDKGRunID, "participant-1.public.json")
	result.Enrollments = nil
	var shares []fridayDKGVerifyingShare
	for index := range result.Participants {
		slot := index + 1
		p := result.Manifest.Participants[index]
		result.Participants[index].FridayDKGManifestParticipantV1 = p
		shares = append(shares, fridayDKGVerifyingShare{ParticipantID: slot, VerifyingShareHex: result.Participants[index].VerifyingShare})
		d, e := fridayDKGEnrollmentDigest(result.Manifest, result.ManifestDigest, slot)
		if e != nil {
			t.Fatal(e)
		}
		result.Enrollments = append(result.Enrollments, FridayDKGEnrollmentV1{Schema: fridayDKGEnrollmentV1Schema, ManifestDigest: result.ManifestDigest, RosterDigest: result.RosterDigest, ParticipantID: slot, DKGIdentity: p.DKGIdentity, Signature: literalSchnorrSignature(t, literalSchnorrPrivate(byte(10+slot)), d, byte(90+slot))})
	}
	result.PublicSummaryDigest, _ = fridayDKGPublicSummaryDigest(result, result.ManifestDigest, shares)
	result.SignerRosterDigest, _ = fridayDKGSignerRosterDigest(result, shares)
	sharesDigest, _ := fridayDKGVerifyingSharesDigest(shares)
	for index := range result.FinalAttestations {
		a := &result.FinalAttestations[index]
		p := result.Participants[index]
		a.ManifestDigest = result.ManifestDigest
		a.RosterDigest = result.RosterDigest
		a.DKGIdentity = p.DKGIdentity
		a.SignerIdentity = p.SignerIdentity
		a.SignerEndpoint = p.SignerEndpoint
		a.ParticipantBinarySHA256 = p.ParticipantBinarySHA256
		a.InspectorBinarySHA256 = p.InspectorBinarySHA256
		a.PublicSummaryDigest = result.PublicSummaryDigest
		a.VerifyingSharesDigest = sharesDigest
		d, e := fridayDKGFinalAttestationDigest(*a)
		if e != nil {
			t.Fatal(e)
		}
		a.Signature = literalSchnorrSignature(t, literalSchnorrPrivate(byte(11+index)), d, byte(100+index))
	}
	if err := verifyFridayAuthenticatedDKGResultV2ForRoot(result.ManifestDigest, fridaySeparatedDKGRoot, result); err != nil {
		t.Fatal(err)
	}
	digest := func(label string) string { return hashBytes([]byte("synthetic " + label)) }
	var validators []any
	for index, p := range result.Participants {
		validators = append(validators, map[string]any{"participantId": index + 1, "role": "VALIDATOR_SIGNER", "hostId": p.HostID, "underlayIpv4": p.UnderlayIPv4, "fipsNpub": p.FIPSNpub, "fipsUla": p.FIPSULA, "dkgIdentity": p.DKGIdentity, "signerIdentity": p.SignerIdentity, "kexPublicKey": p.KEXPublicKey, "rebuild": map[string]any{"providerEventDigest": digest(p.HostID + " provider"), "imageDigest": digest("image"), "sshHostKeyDigest": digest(p.HostID + " SSH"), "abandonmentDecisionDigest": digest("abandonment"), "emptyStateObservationDigest": digest(p.HostID + " empty")}})
	}
	packet := map[string]any{"schema": "PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_V1", "valueProfile": "FAKE_MONEY_ONLY", "stage": "PRE_DKG", "deploymentId": fridaySeparatedDeploymentID, "applicationRunId": fridaySeparatedApplicationRunID, "dkgRunId": fridaySeparatedDKGRunID, "predecessorManifestDigest": previousDigest, "application": map[string]any{"role": "APPLICATION", "hostId": "linode-109290386", "underlayIpv4": "139.162.161.233", "fipsNpub": "npub1" + strings.Repeat("y", 58), "fipsUla": "fd42::5", "coordinatorRpcIdentity": result.CoordinatorIdentity, "publicOrigin": "https://139.162.161.233", "mintOrigin": "https://139.162.161.233"}, "validators": validators, "participantBinarySha256": result.Participants[0].ParticipantBinarySHA256, "inspectorBinarySha256": result.Participants[0].InspectorBinarySHA256}
	owner := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x44}, 32))
	ownerPublic := hex.EncodeToString(owner.Public().(ed25519.PublicKey))
	message, _ := separatedCanonical([]any{"PLEBEIAN_FRIDAY_SEPARATED_BOOTSTRAP_OWNER_APPROVAL_V1", packet})
	packet["ownerSignature"] = hex.EncodeToString(ed25519.Sign(owner, message))
	canonical, _ := separatedCanonical(packet)
	bootstrapDigest := hashBytes(canonical)
	runtime := FridaySeparatedRuntime{Schema: fridaySeparatedRuntimeSchema, ValueProfile: "FAKE_MONEY_ONLY", DeploymentID: fridaySeparatedDeploymentID, BootstrapDigest: bootstrapDigest, ManifestDigest: result.ManifestDigest, Result: result}
	runtime.BindingDigest, err = separatedRuntimeDigest(runtime)
	if err != nil {
		t.Fatal(err)
	}
	return separatedPublicFixture{Predecessor: previous, Bootstrap: packet, BootstrapDigest: bootstrapDigest, OwnerPublic: ownerPublic, Runtime: runtime}
}
func TestFridaySeparatedOwnerBootstrapAndRuntime(t *testing.T) {
	f := separatedFixture(t)
	raw, _ := json.Marshal(f.Bootstrap)
	if _, err := verifySeparatedBootstrapPacket(raw, f.BootstrapDigest, f.OwnerPublic, f.Predecessor); err != nil {
		t.Fatal(err)
	}
	if err := verifySeparatedRuntime(f.Runtime, f.BootstrapDigest, f.Runtime.BindingDigest, f.Runtime.ManifestDigest); err != nil {
		t.Fatal(err)
	}
	if _, err := verifySeparatedBootstrapPacket(raw, strings.Repeat("0", 64), f.OwnerPublic, f.Predecessor); err == nil {
		t.Fatal("wrong owner pin accepted")
	}
	changed := f.Runtime
	changed.Result.Manifest.DeploymentID = "wrong"
	if verifySeparatedRuntime(changed, f.BootstrapDigest, changed.BindingDigest, changed.ManifestDigest) == nil {
		t.Fatal("wrong DKG deployment accepted")
	}
	if os.Getenv("UPDATE_SEPARATED_GOLDEN") == "1" {
		out, err := json.MarshalIndent(f, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("testdata/friday-separated-go-golden.json", append(out, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
