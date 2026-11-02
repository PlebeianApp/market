package poc

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/api/cometbft/types/v1"
)

const appCodespace = "plebeian-auctions-poc"

type pendingState struct {
	state State
	hash  [32]byte
}

type Application struct {
	abci.BaseApplication

	mu        sync.RWMutex
	state     State
	hash      [32]byte
	pending   *pendingState
	policy    Policy
	mintSeed  []byte
	statePath string
}

var _ abci.Application = (*Application)(nil)

func NewApplication(chainID string, policy Policy, mintSeed []byte, committeePublicKey, statePath string) (*Application, error) {
	return NewApplicationWithEndpoints(chainID, policy, mintSeed, committeePublicKey, TestMintURL, CashuMintURL, statePath)
}

func NewApplicationWithEndpoints(chainID string, policy Policy, mintSeed []byte, committeePublicKey, mintURL, cashuMintURL, statePath string) (*Application, error) {
	return newApplicationWithEndpoints(chainID, policy, mintSeed, committeePublicKey, mintURL, cashuMintURL, statePath, nil)
}

// NewApplicationWithFundingAbortPins starts only a network whose genesis app
// hash and manifest were explicitly upgraded before any validator committed a
// block. Request data can never enroll or replace these pins.
func NewApplicationWithFundingAbortPins(chainID string, policy Policy, mintSeed []byte, committeePublicKey,
	mintURL, cashuMintURL, statePath string, pins FundingAbortPinsV1) (*Application, error) {
	return newApplicationWithEndpoints(chainID, policy, mintSeed, committeePublicKey, mintURL, cashuMintURL, statePath, &pins)
}

// NewApplicationWithFrostFundingAbortPins starts the explicit Friday
// FROST/Cashu state machine from public pins only. Validators never load or
// share the legacy Ed25519 note-issuer seed in this mode.
func NewApplicationWithFrostFundingAbortPins(chainID string, policy Policy, mintPublic ed25519.PublicKey,
	committeePublicKey, mintURL, cashuMintURL, statePath string, pins FundingAbortPinsV1) (*Application, error) {
	return newApplicationWithAuthority(chainID, policy, nil, mintPublic, committeePublicKey, mintURL,
		cashuMintURL, statePath, &pins, ApplicationAuthorityFrostCashu)
}

func newApplicationWithEndpoints(chainID string, policy Policy, mintSeed []byte, committeePublicKey,
	mintURL, cashuMintURL, statePath string, fundingAbortPins *FundingAbortPinsV1) (*Application, error) {
	if len(mintSeed) != ed25519.SeedSize {
		return nil, errors.New("POC committee seed must be exactly 32 bytes")
	}
	return newApplicationWithAuthority(chainID, policy, mintSeed,
		ed25519.NewKeyFromSeed(mintSeed).Public().(ed25519.PublicKey), committeePublicKey,
		mintURL, cashuMintURL, statePath, fundingAbortPins, ApplicationAuthorityLegacy)
}

