package poc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/api/cometbft/types/v1"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestFridayObserverReplaysActualThresholdABCIWithoutVotingUpdates(t *testing.T) {
	parent := t.TempDir()
	authority := literalFridayAuthority(t, parent)
	_, descriptors := literalFridayRoster(t, parent, authority)
	assembly := literalFridayAssembly(authority)
	assembly.CashuMintURL = "https://139.162.161.233"
	receipt, err := AssembleFridayCometGenesis(filepath.Join(parent, "bundle"), descriptors, assembly)
	if err != nil {
		t.Fatal(err)
	}
	public, err := DeriveFrostCashuLegacyNotePublicPin(receipt.FundingAbortPins)
	if err != nil {
		t.Fatal(err)
	}
	newApp := func(path string) *Application {
		app, err := NewApplicationWithFrostFundingAbortPins(receipt.ChainID, assembly.Policy, public, receipt.CommitteePublicKey, assembly.MintURL, assembly.CashuMintURL, path, receipt.FundingAbortPins)
		if err != nil {
			t.Fatal(err)
		}
		return app
	}
	paths := []string{filepath.Join(parent, "replica-a.json"), filepath.Join(parent, "replica-b.json")}
	var hashes [2][]byte
	for index, path := range paths {
		app := newApp(path)
		for height := int64(1); height <= 3; height++ {
			result, err := app.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: height, Time: time.Unix(1000+height, 0)})
			if err != nil || len(result.ValidatorUpdates) != 0 {
				t.Fatal("observer replay emitted validator update", err)
			}
			hashes[index] = append([]byte(nil), result.AppHash...)
			if _, err := app.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
				t.Fatal(err)
			}
		}
		if len(app.mintSeed) != 0 {
			t.Fatal("threshold observer acquired legacy mint seed")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		derived := sha256.Sum256(raw)
		if !bytes.Equal(derived[:], hashes[index]) {
			t.Fatal("persisted ABCI state does not derive committed apphash")
		}
		restored := newApp(path)
		if restored.state.Height != 3 {
			t.Fatal("observer failed to restore committed height")
		}
	}
	if !bytes.Equal(hashes[0], hashes[1]) {
		t.Fatal("deterministic replica replay differs")
	}
}

