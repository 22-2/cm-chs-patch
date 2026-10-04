/* eslint-disable prefer-arrow/prefer-arrow-functions */
import type { EditorState, Transaction, StateCommand } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type CMJpPatch from "../chsp-main";
import { WordNavigationType, type WordModel } from "./word-navigation";

export const patchKeymap = (plugin: CMJpPatch) => {
  // based on https://github.com/codemirror/commands/releases/tag/6.1.1

  const getWordModel = (state: EditorState): WordModel => ({
    getLineContent: (lineNumber) => state.doc.line(lineNumber).text,
    getLineMaxColumn: (lineNumber) => state.doc.line(lineNumber).length + 1,
    getLineCount: () => state.doc.lines,
  });

  const moveByWord = (
    target: CommandTarget,
    forward: boolean,
    select: boolean,
    wordPart: boolean,
  ) => {
    const { state } = target;
    const model = getWordModel(state);
    const navigator = plugin.getWordNavigator();
    const hasMulticursor = state.selection.ranges.length > 1;
    const changes = state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const position = {
        lineNumber: line.number,
        column: range.head - line.from + 1,
      };
      const destination = forward
        ? wordPart
          ? navigator.moveWordPartRight(model, position)
          : navigator.moveWordRight(model, position, WordNavigationType.WordEnd)
        : wordPart
          ? navigator.moveWordPartLeft(model, position, hasMulticursor)
          : navigator.moveWordLeft(
              model,
              position,
              WordNavigationType.WordStartFast,
              hasMulticursor,
            );
      const destinationLine = state.doc.line(destination.lineNumber);
      const destinationOffset = destinationLine.from + destination.column - 1;

      return {
        range: select
          ? EditorSelection.range(range.anchor, destinationOffset)
          : EditorSelection.cursor(destinationOffset, forward ? -1 : 1),
      };
    });
    if (changes.selection.eq(state.selection, true)) return false;
    target.dispatch(
      state.update(changes, {
        scrollIntoView: true,
        userEvent: select ? "select.word" : "move.word",
      }),
    );
    return true;
  };

  const moveWordLeft: StateCommand = (target) =>
    moveByWord(target, false, false, false);
  const moveWordRight: StateCommand = (target) =>
    moveByWord(target, true, false, false);
  const selectWordLeft: StateCommand = (target) =>
    moveByWord(target, false, true, false);
  const selectWordRight: StateCommand = (target) =>
    moveByWord(target, true, true, false);
  const moveWordPartLeft: StateCommand = (target) =>
    moveByWord(target, false, false, true);
  const moveWordPartRight: StateCommand = (target) =>
    moveByWord(target, true, false, true);
  const selectWordPartLeft: StateCommand = (target) =>
    moveByWord(target, false, true, true);
  const selectWordPartRight: StateCommand = (target) =>
    moveByWord(target, true, true, true);

  function deleteBy(target: CommandTarget, by: (start: number) => number) {
    if (target.state.readOnly) return false;
    let event = "delete.selection";
    const { state } = target;
    const changes = state.changeByRange((range) => {
      let { from, to } = range;
      if (from == to) {
        let towards = by(from);
        if (towards < from) {
          event = "delete.backward";
          towards = skipAtomic(target, towards, false);
        } else if (towards > from) {
          event = "delete.forward";
          towards = skipAtomic(target, towards, true);
        }
        from = Math.min(from, towards);
        to = Math.max(to, towards);
      } else {
        from = skipAtomic(target, from, false);
        // Preserve both selection edges.  Using the already-adjusted `from`
        // here would shrink a selection when the left edge is atomic.
        to = skipAtomic(target, to, true);
      }
      return from == to
        ? { range }
        : { changes: { from, to }, range: EditorSelection.cursor(from) };
    });
    if (changes.changes.empty) return false;
    target.dispatch(
      state.update(changes, {
        scrollIntoView: true,
        userEvent: event,
        effects:
          event == "delete.selection"
            ? EditorView.announce.of(state.phrase("Selection deleted"))
            : undefined,
      }),
    );
    return true;
  }

  function skipAtomic(target: CommandTarget, pos: number, forward: boolean) {
    let _pos = pos;
    if (target instanceof EditorView)
      for (const ranges of target.state
        .facet(EditorView.atomicRanges)
        .map((f) => f(target)))
        ranges.between(_pos, _pos, (from, to) => {
          if (from < _pos && to > _pos) _pos = forward ? to : from;
        });
    return _pos;
  }

  const deleteByWord = (target: CommandTarget, forward: boolean) =>
    deleteBy(target, (start) => {
      const { state } = target;
      const model = getWordModel(state);
      const line = state.doc.lineAt(start);
      const position = {
        lineNumber: line.number,
        column: start - line.from + 1,
      };
      const navigator = plugin.getWordNavigator();
      const range = forward
        ? navigator.deleteWordRight(
            model,
            position,
            WordNavigationType.WordEnd,
            true,
          )
        : navigator.deleteWordLeft(
            model,
            position,
            WordNavigationType.WordStart,
            true,
          );
      if (!range) return start;
      const endpoint = forward ? range.to : range.from;
      return state.doc.line(endpoint.lineNumber).from + endpoint.column - 1;
    });

  /// Delete the selection or backward using VS Code's WordStart rules.
  /// Whitespace heuristics remove a contiguous run of spaces/tabs first.
  const deleteWordBackward: StateCommand = (target) =>
    deleteByWord(target, false);
  /// Delete the selection or forward using VS Code's WordEnd rules.
  const deleteWordForward: StateCommand = (target) =>
    deleteByWord(target, true);

  type CommandTarget = {
    state: EditorState;
    dispatch: (tr: Transaction) => void;
  };

  return keymap.of([
    // CodeMirror's built-in group commands call moveByGroup, but registering
    // these bindings also makes the VS Code shortcut mapping deterministic on
    // hosts whose bundled keymap omits one of the platform variants.
    {
      key: "Mod-ArrowLeft",
      mac: "Alt-ArrowLeft",
      run: moveWordLeft,
      shift: selectWordLeft,
    },
    {
      key: "Mod-ArrowRight",
      mac: "Alt-ArrowRight",
      run: moveWordRight,
      shift: selectWordRight,
    },
    // VS Code exposes word-part movement on macOS as Ctrl+Alt+Arrow.  Keep
    // that platform-specific binding so Cmd+Arrow remains line navigation.
    {
      mac: "Ctrl-Alt-ArrowLeft",
      run: moveWordPartLeft,
      shift: selectWordPartLeft,
    },
    {
      mac: "Ctrl-Alt-ArrowRight",
      run: moveWordPartRight,
      shift: selectWordPartRight,
    },
    { key: "Ctrl-Alt-h", run: deleteWordBackward },
    { key: "Mod-Backspace", mac: "Alt-Backspace", run: deleteWordBackward },
    { key: "Mod-Delete", mac: "Alt-Delete", run: deleteWordForward },
  ]);
};
