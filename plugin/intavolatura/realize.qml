import QtQuick
import QtQuick.Layouts
import Muse.Ui
import Muse.UiComponents as MU
import MuseScore 3.0
import FileIO 3.0
import "intavolatura.js" as Intav

// Realize figured bass: writes a fingering for every bass note of the
// selected range into a tablature staff, from the figured bass under it.
MuseScore {
    id: root
    title: "Realize figured bass"
    description: "Writes a fingering for every bass note of the selected range into a tablature staff, from its figured bass."
    version: "0.1.0"
    pluginType: "dialog"
    categoryCode: "composing-arranging-tools"
    requiresScore: true

    width: 420
    height: column.implicitHeight + 32

    FileIO { id: io }
    QProcess { id: proc }

    Settings {
        id: prefs
        category: "Intavolatura"
        property int fretSpan: 4
        property int candidates: 10
        property bool keep: true
    }

    property var ms: null
    property var range: null
    property var targets: []
    property var presetList: []
    property int targetIndex: 0
    property int presetIndex: 0
    property string mode: "major"
    property string message: ""
    property bool finished: false

    function cliPath() {
        return Intav.cliPath(Qt.resolvedUrl("bin/intavolatura-cli"));
    }

    function loadPresets() {
        presetList = [];
        presetIndex = 0;
        if (targets.length === 0) return;
        try {
            presetList = Intav.presets(ms, targets[targetIndex].staff, range.from);
        } catch (e) {
            message = String(e.message || e);
        }
    }

    onRun: {
        ms = { plugin: root, Element: Element, io: io, proc: proc, cliPath: cliPath() };
        range = Intav.selectedRange(ms);
        if (!range) {
            message = "Select a range of the bass staff (its figured bass included) first.";
            finished = true;
            return;
        }
        targets = Intav.tabStaves(ms, range.from).filter(function (t) { return t.staff !== range.staff; });
        if (targets.length === 0) {
            message = "Add a plucked-string part with a tablature staff to write into first.";
            finished = true;
            return;
        }
        // Defaults: the choices of the last realize of this bass staff in the
        // score, else the first tablature staff below it and guesses.
        var saved = Intav.savedSettings(ms);
        if (saved && saved.source !== range.staff) saved = null;
        var below = targets.findIndex(function (t) { return t.staff > range.staff; });
        var previous = saved ? targets.findIndex(function (t) { return t.staff === saved.target; }) : -1;
        targetIndex = previous >= 0 ? previous : below >= 0 ? below : 0;
        if (saved) {
            mode = saved.mode;
        } else {
            var line = Intav.readBassLine(ms, range.staff, range.from, range.to);
            mode = Intav.guessMode(ms, line);
        }
        loadPresets();
        if (saved) {
            var preset = presetList.findIndex(function (p) { return p.id === saved.preset; });
            if (preset >= 0) presetIndex = preset;
        }
    }

    function realize() {
        try {
            var report = Intav.realizeSelection(ms, {
                target: targets[targetIndex].staff,
                mode: mode,
                preset: presetList[presetIndex].id,
                fretSpan: prefs.fretSpan,
                candidates: prefs.candidates,
                keep: prefs.keep,
                range: range
            });
            var lines = ["Realized " + report.written + " bass note" + (report.written === 1 ? "." : "s.")];
            report.failed.forEach(function (f) {
                lines.push("Bar " + f.bar + (f.figures ? " (" + f.figures + ")" : "") + ": " + f.error);
            });
            if (report.stray.length > 0) {
                lines.push("Figures over rests ignored in bar " + report.stray.join(", ") + ".");
            }
            message = lines.join("\n");
        } catch (e) {
            message = "Nothing was changed: " + String(e.message || e);
        }
        finished = true;
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: 16
        spacing: 12

        GridLayout {
            visible: !root.finished
            columns: 2
            columnSpacing: 12
            rowSpacing: 8

            MU.StyledTextLabel { text: "Tablature staff" }
            MU.StyledDropdown {
                Layout.preferredWidth: 240
                model: root.targets.map(function (t) { return { text: t.name, value: t.staff }; })
                currentIndex: root.targetIndex
                onActivated: function (index, value) {
                    root.targetIndex = index;
                    root.loadPresets();
                }
            }

            MU.StyledTextLabel { text: "Instrument rules" }
            MU.StyledDropdown {
                Layout.preferredWidth: 240
                model: root.presetList.map(function (p) { return { text: p.name, value: p.id }; })
                currentIndex: root.presetIndex
                onActivated: function (index, value) { root.presetIndex = index; }
            }

            MU.StyledTextLabel { text: "Mode" }
            MU.StyledDropdown {
                Layout.preferredWidth: 240
                model: [{ text: "Major", value: "major" }, { text: "Minor", value: "minor" }]
                currentIndex: root.mode === "minor" ? 1 : 0
                onActivated: function (index, value) { root.mode = value; }
            }

            MU.StyledTextLabel { text: "Fret span" }
            MU.IncrementalPropertyControl {
                Layout.preferredWidth: 100
                decimals: 0
                step: 1
                minValue: 2
                maxValue: 6
                currentValue: prefs.fretSpan
                onValueEdited: function (newValue) { prefs.fretSpan = newValue; }
            }

            MU.StyledTextLabel { text: "Fingerings to cycle" }
            MU.IncrementalPropertyControl {
                Layout.preferredWidth: 100
                decimals: 0
                step: 1
                minValue: 1
                maxValue: 50
                currentValue: prefs.candidates
                onValueEdited: function (newValue) { prefs.candidates = newValue; }
            }
        }

        MU.CheckBox {
            visible: !root.finished
            text: "Keep chords that already have a fingering"
            checked: prefs.keep
            onClicked: prefs.keep = !prefs.keep
        }

        MU.StyledTextLabel {
            Layout.fillWidth: true
            visible: root.message !== ""
            text: root.message
            wrapMode: Text.WordWrap
            horizontalAlignment: Text.AlignLeft
        }

        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: 8

            MU.FlatButton {
                text: root.finished ? "Close" : "Cancel"
                onClicked: root.quit()
            }
            MU.FlatButton {
                visible: !root.finished
                enabled: root.presetList.length > 0
                accentButton: true
                text: "Realize"
                onClicked: root.realize()
            }
        }
    }
}