func observerGenesisFixture() (*cmttypes.GenesisDoc, cmted25519.PubKey) {
	g := &cmttypes.GenesisDoc{}
	for i := 0; i < 4; i++ {
		key := cmted25519.GenPrivKeyFromSecret([]byte{byte(i + 1)})
		public := key.PubKey()
		g.Validators = append(g.Validators, cmttypes.GenesisValidator{Address: public.Address(), PubKey: public, Power: 1})
	}
	observer := cmted25519.GenPrivKeyFromSecret([]byte("deterministic synthetic observer")).PubKey().(cmted25519.PubKey)
	return g, observer
}
func TestFridayObserverHasPublicOnlyDisabledSigning(t *testing.T) {
	_, public := observerGenesisFixture()
	adapter := signingDisabledObserver{public: public}
	returned, err := adapter.GetPubKey()
	if err != nil || !bytes.Equal(returned.Bytes(), public.Bytes()) {
		t.Fatal("public adapter differs")
	}
	if adapter.SignVote("fake", &cmtproto.Vote{}, false) == nil || adapter.SignVote("fake", &cmtproto.Vote{}, true) == nil || adapter.SignProposal("fake", &cmtproto.Proposal{}) == nil {
		t.Fatal("observer must refuse all consensus signing")
	}
	if signature, err := adapter.SignBytes([]byte("anything")); err == nil || signature != nil {
		t.Fatal("observer must refuse arbitrary signing")
	}
}
func TestFridayObserverRejectsVotingIdentityAndWrongRoster(t *testing.T) {
	genesis, public := observerGenesisFixture()
	if err := observerNonmember(public, genesis); err != nil {
		t.Fatal(err)
	}
	if observerNonmember(genesis.Validators[0].PubKey, genesis) == nil {
		t.Fatal("voter accepted as observer")
	}
	duplicate := *genesis
	duplicate.Validators = append([]cmttypes.GenesisValidator{}, genesis.Validators...)
	duplicate.Validators[1] = duplicate.Validators[0]
	if observerNonmember(public, &duplicate) == nil {
		t.Fatal("duplicate voter accepted")
	}
	short := *genesis
	short.Validators = genesis.Validators[:3]
	if observerNonmember(public, &short) == nil {
		t.Fatal("three voter bootstrap accepted")
	}
	extra := *genesis
	extra.Validators = append(append([]cmttypes.GenesisValidator{}, genesis.Validators...), cmttypes.GenesisValidator{PubKey: public, Power: 1})
	if observerNonmember(public, &extra) == nil {
		t.Fatal("fifth voter accepted")
	}
	wrongPower := *genesis
	wrongPower.Validators = append([]cmttypes.GenesisValidator{}, genesis.Validators...)
	wrongPower.Validators[0].Power = 2
	if observerNonmember(public, &wrongPower) == nil {
		t.Fatal("unequal power accepted")
	}
}
func TestFridayObserverConfigIsLoopbackRPCAndPinnedFIPSPeers(t *testing.T) {
	manifest := NetworkManifest{ChainID: "fake-observer"}
	for i := 1; i <= 4; i++ {
		manifest.Validators = append(manifest.Validators, ValidatorManifest{Slot: i, NodeID: strings.Repeat(string(rune('a'+i)), 40), P2PListen: "tcp://[fd42::" + string(rune('0'+i)) + "]:27656"})
	}
	receipt := FridayObserverReceipt{Role: "NONVOTING_APPLICATION_OBSERVER", P2PListen: "tcp://[fd42::5]:27656", RPCListen: fridayObserverRPC}
	cfg, err := observerConfig(t.TempDir(), manifest, receipt)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RPC.ListenAddress != fridayObserverRPC || cfg.RPC.Unsafe || cfg.StateSync.Enable || cfg.P2P.PexReactor {
		t.Fatal("observer exposed unsafe or snapshot bootstrap")
	}
	if strings.Count(cfg.P2P.PersistentPeers, ",") != 3 || !strings.Contains(cfg.P2P.PersistentPeers, "[fd42::4]:27656") {
		t.Fatal("observer peers differ")
	}
	if !strings.Contains(cfg.PrivValidatorKeyFile(), "forbidden-validator-key") || !strings.Contains(cfg.PrivValidatorStateFile(), "forbidden-validator-state") {
		t.Fatal("observer inherited validator signing paths")
	}
	if cfg.Consensus.WalPath == "" {
		t.Fatal("replay WAL unexpectedly disabled")
	}
	if cfg.TxIndex.Indexer != "kv" {
		t.Fatal("observer lost transaction index needed for exact recovery")
	}
	for _, bad := range []string{"tcp://0.0.0.0:27656", "tcp://[::]:27656", "tcp://[2001:db8::1]:27656", "tcp://[fd42::5]:26656"} {
		receipt.P2PListen = bad
		if _, err := observerConfig(t.TempDir(), manifest, receipt); err == nil {
			t.Fatalf("unsafe observer listener accepted: %s", bad)
		}
	}
	receipt.P2PListen = "tcp://[fd42::5]:27656"
	receipt.RPCListen = "tcp://0.0.0.0:27657"
	if _, err := observerConfig(t.TempDir(), manifest, receipt); err == nil {
		t.Fatal("public RPC accepted")
	}
}
func TestFridayObserverRejectsMissingPinsBeforeRuntime(t *testing.T) {
	root := t.TempDir() + "/uncreated"
	if _, _, _, err := loadFridayObserver(root, ""); err == nil {
		t.Fatal("missing independent receipt pin accepted")
	}
	if _, err := InitFridayObserver(root, "/nonexistent", strings.Repeat("1", 64), strings.Repeat("2", 64), "tcp://127.0.0.1:27656"); err == nil {
		t.Fatal("non-FIPS listener accepted")
	}
	if err := RunCLI([]string{"node", "--home", root, "--slot", "5"}); err == nil {
		t.Fatal("validator5 accepted")
	}
}

func TestFridayObserverRejectsStrayValidatorStateWithoutReadingIt(t *testing.T) {
	root := t.TempDir()
	cfg, err := observerConfig(root, NetworkManifest{}, FridayObserverReceipt{Role: "NONVOTING_APPLICATION_OBSERVER", P2PListen: "tcp://[fd42::5]:27656", RPCListen: fridayObserverRPC})
	if err != nil {
		t.Fatal(err)
	}
	if err := observerRejectSigningFiles(cfg); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(cfg.RootDir, "config", "priv_validator_key.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("synthetic forbidden-state sentinel; no key"), 0000); err != nil {
		t.Fatal(err)
	}
	if observerRejectSigningFiles(cfg) == nil {
		t.Fatal("stray validator file accepted")
	}
}
