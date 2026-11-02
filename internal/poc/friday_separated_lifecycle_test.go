package poc

// Component runtime only: deterministic synthetic keys and private temp files.
// No Comet node, listener, Rust DKG, mint or browser is started.
import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/p2p"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFridaySeparatedFinalAnchorGenesisAndObserverPublicClosure(t *testing.T) {
	f := separatedFixture(t)
	parent := t.TempDir()
	write := func(name string, v any) string {
		t.Helper()
		raw, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		p := filepath.Join(parent, name)
		if e = os.WriteFile(p, raw, 0600); e != nil {
			t.Fatal(e)
		}
		return p
	}
	frostPath := write("frost.json", f.Runtime.Result)
	bootstrapPath := write("bootstrap.json", f.Bootstrap)
	runtimePath := write("runtime.json", f.Runtime)
	predecessorPath := write("predecessor.json", f.Predecessor)
	mintReceipt := []byte(`{"schema":"SYNTHETIC_MINT_RECEIPT","valueProfile":"FAKE_MONEY_ONLY"}`)
	mintPath := filepath.Join(parent, "mint.json")
	if e := os.WriteFile(mintPath, mintReceipt, 0600); e != nil {
		t.Fatal(e)
	}
	owner := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x44}, 32))
	ownerPath := filepath.Join(parent, "synthetic-owner.seed")
	if e := os.WriteFile(ownerPath, []byte(hex.EncodeToString(owner.Seed())+"\n"), 0600); e != nil {
		t.Fatal(e)
	}
	input := FridayCometAuthorityRender{OutputRoot: filepath.Join(parent, "authority"), FROSTFinalPackagePath: frostPath, ExpectedManifestDigest: f.Runtime.ManifestDigest, OwnerPrivateKeyPath: ownerPath,
		ChainID: "plebeian-separated-synthetic", GenesisTime: "2026-10-30T00:00:00Z", ActiveKeysetID: "synthetic-active-sat", SeparatedBootstrapPath: bootstrapPath, SeparatedRuntimeBindingPath: runtimePath,
		PredecessorManifestPath: predecessorPath, ExpectedSeparatedBootstrapDigest: f.BootstrapDigest, ExpectedSeparatedRuntimeDigest: f.Runtime.BindingDigest, MintConformanceReceiptPath: mintPath, MintConformanceReceiptSHA256: hashBytes(mintReceipt)}
	missing := input
	missing.MintConformanceReceiptPath = filepath.Join(parent, "absent")
	if _, e := RenderFridayCometAuthority(missing); e == nil {
		t.Fatal("final anchor accepted absent mint result")
	}
	if _, e := os.Stat(input.OutputRoot); !os.IsNotExist(e) {
		t.Fatal("rejected mint created output")
	}
	rendered, e := RenderFridayCometAuthority(input)
	if e != nil {
		t.Fatal(e)
	}
	anchorPath := filepath.Join(input.OutputRoot, "deployment-anchor.json")
	anchor, _, e := loadFridayDeploymentAnchor(anchorPath, f.OwnerPublic)
	if e != nil {
		t.Fatal(e)
	}
	if anchor.ApplicationFIPSULA != "fd42::5" || anchor.SeparatedMintConformanceSHA256 != hashBytes(mintReceipt) {
		t.Fatal("owner final anchor omitted app/mint binding")
	}
	authority := fridayAuthorityFixture{anchorPath: anchorPath, frostPath: frostPath, bootstrapPath: filepath.Join(input.OutputRoot, "funding-abort-bootstrap.json"), ownerPublic: f.OwnerPublic, ownerPrivate: owner, manifestDigest: f.Runtime.ManifestDigest, frost: f.Runtime.Result}
	roots, descriptors := literalFridayRoster(t, parent, authority)
	assembly := literalFridayAssembly(authority)
	assembly.CashuMintURL = "https://139.162.161.233"
	assembly.SeparatedRuntimeBindingPath = runtimePath
	wrong := assembly
	wrong.CashuMintURL = "https://172.105.95.57"
	if _, e := AssembleFridayCometGenesis(filepath.Join(parent, "wrong-origin"), descriptors, wrong); e == nil {
		t.Fatal("legacy mint origin accepted")
	}
	bundleRoot := filepath.Join(parent, "bundle")
	bundle, e := AssembleFridayCometGenesis(bundleRoot, descriptors, assembly)
	if e != nil {
		t.Fatal(e)
	}
	_, manifest, _, e := validateFridayCometBundle(bundleRoot)
	if e != nil {
		t.Fatal(e)
	}
	if len(manifest.Validators) != 4 || manifest.DeploymentID != fridaySeparatedDeploymentID || manifest.SeparatedRuntimeBindingDigest != f.Runtime.BindingDigest {
		t.Fatal("fresh manifest differs")
	}
	for i, root := range roots {
		if _, e := FinalizeFridayCometValidator(root, bundleRoot, i+1); e != nil {
			t.Fatal(e)
		}
	}
	observerRoot := filepath.Join(parent, "app-observer")
	deterministic := func(path string) (*p2p.NodeKey, error) {
		key := &p2p.NodeKey{PrivKey: cmted25519.GenPrivKeyFromSecret([]byte("synthetic observer fixture only"))}
		return key, key.SaveAs(path)
	}
	if _, e := initFridayObserver(filepath.Join(parent, "wrong-ula"), bundleRoot, bundle.BundleDigest, f.OwnerPublic, "tcp://[fd42::9]:27656", deterministic); e == nil {
		t.Fatal("unapproved app ULA accepted")
	}
	receipt, e := initFridayObserver(observerRoot, bundleRoot, bundle.BundleDigest, f.OwnerPublic, "tcp://[fd42::5]:27656", deterministic)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile(filepath.Join(observerRoot, "observer.json"))
	if e != nil {
		t.Fatal(e)
	}
	_, got, genesis, e := loadFridayObserver(observerRoot, hashBytes(raw))
	if e != nil {
		t.Fatal(e)
	}
	pub, _ := hex.DecodeString(receipt.PublicKey)
	if observerNonmember(cmted25519.PubKey(pub), genesis) != nil || len(got.Validators) != 4 {
		t.Fatal("observer voting membership wrong")
	}
	for _, p := range []string{"node-1/config/priv_validator_key.json", "observer/config/forbidden-validator-key.json", "participant.config.json", "state"} {
		if _, e := os.Lstat(filepath.Join(observerRoot, p)); !os.IsNotExist(e) {
			t.Fatal("observer acquired participant/voting state", p)
		}
	}
	for _, v := range manifest.Validators {
		if strings.EqualFold(v.NodeID, receipt.NodeID) {
			t.Fatal("observer reused validator transport")
		}
	}
	if rendered.DeploymentAnchorSHA256 == "" {
		t.Fatal("missing final anchor receipt")
	}
}
