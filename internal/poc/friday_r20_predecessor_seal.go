package poc

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

const (
	fridayR18PermissionSealSchema = "PLEBEIAN_FRIDAY_R18_PERMISSION_SEAL_V1"
	fridayR18PermissionSealPath   = "/etc/plebeian-auctions-friday/r18-abort-seal.json"
	fridayR18PrivateRoot          = "/var/lib/plebeian-auctions-friday/frost/keyset-v1"
	fridayR18PrivateParent        = "/var/lib/plebeian-auctions-friday/frost"
)

type fridayR18PermissionSealV1 struct {
	Schema                    string `json:"schema"`
	ParticipantID             int    `json:"participantId"`
	AbortDigest               string `json:"abortDigest"`
	PredecessorManifestDigest string `json:"predecessorManifestDigest"`
	AcknowledgementsDigest    string `json:"acknowledgementsDigest"`
	SealedRoot                string `json:"sealedRoot"`
	SealedParent              string `json:"sealedParent"`
	PriorOwnerUID             int    `json:"priorOwnerUid"`
	PriorOwnerGID             int    `json:"priorOwnerGid"`
	SealedOwnerUID            int    `json:"sealedOwnerUid"`
	SealedOwnerGID            int    `json:"sealedOwnerGid"`
	SealedMode                string `json:"sealedMode"`
	SealedParentMode          string `json:"sealedParentMode"`
	Status                    string `json:"status"`
}

type fridayR20PredecessorSealProfile struct {
	SealPath         string
	SealedRoot       string
	SealedParent     string
	SealUID          uint32
	SealGID          uint32
	SealedUID        uint32
	SealedGID        uint32
	PriorUID         int
	PriorGID         int
	SealMode         os.FileMode
	SealedMode       os.FileMode
	SealedParentMode os.FileMode
}

var fridayR20ProductionPredecessorSealProfile = fridayR20PredecessorSealProfile{
	SealPath: fridayR18PermissionSealPath, SealedRoot: fridayR18PrivateRoot, SealedParent: fridayR18PrivateParent,
	SealUID: 0, SealGID: 0, SealedUID: 0, SealedGID: 0, PriorUID: 997, PriorGID: 986,
	SealMode: 0o444, SealedMode: 0o700, SealedParentMode: 0o711,
}

func fridayStatIdentity(info os.FileInfo) (*syscall.Stat_t, error) {
	value, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return nil, errors.New("Friday predecessor metadata has no Linux stat identity")
	}
	return value, nil
}

