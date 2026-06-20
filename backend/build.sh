#!/usr/bin/env bash
set -euo pipefail

# Build the sov-upgrade-map backend
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o sov-upgrade-map .
upx --lzma sov-upgrade-map 2>/dev/null || true
echo "Build complete: sov-upgrade-map"
