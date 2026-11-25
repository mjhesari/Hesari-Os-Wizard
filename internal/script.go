package internal

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type EmbeddedSettings struct {
	kvBinding   string
	AccID       string   `json:"accID"`
	AccEmail    string   `json:"accEmail"`
	ApiToken    string   `json:"apiToken"`
	VlUUID      string   `json:"vlUUID"`
	TrPass      string   `json:"trPass"`
	SecurePath  string   `json:"securePath"`
	ProxyIPMode string   `json:"proxyIpMode"`
	ProxyIPs    []string `json:"proxyIPs"`
	Prefixes    []string `json:"prefixes"`
	Fallback    string   `json:"fallback"`
	DohURL      string   `json:"dohUrl"`
	MainDomain  string   `json:"mainDomain"`
}

func readScriptFile() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)
	fullPath := filepath.Join(exeDir, "worker.js")
	bytes, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}

	return string(bytes), nil
}

func buildScript(acc *CfAccount, workerName, subdomain string) (io.Reader, *EmbeddedSettings, error) {
	raw, err := readScriptFile()
	if err != nil {
		return nil, nil, err
	}

	return renderScript(raw, acc, workerName, subdomain)
}

func renderScript(raw string, acc *CfAccount, workerName, subdomain string) (io.Reader, *EmbeddedSettings, error) {
	vlUUID := uuid.NewString()
	const passCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&*_-+;:,."
	trPass := randString(passCharset, 16, 32)
	const pathCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456780-_"
	securePath := randString(pathCharset, 16, 32)
	settings := &EmbeddedSettings{
		AccID:       acc.ID,
		AccEmail:    acc.Email,
		ApiToken:    acc.Token,
		VlUUID:      vlUUID,
		TrPass:      trPass,
		SecurePath:  securePath,
		ProxyIPMode: "proxyip",
		ProxyIPs:    []string{},
		Prefixes:    []string{},
		Fallback:    "",
		DohURL:      "",
		MainDomain:  fmt.Sprintf("%s.%s", workerName, subdomain),
	}

	profile, err := createRuntimeProfile()
	if err != nil {
		return nil, nil, err
	}

	script, err := personalizeWorkerBundle(raw, profile, settings)
	if err != nil {
		return nil, nil, err
	}
	settings.kvBinding = profile.KVBinding
	var reader io.Reader = strings.NewReader(script)

	return reader, settings, nil
}
