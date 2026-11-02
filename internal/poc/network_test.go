package poc

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func fundingAbortBootstrapFixture() FundingAbortBootstrapV1 {
	return FundingAbortBootstrapV1{
		Schema:         "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1",
		ActiveKeysetID: "00bafe58a7793489", CommitteeKeysetID: "friday-keyset-1",
		CommitteeKeysetVersion: "1", DKGRunID: "friday-dkg-1",
		PublicKeyPackageSHA256: strings.Repeat("1", 64), SignerRosterDigest: strings.Repeat("2", 64),
	}
}

func TestEnableFundingAbortPinsFreshGenesisAndApplication(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	manifest, err := InitLocalNetwork(root, DefaultPolicy())
	if err != nil {
		t.Fatal(err)
	}
	before, err := cmttypes.GenesisDocFromFile(filepath.Join(root, "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	activated, err := EnableFundingAbort(root, fundingAbortBootstrapFixture())
	if err != nil {
		t.Fatal(err)
	}
	if activated.FundingAbortPins == nil || activated.FundingAbortPins.ChainID != manifest.ChainID ||
		activated.FundingAbortPins.MintURL != manifest.CashuMintURL ||
		activated.FundingAbortPins.CommitteePublicKey != manifest.CommitteePublicKey {
		t.Fatalf("activated manifest pins = %+v", activated.FundingAbortPins)
	}
	after, err := cmttypes.GenesisDocFromFile(filepath.Join(root, "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after.AppHash) == string(before.AppHash) {
		t.Fatal("funding-abort activation did not bind the genesis app hash")
	}
	facts, err := LoadNetworkFacts(root)
	if err != nil {
		t.Fatal(err)
	}
	if facts.GenesisSHA256 != activated.FundingAbortPins.GenesisSHA256 {
		t.Fatalf("network facts genesis identity %q != pins %q", facts.GenesisSHA256, activated.FundingAbortPins.GenesisSHA256)
	}
	seed, err := loadCommitteeSeed(root, activated.MintPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	application, err := NewApplicationWithFundingAbortPins(activated.ChainID, activated.Policy, seed,
		activated.CommitteePublicKey, activated.MintURL, activated.CashuMintURL,
		filepath.Join(root, "validator-1", "data", "application-state.json"), *activated.FundingAbortPins)
	if err != nil {
		t.Fatal(err)
	}
	info, err := application.Info(context.Background(), &abci.InfoRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if string(info.LastBlockAppHash) != string(after.AppHash) {
		t.Fatalf("pinned application hash %x != genesis %x", info.LastBlockAppHash, after.AppHash)
	}
	if _, err := EnableFundingAbort(root, fundingAbortBootstrapFixture()); err == nil {
		t.Fatal("second funding-abort activation was accepted")
	}
}

func TestEnableFundingAbortFrostAuthorityNeverLoadsLegacySeed(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"fd42::11", "fd42::12", "fd42::13", "fd42::14"}
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	manifest, err := InitRemoteNetworkWithCommitteeAndOptions(root, DefaultPolicy(), hosts, committee, RemoteNetworkOptions{
		P2PPort: 27656, RPCPort: 27657,
		MintURL: "http://127.0.0.1:8180/test-mint", CashuMintURL: "http://[fd42::12]:3438",
	})
	if err != nil {
		t.Fatal(err)
	}
	manifest.ApplicationAuthority = ApplicationAuthorityFrostCashu
	genesis, err := cmttypes.GenesisDocFromFile(filepath.Join(root, "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	genesisIdentity, err := fundingAbortGenesisIdentity(genesis)
	if err != nil {
		t.Fatal(err)
	}
	bootstrap := fundingAbortBootstrapFixture()
	pins := FundingAbortPinsV1{
		AuthNetworkID: manifest.ChainID, ChainID: manifest.ChainID, GenesisSHA256: genesisIdentity,
		MintURL: manifest.CashuMintURL, ActiveKeysetID: bootstrap.ActiveKeysetID,
		CommitteePublicKey: manifest.CommitteePublicKey, CommitteeKeysetID: bootstrap.CommitteeKeysetID,
		CommitteeKeysetVersion: bootstrap.CommitteeKeysetVersion, DKGRunID: bootstrap.DKGRunID,
		PublicKeyPackageSHA256: bootstrap.PublicKeyPackageSHA256, SignerRosterDigest: bootstrap.SignerRosterDigest,
	}
	legacyNotePin, err := DeriveFrostCashuLegacyNotePublicPin(pins)
	if err != nil {
		t.Fatal(err)
	}
	manifest.MintPublicKey = hex.EncodeToString(legacyNotePin)
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "network.json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "committee.seed")); err != nil {
		t.Fatal(err)
	}

	activated, err := EnableFundingAbort(root, bootstrap)
	if err != nil {
		t.Fatalf("seedless FROST activation: %v", err)
	}
	if activated.ApplicationAuthority != ApplicationAuthorityFrostCashu || activated.FundingAbortPins == nil {
		t.Fatalf("seedless FROST manifest = %+v", activated)
	}
	mintPublic, err := hex.DecodeString(activated.MintPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	application, err := NewApplicationWithFrostFundingAbortPins(activated.ChainID, activated.Policy,
		ed25519.PublicKey(mintPublic), activated.CommitteePublicKey, activated.MintURL, activated.CashuMintURL,
		filepath.Join(root, "validator-1", "data", "application-state.json"), *activated.FundingAbortPins)
	if err != nil {
		t.Fatalf("seedless FROST application: %v", err)
	}
	if len(application.mintSeed) != 0 || application.state.ApplicationAuthority != ApplicationAuthorityFrostCashu {
		t.Fatalf("seedless application retained legacy authority: seed=%d mode=%q",
			len(application.mintSeed), application.state.ApplicationAuthority)
	}
	if _, err := loadCommitteeSeed(root, activated.MintPublicKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy seed unexpectedly exists: %v", err)
	}
}

func TestEnableFundingAbortRejectsUsedOrMalformedNetwork(t *testing.T) {
	t.Run("consensus data", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "network")
		if _, err := InitLocalNetwork(root, DefaultPolicy()); err != nil {
			t.Fatal(err)
		}
		statePath := filepath.Join(root, "validator-2", "data", "priv_validator_state.json")
		if err := os.WriteFile(statePath, []byte("{\n  \"height\": \"1\",\n  \"round\": 0,\n  \"step\": 1\n}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := EnableFundingAbort(root, fundingAbortBootstrapFixture()); err == nil || !strings.Contains(err.Error(), "already signed") {
			t.Fatalf("used validator activation error = %v", err)
		}
	})
	t.Run("application data", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "network")
		if _, err := InitLocalNetwork(root, DefaultPolicy()); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "validator-1", "data", "application-state.json"), []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := EnableFundingAbort(root, fundingAbortBootstrapFixture()); err == nil || !strings.Contains(err.Error(), "already-created") {
			t.Fatalf("used application activation error = %v", err)
		}
	})
	t.Run("bootstrap", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "network")
		if _, err := InitLocalNetwork(root, DefaultPolicy()); err != nil {
			t.Fatal(err)
		}
		bootstrap := fundingAbortBootstrapFixture()
		bootstrap.SignerRosterDigest = "ABC"
		if _, err := EnableFundingAbort(root, bootstrap); err == nil || !strings.Contains(err.Error(), "malformed") {
			t.Fatalf("malformed bootstrap activation error = %v", err)
		}
	})
}