func readFridayR18PermissionSeal(profile fridayR20PredecessorSealProfile) (fridayR18PermissionSealV1, error) {
	var value fridayR18PermissionSealV1
	canonical, err := filepath.EvalSymlinks(profile.SealPath)
	if err != nil || canonical != profile.SealPath {
		return value, errors.New("Friday R18 permission seal path is not canonical")
	}
	fd, err := unix.Open(profile.SealPath, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return value, fmt.Errorf("open Friday R18 permission seal: %w", err)
	}
	file := os.NewFile(uintptr(fd), profile.SealPath)
	if file == nil {
		unix.Close(fd)
		return value, errors.New("open Friday R18 permission seal file handle")
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil {
		return value, err
	}
	identity, err := fridayStatIdentity(before)
	if err != nil || !before.Mode().IsRegular() || identity.Nlink != 1 || identity.Uid != profile.SealUID ||
		identity.Gid != profile.SealGID || before.Mode().Perm() != profile.SealMode || before.Size() < 2 || before.Size() > 16*1024 {
		return value, errors.New("Friday R18 permission seal metadata differs")
	}
	raw, err := io.ReadAll(io.LimitReader(file, before.Size()+1))
	if err != nil || int64(len(raw)) != before.Size() {
		return value, errors.New("Friday R18 permission seal read is incomplete")
	}
	after, err := file.Stat()
	if err != nil {
		return value, err
	}
	afterIdentity, err := fridayStatIdentity(after)
	if err != nil || identity.Dev != afterIdentity.Dev || identity.Ino != afterIdentity.Ino ||
		identity.Nlink != afterIdentity.Nlink || before.Size() != after.Size() ||
		identity.Mtim != afterIdentity.Mtim || identity.Ctim != afterIdentity.Ctim {
		return value, errors.New("Friday R18 permission seal changed while read")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, err
	}
	if err := requireEOF(decoder); err != nil {
		return value, err
	}
	return value, nil
}

func verifyFridaySealedDirectory(path string, uid, gid uint32, mode os.FileMode) error {
	beforePath, err := os.Lstat(path)
	if err != nil {
		return err
	}
	beforePathIdentity, err := fridayStatIdentity(beforePath)
	if err != nil || !beforePath.IsDir() {
		return errors.New("Friday R18 sealed directory path metadata differs")
	}
	// O_PATH verifies the directory object without requiring read permission.
	// That is required for the intentionally search-only 0711 parent and the
	// root-owned 0700 keyset when this verifier runs as the service account.
	fd, err := unix.Open(path, unix.O_PATH|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_DIRECTORY, 0)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		unix.Close(fd)
		return errors.New("open Friday sealed directory handle")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	identity, err := fridayStatIdentity(info)
	if err != nil || !info.IsDir() || identity.Nlink < 2 || identity.Uid != uid || identity.Gid != gid || info.Mode().Perm() != mode {
		return errors.New("Friday R18 sealed directory metadata differs")
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || canonical != path {
		return errors.New("Friday R18 sealed directory is not canonical")
	}
	afterPath, err := os.Lstat(path)
	if err != nil {
		return err
	}
	afterPathIdentity, err := fridayStatIdentity(afterPath)
	if err != nil || !afterPath.IsDir() || beforePathIdentity.Dev != identity.Dev ||
		beforePathIdentity.Ino != identity.Ino || afterPathIdentity.Dev != identity.Dev ||
		afterPathIdentity.Ino != identity.Ino || beforePathIdentity.Nlink != identity.Nlink ||
		afterPathIdentity.Nlink != identity.Nlink || beforePath.Mode().Perm() != info.Mode().Perm() ||
		afterPath.Mode().Perm() != info.Mode().Perm() {
		return errors.New("Friday R18 sealed directory path changed while verified")
	}
	return nil
}

func loadFridayR20RuntimeBindingFromNetworkRoot(root string, manifest NetworkManifest) (FridayR20RuntimeDKGBindingV1, error) {
	var empty FridayR20RuntimeDKGBindingV1
	if manifest.DeploymentID != fridayR20DeploymentID {
		return empty, errors.New("Friday R20 predecessor gate received another deployment")
	}
	raw, err := os.ReadFile(filepath.Join(root, "r20-runtime-binding.json"))
	if err != nil {
		return empty, err
	}
	digest := sha256.Sum256(raw)
	if fmt.Sprintf("%x", digest[:]) != manifest.R20RuntimeBindingSHA256 {
		return empty, errors.New("Friday R20 runtime binding bytes differ from network manifest")
	}
	return parseAndVerifyFridayR20RuntimeDKGBinding(raw, manifest.R20RuntimeBindingDigest,
		manifest.R20PredecessorAbortDigest)
}

func requireFridayR20PredecessorRevocation(root string, slot int, profile fridayR20PredecessorSealProfile) error {
	if slot < 1 || slot > 4 {
		return errors.New("Friday R20 predecessor seal slot must be 1..4")
	}
	manifest, err := LoadNetworkManifest(root)
	if err != nil {
		return err
	}
	if manifest.DeploymentID != fridayR20DeploymentID {
		return nil
	}
	binding, err := loadFridayR20RuntimeBindingFromNetworkRoot(root, manifest)
	if err != nil {
		return err
	}
	seal, err := readFridayR18PermissionSeal(profile)
	if err != nil {
		return err
	}
	if seal.Schema != fridayR18PermissionSealSchema || seal.ParticipantID != slot ||
		seal.AbortDigest != manifest.R20PredecessorAbortDigest ||
		seal.PredecessorManifestDigest != binding.PredecessorManifestDigest ||
		seal.AcknowledgementsDigest != binding.AbortAcknowledgementsDigest ||
		seal.SealedRoot != profile.SealedRoot || seal.SealedParent != profile.SealedParent ||
		seal.PriorOwnerUID != profile.PriorUID || seal.PriorOwnerGID != profile.PriorGID ||
		seal.SealedOwnerUID != int(profile.SealedUID) || seal.SealedOwnerGID != int(profile.SealedGID) ||
		seal.SealedMode != "0700" || seal.SealedParentMode != "0711" ||
		seal.Status != "R18_PRIVATE_ROOT_SEALED_NO_REPLAY" {
		return errors.New("Friday R18 predecessor permission seal differs from the exact R20 profile")
	}
	if err := verifyFridaySealedDirectory(profile.SealedParent, profile.SealedUID, profile.SealedGID, profile.SealedParentMode); err != nil {
		return err
	}
	if err := verifyFridaySealedDirectory(profile.SealedRoot, profile.SealedUID, profile.SealedGID, profile.SealedMode); err != nil {
		return err
	}
	return nil
}
