/* eslint-disable prefer-arrow/prefer-arrow-functions */
import { EditorSelection } from "@codemirror/state";
import type { SelectionRange } from "@codemirror/state";
import type { MouseSelectionStyle } from "@codemirror/view";
import { EditorView } from "@codemirror/view";

import type CMJpPatch from "../../chsp-main";
import type { WordModel } from "../word-navigation";
import { queryPos } from "./from-src";

export const dblClickPatch = (plugin: CMJpPatch) => {
  /** only accept double click */
  const rangeForClick = (
    view: EditorView,
    pos: number,
    _bias: -1 | 1,
    _type: number,
  ): SelectionRange => {
    const line = view.state.doc.lineAt(pos);
    const model: WordModel = {
      getLineContent: (lineNumber) => view.state.doc.line(lineNumber).text,
      getLineMaxColumn: (lineNumber) =>
        view.state.doc.line(lineNumber).length + 1,
      getLineCount: () => view.state.doc.lines,
    };
    const navigator = plugin.getWordNavigator();
    const range = navigator.selectWord(model, {
      lineNumber: line.number,
      column: pos - line.from + 1,
    });
    const fromLine = view.state.doc.line(range.from.lineNumber);
    const toLine = view.state.doc.line(range.to.lineNumber);
    // WordNavigator works in line-relative one-based columns, while mouse
    // selections use the document's UTF-16 offsets.
    return EditorSelection.range(
      fromLine.from + range.from.column - 1,
      toLine.from + range.to.column - 1,
    );
  };
  const dblClickPatch = EditorView.mouseSelectionStyle.of((view, event) => {
    // Only handle double clicks
    if (event.button !== 0 || event.detail !== 2) return null;

    // From https://github.com/codemirror/view/blob/0.19.30/src/input.ts#L464-L495
    const start = queryPos(view, event),
      type = event.detail; // not targeting ie, no need for polyfill
    let startSel = view.state.selection;
    let last = start,
      lastEvent: MouseEvent | null = event;
    return {
      update(update) {
        if (update.docChanged) {
          if (start) start.pos = update.changes.mapPos(start.pos);
          startSel = startSel.map(update.changes);
          lastEvent = null;
        }
      },
      get(event, extend, multiple) {
        let cur;
        if (
          lastEvent &&
          event.clientX == lastEvent.clientX &&
          event.clientY == lastEvent.clientY
        )
          cur = last;
        else {
          cur = last = queryPos(view, event);
          lastEvent = event;
        }
        if (!cur || !start) return startSel;
        let range = rangeForClick(view, cur.pos, cur.bias, type);
        if (start.pos != cur.pos && !extend) {
          const startRange = rangeForClick(view, start.pos, start.bias, type);
          const from = Math.min(startRange.from, range.from),
            to = Math.max(startRange.to, range.to);
          range =
            from < range.from
              ? EditorSelection.range(from, to)
              : EditorSelection.range(to, from);
        }
        if (extend)
          return startSel.replaceRange(
            startSel.main.extend(range.from, range.to),
          );
        else if (multiple) return startSel.addRange(range);
        else return EditorSelection.create([range]);
      },
    } as MouseSelectionStyle;
  });
  return dblClickPatch;
};