func newApplicationWithAuthority(chainID string, policy Policy, mintSeed []byte, mintPublic ed25519.PublicKey,
	committeePublicKey, mintURL, cashuMintURL, statePath string, fundingAbortPins *FundingAbortPinsV1,
	authority string) (*Application, error) {
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	if len(mintPublic) != ed25519.PublicKeySize ||
		(authority != ApplicationAuthorityLegacy && authority != ApplicationAuthorityFrostCashu) {
		return nil, errors.New("application authority identity is invalid")
	}
	var state State
	var err error
	if authority == ApplicationAuthorityFrostCashu {
		if len(mintSeed) != 0 || fundingAbortPins == nil {
			return nil, errors.New("FROST/Cashu authority requires public pins and no legacy seed")
		}
		state, err = NewStateWithFrostFundingAbortPins(chainID, mintPublic, committeePublicKey,
			mintURL, cashuMintURL, *fundingAbortPins)
	} else if fundingAbortPins == nil {
		state, err = NewStateWithEndpoints(chainID, mintPublic, committeePublicKey, mintURL, cashuMintURL)
	} else {
		state, err = NewStateWithFundingAbortPins(chainID, mintPublic, committeePublicKey,
			mintURL, cashuMintURL, *fundingAbortPins)
	}
	if err != nil {
		return nil, err
	}
	if raw, readErr := os.ReadFile(statePath); readErr == nil {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&state); err != nil {
			return nil, fmt.Errorf("load application state: %w", err)
		}
		if err := requireEOF(decoder); err != nil {
			return nil, fmt.Errorf("load application state: %w", err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return nil, readErr
	}
	if err := normalizeState(&state, policy); err != nil {
		return nil, err
	}
	if state.ChainID != chainID || state.MintPublicKey != hex.EncodeToString(mintPublic) ||
		state.ApplicationAuthority != authority || state.MintURL != mintURL ||
		state.CashuMintURL != cashuMintURL || state.CommitteePublicKey != committeePublicKey {
		return nil, errors.New("persisted application state identity mismatch")
	}
	if (fundingAbortPins == nil) != (state.FundingAbortPins == nil) ||
		(fundingAbortPins != nil && *fundingAbortPins != *state.FundingAbortPins) {
		return nil, errors.New("persisted funding-abort authority differs from validator configuration")
	}
	hash, err := state.CanonicalHash()
	if err != nil {
		return nil, err
	}
	return &Application{state: state, hash: hash, policy: policy, mintSeed: append([]byte(nil), mintSeed...), statePath: statePath}, nil
}

func (app *Application) Info(context.Context, *abci.InfoRequest) (*abci.InfoResponse, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return &abci.InfoResponse{Data: "plebeian-auctions-fake-money-poc", AppVersion: 1, LastBlockHeight: app.state.Height, LastBlockAppHash: append([]byte(nil), app.hash[:]...)}, nil
}

func (app *Application) InitChain(_ context.Context, request *abci.InitChainRequest) (*abci.InitChainResponse, error) {
	if request == nil || len(request.AppStateBytes) != 0 {
		return nil, errors.New("genesis application state must be empty")
	}
	app.mu.RLock()
	defer app.mu.RUnlock()
	return &abci.InitChainResponse{AppHash: append([]byte(nil), app.hash[:]...)}, nil
}

func (app *Application) CheckTx(_ context.Context, request *abci.CheckTxRequest) (*abci.CheckTxResponse, error) {
	if request == nil {
		return invalidTx(errors.New("nil CheckTx request")), nil
	}
	tx, err := DecodeTransaction(request.Tx)
	if err == nil {
		app.mu.RLock()
		state := app.state
		app.mu.RUnlock()
		err = ValidateForMempool(state, tx, app.policy, app.mintSeed)
	}
	if err != nil {
		return invalidTx(err), nil
	}
	return &abci.CheckTxResponse{Code: abci.CodeTypeOK}, nil
}

func invalidTx(err error) *abci.CheckTxResponse {
	return &abci.CheckTxResponse{Code: 1, Codespace: appCodespace, Log: err.Error()}
}

func (app *Application) PrepareProposal(_ context.Context, request *abci.PrepareProposalRequest) (*abci.PrepareProposalResponse, error) {
	if request == nil {
		return nil, errors.New("nil PrepareProposal request")
	}
	app.mu.RLock()
	state := app.state
	app.mu.RUnlock()
	selected := make([][]byte, 0, len(request.Txs))
	for _, raw := range request.Txs {
		tx, err := DecodeTransaction(raw)
		if err != nil {
			continue
		}
		next, err := ApplyTransaction(state, tx, request.Time.Unix(), app.policy, app.mintSeed)
		if err != nil {
			continue
		}
		candidate := append(selected, raw)
		if request.MaxTxBytes > 0 && int64((&cmtproto.Data{Txs: candidate}).Size()) > request.MaxTxBytes {
			continue
		}
		selected = candidate
		state = next
	}
	return &abci.PrepareProposalResponse{Txs: selected}, nil
}

func (app *Application) ProcessProposal(_ context.Context, request *abci.ProcessProposalRequest) (*abci.ProcessProposalResponse, error) {
	if request == nil {
		return rejectProposal(), nil
	}
	app.mu.RLock()
	state := app.state
	app.mu.RUnlock()
	for _, raw := range request.Txs {
		tx, err := DecodeTransaction(raw)
		if err != nil {
			return rejectProposal(), nil
		}
		state, err = ApplyTransaction(state, tx, request.Time.Unix(), app.policy, app.mintSeed)
		if err != nil {
			return rejectProposal(), nil
		}
	}
	return &abci.ProcessProposalResponse{Status: abci.PROCESS_PROPOSAL_STATUS_ACCEPT}, nil
}

func rejectProposal() *abci.ProcessProposalResponse {
	return &abci.ProcessProposalResponse{Status: abci.PROCESS_PROPOSAL_STATUS_REJECT}
}

func (app *Application) FinalizeBlock(_ context.Context, request *abci.FinalizeBlockRequest) (*abci.FinalizeBlockResponse, error) {
	if request == nil {
		return nil, errors.New("nil FinalizeBlock request")
	}
	app.mu.RLock()
	state := app.state
	hasPending := app.pending != nil
	app.mu.RUnlock()
	if hasPending {
		return nil, errors.New("a finalized state is already pending")
	}
	results := make([]*abci.ExecTxResult, 0, len(request.Txs))
	for _, raw := range request.Txs {
		tx, err := DecodeTransaction(raw)
		if err != nil {
			return nil, err
		}
		state, err = ApplyTransaction(state, tx, request.Time.Unix(), app.policy, app.mintSeed)
		if err != nil {
			return nil, err
		}
		results = append(results, &abci.ExecTxResult{Code: abci.CodeTypeOK})
	}
	state.Height = request.Height
	state.LastConsensusTime = request.Time.Unix()
	hash, err := state.CanonicalHash()
	if err != nil {
		return nil, err
	}
	app.mu.Lock()
	if app.pending != nil || app.state.Height >= request.Height {
		app.mu.Unlock()
		return nil, errors.New("application height changed during finalization")
	}
	app.pending = &pendingState{state: state, hash: hash}
	app.mu.Unlock()
	return &abci.FinalizeBlockResponse{TxResults: results, AppHash: append([]byte(nil), hash[:]...)}, nil
}

func (app *Application) Commit(context.Context, *abci.CommitRequest) (*abci.CommitResponse, error) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.pending == nil {
		return nil, errors.New("no finalized state is pending")
	}
	if err := persistState(app.statePath, app.pending.state); err != nil {
		return nil, err
	}
	app.state = app.pending.state
	app.hash = app.pending.hash
	app.pending = nil
	return &abci.CommitResponse{}, nil
}

func (app *Application) Query(_ context.Context, request *abci.QueryRequest) (*abci.QueryResponse, error) {
	if request == nil || request.Path != "/state" {
		return &abci.QueryResponse{Code: 1, Codespace: appCodespace, Log: "unsupported query path"}, nil
	}
	actor := string(request.Data)
	if actor != "" && !validActor(actor) {
		return &abci.QueryResponse{Code: 1, Codespace: appCodespace, Log: "invalid actor query"}, nil
	}
	app.mu.RLock()
	view, err := app.state.View(actor)
	height := app.state.Height
	app.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(view)
	if err != nil {
		return nil, err
	}
	return &abci.QueryResponse{Code: abci.CodeTypeOK, Value: raw, Height: height}, nil
}

func (app *Application) Snapshot(actor string) (StateView, error) {
	app.mu.RLock()
	defer app.mu.RUnlock()
	return app.state.View(actor)
}

func persistState(path string, state State) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := file.Write(raw); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
