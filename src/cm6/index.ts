/* eslint-disable prefer-arrow/prefer-arrow-functions */
import type { SelectionRange } from "@codemirror/state";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { around } from "monkey-around";

import type CMJpPatch from "../chsp-main";
import { getJpPatchExtension } from "./chs-extension";
import cm6GetJpSeg from "./get-seg";

const setupCM6 = (plugin: CMJpPatch) => {
  plugin.registerEditorExtension(getJpPatchExtension(plugin));
  // wordAt monkey patch
  plugin.register(
    around(EditorState.prototype, {
      wordAt: (next) =>
        function (this: EditorState, pos: number) {
          const srcRange = next.call(this, pos);
          return (
            cm6GetJpSeg(plugin, pos, next.call(this, pos), this) ?? srcRange
          );
        },
    }),
  );

  let origPos: number | null;

  // cursor movement direction type
  enum Direction {
    BeginAndForward = "BeginAndForward",
    BeginAndBackward = "BeginAndBackward",
    ForwardAndForward = "ForwardAndForward",
    ForwardAndBackward = "ForwardAndBackward",
    BackwardAndForward = "BackwardAndForward",
    BackwardAndBackward = "BackwardAndBackward",
  }

  plugin.register(
    around(EditorView.prototype, {
      moveByGroup: (next) =>
        function (this: EditorView, start: SelectionRange, forward: boolean) {
          const dest = next.call(this, start, forward);
          if (dest.empty || start.empty) {
            let direction: Direction | null;
            if (dest.empty && start.empty) {
              direction = forward
                ? Direction.BeginAndForward
                : Direction.BeginAndBackward;
              origPos = start.from;
            } else if (forward) {
              direction =
                origPos != start.to
                  ? Direction.ForwardAndForward
                  : Direction.BackwardAndForward;
            } else {
              direction =
                origPos != start.from
                  ? Direction.BackwardAndBackward
                  : Direction.ForwardAndBackward;
            }

            let startPos: number;
            switch (direction) {
              case Direction.BeginAndForward:
                startPos = start.from;
                break;
              case Direction.BeginAndBackward:
              case Direction.ForwardAndBackward:
                startPos = start.to;
                break;
              case Direction.ForwardAndForward:
                if (start.from <= dest.to) {
                  startPos = start.to + 1;
                } else {
                  startPos = start.from + 1;
                }
                break;
              case Direction.BackwardAndForward:
                startPos = start.from + 1;
                break;
              case Direction.BackwardAndBackward:
                if (start.from > dest.to) {
                  startPos = start.from - 1;
                } else {
                  startPos = start.to;
                }
                break;
              default:
                startPos = start.from;
                break;
            }

            const destPos = plugin.getSegDestFromGroup(
              startPos,
              forward ? dest.from : dest.to,
              this.state.sliceDoc.bind(this.state),
            );

            if (destPos) return EditorSelection.range(destPos, destPos);
          }
          return dest;
        },
    }),
  );
};
export default setupCM6;
