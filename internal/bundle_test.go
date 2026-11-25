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
	"strings"
	"testing"

	"github.com/cloudflare/cloudflare-go/v7"
	"github.com/cloudflare/cloudflare-go/v7/option"
)

func TestInvalidWorkerBundles(t *testing.T) {
	raw := panelFixture(t)
	header, source, _ := strings.Cut(raw, "\n")
	var values map[string]any
	if err := json.Unmarshal([]byte(header[len(bundleBootstrap):len(header)-2]), &values); err != nil {
		t.Fatal(err)
	}
	bundle, err := parseWorkerBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{"legacy": "const EMBEDED_SETTINGS = {}; export default {};", "empty": "", "html": "<html>Error</html>", "outer-truncated": raw[:len(raw)-20], "no-header": source}
	mutate := func(key string, value any) string {
		copy := make(map[string]any)
		for k, v := range values {
			copy[k] = v
		}
		copy[key] = value
		data, _ := json.Marshal(copy)
		return bundleBootstrap + string(data) + ");\n" + source
	}
	cases["gzip"] = mutate(bundle.Profile.Names["source"], "invalid-secret-do-not-echo")
	cases["asset"] = mutate(bundle.Profile.Names["panel"], nil)
	badProfile := bundle.Profile
	badProfile.Format = 2
	cases["profile-version"] = mutate(bundle.Profile.Names["profile"], badProfile)
	badProfile = bundle.Profile
	badProfile.KVBinding = "kv"
	cases["fixed-kv"] = mutate(bundle.Profile.Names["profile"], badProfile)
	for name, worker := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := renderScript(worker, &CfAccount{Token: "private-test-token"}, "test", "pages.dev")
			if err == nil || err.Error() != errWorkerBundle.Error() {
				t.Fatal("expected sanitized bundle error")
			}
		})
	}
}

// Exercise the CLI's complete orchestration and real SDK multipart requests.
// The Node runtime suite consumes these uploads, without invoking Cloudflare.
func TestCLIDeployments(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(filepath.Dir(exe), "worker.js")
	if err := os.WriteFile(scriptPath, []byte(panelFixture(t)), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(scriptPath) })
	var previousBinding string
	for _, kind := range []string{"workers", "pages"} {
		t.Run(kind, func(t *testing.T) {
			const namespaceID = "0123456789abcdef0123456789abcdef"
			var uploaded, binding string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case strings.HasSuffix(r.URL.Path, "/workers/subdomain"):
					fmt.Fprint(w, `{"success":true,"result":{"subdomain":"owner"}}`)
				case strings.HasSuffix(r.URL.Path, "/pages/projects"):
					var project struct {
						DeploymentConfigs struct {
							Production struct {
								KVNamespaces map[string]struct {
									NamespaceID string `json:"namespace_id"`
								} `json:"kv_namespaces"`
							} `json:"production"`
						} `json:"deployment_configs"`
					}
					if err := json.NewDecoder(r.Body).Decode(&project); err != nil {
						t.Error(err)
					}
					for name, kv := range project.DeploymentConfigs.Production.KVNamespaces {
						binding = name
						if kv.NamespaceID != namespaceID {
							t.Error("namespace ID changed")
						}
					}
					fmt.Fprint(w, `{"success":true,"result":{"subdomain":"workspace.pages.dev"}}`)
				case r.Method == "PUT" || strings.HasSuffix(r.URL.Path, "/deployments"):
					if err := r.ParseMultipartForm(16 << 20); err != nil {
						t.Error(err)
						return
					}
					defer r.MultipartForm.RemoveAll()
					if kind == "workers" {
						// Inspect the actual SDK payload rather than reconstructing metadata.
						var data struct {
							Bindings []struct {
								Name        string `json:"name"`
								NamespaceID string `json:"namespace_id"`
							} `json:"bindings"`
						}
						if err := json.Unmarshal([]byte(r.FormValue("metadata")), &data); err != nil {
							t.Error(err)
						}
						if len(data.Bindings) != 1 {
							t.Error("expected one binding")
							return
						}
						binding = data.Bindings[0].Name
						if data.Bindings[0].NamespaceID != namespaceID {
							t.Error("namespace ID changed")
						}
					}
					for _, files := range r.MultipartForm.File {
						for _, file := range files {
							if file.Filename == "worker.js" || file.Filename == "_worker.js" {
								f, err := file.Open()
								if err != nil {
									t.Error(err)
									return
								}
								data, err := io.ReadAll(f)
								f.Close()
								if err != nil {
									t.Error(err)
									return
								}
								uploaded = string(data)
							}
						}
					}
					// Pages SDK may encode WorkerJS as a form value instead of a file.
					if uploaded == "" {
						uploaded = r.FormValue("_worker.js")
					}
					fmt.Fprint(w, `{"success":true,"result":{}}`)
				case strings.HasSuffix(r.URL.Path, "/subdomain"):
					fmt.Fprint(w, `{"success":true,"result":{"enabled":true}}`)
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			acc := &CfAccount{ID: "00000000000000000000000000000001", Email: "owner@example.com", Token: "integration-test-only", Client: cloudflare.NewClient(option.WithAPIToken("integration-test-only"), option.WithBaseURL(server.URL), option.WithMaxRetries(0))}
			var panelURL string
			if kind == "workers" {
				panelURL = DeployToWorkers(context.Background(), acc, NewLogger(), "workspace", namespaceID)
			} else {
				panelURL = DeployToPages(context.Background(), acc, NewLogger(), "workspace", namespaceID)
			}
			bundle, err := parseWorkerBundle(uploaded)
			if err != nil {
				t.Fatal(err)
			}
			if binding != bundle.Profile.KVBinding || binding == previousBinding {
				t.Fatal("deployment/profile binding mismatch or identifiers reused")
			}
			previousBinding = binding
			var settings EmbeddedSettings
			if err := json.Unmarshal(bundle.Config, &settings); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(panelURL, settings.SecurePath) {
				t.Fatal("panel URL mismatch")
			}
			if output := os.Getenv("WIZARD_RUNTIME_OUTPUT"); output != "" {
				if err := os.WriteFile(filepath.Join(output, "cli-"+kind+".js"), []byte(uploaded), 0600); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestProviderErrorsDoNotExposeResponseBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"errors":[{"message":"private-test-token password"}]}`)
	}))
	defer server.Close()
	acc := &CfAccount{ID: "test", Client: cloudflare.NewClient(option.WithBaseURL(server.URL), option.WithMaxRetries(0))}
	_, err := acc.CreatePagesProject(context.Background(), "test", "existing-id", "a000000000000000000000000")
	if err == nil || strings.Contains(safeInstallationError(err), "private-test-token") || !strings.Contains(safeInstallationError(err), "400") {
		t.Fatal("unsafe provider error")
	}
}
