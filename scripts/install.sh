#!/bin/sh
# Builds intavolatura-cli from the intavolatura repository and installs the
# plugin with the binary into MuseScore's plugins folder:
#   scripts/install.sh [plugins-folder]
# The repository defaults to ../intavolatura next to this one (override with
# INTAVOLATURA_REPO); the folder to MuseScore 4's default,
# ~/Documents/MuseScore4/Plugins. The CLI is built here rather than
# downloaded, so macOS does not quarantine it.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
core="${INTAVOLATURA_REPO:-$repo/../intavolatura}"
plugins="${1:-$HOME/Documents/MuseScore4/Plugins}"

(cd "$core" && cargo build -q --release -p intavolatura-cli)
binary="$core/target/release/intavolatura-cli"
[ -f "$binary.exe" ] && binary="$binary.exe"

dest="$plugins/intavolatura"
rm -rf "$dest"
mkdir -p "$dest/bin"
cp "$repo"/plugin/intavolatura/*.qml "$repo"/plugin/intavolatura/*.js "$dest/"
cp "$binary" "$dest/bin/"
echo "installed into $dest"