func TestInitRemoteNetworkUsesDistinctIdentitiesAndBoundedListeners(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"172.105.64.142", "172.105.95.57", "172.104.240.217", "172.104.253.247"}
	manifest, err := InitRemoteNetwork(root, DefaultPolicy(), hosts)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Mode != "remote" || manifest.Schema != "PlebeianAuctionsPOCNetworkV3" || len(manifest.Validators) != 4 {
		t.Fatalf("remote manifest = %+v", manifest)
	}
	nodes, validators := map[string]bool{}, map[string]bool{}
	for index, validator := range manifest.Validators {
		if validator.P2PListen != "tcp://0.0.0.0:26656" || validator.P2PExternal != "tcp://"+net.JoinHostPort(hosts[index], "26656") || validator.RPCListen != "tcp://127.0.0.1:26657" {
			t.Fatalf("validator %d listener topology = %+v", index+1, validator)
		}
		nodes[validator.NodeID] = true
		validators[validator.ValidatorAddress] = true
	}
	if len(nodes) != 4 || len(validators) != 4 {
		t.Fatalf("node identities=%d validator identities=%d, want four each", len(nodes), len(validators))
	}
	loaded, err := LoadNetworkManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ChainID != manifest.ChainID || loaded.CommitteePublicKey != manifest.CommitteePublicKey {
		t.Fatal("saved remote manifest differs from generated manifest")
	}
}

