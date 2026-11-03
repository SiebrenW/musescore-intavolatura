// Shared logic of the Intavolatura plugins: reading a figured bass line from
// a MuseScore score, asking intavolatura-cli for fingerings and writing them
// into a tablature staff. No music logic lives here; see the CLI for that.
//
// Every entry point takes `ms`, the plugin's context:
//   ms.plugin   the MuseScore plugin item (curScore, newElement, cmd, fraction)
//   ms.Element  the Element enumeration
//   ms.io       a FileIO item
//   ms.proc     a QProcess item
//   ms.cliPath  path of the intavolatura-cli binary

var TICKS_PER_WHOLE = 1920; // MuseScore's ticks: 480 to the quarter
var LABEL = "no fingering";

// The file path of the CLI from its URL next to the plugin
// (Qt.resolvedUrl("bin/intavolatura-cli")), with .exe on Windows.
function cliPath(url) {
    var path = decodeURIComponent(url.toString());
    path = path.replace(/^file:\/\/\/([A-Za-z]:)/, "$1").replace(/^file:\/\//, "");
    return Qt.platform.os === "windows" ? path + ".exe" : path;
}

// --- Reading the score -------------------------------------------------

// Every chord and rest of one staff's four voices from `from` to `to`.
function readEvents(ms, staff, from, to) {
    var score = ms.plugin.curScore;
    var events = [];
    for (var voice = 0; voice < 4; voice++) {
        var c = score.newCursor();
        c.track = staff * 4 + voice;
        c.rewindToTick(from);
        while (c.segment && c.tick < to) {
            var el = c.element;
            if (el && (el.type === ms.Element.CHORD || el.type === ms.Element.REST)) {
                var notes = [];
                if (el.type === ms.Element.CHORD) {
                    for (var i = 0; i < el.notes.length; i++) {
                        var n = el.notes[i];
                        notes.push({ pitch: n.pitch, tpc: n.tpc, tieBack: !!n.tieBack });
                    }
                }
                var tuplet = null;
                if (el.tuplet) {
                    var t = el.tuplet;
                    tuplet = {
                        start: t.elements[0].fraction.ticks,
                        actual: t.actualNotes,
                        normal: t.normalNotes,
                        num: t.duration.numerator,
                        den: t.duration.denominator
                    };
                }
                events.push({
                    track: c.track,
                    tick: c.tick,
                    end: c.tick + el.actualDuration.ticks,
                    notes: notes,
                    written: { num: el.duration.numerator, den: el.duration.denominator },
                    tuplet: tuplet
                });
            }
            if (!c.next()) break;
        }
    }
    return events;
}

// The bass line of a staff: at every moment the lowest sounding note of its
// voices. A note continues while the same pitch sustains or is tied; a
// stretch where nothing sounds is a rest. Each bass note keeps its pieces:
// the spans between the onsets of any voice, with the event sounding the bass.
function readBassLine(ms, staff, from, to) {
    var events = readEvents(ms, staff, from, to);
    var cuts = {};
    cuts[from] = true;
    cuts[to] = true;
    events.forEach(function (e) {
        if (e.tick > from && e.tick < to) cuts[e.tick] = true;
        if (e.end > from && e.end < to) cuts[e.end] = true;
    });
    var ticks = Object.keys(cuts).map(Number).sort(function (a, b) { return a - b; });

    var line = [];
    var current = null;
    for (var i = 0; i + 1 < ticks.length; i++) {
        var a = ticks[i], b = ticks[i + 1];
        var lowest = null, source = null, restSource = null;
        events.forEach(function (e) {
            if (e.tick > a || e.end <= a) return;
            if (e.notes.length === 0) {
                if (!restSource) restSource = e;
                return;
            }
            e.notes.forEach(function (n) {
                if (!lowest || n.pitch < lowest.pitch) {
                    lowest = n;
                    source = e;
                }
            });
        });
        var piece = { tick: a, ticks: b - a, source: source || restSource };
        var continues;
        if (lowest) {
            continues = current && !current.rest && current.pitch === lowest.pitch
                && (source.tick < a || lowest.tieBack);
        } else {
            continues = current && current.rest;
        }
        if (!continues) {
            current = lowest
                ? { tick: a, rest: false, pitch: lowest.pitch, tpc: lowest.tpc, pieces: [] }
                : { tick: a, rest: true, pieces: [] };
            line.push(current);
        }
        current.pieces.push(piece);
        current.end = b;
    }
    return line;
}

// Figured bass items of a staff from `from` to `to`, in order: {tick, text}.
function readFigures(ms, staff, from, to) {
    var figures = [];
    var seg = ms.plugin.curScore.firstSegment();
    while (seg && seg.tick < to) {
        if (seg.tick >= from) {
            var anns = seg.annotations;
            for (var i = 0; i < anns.length; i++) {
                var a = anns[i];
                if (a.type === ms.Element.FIGURED_BASS && Math.floor(a.track / 4) === staff) {
                    figures.push({ tick: seg.tick, text: String(a.text) });
                }
            }
        }
        seg = seg.next;
    }
    return figures;
}

// Gives each bass note its parts: one per figured bass item under it, with
// an empty (5/3) first part when the first figure comes later than the note.
// Returns figures that fall on rests.
function attachFigures(line, figures) {
    var stray = [];
    line.forEach(function (note) {
        note.parts = [];
    });
    figures.forEach(function (f) {
        var note = line.find(function (n) { return n.tick <= f.tick && f.tick < n.end; });
        if (!note || note.rest) {
            stray.push(f);
            return;
        }
        note.parts.push({ tick: f.tick, text: f.text });
    });
    line.forEach(function (note) {
        if (note.rest) return;
        if (note.parts.length === 0 || note.parts[0].tick > note.tick) {
            note.parts.unshift({ tick: note.tick, text: "" });
        }
        for (var i = 0; i < note.parts.length; i++) {
            note.parts[i].end = i + 1 < note.parts.length ? note.parts[i + 1].tick : note.end;
        }
    });
    return stray;
}

// The strings of the instrument on `staff` at `tick`, as MuseScore lists
// them (lowest first), and its fret count.
function readStrings(ms, staff, tick) {
    var part = ms.plugin.curScore.staves[staff].part;
    var data = part.instrumentAtTick(tick).stringData;
    var strings = [];
    for (var i = 0; i < data.strings.length; i++) {
        var s = data.strings[i];
        strings.push(s.open ? { pitch: s.pitch, open: true } : { pitch: s.pitch });
    }
    return { strings: strings, frets: data.frets };
}

// The chord in voice 1 of `staff` starting exactly at `tick`, or null.
function chordAt(ms, staff, tick) {
    var c = ms.plugin.curScore.newCursor();
    c.track = staff * 4;
    c.rewindToTick(tick);
    if (!c.segment || c.tick !== tick) return null;
    var el = c.element;
    return el && el.type === ms.Element.CHORD ? el : null;
}

// The fingering of a chord as {string, fret} pairs, or null if any note
// has no string.
function fingeringOf(chord) {
    if (!chord) return null;
    var stops = [];
    for (var i = 0; i < chord.notes.length; i++) {
        var n = chord.notes[i];
        if (n.string < 0 || n.fret < 0) return null;
        stops.push({ string: n.string, fret: n.fret });
    }
    return stops;
}

// Key signature (sharps positive) of a bass note, read where the chord
// sounding it starts: a cursor without an element under it at a tick moves
// on to the next one, and reading the key past the last one crashes.
function keySignatureOf(ms, note) {
    var source = note.pieces[0].source;
    var c = ms.plugin.curScore.newCursor();
    c.track = source.track;
    c.rewindToTick(source.tick);
    return c.segment ? c.keySignature : ms.plugin.curScore.keysig;
}

// Major or minor, guessed from the last bass note: the relative minor's
// tonic means minor, anything else major.
function guessMode(ms, line) {
    for (var i = line.length - 1; i >= 0; i--) {
        if (!line[i].rest) {
            return line[i].tpc - 14 === keySignatureOf(ms, line[i]) + 3 ? "minor" : "major";
        }
    }
    return "major";
}

// The tablature staves of the score: [{staff, name}].
function tabStaves(ms, tick) {
    var score = ms.plugin.curScore;
    var found = [];
    for (var i = 0; i < score.nstaves; i++) {
        var st = score.staves[i];
        if (st.isTabStaff(ms.plugin.fraction(tick, TICKS_PER_WHOLE))) {
            found.push({ staff: i, name: st.part.partName + " (staff " + (i + 1) + ")" });
        }
    }
    return found;
}

// 1-based bar number of `tick`.
function barAt(ms, tick) {
    var c = ms.plugin.curScore.newCursor();
    c.rewindToTick(tick);
    return c.measure ? c.measure.no + 1 : 0;
}

// --- The CLI -----------------------------------------------------------

function runCli(ms, request) {
    // FileIO refuses to overwrite a file in the temp directory on macOS;
    // remove it first.
    var path = ms.io.tempPath() + "/intavolatura-request.json";
    ms.io.source = path;
    ms.io.remove();
    if (!ms.io.write(JSON.stringify(request))) {
        throw new Error("Could not write " + path);
    }
    ms.proc.startWithArgs(ms.cliPath, [path]);
    if (!ms.proc.waitForFinished(30000)) {
        throw new Error("intavolatura-cli did not run (" + ms.cliPath + ")");
    }
    var out = String(ms.proc.readAllStandardOutput());
    var response;
    try {
        response = JSON.parse(out);
    } catch (e) {
        throw new Error("intavolatura-cli gave no answer: " + out);
    }
    if (response.error) throw new Error(response.error);
    return response;
}

// The presets for the strings of `staff`, best match first: [{id, name}].
function presets(ms, staff, tick) {
    return runCli(ms, { command: "presets", strings: readStrings(ms, staff, tick).strings }).presets;
}

// --- Writing -----------------------------------------------------------

// Note values with up to two dots, longest first, in ticks.
var VALUES = (function () {
    var values = [];
    for (var den = 1; den <= 64; den *= 2) {
        var plain = TICKS_PER_WHOLE / den;
        values.push({ ticks: plain, num: 1, den: den });
        if (den * 2 <= 64) values.push({ ticks: plain * 3 / 2, num: 3, den: den * 2 });
        if (den * 4 <= 64) values.push({ ticks: plain * 7 / 4, num: 7, den: den * 4 });
    }
    return values.sort(function (a, b) { return b.ticks - a.ticks; });
})();

// `ticks` as note values to tie, longest first, or null.
function noteValues(ticks) {
    var out = [];
    while (ticks > 0) {
        var v = VALUES.find(function (x) { return x.ticks <= ticks; });
        if (!v) return null;
        out.push(v);
        ticks -= v.ticks;
    }
    return out;
}

// The units to write for a span: [{tick, num, den, tuplet}], tied
// together. Inside a tuplet only whole tuplet notes can be copied.
function units(piece) {
    var e = piece.source;
    if (e && e.tuplet) {
        if (piece.tick !== e.tick || piece.ticks !== e.end - e.tick) {
            throw new Error("Cannot copy a rhythm that splits a tuplet note (tick "
                + piece.tick + ")");
        }
        return [{ tick: piece.tick, num: e.written.num, den: e.written.den, tuplet: e.tuplet }];
    }
    var values = noteValues(piece.ticks);
    if (!values) throw new Error("Cannot copy a duration of " + piece.ticks + " ticks");
    var tick = piece.tick;
    return values.map(function (v) {
        var u = { tick: tick, num: v.num, den: v.den, tuplet: null };
        tick += v.ticks;
        return u;
    });
}

// The pieces of `note` between `from` and `to`.
function piecesBetween(note, from, to) {
    var out = [];
    note.pieces.forEach(function (p) {
        var a = Math.max(p.tick, from), b = Math.min(p.tick + p.ticks, to);
        if (a < b) out.push({ tick: a, ticks: b - a, source: p.source });
    });
    return out;
}

function Writer(ms, staff) {
    this.ms = ms;
    this.staff = staff;
    this.cursor = ms.plugin.curScore.newCursor();
    this.cursor.track = staff * 4;
    this.ties = []; // [{tick, stops}] notes of the chord at tick to tie forward
}

Writer.prototype.start = function (tick) {
    this.cursor.rewindToTick(tick);
    if (this.cursor.tick !== tick) {
        throw new Error("Cannot start writing at tick " + tick + " in the tablature staff");
    }
};

Writer.prototype.enter = function (unit) {
    var c = this.cursor;
    if (unit.tuplet && unit.tick === unit.tuplet.start) {
        c.addTuplet(this.ms.plugin.fraction(unit.tuplet.actual, unit.tuplet.normal),
                    this.ms.plugin.fraction(unit.tuplet.num, unit.tuplet.den));
    }
    c.setDuration(unit.num, unit.den);
};

Writer.prototype.rest = function (unit) {
    this.enter(unit);
    this.cursor.addRest();
};

// Writes one chord: pitches, then string, fret and spelling of each note.
Writer.prototype.chord = function (unit, notes) {
    this.enter(unit);
    var c = this.cursor;
    for (var i = 0; i < notes.length; i++) c.addNote(notes[i].pitch, i > 0);
    var chord = chordAt(this.ms, this.staff, unit.tick);
    if (!chord) throw new Error("A chord was not written at tick " + unit.tick);
    var free = [];
    for (var k = 0; k < chord.notes.length; k++) free.push(chord.notes[k]);
    notes.forEach(function (want) {
        var at = free.findIndex(function (n) { return n.pitch === want.pitch; });
        if (at < 0) return;
        var n = free.splice(at, 1)[0];
        n.string = want.string;
        n.fret = want.fret;
        n.tpc = want.tpc;
    });
};

Writer.prototype.label = function (tick, text) {
    var c = this.ms.plugin.curScore.newCursor();
    c.track = this.staff * 4;
    c.rewindToTick(tick);
    var st = this.ms.plugin.newElement(this.ms.Element.STAFF_TEXT);
    st.text = text;
    c.add(st);
};

// Ties the given notes of each recorded chord to the chord after it.
Writer.prototype.tie = function () {
    var score = this.ms.plugin.curScore;
    for (var i = 0; i < this.ties.length; i++) {
        var t = this.ties[i];
        var chord = chordAt(this.ms, this.staff, t.tick);
        if (!chord) continue;
        score.selection.clear();
        var any = false;
        for (var k = 0; k < chord.notes.length; k++) {
            var n = chord.notes[k];
            if (t.stops.some(function (s) { return s.string === n.string && s.fret === n.fret; })) {
                score.selection.select(n, any);
                any = true;
            }
        }
        if (any) this.ms.plugin.cmd("tie");
    }
};


// Reports progress to `ms.trace`, if the caller gave one (the test harness).
function trace(ms, label) {
    if (ms.trace) ms.trace(label);
}
// --- Realize -----------------------------------------------------------

// The selected range: {staff, from, to} in ticks, `to` exclusive; null
// without a range selection.
function selectedRange(ms) {
    var score = ms.plugin.curScore;
    var sel = score.selection;
    if (!sel.isRange) return null;
    return {
        staff: sel.startStaff,
        from: sel.startSegment.tick,
        to: sel.endSegment ? sel.endSegment.tick : score.lastSegment.tick
    };
}

// Selects `staff` from `from` to `to`. Selection.selectRange cannot reach
// the end of the score (its end snaps to the last segment), so `to` at the
// end selects up to the last chord or rest only.
function selectRange(ms, staff, from, to) {
    ms.plugin.curScore.selection.selectRange(from, to, staff, staff + 1);
}

// Turns everything in voice 1 of `staff` from `from` to `to` into rests,
// removing tuplets, so the range can be written afresh.
function clearRange(ms, staff, from, to) {
    var score = ms.plugin.curScore;
    selectRange(ms, staff, from, to);
    // Read before deleting: the delete removes segments the selection points to.
    var end = score.selection.endSegment ? score.selection.endSegment.tick : to;
    ms.plugin.cmd("delete");
    // What a range ending at the score end left out: its last chord.
    var last = end < to ? chordAt(ms, staff, end) : null;
    if (last) {
        score.selection.clear();
        for (var i = 0; i < last.notes.length; i++) score.selection.select(last.notes[i], i > 0);
        ms.plugin.cmd("delete");
    }
    // A range delete leaves tuplets in place, filled with rests; remove
    // them, so tuplets can be written where the bass has them.
    var starts = [];
    var c = score.newCursor();
    c.track = staff * 4;
    c.rewindToTick(from);
    while (c.segment && c.tick < to) {
        var t = c.element && c.element.tuplet;
        if (t) {
            var start = t.elements[0].fraction.ticks;
            if (start >= from && starts.indexOf(start) < 0) starts.push(start);
        }
        if (!c.next()) break;
    }
    starts.forEach(function (tick) {
        c.rewindToTick(tick);
        if (c.tick === tick && c.element && c.element.tuplet) {
            ms.plugin.removeElement(c.element.tuplet);
        }
    });
    // The delete keeps staff texts; drop the labels of an earlier run.
    var labels = [];
    for (var seg = score.firstSegment(); seg && seg.tick < to; seg = seg.next) {
        if (seg.tick < from) continue;
        var anns = seg.annotations;
        for (var k = 0; k < anns.length; k++) {
            var a = anns[k];
            if (a.type === ms.Element.STAFF_TEXT && Math.floor(a.track / 4) === staff
                && String(a.text) === LABEL) {
                labels.push(a);
            }
        }
    }
    labels.forEach(function (a) { ms.plugin.removeElement(a); });
}

// Asks the CLI to `command` ("realize", "next", "previous") every bass
// note of `line`, one request per key signature (the instrument keeps its
// tuning). `fingering(note)` gives the fingering to keep or step from.
// Returns the results by note id.
function ask(ms, command, line, settings, fingering) {
    var instrument = readStrings(ms, settings.target, line[0].tick);
    instrument.preset = settings.preset;
    var groups = [];
    line.forEach(function (note) {
        if (note.rest) return;
        var signature = keySignatureOf(ms, note);
        var group = groups.find(function (g) { return g.signature === signature; });
        if (!group) {
            group = { signature: signature, notes: [] };
            groups.push(group);
        }
        group.notes.push({
            id: note.id,
            pitch: note.pitch,
            tpc: note.tpc,
            figures: note.parts.map(function (p) { return p.text; }),
            fingering: fingering(note)
        });
    });
    var results = {};
    groups.forEach(function (g) {
        var response = runCli(ms, {
            command: command,
            key: { signature: g.signature, mode: settings.mode },
            instrument: instrument,
            settings: { fretSpan: settings.fretSpan, candidates: settings.candidates },
            notes: g.notes
        });
        response.notes.forEach(function (r) { results[r.id] = r; });
    });
    return results;
}

// Writes `line` with the CLI's `results` from the writer's position on:
// chords with held voices tied, rests, and a label where a note failed.
// Adds what it wrote to `report` ({written, failed}).
function writeLine(ms, writer, line, results, report) {
    line.forEach(function (note) {
        trace(ms, "note at " + note.tick);
        var result = results[note.id];
        if (note.rest || result.error) {
            piecesBetween(note, note.tick, note.end).forEach(function (p) {
                units(p).forEach(function (u) { writer.rest(u); });
            });
            if (!note.rest) {
                writer.label(note.tick, LABEL);
                report.failed.push({
                    bar: barAt(ms, note.tick),
                    figures: note.parts.map(function (p) { return p.text.replace(/\n/g, " "); }).join(" – "),
                    error: result.error
                });
            }
            return;
        }
        note.parts.forEach(function (part, i) {
            var sounding = result.parts[i].notes;
            var all = sounding.map(function (n) { return { string: n.string, fret: n.fret }; });
            var held = i + 1 < note.parts.length
                ? result.parts[i + 1].notes.filter(function (n) { return !n.struck; })
                    .map(function (n) { return { string: n.string, fret: n.fret }; })
                : [];
            var us = [];
            piecesBetween(note, part.tick, part.end).forEach(function (p) {
                us = us.concat(units(p));
            });
            us.forEach(function (u, k) {
                writer.chord(u, sounding);
                var stops = k + 1 === us.length ? held : all;
                if (stops.length > 0) writer.ties.push({ tick: u.tick, stops: stops });
            });
        });
        report.written++;
    });
}

// The bass line of `staff` from `from` to `to` with its figures, notes
// numbered; and the figures that fell on rests.
function figuredLine(ms, staff, from, to) {
    var line = readBassLine(ms, staff, from, to);
    line.forEach(function (note, id) { note.id = id; });
    var stray = attachFigures(line, readFigures(ms, staff, from, to));
    return { line: line, stray: stray };
}

// Rewrites `line` (from `from` to `to`) into the target staff as one undo
// step named `name`.
function rewrite(ms, name, settings, line, results, from, to, report) {
    var score = ms.plugin.curScore;
    score.startCmd(name);
    try {
        trace(ms, "clear");
        clearRange(ms, settings.target, from, to);
        var writer = new Writer(ms, settings.target);
        writer.start(from);
        writeLine(ms, writer, line, results, report);
        trace(ms, "tie");
        writer.tie();
        score.setMetaTag(META_TAG, JSON.stringify(settings));
        score.endCmd();
    } catch (e) {
        score.endCmd(true);
        throw e;
    }
}

// The score's last realize settings: {source, target, mode, preset,
// fretSpan, candidates}, or null.
var META_TAG = "intavolatura";
function savedSettings(ms) {
    var text = ms.plugin.curScore.metaTag(META_TAG);
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// Realizes the range (default: the selected one) of the bass staff into
// the tablature staff `options.target`, and remembers the settings in the
// score for cycling. Options: target, mode ("major"/"minor"), preset,
// fretSpan, candidates, keep (keep chords that already have a fingering),
// range ({staff, from, to}).
// Returns {written, failed: [{bar, figures, error}], stray: [bar]}.
function realizeSelection(ms, options) {
    var range = options.range || selectedRange(ms);
    if (!range) throw new Error("Select a range of the bass staff first.");
    if (options.target === range.staff) throw new Error("The tablature staff cannot be the bass staff.");
    var settings = {
        source: range.staff,
        target: options.target,
        mode: options.mode,
        preset: options.preset,
        fretSpan: options.fretSpan,
        candidates: options.candidates
    };
    trace(ms, "read");
    var read = figuredLine(ms, range.staff, range.from, range.to);
    trace(ms, "cli");
    var results = ask(ms, "realize", read.line, settings, function (note) {
        return options.keep ? fingeringOf(chordAt(ms, settings.target, note.tick)) : null;
    });
    var report = { written: 0, failed: [], stray: read.stray.map(function (f) { return barAt(ms, f.tick); }) };
    rewrite(ms, "Realize figured bass", settings, read.line, results, range.from, range.to, report);
    selectRange(ms, range.staff, range.from, range.to);
    trace(ms, "done");
    return report;
}

// The tick of the selection: a selected note or chord, or the start of a
// range; null when nothing is selected.
function selectedTick(ms) {
    var sel = ms.plugin.curScore.selection;
    if (sel.isRange) return sel.startSegment.tick;
    if (sel.elements.length === 0) return null;
    var el = sel.elements[0];
    if (el.type === ms.Element.NOTE) el = el.parent;
    return el.fraction ? el.fraction.ticks : null;
}

// Replaces the fingering of the bass note at the selection (in the bass
// staff, the tablature or its standard staff) by the next (or previous)
// of its best candidates, with the score's last realize settings.
// `tick` overrides the selection. Returns {written, failed}.
function cycleSelection(ms, forward, tick) {
    var settings = savedSettings(ms);
    if (!settings) throw new Error("Realize the figured bass first.");
    if (tick === undefined || tick === null) tick = selectedTick(ms);
    if (tick === null) throw new Error("Select a chord of the realization first.");
    var score = ms.plugin.curScore;
    var whole = figuredLine(ms, settings.source, 0, score.lastSegment.tick);
    var note = whole.line.find(function (n) { return n.tick <= tick && tick < n.end; });
    if (!note || note.rest) throw new Error("There is no bass note at the selection.");
    var results = ask(ms, forward ? "next" : "previous", [note], settings, function (n) {
        return fingeringOf(chordAt(ms, settings.target, n.tick));
    });
    var report = { written: 0, failed: [] };
    rewrite(ms, forward ? "Next fingering" : "Previous fingering", settings, [note], results,
            note.tick, note.end, report);
    var chord = chordAt(ms, settings.target, note.tick);
    if (chord) score.selection.select(chord.notes[0]);
    return report;
}
