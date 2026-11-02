package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// FridayCometAuthorityRender contains only paths and public deployment
// parameters. The renderer never creates an owner key or DKG material.
type FridayCometAuthorityRender struct {
	OutputRoot                       string
	FROSTFinalPackagePath            string
	ExpectedManifestDigest           string
	OwnerPrivateKeyPath              string
	ChainID                          string
	GenesisTime                      string
	ActiveKeysetID                   string
	SeparatedBootstrapPath           string
	SeparatedRuntimeBindingPath      string
	PredecessorManifestPath          string
	ExpectedSeparatedBootstrapDigest string
	ExpectedSeparatedRuntimeDigest   string
	MintConformanceReceiptSHA256     string
	MintConformanceReceiptPath       string
}

// FridayCometAuthorityReceipt is safe to persist with the public deployment
// inputs. It contains no owner or participant private material.
type FridayCometAuthorityReceipt struct {
	Schema                      string `json:"schema"`
	DeploymentID                string `json:"deployment_id"`
	ChainID                     string `json:"chain_id"`
	ApplicationRunID            string `json:"application_run_id"`
	ExpectedManifestDigest      string `json:"expected_manifest_digest"`
	OwnerApprovalPublicKey      string `json:"owner_approval_public_key"`
	FROSTFinalPackageSHA256     string `json:"frost_final_package_sha256"`
	FundingAbortBootstrapSHA256 string `json:"funding_abort_bootstrap_sha256"`
	DeploymentAnchorSHA256      string `json:"deployment_anchor_sha256"`
}

const fridayCometAuthorityReceiptSchema = "PLEBEIAN_FRIDAY_COMET_AUTHORITY_RENDERED_V1"

func loadFridayOwnerApprovalPrivateKey(path string) (ed25519.PrivateKey, string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, "", errors.New("Friday owner approval key path must be canonical and absolute")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, "", errors.New("Friday owner approval key path must not traverse a symlink")
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, "", err
	}
	stat, statOK := before.Sys().(*syscall.Stat_t)
	if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 || before.Mode().Perm() != 0o600 ||
		!statOK || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		return nil, "", errors.New("Friday owner approval key must be a regular mode-0600 file")
	}
	if before.Size() != 65 {
		return nil, "", errors.New("Friday owner approval key must contain one lowercase Ed25519 seed")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	opened, statErr := file.Stat()
	if statErr != nil || !os.SameFile(before, opened) {
		_ = file.Close()
		return nil, "", errors.New("Friday owner approval key changed before open")
	}
	raw := make([]byte, 65)
	count, readErr := io.ReadFull(file, raw)
	closeErr := file.Close()
	after, afterErr := os.Lstat(path)
	if readErr != nil || closeErr != nil || afterErr != nil || count != len(raw) || !os.SameFile(before, after) {
		for index := range raw {
			raw[index] = 0
		}
		return nil, "", errors.New("Friday owner approval key changed during read")
	}
	if raw[64] != '\n' || !validLowerHex(string(raw[:64]), ed25519.SeedSize) {
		for index := range raw {
			raw[index] = 0
		}
		return nil, "", errors.New("Friday owner approval key must contain one lowercase Ed25519 seed")
	}
	seed, err := hex.DecodeString(string(raw[:64]))
	for index := range raw {
		raw[index] = 0
	}
	if err != nil {
		return nil, "", errors.New("Friday owner approval key is malformed")
	}
	private := ed25519.NewKeyFromSeed(seed)
	for index := range seed {
		seed[index] = 0
	}
	public := hex.EncodeToString(private.Public().(ed25519.PublicKey))
	return private, public, nil
}

func loadFridayAuthenticatedDKGForRender(path, expectedManifestDigest string) (FridayAuthenticatedDKGResultV2, []byte, error) {
	var result FridayAuthenticatedDKGResultV2
	if !validLowerHex(expectedManifestDigest, sha256.Size) {
		return result, nil, errors.New("Friday expected manifest digest is invalid")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return result, nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, nil, err
	}
	if err := requireEOF(decoder); err != nil {
		return result, nil, err
	}
	verifyResult := verifyFridayAuthenticatedDKGResultV2(expectedManifestDigest, result)
	if result.Manifest.DeploymentID == fridaySeparatedDeploymentID {
		verifyResult = verifyFridayAuthenticatedDKGResultV2ForRoot(expectedManifestDigest, fridaySeparatedDKGRoot, result)
	}
	if err := verifyResult; err != nil {
		return result, nil, err
	}
	return result, raw, nil
}

