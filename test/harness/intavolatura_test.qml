import QtQuick 2.0
import MuseScore 3.0
import FileIO 3.0
import "../intavolatura/intavolatura.js" as Intav

// Headless driver for test/run.sh: reads options from
// $TMPDIR/intavolatura-test-options.json, runs a plugin action through the
// shared logic and writes what the target staff holds afterwards to
// $TMPDIR/intavolatura-test-report.json. Not shipped with the plugin.
MuseScore {
    id: harness
    title: "Intavolatura test harness"
    description: "Runs the Intavolatura plugin logic headless for tests"
    version: "1.0"
    requiresScore: true

    FileIO { id: io }
    QProcess { id: proc }

    function context(options) {
        return { plugin: harness, Element: Element, io: io, proc: proc, cliPath: options.cliPath,
                 trace: function (label) {
                     io.source = io.tempPath() + "/intavolatura-test-trace.txt";
                     io.remove();
                     io.write(label);
                 } };
    }

    // Whether a shipped plugin file compiles, or its errors.
    function compiles(file) {
        var component = Qt.createComponent("../intavolatura/" + file);
        return component.status === Component.Ready ? "ready" : component.errorString();
    }

    // Every chord and rest of voice 1 of `staff`, with staff texts.
    function contents(staff) {
        var out = [];
        var c = curScore.newCursor();
        c.track = staff * 4;
        c.rewind(0);
        while (c.segment) {
            var el = c.element;
            var item = { tick: c.tick, duration: el.duration.str, tuplet: !!el.tuplet };
            if (el.type === Element.CHORD) {
                item.notes = [];
                for (var i = 0; i < el.notes.length; i++) {
                    var n = el.notes[i];
                    item.notes.push({ pitch: n.pitch, tpc: n.tpc, string: n.string, fret: n.fret,
                                      tieFwd: !!n.tieForward, tieBack: !!n.tieBack });
                }
            } else {
                item.rest = true;
            }
            var anns = c.segment.annotations;
            for (var k = 0; k < anns.length; k++) {
                if (anns[k].type === Element.STAFF_TEXT && Math.floor(anns[k].track / 4) === staff)
                    item.text = String(anns[k].text);
            }
            out.push(item);
            if (!c.next()) break;
        }
        return out;
    }

    function save(report) {
        io.source = io.tempPath() + "/intavolatura-test-report.json";
        io.remove();
        io.write(JSON.stringify(report, null, 1));
    }

    onRun: {
        io.source = io.tempPath() + "/intavolatura-test-options.json";
        var options = JSON.parse(io.read());
        var ms = context(options);
        var report = { options: options, compiles: {} };
        ["realize.qml", "next.qml", "previous.qml"].forEach(function (f) { report.compiles[f] = compiles(f); });
        try {
            var to = options.endTick >= 0 ? options.endTick : curScore.lastSegment.tick;
            // Selection.selectRange cannot reach the score end, so runs get the
            // range a selection to the end gives the plugin.
            var range = { staff: options.source, from: options.startTick, to: to };
            var line = Intav.readBassLine(ms, options.source, options.startTick, to);
            report.line = line.map(function (n) {
                return (n.rest ? "r" : n.pitch) + "@" + n.tick + "-" + n.end;
            });
            report.modeGuess = Intav.guessMode(ms, line);
            report.tabStaves = Intav.tabStaves(ms, options.startTick);
            report.presets = Intav.presets(ms, options.target, options.startTick).map(function (p) { return p.id; });
            for (var r = 0; r < options.runs.length; r++) {
                var run = options.runs[r];
                run.range = range;
                report.lastRun = r;
                if (run.action === "realize") {
                    report["run" + r] = Intav.realizeSelection(ms, run);
                } else {
                    report["run" + r] = Intav.cycleSelection(ms, run.action === "next", run.tick);
                }
                report["target" + r] = contents(options.target);
            }
            report.meta = curScore.metaTag("intavolatura");
        } catch (e) {
            report.error = String(e);
        }
        report.target = contents(options.target);
        save(report);
    }
}
