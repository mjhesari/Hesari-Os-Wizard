package internal

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Wire contract: Hesari-Os/src/common/worker-bundle.js, format 1.
var runtimeRoles = []string{
	"source", "config", "error", "panel", "login", "proxy", "icon",
	"protocolA", "protocolALabel", "protocolC", "protocolCLabel",
	"protocolB", "protocolBLabel", "protocolD", "client",
	"project", "slug", "repository", "wizard", "website", "proxyHost", "profile",
}

var assetRoles = []string{"panel", "login", "error", "proxy", "icon"}
var runtimeIdentifier = regexp.MustCompile(`^[a-z][a-f0-9]{24}$`)
var errWorkerBundle = errors.New("Incompatible or corrupt panel worker bundle. Download a complete HESARI OS release with runtime profile format 1.")

const bundleBootstrap = "Object.assign(globalThis,"

type RuntimeProfile struct {
	Format    int               `json:"format"`
	KVBinding string            `json:"kvBinding"`
	Names     map[string]string `json:"names"`
}

func validateRuntimeProfile(profile RuntimeProfile) error {
	if profile.Format != 1 || !runtimeIdentifier.MatchString(profile.KVBinding) || len(profile.Names) != len(runtimeRoles) {
		return errWorkerBundle
	}
	seen := map[string]bool{profile.KVBinding: true}
	for _, role := range runtimeRoles {
		name := profile.Names[role]
		if !runtimeIdentifier.MatchString(name) || seen[name] {
			return errWorkerBundle
		}
		seen[name] = true
	}
	return nil
}

func createRuntimeProfile() (RuntimeProfile, error) {
	profile := RuntimeProfile{Format: 1, Names: make(map[string]string)}
	randomName := func() (string, error) {
		var data [13]byte
		if _, err := rand.Read(data[:]); err != nil {
			return "", errors.New("Secure randomness is unavailable")
		}
		return string(rune('a'+data[0]%26)) + hex.EncodeToString(data[1:]), nil
	}
	var err error
	profile.KVBinding, err = randomName()
	if err != nil {
		return profile, err
	}
	for _, role := range runtimeRoles {
		profile.Names[role], err = randomName()
		if err != nil {
			return profile, err
		}
	}
	return profile, validateRuntimeProfile(profile)
}

type workerBundle struct {
	Profile RuntimeProfile
	Assets  map[string]string
	Source  string
	Config  json.RawMessage
}

func unpackSource(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", errWorkerBundle
	}
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", errWorkerBundle
	}
	defer reader.Close()
	const maxSourceSize = 16 << 20
	source, err := io.ReadAll(io.LimitReader(reader, maxSourceSize+1))
	if err != nil || len(source) > maxSourceSize || !utf8.Valid(source) {
		return "", errWorkerBundle
	}
	return string(source), nil
}

func parseWorkerBundle(worker string) (*workerBundle, error) {
	header, outer, found := strings.Cut(worker, "\n")
	if !found || !strings.HasPrefix(header, bundleBootstrap) || !strings.HasSuffix(header, ");") {
		return nil, errWorkerBundle
	}
	var values map[string]json.RawMessage
	if json.Unmarshal([]byte(header[len(bundleBootstrap):len(header)-2]), &values) != nil {
		return nil, errWorkerBundle
	}
	bundle := &workerBundle{Assets: make(map[string]string)}
	profiles := 0
	profileKey := ""
	for key, value := range values {
		var candidate RuntimeProfile
		if json.Unmarshal(value, &candidate) == nil && candidate.Format == 1 && candidate.Names != nil {
			bundle.Profile = candidate
			profileKey = key
			profiles++
		}
	}
	if profiles != 1 || validateRuntimeProfile(bundle.Profile) != nil || profileKey != bundle.Profile.Names["profile"] {
		return nil, errWorkerBundle
	}
	for _, role := range assetRoles {
		var asset *string
		if json.Unmarshal(values[bundle.Profile.Names[role]], &asset) != nil || asset == nil {
			return nil, errWorkerBundle
		}
		bundle.Assets[role] = *asset
		if role != "icon" {
			if unpacked, err := unpackSource(*asset); err != nil || strings.TrimSpace(unpacked) == "" {
				return nil, errWorkerBundle
			}
		} else if decoded, err := base64.StdEncoding.DecodeString(*asset); err != nil || len(decoded) == 0 {
			return nil, errWorkerBundle
		}
	}
	var source string
	if json.Unmarshal(values[bundle.Profile.Names["source"]], &source) != nil {
		return nil, errWorkerBundle
	}
	var err error
	bundle.Source, err = unpackSource(source)
	if err != nil || strings.TrimSpace(bundle.Source) == "" || bundle.Source != outer {
		return nil, errWorkerBundle
	}
	bundle.Config = values[bundle.Profile.Names["config"]]
	return bundle, nil
}

func encodeWorkerBundle(source string, assets map[string]string, profile RuntimeProfile, config any) (string, error) {
	if err := validateRuntimeProfile(profile); err != nil {
		return "", err
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := io.WriteString(writer, source); err != nil {
		return "", errWorkerBundle
	}
	if err := writer.Close(); err != nil {
		return "", errWorkerBundle
	}
	values := map[string]any{
		profile.Names["source"]:  base64.StdEncoding.EncodeToString(compressed.Bytes()),
		profile.Names["profile"]: profile,
	}
	for _, role := range assetRoles {
		values[profile.Names[role]] = assets[role]
	}
	if config != nil {
		values[profile.Names["config"]] = config
	}
	header, err := json.Marshal(values)
	if err != nil {
		return "", errWorkerBundle
	}
	return bundleBootstrap + string(header) + ");\n" + source, nil
}

func personalizeWorkerBundle(worker string, profile RuntimeProfile, config any) (string, error) {
	previous, err := parseWorkerBundle(worker)
	if err != nil {
		return "", err
	}
	if err := validateRuntimeProfile(profile); err != nil {
		return "", err
	}
	replacements := make(map[string]string)
	var names []string
	for _, role := range runtimeRoles {
		old := previous.Profile.Names[role]
		names = append(names, old)
		replacements[old] = profile.Names[role]
	}
	pattern := regexp.MustCompile(`\b(?:` + strings.Join(names, "|") + `)\b`)
	source := pattern.ReplaceAllStringFunc(previous.Source, func(name string) string { return replacements[name] })
	return encodeWorkerBundle(source, previous.Assets, profile, config)
}
