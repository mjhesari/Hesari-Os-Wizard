VER ?= $(VERSION)
GOOS ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)
LDFLAGS = -s -w -X main.VERSION=$(VER)
APP_NAME := HESARI-Wizard
OUT_DIR := bin
DIST_DIR := dist

.PHONY: build clean test
build:
	@set -eu; \
	mkdir -p $(OUT_DIR) $(DIST_DIR); \
	ext=""; if [ "$(GOOS)" = "windows" ]; then ext=".exe"; fi; \
	outdir="$(OUT_DIR)/$(APP_NAME)-$(GOOS)-$(GOARCH)"; \
	mkdir -p "$$outdir"; \
	echo "Building $(GOOS)-$(GOARCH)..."; \
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -ldflags '$(LDFLAGS)' -o "$$outdir/wizard$$ext" .; \
	cp LICENSE "$$outdir/"; \
	archive="$(DIST_DIR)/$(APP_NAME)-$(GOOS)-$(GOARCH)"; \
	if [ "$(GOOS)" = windows ] || [ "$(GOOS)" = darwin ]; then \
		zip -j -q "$$archive.zip" "$$outdir/"*; \
	else \
		tar -czf "$$archive.tar.gz" -C "$$outdir" .; \
	fi

test:
	go test ./...
	go vet ./...

clean:
	rm -rf $(OUT_DIR) $(DIST_DIR) .test-build
