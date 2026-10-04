/* eslint-disable prefer-arrow/prefer-arrow-functions */
import type { SelectionRange } from "@codemirror/state";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { around } from "monkey-around";

import type CMJpPatch from "../chsp-main";
import { getJpPatchExtension } from "./chs-extension";
import cm6GetJpSeg from "./get-seg";
import { WordNavigationType, type WordModel } from "./word-navigation";

const setupCM6 = (plugin: CMJpPatch) => {
  plugin.registerEditorExtension(getJpPatchExtension(plugin));
  // wordAt monkey patch
  plugin.register(
    around(EditorState.prototype, {
      wordAt: (next) =>
        function (this: EditorState, pos: number) {
          if (plugin.settings.splitMode === "custom") {
            const line = this.doc.lineAt(pos);
            const model: WordModel = {
              getLineContent: (lineNumber) => this.doc.line(lineNumber).text,
              getLineMaxColumn: (lineNumber) =>
                this.doc.line(lineNumber).length + 1,
              getLineCount: () => this.doc.lines,
            };
            // CodeMirror's original word range can already stop at punctuation
            // that VS Code treats as regular text. Scan the whole line first.
            const range = plugin.getWordNavigator().getWordAtPosition(model, {
              lineNumber: line.number,
              column: pos - line.from + 1,
            });
            return range
              ? EditorSelection.range(
                  line.from + range.from.column - 1,
                  line.from + range.to.column - 1,
                )
              : null;
          }
          const srcRange = next.call(this, pos);
          return cm6GetJpSeg(plugin, pos, srcRange, this) ?? srcRange;
        },
    }),
  );

  plugin.register(
    around(EditorView.prototype, {
      moveByGroup: (next) =>
        function (this: EditorView, start: SelectionRange, forward: boolean) {
          const state = this.state;
          const model: WordModel = {
            getLineContent: (lineNumber) => state.doc.line(lineNumber).text,
            getLineMaxColumn: (lineNumber) =>
              state.doc.line(lineNumber).length + 1,
            getLineCount: () => state.doc.lines,
          };
          const line = state.doc.lineAt(start.head);
          const position = {
            lineNumber: line.number,
            column: start.head - line.from + 1,
          };
          const navigator = plugin.getWordNavigator();
          const destination = forward
            ? navigator.moveWordRight(
                model,
                position,
                WordNavigationType.WordEnd,
              )
            : navigator.moveWordLeft(
                model,
                position,
                WordNavigationType.WordStartFast,
                state.selection.ranges.length > 1,
              );
          const destinationLine = state.doc.line(destination.lineNumber);
          const destinationOffset =
            destinationLine.from + destination.column - 1;

          // Keep CodeMirror's original result at a hard document boundary so
          // widget/association behavior is preserved when there is nowhere to
          // move.  Word boundaries themselves are decided by WordNavigator.
          if (destinationOffset === start.head) {
            return next.call(this, start, forward);
          }
          return EditorSelection.cursor(destinationOffset, forward ? -1 : 1);
        },
    }),
  );
};
export default setupCM6;
