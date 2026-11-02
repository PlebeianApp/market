package poc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func freshSiteFixture() (NetworkManifest, *APIServer) {
	m, s := exactR20CloseActivationFixture()
	m.DeploymentID = fridaySeparatedDeploymentID
	m.ApplicationRunID = fridaySeparatedApplicationRunID
	m.CashuMintURL = "https://139.162.161.233"
	m.SeparatedRuntimeBindingDigest = strings.Repeat("e", 64)
	m.R20RuntimeBindingDigest = ""
	p := m.FundingAbortPins
	p.MintURL = m.CashuMintURL
	p.CommitteeKeysetID = fridaySeparatedKeysetID
	p.CommitteeKeysetVersion = "3"
	p.DKGRunID = fridaySeparatedDKGRunID
	s.manifest = m
	s.observerNodeID = strings.Repeat("f", 40)
	b := s.browserReleasePins
	b.DeploymentID = m.DeploymentID
	b.CashuMintURL = m.CashuMintURL
	b.CommitteeKeysetID = p.CommitteeKeysetID
	b.CommitteeKeysetVersion = "3"
	b.DKGRunID = p.DKGRunID
	return m, s
}
func TestFridaySeparatedBrowserReadinessAndRoleBoundClose(t *testing.T) {
	m, s := freshSiteFixture()
	if e := validateBrowserReleasePins(*s.browserReleasePins); e != nil || !s.browserPinsReady() {
		t.Fatal("fresh browser pins rejected", e)
	}
	wrong := *s.browserReleasePins
	wrong.CashuMintURL = "https://172.105.95.57"
	if validateBrowserReleasePins(wrong) == nil {
		t.Fatal("legacy mint accepted for fresh deployment")
	}
	ready := false
	s.runtimeReadyProbe = func(context.Context) bool { return ready }
	h, e := s.Handler()
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range []bool{false, true, false} {
		ready = v
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/api/config", nil))
		var c map[string]any
		if json.Unmarshal(r.Body.Bytes(), &c) != nil || c["browser_threshold_admission_ready"] != v || c["deployment_id"] != fridaySeparatedDeploymentID {
			t.Fatal("fresh readiness stale", r.Body.String())
		}
	}
	ready = false
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/api/close", strings.NewReader(`{"auction_id":"synthetic"}`)))
	if r.Code != 503 {
		t.Fatal("fresh direct mutation bypassed readiness")
	}
	root := "/var/lib/plebeian-auctions-friday/network-separated"
	t.Setenv("POC_FRIDAY_R20_CLOSE_TRIGGER", "true")
	t.Setenv("FRIDAY_NETWORK_ROOT", root)
	t.Setenv("FRIDAY_APPLICATION", r20ApplicationPath)
	t.Setenv("FRIDAY_TERMINAL_EXECUTOR_BIN", "/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-friday-terminal-executor")
	t.Setenv("FRIDAY_SITE_PORT", "8180")
	t.Setenv("FRIDAY_ROLE", "APPLICATION")
	t.Setenv("FRIDAY_SLOT", "")
	t.Setenv("FRIDAY_SEPARATED_RUNTIME_DIGEST", m.SeparatedRuntimeBindingDigest)
	if ok, e := requireR20CloseTriggerActivation(root, "127.0.0.1:8180", m, s); e != nil || !ok {
		t.Fatal("exact app observer close refused", e)
	}
	t.Setenv("FRIDAY_SLOT", "2")
	if ok, e := requireR20CloseTriggerActivation(root, "127.0.0.1:8180", m, s); e == nil || ok {
		t.Fatal("validator slot masqueraded as application")
	}
	t.Setenv("FRIDAY_SLOT", "")
	s.observerNodeID = ""
	if ok, e := requireR20CloseTriggerActivation(root, "127.0.0.1:8180", m, s); e == nil || ok {
		t.Fatal("unbound observer close accepted")
	}
}
