import QtQuick 2.0
import MuseScore 3.0
import FileIO 3.0
import "intavolatura.js" as Intav

// Next fingering: replaces the fingering of the bass note at the selection
// by the next of its best candidates. Give it a shortcut in Preferences →
// Shortcuts ("Run plugin Next fingering").
MuseScore {
    id: root
    title: "Next fingering"
    description: "Replaces the fingering of the selected realized chord by the next of its best candidates."
    version: "0.1.0"
    categoryCode: "composing-arranging-tools"
    requiresScore: true

    FileIO { id: io }
    QProcess { id: proc }
    MessageDialog { id: problem; title: "Next fingering" }

    onRun: {
        var ms = { plugin: root, Element: Element, io: io, proc: proc, cliPath: Intav.cliPath(Qt.resolvedUrl("bin/intavolatura-cli")) };
        try {
            var report = Intav.cycleSelection(ms, true);
            if (report.failed.length > 0) {
                problem.text = "Bar " + report.failed[0].bar + ": " + report.failed[0].error;
                problem.open();
            }
        } catch (e) {
            problem.text = String(e.message || e);
            problem.open();
        }
    }
}