// RenderFridayCometAuthority creates a fresh public authority bundle from an
// already authenticated four-host DKG result. It refuses an existing output
// root and never invents or imports participant private material.
func RenderFridayCometAuthority(input FridayCometAuthorityRender) (FridayCometAuthorityReceipt, error) {
	var receipt FridayCometAuthorityReceipt
	if !filepath.IsAbs(input.OutputRoot) || filepath.Clean(input.OutputRoot) != input.OutputRoot || input.OutputRoot == "/" ||
		!validFridayChainID(input.ChainID) || !validOperationID(input.ActiveKeysetID) {
		return receipt, errors.New("Friday Comet authority render arguments are invalid")
	}
	if _, err := canonicalFridayGenesisTime(input.GenesisTime); err != nil {
		return receipt, err
	}
	frost, frostRaw, err := loadFridayAuthenticatedDKGForRender(input.FROSTFinalPackagePath, input.ExpectedManifestDigest)
	if err != nil {
		return receipt, fmt.Errorf("load authenticated Friday DKG result: %w", err)
	}
	ownerPrivate, ownerPublic, err := loadFridayOwnerApprovalPrivateKey(input.OwnerPrivateKeyPath)
	if err != nil {
		return receipt, err
	}
	defer func() {
		for index := range ownerPrivate {
			ownerPrivate[index] = 0
		}
	}()

	bootstrap := FundingAbortBootstrapV1{Schema: "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1",
		ActiveKeysetID: input.ActiveKeysetID, CommitteeKeysetID: frost.CommitteeKeysetID,
		CommitteeKeysetVersion: frost.CommitteeKeysetVersion, DKGRunID: frost.DKGRunID,
		PublicKeyPackageSHA256: frost.PublicKeyPackageSHA256, SignerRosterDigest: frost.SignerRosterDigest}
	if err := validateFundingAbortBootstrap(bootstrap); err != nil {
		return receipt, err
	}
	bootstrapRaw, err := marshalJSON(bootstrap, false)
	if err != nil {
		return receipt, err
	}
	anchor := FridayCometDeploymentAnchorV1{Schema: fridayCometDeploymentAnchorSchema,
		DeploymentID: frost.Manifest.DeploymentID, ChainID: input.ChainID,
		ApplicationRunID: frost.RunID, ExpectedManifestDigest: input.ExpectedManifestDigest,
		GenesisTime: input.GenesisTime, ActiveKeysetID: input.ActiveKeysetID,
		FROSTFinalPackageSHA256: hashBytes(frostRaw), FundingAbortBootstrapSHA256: hashBytes(bootstrapRaw),
		OwnerApprovalPublicKey: ownerPublic}
	if frost.Manifest.DeploymentID == fridaySeparatedDeploymentID {
		if !validLowerHex(input.MintConformanceReceiptSHA256, 32) {
			return receipt, errors.New("separated final anchor requires completed mint conformance receipt pin")
		}
		mintReceipt, err := os.ReadFile(input.MintConformanceReceiptPath)
		if err != nil || len(mintReceipt) < 2 || len(mintReceipt) > 1024*1024 || hashBytes(mintReceipt) != input.MintConformanceReceiptSHA256 {
			return receipt, errors.New("separated owner-reviewed mint conformance receipt unavailable or changed")
		}
		var predecessor FridayDKGManifestV1
		if err := readStrictJSON(input.PredecessorManifestPath, &predecessor); err != nil {
			return receipt, err
		}
		bootstrapBytes, err := os.ReadFile(input.SeparatedBootstrapPath)
		if err != nil {
			return receipt, err
		}
		packet, err := verifySeparatedBootstrapPacket(bootstrapBytes, input.ExpectedSeparatedBootstrapDigest, ownerPublic, predecessor)
		if err != nil {
			return receipt, err
		}
		app := packet["application"].(map[string]any)
		anchor.ApplicationFIPSULA = app["fipsUla"].(string)
		anchor.ApplicationFIPSNpub = app["fipsNpub"].(string)
		anchor.SeparatedMintOrigin = app["mintOrigin"].(string)
		if app["coordinatorRpcIdentity"] != frost.CoordinatorIdentity {
			return receipt, errors.New("separated requester identity differs from owner DKG binding")
		}
		pins := packet["validators"].([]any)
		for index, p := range frost.Participants {
			pin := pins[index].(map[string]any)
			if p.HostID != pin["hostId"] || p.UnderlayIPv4 != pin["underlayIpv4"] || p.FIPSNpub != pin["fipsNpub"] || p.FIPSULA != pin["fipsUla"] || p.DKGIdentity != pin["dkgIdentity"] || p.SignerIdentity != pin["signerIdentity"] || p.KEXPublicKey != pin["kexPublicKey"] || p.ParticipantBinarySHA256 != packet["participantBinarySha256"] || p.InspectorBinarySHA256 != packet["inspectorBinarySha256"] {
				return receipt, errors.New("completed DKG differs from fresh owner host pins")
			}
		}
		runtimeBytes, err := os.ReadFile(input.SeparatedRuntimeBindingPath)
		if err != nil {
			return receipt, err
		}
		anchor.SeparatedBootstrapDigest = input.ExpectedSeparatedBootstrapDigest
		anchor.SeparatedRuntimeBindingDigest = input.ExpectedSeparatedRuntimeDigest
		anchor.SeparatedRuntimeBindingSHA256 = hashBytes(runtimeBytes)
		anchor.SeparatedMintConformanceSHA256 = input.MintConformanceReceiptSHA256
		if _, _, err := loadSeparatedRuntime(input.SeparatedRuntimeBindingPath, anchor, frost); err != nil {
			return receipt, err
		}
	} else if input.SeparatedBootstrapPath != "" || input.SeparatedRuntimeBindingPath != "" || input.ExpectedSeparatedBootstrapDigest != "" || input.ExpectedSeparatedRuntimeDigest != "" || input.MintConformanceReceiptSHA256 != "" {
		return receipt, errors.New("non-separated authority received separated bootstrap inputs")
	}
	for slot, participant := range frost.Participants {
		anchor.Roster = append(anchor.Roster, FridayCometRosterAnchorV1{Slot: slot + 1,
			HostID: participant.HostID, FIPSULA: participant.FIPSULA, SignerIdentity: participant.SignerIdentity})
	}
	message, err := fridayAnchorSigningBytes(anchor)
	if err != nil {
		return receipt, err
	}
	anchor.OwnerApprovalSignature = hex.EncodeToString(ed25519.Sign(ownerPrivate, message))
	anchorRaw, err := marshalJSON(anchor, false)
	if err != nil {
		return receipt, err
	}
	if err := os.Mkdir(input.OutputRoot, 0o700); err != nil {
		return receipt, fmt.Errorf("create fresh Friday authority output root: %w", err)
	}
	for _, output := range []struct {
		name string
		raw  []byte
	}{
		{"funding-abort-bootstrap.json", bootstrapRaw}, {"deployment-anchor.json", anchorRaw},
	} {
		if err := writeExclusive(filepath.Join(input.OutputRoot, output.name), output.raw, 0o644); err != nil {
			return receipt, fmt.Errorf("write Friday authority %s: %w", output.name, err)
		}
	}
	loadedAnchor, anchorSHA, err := loadFridayDeploymentAnchor(filepath.Join(input.OutputRoot, "deployment-anchor.json"), ownerPublic)
	if err != nil {
		return receipt, err
	}
	if _, err := loadFridayFundingAbortBootstrap(filepath.Join(input.OutputRoot, "funding-abort-bootstrap.json"), loadedAnchor, frost); err != nil {
		return receipt, err
	}
	receipt = FridayCometAuthorityReceipt{Schema: fridayCometAuthorityReceiptSchema,
		DeploymentID: anchor.DeploymentID, ChainID: anchor.ChainID, ApplicationRunID: anchor.ApplicationRunID,
		ExpectedManifestDigest: anchor.ExpectedManifestDigest, OwnerApprovalPublicKey: ownerPublic,
		FROSTFinalPackageSHA256:     anchor.FROSTFinalPackageSHA256,
		FundingAbortBootstrapSHA256: anchor.FundingAbortBootstrapSHA256, DeploymentAnchorSHA256: anchorSHA}
	receiptRaw, err := marshalJSON(receipt, false)
	if err != nil {
		return receipt, err
	}
	if err := writeExclusive(filepath.Join(input.OutputRoot, "authority-render-receipt.json"), receiptRaw, 0o644); err != nil {
		return receipt, err
	}
	directory, err := os.Open(input.OutputRoot)
	if err != nil {
		return receipt, err
	}
	if err = directory.Sync(); err != nil {
		_ = directory.Close()
		return receipt, err
	}
	if err = directory.Close(); err != nil {
		return receipt, err
	}
	return receipt, nil
}
