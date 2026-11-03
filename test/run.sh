#!/bin/sh
# Headless end-to-end run of the plugin logic in MuseScore:
#   test/run.sh [options.json]
# Builds intavolatura-cli and the test score (test/fixture.intav as figured
# bass, with an empty theorbo part), installs the plugin and the test
# harness, runs the harness through MuseScore's converter, then prints the
# harness report. The realized score is left in /tmp/intavolatura-test/out.mscz
# and rendered to out-1.png there.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
core="${INTAVOLATURA_REPO:-$repo/../intavolatura}"
mscore="${MSCORE:-/Applications/MuseScore 4.app/Contents/MacOS/mscore}"
plugins="${MSCORE_PLUGINS:-$HOME/Documents/MuseScore4/Plugins}"
work=/tmp/intavolatura-test
options="${1:-$here/options.json}"
mkdir -p "$work"

(cd "$core" && cargo build -q --release -p intavolatura-cli)
(cd "$core" && cargo run -q --example to_musicxml -- "$here/fixture.intav" "$work/bass.musicxml" --bass-only >/dev/null)
python3 "$here/make_fixture.py" voice2 "$work/bass.musicxml" "$work/bass2.musicxml"
"$mscore" -o "$work/bass.mscz" "$work/bass2.musicxml" >/dev/null 2>&1 || true
python3 "$here/make_fixture.py" theorbo "$work/bass.mscz" "$work/fixture.mscz"

"$repo/scripts/install.sh" "$plugins" >/dev/null
rm -rf "$plugins/intavolatura_test"
cp -R "$here/harness" "$plugins/intavolatura_test"

tmp="${TMPDIR%/}"
sed "s#@CLI@#$plugins/intavolatura/bin/intavolatura-cli#" "$options" > "$tmp/intavolatura-test-options.json"
rm -f "$tmp/intavolatura-test-report.json" "$work/out.mscz" "$work"/out-*.png
"$mscore" -o "$work/out.mscz" --extension "musescore://extensions/v1/intavolatura_test/intavolatura_test.qml" "$work/fixture.mscz" >/dev/null 2>&1 || true
"$mscore" -r 110 -o "$work/out.png" "$work/out.mscz" >/dev/null 2>&1 || true
rm -rf "$plugins/intavolatura_test"
cat "$tmp/intavolatura-test-report.json"
