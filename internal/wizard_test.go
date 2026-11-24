package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/cloudflare/cloudflare-go/v7"
	"github.com/cloudflare/cloudflare-go/v7/option"
)

func TestRenderScript(t *testing.T) {
	acc := &CfAccount{ID: "account-test", Email: "test@example.com", Token: "test-token"}
	reader, settings, err := renderScript("export default {};", acc, "workspace", "owner.workers.dev")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`const EMBEDED_SETTINGS = (\{[^\n]+?\});`).FindSubmatch(body)
	if match == nil {
		t.Fatal("embedded settings missing")
	}
	var decoded EmbeddedSettings
	if err := json.Unmarshal(match[1], &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.AccID != acc.ID || decoded.ApiToken != acc.Token || decoded.MainDomain != "workspace.owner.workers.dev" {
		t.Fatalf("incorrect settings: %+v", decoded)
	}
	if !regexp.MustCompile(`^[\w-]{16,32}$`).MatchString(settings.SecurePath) {
		t.Fatal("invalid secure path")
	}
	if len(settings.TrPass) < 16 || len(settings.VlUUID) != 36 {
		t.Fatal("missing credentials")
	}
	if !strings.HasSuffix(string(body), "export default {};") {
		t.Fatal("panel source was not preserved")
	}
	_, second, _ := renderScript("export default {};", acc, "workspace", "owner.workers.dev")
	if settings.SecurePath == second.SecurePath || settings.TrPass == second.TrPass || settings.VlUUID == second.VlUUID {
		t.Fatal("credentials reused")
	}
}

func TestLoginSelection(t *testing.T) {
	for _, tc := range []struct {
		input   string
		want    int
		invalid bool
	}{{"", 2, false}, {"0", 0, false}, {"1", 1, false}, {"2", 2, false}, {"-1", 0, true}, {"3", 0, true}, {"bad", 0, true}} {
		t.Run(tc.input, func(t *testing.T) {
			got, err := parseLoginChoice(tc.input, 2, 2)
			if (err != nil) != tc.invalid || (!tc.invalid && got != tc.want) {
				t.Fatalf("got %d, %v", got, err)
			}
		})
	}
}

func TestTokenStoreRoundTripAndPermissions(t *testing.T) {
	dir := t.TempDir()
	store := tokenStore{path: filepath.Join(dir, "bpb-wizard", "store.json")}
	first := CfLogin{Email: "one@example.com", ID: "one", Token: "test-one"}
	second := CfLogin{Email: "two@example.com", ID: "two", Token: "test-two"}
	for _, login := range []CfLogin{first, second, {Email: first.Email, ID: first.ID, Token: "replaced"}} {
		if err := store.SaveLogin(login); err != nil {
			t.Fatal(err)
		}
	}
	loaded, err := store.LoadLogins()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Logins) != 2 || loaded.ActiveEmail != first.Email || loaded.Logins[0].Token != "replaced" {
		t.Fatalf("unexpected store: %+v", loaded)
	}
	info, _ := os.Stat(store.path)
	if info.Mode().Perm()&0077 != 0 {
		t.Fatal("token store accessible to other users")
	}
	if err := os.WriteFile(store.path, []byte("invalid JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoadLogins(); err == nil {
		t.Fatal("corrupted token store must not be silently overwritten")
	}
	if filepath.Base(tokenFilePath()) != "store.json" {
		t.Fatal("legacy token store path changed")
	}
}

func TestCloudflareResourceChecksAndFreshSubdomain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing authentication")
		}
		if strings.HasSuffix(r.URL.Path, "/workers/subdomain") {
			fmt.Fprint(w, `{"success":true,"result":{"subdomain":"fresh"}}`)
		} else if strings.HasSuffix(r.URL.Path, "/taken") {
			if strings.Contains(r.URL.Path, "/workers/scripts/") {
				w.Header().Set("Content-Type", "application/javascript")
				fmt.Fprint(w, "export default {};")
			} else {
				fmt.Fprint(w, `{"success":true,"result":{}}`)
			}
		} else if strings.HasSuffix(r.URL.Path, "/forbidden") {
			w.WriteHeader(403)
			fmt.Fprint(w, `{"success":false,"errors":[{"message":"forbidden"}]}`)
		} else {
			w.WriteHeader(404)
			fmt.Fprint(w, `{"success":false,"errors":[{"message":"not found"}]}`)
		}
	}))
	defer server.Close()
	acc := &CfAccount{ID: "test", Client: cloudflare.NewClient(option.WithAPIToken("test-token"), option.WithBaseURL(server.URL))}
	for _, kind := range []string{"workers", "pages"} {
		for _, name := range []string{"taken", "available", "forbidden"} {
			exists, err := acc.NameTaken(context.Background(), kind, name)
			if name == "forbidden" {
				if err == nil {
					t.Fatal("permission error was ignored")
				}
				continue
			}
			if err != nil || exists != (name == "taken") {
				t.Fatalf("%s %s: %v %v", kind, name, exists, err)
			}
		}
	}
	subdomain, err := acc.CreateWorkersDevSubdomain(context.Background())
	if err != nil || subdomain != "fresh.workers.dev" {
		t.Fatalf("%q %v", subdomain, err)
	}
}
