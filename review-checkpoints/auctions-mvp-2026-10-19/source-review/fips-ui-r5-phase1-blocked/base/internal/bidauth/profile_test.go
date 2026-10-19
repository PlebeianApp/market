package bidauth

import (
	"strings"
	"testing"
)

func testProfile() Profile {
	var network [32]byte
	for index := range network {
		network[index] = byte(index + 1)
	}
	return Profile{NetworkID: network, ChainID: "demo-auth-chain", ActivationHeight: 1}
}

func profileEvent(t *testing.T, created, validUntil int64) VerifiedEvent {
	t.Helper()
	tags, err := ExpectedTags(testProfile(), validUntil)
	if err != nil {
		t.Fatal(err)
	}
	return VerifiedEvent{valid: true, actorID: strings.Repeat("a", 64), createdAt: created, kind: DemoBidKind, tags: tags, content: "{}"}
}

func TestProfileExactLiteralsAndWindowBoundaries(t *testing.T) {
	if DemoProtocol != "plebeian-auction-auth-demo" || len(DemoProtocol) != 26 || DemoBidKind != 28642 || DemoMaxInteger != 9007199254740991 {
		t.Fatal("profile literals drifted")
	}
	tests := []struct {
		name      string
		s, u, now int64
		ok        bool
	}{
		{"before", 100, 200, 99, false}, {"at start", 100, 200, 100, true}, {"last", 100, 200, 199, true}, {"at end", 100, 200, 200, false},
		{"zero lifetime", 100, 100, 100, false}, {"max lifetime", 100, 400, 100, true}, {"one over lifetime", 100, 401, 100, false},
		{"integer ceiling", DemoMaxInteger - 1, DemoMaxInteger, DemoMaxInteger - 1, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ValidateProfileEvent(profileEvent(t, test.s, test.u), testProfile(), test.now)
			if (err == nil) != test.ok {
				t.Fatalf("ok=%v err=%v", test.ok, err)
			}
		})
	}
}

func TestProfileRejectsKindDomainAndTagShape(t *testing.T) {
	base := profileEvent(t, 10, 20)
	mutations := map[string]func(*VerifiedEvent){
		"kind":         func(event *VerifiedEvent) { event.kind = 5900 },
		"protocol":     func(event *VerifiedEvent) { event.tags[0][1] = "other" },
		"version":      func(event *VerifiedEvent) { event.tags[1][1] = "2" },
		"environment":  func(event *VerifiedEvent) { event.tags[2][1] = strings.Repeat("0", 64) },
		"order":        func(event *VerifiedEvent) { event.tags[0], event.tags[1] = event.tags[1], event.tags[0] },
		"cardinality":  func(event *VerifiedEvent) { event.tags = append(event.tags, []string{"extra", "x"}) },
		"leading zero": func(event *VerifiedEvent) { event.tags[3][1] = "020" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			event := base
			event.tags = cloneTags(base.tags)
			mutate(&event)
			if _, err := ValidateProfileEvent(event, testProfile(), 10); err == nil {
				t.Fatal("mutation accepted")
			}
		})
	}
	for _, kind := range []uint16{1021, 5900, 65535, 28641, 28643} {
		t.Run(string(rune(kind)), func(t *testing.T) {
			event := base
			event.kind = kind
			if _, err := ValidateProfileEvent(event, testProfile(), 10); err == nil {
				t.Fatalf("kind %d accepted", kind)
			}
		})
	}
	createdOver := base
	createdOver.createdAt = DemoMaxInteger + 1
	if _, err := ValidateProfileEvent(createdOver, testProfile(), 10); err == nil {
		t.Fatal("created_at J+1 accepted")
	}
	deadlineOver := base
	deadlineOver.tags = cloneTags(base.tags)
	deadlineOver.tags[3][1] = "9007199254740992"
	if _, err := ValidateProfileEvent(deadlineOver, testProfile(), 10); err == nil {
		t.Fatal("valid_until J+1 accepted")
	}
	if _, err := ValidateProfileEvent(base, testProfile(), DemoMaxInteger+1); err == nil {
		t.Fatal("consensus J+1 accepted")
	}
}
