import QtQuick 2.0
import MuseScore 3.0
import FileIO 3.0
import "intavolatura.js" as Intav

// Previous fingering: replaces the fingering of the bass note at the
// selection by the previous of its best candidates. Give it a shortcut in
// Preferences → Shortcuts ("Run plugin Previous fingering").
MuseScore {
    id: root
    title: "Previous fingering"
    description: "Replaces the fingering of the selected realized chord by the previous of its best candidates."
    version: "0.1.0"
    categoryCode: "composing-arranging-tools"
    requiresScore: true

    FileIO { id: io }
    QProcess { id: proc }
    MessageDialog { id: problem; title: "Previous fingering" }

    onRun: {
        var ms = { plugin: root, Element: Element, io: io, proc: proc, cliPath: Intav.cliPath(Qt.resolvedUrl("bin/intavolatura-cli")) };
        try {
            var report = Intav.cycleSelection(ms, false);
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
