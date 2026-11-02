package poc

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderFridayCometAuthorityFromAuthenticatedPublicResult(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	ownerPath := filepath.Join(parent, "owner-approval.seed")
	if err := os.WriteFile(ownerPath, []byte(hex.EncodeToString(authority.ownerPrivate.Seed())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(parent, "rendered")
	receipt, err := RenderFridayCometAuthority(FridayCometAuthorityRender{
		OutputRoot: output, FROSTFinalPackagePath: authority.frostPath,
		ExpectedManifestDigest: authority.manifestDigest, OwnerPrivateKeyPath: ownerPath,
		ChainID: fridayFixtureChain, GenesisTime: fridayFixtureTime, ActiveKeysetID: "active-sat-keyset",
	})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.DeploymentID != fridayFixtureDeployment || receipt.OwnerApprovalPublicKey != authority.ownerPublic ||
		receipt.FROSTFinalPackageSHA256 == "" || receipt.FundingAbortBootstrapSHA256 == "" || receipt.DeploymentAnchorSHA256 == "" {
		t.Fatalf("render receipt = %+v", receipt)
	}
	anchor, anchorSHA, err := loadFridayDeploymentAnchor(filepath.Join(output, "deployment-anchor.json"), authority.ownerPublic)
	if err != nil || anchorSHA != receipt.DeploymentAnchorSHA256 {
		t.Fatalf("load rendered anchor: sha=%q err=%v", anchorSHA, err)
	}
	frost, err := loadFridayFROSTFinalPackage(authority.frostPath, anchor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := loadFridayFundingAbortBootstrap(filepath.Join(output, "funding-abort-bootstrap.json"), anchor, frost); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(output, "authority-render-receipt.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := RenderFridayCometAuthority(FridayCometAuthorityRender{
		OutputRoot: output, FROSTFinalPackagePath: authority.frostPath,
		ExpectedManifestDigest: authority.manifestDigest, OwnerPrivateKeyPath: ownerPath,
		ChainID: fridayFixtureChain, GenesisTime: fridayFixtureTime, ActiveKeysetID: "active-sat-keyset",
	}); err == nil || !strings.Contains(err.Error(), "fresh Friday authority output root") {
		t.Fatalf("second render error = %v", err)
	}
}

func TestRenderFridayCometAuthorityRejectsUnpinnedOrUnsafeInputsBeforeOutput(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	ownerPath := filepath.Join(parent, "owner-approval.seed")
	if err := os.WriteFile(ownerPath, []byte(hex.EncodeToString(authority.ownerPrivate.Seed())+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	input := FridayCometAuthorityRender{OutputRoot: filepath.Join(parent, "rendered"),
		FROSTFinalPackagePath: authority.frostPath, ExpectedManifestDigest: authority.manifestDigest,
		OwnerPrivateKeyPath: ownerPath, ChainID: fridayFixtureChain, GenesisTime: fridayFixtureTime,
		ActiveKeysetID: "active-sat-keyset"}
	if _, err := RenderFridayCometAuthority(input); err == nil || !strings.Contains(err.Error(), "mode-0600") {
		t.Fatalf("unsafe owner key error = %v", err)
	}
	if _, err := os.Stat(input.OutputRoot); !os.IsNotExist(err) {
		t.Fatalf("unsafe owner key created output root: %v", err)
	}
	if err := os.Chmod(ownerPath, 0o600); err != nil {
		t.Fatal(err)
	}
	input.ExpectedManifestDigest = strings.Repeat("f", 64)
	if _, err := RenderFridayCometAuthority(input); err == nil {
		t.Fatal("wrong external manifest pin was accepted")
	}
	if _, err := os.Stat(input.OutputRoot); !os.IsNotExist(err) {
		t.Fatalf("wrong manifest pin created output root: %v", err)
	}
}

func TestRenderFridayCometAuthorityCLIRequiresExactContract(t *testing.T) {
	err := RunCLI([]string{"render-friday-comet-authority", "--output-root", "/tmp/example"})
	if err == nil || !strings.Contains(err.Error(), "requires --output-root") {
		t.Fatalf("incomplete renderer CLI error = %v", err)
	}
}
