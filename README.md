# Intavolatura for MuseScore

A MuseScore 4 plugin that realizes figured bass into tablature for a theorbo, lute, archlute or baroque guitar: it reads a bass line with MuseScore's own figured bass and writes a playable fingering for every chord into a tablature staff and its linked standard staff. The fingerings come from the [Intavolatura](../intavolatura) app's engine (same chords, candidates and ranking), run as a small command-line program next to the plugin. Design and decisions: [PLAN.md](PLAN.md).

Requires MuseScore Studio 4.7.5 or later. Tested on macOS.

## Install

Needs Rust (`cargo`) and the `intavolatura` repository next to this one.

```sh
scripts/install.sh            # into ~/Documents/MuseScore4/Plugins
scripts/install.sh <folder>   # or another plugins folder
```

`INTAVOLATURA_REPO=<path>` points at the repository if it is elsewhere. Then enable *Realize figured bass*, *Next fingering* and *Previous fingering* in Plugins → Manage plugins.

## Prepare the score

1. A bass staff with figured bass (Add → Text → Figured bass, Cmd/Ctrl+G).
2. A plucked-string part with a tablature staff, usually linked to a standard staff (e.g. the *Theorbo* instrument; see the handbook's [Creating a tablature staff](https://musescore.org/en/handbook/4/creating-tablature-staff)). Choose French or Italian tablature in its staff type.
3. The part's tuning is what gets realized: set it under Staff/Part properties → Edit string data. Strings marked *open* are diapasons. To retune diapasons to the key (F♯2 in D major), change them there.

## Use

- Select the bass staff over the range to realize, then Plugins → *Realize figured bass*. Choose the tablature staff, the instrument rules (best match for the staff's tuning first), major or minor, the left-hand fret span and how many fingerings to cycle through. *Keep chords that already have a fingering* leaves chords you chose earlier alone. Realize writes the range anew; Undo takes the whole run back.
- Bass notes with no playable fingering get a rest and a "no fingering" label; the summary lists them with the reason.
- Select a chord of the realization (or its bass note) and run *Next fingering* or *Previous fingering* to step through its best fingerings. Give them shortcuts in Preferences → Shortcuts ("Run plugin Next fingering").

## Test

```sh
test/run.sh                  # headless realize and cycling in MuseScore, prints a report
python3 test/show.py         # the report, readably
```

The CLI's own tests live in the `intavolatura` repository: `cargo test -p intavolatura-cli`.