func TestInitRemoteNetworkWithCommitteeBracketsIPv6Peers(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"fd00::1", "fd00::2", "fd00::3", "fd00::4"}
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	manifest, err := InitRemoteNetworkWithCommittee(root, DefaultPolicy(), hosts, committee)
	if err != nil {
		t.Fatal(err)
	}
	for index, validator := range manifest.Validators {
		wantExternal := "tcp://" + net.JoinHostPort(hosts[index], "26656")
		if validator.P2PExternal != wantExternal || validator.P2PListen != "tcp://[::]:26656" {
			t.Fatalf("validator %d P2P topology = listen %q, external %q; want IPv6 listen and %q", index+1, validator.P2PListen, validator.P2PExternal, wantExternal)
		}
	}
	config := validatorConfig(root, filepath.Join(root, "validator-1"), manifest, manifest.Validators[0])
	if config.P2P.PersistentPeers == "" || config.P2P.PersistentPeers[0:1] == "[" {
		t.Fatalf("persistent peers do not include node IDs and bracketed IPv6 endpoints: %q", config.P2P.PersistentPeers)
	}
	for _, host := range hosts[1:] {
		if !strings.Contains(config.P2P.PersistentPeers, "@"+net.JoinHostPort(host, "26656")) {
			t.Fatalf("persistent peers %q lack bracketed host %q", config.P2P.PersistentPeers, host)
		}
	}
}

func TestInitRemoteNetworkWithCommitteeAndOptionsKeepsFridayPortsSeparate(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"fd00::1", "fd00::2", "fd00::3", "fd00::4"}
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	options := RemoteNetworkOptions{
		P2PPort: 27656, RPCPort: 27657,
		MintURL:      "http://127.0.0.1:8180/test-mint",
		CashuMintURL: "http://[fd00::1]:3438",
	}
	manifest, err := InitRemoteNetworkWithCommitteeAndOptions(root, DefaultPolicy(), hosts, committee, options)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Schema != "PlebeianAuctionsPOCNetworkV4" || manifest.MintURL != options.MintURL || manifest.CashuMintURL != options.CashuMintURL {
		t.Fatalf("custom Friday manifest = %+v", manifest)
	}
	for index, validator := range manifest.Validators {
		if validator.P2PListen != "tcp://"+net.JoinHostPort(hosts[index], "27656") || validator.P2PExternal != "tcp://"+net.JoinHostPort(hosts[index], "27656") || validator.RPCListen != "tcp://127.0.0.1:27657" {
			t.Fatalf("validator %d custom topology = %+v", index+1, validator)
		}
	}
	loaded, err := LoadNetworkManifest(root)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Schema != manifest.Schema || loaded.CashuMintURL != options.CashuMintURL {
		t.Fatalf("loaded custom manifest = %+v", loaded)
	}
}

func TestLoadNetworkManifestRejectsFridayWildcardP2PListen(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"fd42::11", "fd42::12", "fd42::13", "fd42::14"}
	manifest, err := InitRemoteNetworkWithCommitteeAndOptions(root, DefaultPolicy(), hosts,
		"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", RemoteNetworkOptions{
			P2PPort: 27656, RPCPort: 27657,
			MintURL: "http://127.0.0.1:3339/test-mint", CashuMintURL: "http://[fd42::11]:3438",
		})
	if err != nil {
		t.Fatal(err)
	}
	manifest.Validators[0].P2PListen = "tcp://[::]:27656"
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "network.json"), append(raw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadNetworkManifest(root); err == nil {
		t.Fatal("Friday wildcard IPv6 P2P listener was accepted")
	}
}

func TestCustomRemoteOptionsAcceptPublicHTTPSCashuIdentityButRejectConflictingEndpoints(t *testing.T) {
	hosts := []string{"fd00::1", "fd00::2", "fd00::3", "fd00::4"}
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	public := RemoteNetworkOptions{P2PPort: 27656, RPCPort: 27657, MintURL: TestMintURL, CashuMintURL: "https://172.105.64.142"}
	manifest, err := InitRemoteNetworkWithCommitteeAndOptions(filepath.Join(t.TempDir(), "network"), DefaultPolicy(), hosts, committee, public)
	if err != nil || manifest.CashuMintURL != public.CashuMintURL {
		t.Fatalf("public HTTPS Cashu identity was rejected: manifest=%+v err=%v", manifest, err)
	}
	for name, options := range map[string]RemoteNetworkOptions{
		"same ports":             {P2PPort: 27656, RPCPort: 27656, MintURL: TestMintURL, CashuMintURL: CashuMintURL},
		"request selected host":  {P2PPort: 27656, RPCPort: 27657, MintURL: TestMintURL, CashuMintURL: "https://mint.example.com"},
		"private HTTPS identity": {P2PPort: 27656, RPCPort: 27657, MintURL: TestMintURL, CashuMintURL: "https://127.0.0.1"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := InitRemoteNetworkWithCommitteeAndOptions(filepath.Join(t.TempDir(), "network"), DefaultPolicy(), hosts, committee, options)
			if err == nil {
				t.Fatal("unsafe custom Friday topology was accepted")
			}
		})
	}
}

func TestCustomRemoteOptionsRejectPublicP2PHosts(t *testing.T) {
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	_, err := InitRemoteNetworkWithCommitteeAndOptions(filepath.Join(t.TempDir(), "network"), DefaultPolicy(), []string{
		"203.0.113.11", "203.0.113.12", "203.0.113.13", "203.0.113.14",
	}, committee, RemoteNetworkOptions{
		P2PPort: 27656, RPCPort: 27657,
		MintURL: "http://127.0.0.1:8180/test-mint", CashuMintURL: "http://[fd00::1]:3438",
	})
	if err == nil || !strings.Contains(err.Error(), "private IPv6 FIPS addresses") {
		t.Fatalf("public Friday P2P host error = %v; want private-FIPS refusal", err)
	}
}

func TestInitRemoteNetworkWithCommitteeStoresOnlyThresholdPublicKey(t *testing.T) {
	root := filepath.Join(t.TempDir(), "network")
	hosts := []string{"fd00::1", "fd00::2", "fd00::3", "fd00::4"}
	committee := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	manifest, err := InitRemoteNetworkWithCommittee(root, DefaultPolicy(), hosts, committee)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CommitteePublicKey != committee || manifest.Mode != "remote" {
		t.Fatalf("threshold remote manifest = %+v", manifest)
	}
	public, err := os.ReadFile(filepath.Join(root, "cashu-committee.public"))
	if err != nil || string(public) != committee+"\n" {
		t.Fatalf("threshold public key = %q, err=%v", public, err)
	}
	if _, err := os.Stat(filepath.Join(root, "cashu-committee.key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("threshold remote network unexpectedly wrote committee scalar: %v", err)
	}
	facts, err := LoadNetworkFacts(root)
	if err != nil {
		t.Fatal(err)
	}
	if facts.Schema != "PlebeianAuctionsPOCNetworkFactsV1" || facts.ChainID != manifest.ChainID ||
		facts.CommitteePublicKey != committee || len(facts.GenesisSHA256) != 64 ||
		len(facts.ValidatorsHash) != 64 || facts.ValidatorRosterVersion != "genesis-v1" {
		t.Fatalf("network facts = %+v", facts)
	}
}
