/**
 * The word-navigation rules used by VS Code's editor are more specific than
 * CodeMirror's letter/non-letter grouping.  Keep the port independent from
 * EditorView so the same boundary decisions can be tested and reused by
 * movement, deletion, and selection code.
 *
 * All offsets in this file intentionally use JavaScript string offsets.  They
 * are UTF-16 code-unit offsets, which is also what CodeMirror's document and
 * selection APIs use.  Intl.Segmenter.index/segment.length use the same unit.
 */

export enum WordCharacterClass {
  Regular,
  Whitespace,
  WordSeparator,
}

export enum WordNavigationType {
  WordStart,
  WordStartFast,
  WordEnd,
  WordAccessibility,
}

// WordAccessibility in VS Code deliberately ignores the user's configured
// separators and uses the editor's built-in separator set instead.
const ACCESSIBILITY_WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

enum WordType {
  None,
  Regular,
  Separator,
}

export interface WordModel {
  getLineContent(lineNumber: number): string;
  getLineMaxColumn(lineNumber: number): number;
  getLineCount(): number;
}

export interface WordPosition {
  lineNumber: number;
  column: number;
}

export interface WordRange {
  from: WordPosition;
  to: WordPosition;
}

export interface FoundWord {
  /** Zero-based, inclusive start within one line. */
  start: number;
  /** Zero-based, exclusive end within one line. */
  end: number;
  type: WordType;
  /** The class that caused the word to end. */
  nextCharClass: WordCharacterClass;
}

export interface WordNavigatorOptions {
  wordSeparators: string;
  /** `undefined` means host-default Intl locale; `[]` disables segmentation. */
  wordSegmenterLocales?: readonly string[];
  /** Override only when matching a host with a different accessibility set. */
  accessibilityWordSeparators?: string;
}

interface IntlWordSegmentData extends Intl.SegmentData {
  isWordLike: true;
}

/**
 * VS Code's WordCharacterClassifier, reduced to the data needed by cursor
 * movement.  The source classifies only space and tab as whitespace because
 * line navigation already operates one line at a time.
 */
export class WordCharacterClassifier {
  readonly wordSeparators: string;
  readonly intlSegmenterLocales: readonly string[] | undefined;

  private readonly classes = new Map<number, WordCharacterClass>();
  private readonly segmenter: Intl.Segmenter | null;
  private cachedLine: string | null = null;
  private cachedSegments: IntlWordSegmentData[] = [];

  constructor(
    wordSeparators: string,
    intlSegmenterLocales: readonly string[] | undefined = [],
  ) {
    this.wordSeparators = wordSeparators;
    this.intlSegmenterLocales = intlSegmenterLocales;

    // `wordSeparators` is intentionally scanned by UTF-16 code unit, matching
    // VS Code's charCodeAt loop and preserving its configuration semantics.
    for (let i = 0; i < wordSeparators.length; i++) {
      this.classes.set(
        wordSeparators.charCodeAt(i),
        WordCharacterClass.WordSeparator,
      );
    }
    this.classes.set(0x20, WordCharacterClass.Whitespace);
    this.classes.set(0x09, WordCharacterClass.Whitespace);

    let segmenter: Intl.Segmenter | null = null;
    const shouldUseSegmenter =
      intlSegmenterLocales === undefined || intlSegmenterLocales.length > 0;
    if (shouldUseSegmenter && typeof Intl !== "undefined") {
      try {
        segmenter = new Intl.Segmenter(intlSegmenterLocales, {
          granularity: "word",
        });
      } catch {
        // Editor options validate locales, but a host can still lack a locale
        // data set.  Falling back keeps ordinary word navigation available.
      }
    }
    this.segmenter = segmenter;
  }

  get(charCode: number): WordCharacterClass {
    return this.classes.get(charCode) ?? WordCharacterClass.Regular;
  }

  findPrevIntlWordBeforeOrAtOffset(
    line: string,
    offset: number,
  ): IntlWordSegmentData | null {
    let candidate: IntlWordSegmentData | null = null;
    for (const segment of this.getIntlWordsOnLine(line)) {
      if (segment.index > offset) break;
      candidate = segment;
    }
    return candidate;
  }

  findNextIntlWordAtOrAfterOffset(
    line: string,
    offset: number,
  ): IntlWordSegmentData | null {
    for (const segment of this.getIntlWordsOnLine(line)) {
      if (segment.index >= offset) return segment;
    }
    return null;
  }

  private getIntlWordsOnLine(line: string): IntlWordSegmentData[] {
    if (!this.segmenter) return [];
    if (this.cachedLine === line) return this.cachedSegments;

    this.cachedLine = line;
    this.cachedSegments = [];
    for (const segment of this.segmenter.segment(line)) {
      if (segment.isWordLike) {
        this.cachedSegments.push(segment as IntlWordSegmentData);
      }
    }
    return this.cachedSegments;
  }
}

/**
 * Port of the boundary and cursor portions of VS Code's WordOperations.
 * Position columns are one-based, while FoundWord offsets are zero-based.
 */
export class WordNavigator {
  readonly classifier: WordCharacterClassifier;
  private readonly accessibilityClassifier: WordCharacterClassifier;

  constructor(options: WordNavigatorOptions) {
    this.classifier = new WordCharacterClassifier(
      options.wordSeparators,
      options.wordSegmenterLocales,
    );
    this.accessibilityClassifier = new WordCharacterClassifier(
      options.accessibilityWordSeparators ?? ACCESSIBILITY_WORD_SEPARATORS,
      options.wordSegmenterLocales,
    );
  }

  findPreviousWordOnLine(
    model: WordModel,
    position: WordPosition,
  ): FoundWord | null {
    return this.findPreviousWordOnLineWithClassifier(
      model,
      position,
      this.classifier,
    );
  }

  private findPreviousWordOnLineWithClassifier(
    model: WordModel,
    position: WordPosition,
    classifier: WordCharacterClassifier,
  ): FoundWord | null {
    return this.doFindPreviousWordOnLine(
      model.getLineContent(position.lineNumber),
      position.column,
      classifier,
    );
  }

  findNextWordOnLine(
    model: WordModel,
    position: WordPosition,
  ): FoundWord | null {
    return this.findNextWordOnLineWithClassifier(
      model,
      position,
      this.classifier,
    );
  }

  private findNextWordOnLineWithClassifier(
    model: WordModel,
    position: WordPosition,
    classifier: WordCharacterClassifier,
  ): FoundWord | null {
    return this.doFindNextWordOnLine(
      model.getLineContent(position.lineNumber),
      position.column,
      classifier,
    );
  }

  moveWordLeft(
    model: WordModel,
    position: WordPosition,
    wordNavigationType: WordNavigationType,
    hasMulticursor = false,
  ): WordPosition {
    let lineNumber = position.lineNumber;
    let column = position.column;
    const classifier =
      wordNavigationType === WordNavigationType.WordAccessibility
        ? this.accessibilityClassifier
        : this.classifier;

    if (column === 1 && lineNumber > 1) {
      lineNumber--;
      column = model.getLineMaxColumn(lineNumber);
    }

    let previous = this.findPreviousWordOnLineWithClassifier(
      model,
      { lineNumber, column },
      classifier,
    );

    if (wordNavigationType === WordNavigationType.WordStart) {
      return { lineNumber, column: previous ? previous.start + 1 : 1 };
    }

    if (wordNavigationType === WordNavigationType.WordStartFast) {
      if (
        !hasMulticursor &&
        previous &&
        previous.type === WordType.Separator &&
        previous.end - previous.start === 1 &&
        previous.nextCharClass === WordCharacterClass.Regular
      ) {
        // VS Code skips one separator before a regular word for the fast
        // Windows/Linux Ctrl+Left command.  It disables this optimization for
        // multicursor moves so cursors do not stop at different boundaries.
        previous = this.findPreviousWordOnLineWithClassifier(
          model,
          { lineNumber, column: previous.start + 1 },
          classifier,
        );
      }
      return { lineNumber, column: previous ? previous.start + 1 : 1 };
    }

    if (wordNavigationType === WordNavigationType.WordAccessibility) {
      while (previous?.type === WordType.Separator) {
        previous = this.findPreviousWordOnLineWithClassifier(
          model,
          { lineNumber, column: previous.start + 1 },
          classifier,
        );
      }
      return { lineNumber, column: previous ? previous.start + 1 : 1 };
    }

    // WordEnd moves to the end of the previous word.  If the current cursor
    // is already inside that word, find the preceding word first.
    if (previous && column <= previous.end + 1) {
      previous = this.findPreviousWordOnLineWithClassifier(
        model,
        { lineNumber, column: previous.start + 1 },
        classifier,
      );
    }
    return { lineNumber, column: previous ? previous.end + 1 : 1 };
  }

  moveWordRight(
    model: WordModel,
    position: WordPosition,
    wordNavigationType: WordNavigationType,
  ): WordPosition {
    let lineNumber = position.lineNumber;
    let column = position.column;
    let movedDown = false;
    const classifier =
      wordNavigationType === WordNavigationType.WordAccessibility
        ? this.accessibilityClassifier
        : this.classifier;

    if (
      column === model.getLineMaxColumn(lineNumber) &&
      lineNumber < model.getLineCount()
    ) {
      movedDown = true;
      lineNumber++;
      column = 1;
    }

    let next = this.findNextWordOnLineWithClassifier(
      model,
      { lineNumber, column },
      classifier,
    );

    if (wordNavigationType === WordNavigationType.WordEnd) {
      if (
        next?.type === WordType.Separator &&
        next.end - next.start === 1 &&
        next.nextCharClass === WordCharacterClass.Regular
      ) {
        // The fast right movement skips a single separator before a regular
        // word, matching VS Code's Ctrl+Right/Alt+Right behavior.
        next = this.findNextWordOnLineWithClassifier(
          model,
          { lineNumber, column: next.end + 1 },
          classifier,
        );
      }
      return {
        lineNumber,
        column: next ? next.end + 1 : model.getLineMaxColumn(lineNumber),
      };
    }

    if (wordNavigationType === WordNavigationType.WordAccessibility) {
      if (movedDown) column = 0;
      while (
        next &&
        (next.type === WordType.Separator || next.start + 1 <= column)
      ) {
        // Accessibility navigation skips separator-only words and any word
        // that begins at/before the current cursor to guarantee progress.
        next = this.findNextWordOnLineWithClassifier(
          model,
          { lineNumber, column: next.end + 1 },
          classifier,
        );
      }
      return {
        lineNumber,
        column: next ? next.start + 1 : model.getLineMaxColumn(lineNumber),
      };
    }

    if (next && !movedDown && column >= next.start + 1) {
      next = this.findNextWordOnLineWithClassifier(
        model,
        { lineNumber, column: next.end + 1 },
        classifier,
      );
    }
    return {
      lineNumber,
      column: next ? next.start + 1 : model.getLineMaxColumn(lineNumber),
    };
  }

  /**
   * Move to the furthest-left of the ordinary word boundaries and the next
   * camel/snake/kebab boundary.  VS Code uses this candidate comparison so a
   * word-part command still behaves sensibly in whitespace and punctuation.
   */
  moveWordPartLeft(
    model: WordModel,
    position: WordPosition,
    hasMulticursor = false,
  ): WordPosition {
    return maxPosition(
      this.moveWordLeft(
        model,
        position,
        WordNavigationType.WordStart,
        hasMulticursor,
      ),
      this.moveWordLeft(
        model,
        position,
        WordNavigationType.WordEnd,
        hasMulticursor,
      ),
      this.moveWordPartLeftDirect(model, position),
    );
  }

  private moveWordPartLeftDirect(
    model: WordModel,
    position: WordPosition,
  ): WordPosition {
    const lineNumber = position.lineNumber;
    const maxColumn = model.getLineMaxColumn(lineNumber);

    if (position.column === 1) {
      return lineNumber > 1
        ? {
            lineNumber: lineNumber - 1,
            column: model.getLineMaxColumn(lineNumber - 1),
          }
        : position;
    }

    const line = model.getLineContent(lineNumber);
    for (let column = position.column - 1; column > 1; column--) {
      const left = line.charCodeAt(column - 2);
      const right = line.charCodeAt(column - 1);

      if (left === 0x5f && right !== 0x5f) return { lineNumber, column };
      if (left === 0x2d && right !== 0x2d) return { lineNumber, column };
      if ((isLowerAscii(left) || isAsciiDigit(left)) && isUpperAscii(right)) {
        return { lineNumber, column };
      }
      if (isUpperAscii(left) && isUpperAscii(right)) {
        if (column + 1 < maxColumn) {
          const rightRight = line.charCodeAt(column);
          if (isLowerAscii(rightRight) || isAsciiDigit(rightRight)) {
            return { lineNumber, column };
          }
        }
      }
    }
    return { lineNumber, column: 1 };
  }

  /** See `moveWordPartLeft` for why ordinary word boundaries are candidates. */
  moveWordPartRight(model: WordModel, position: WordPosition): WordPosition {
    return minPosition(
      this.moveWordRight(model, position, WordNavigationType.WordStart),
      this.moveWordRight(model, position, WordNavigationType.WordEnd),
      this.moveWordPartRightDirect(model, position),
    );
  }

  private moveWordPartRightDirect(
    model: WordModel,
    position: WordPosition,
  ): WordPosition {
    const lineNumber = position.lineNumber;
    const maxColumn = model.getLineMaxColumn(lineNumber);

    if (position.column === maxColumn) {
      return lineNumber < model.getLineCount()
        ? { lineNumber: lineNumber + 1, column: 1 }
        : position;
    }

    const line = model.getLineContent(lineNumber);
    for (let column = position.column + 1; column < maxColumn; column++) {
      const left = line.charCodeAt(column - 2);
      const right = line.charCodeAt(column - 1);

      if (left !== 0x5f && right === 0x5f) return { lineNumber, column };
      if (left !== 0x2d && right === 0x2d) return { lineNumber, column };
      if ((isLowerAscii(left) || isAsciiDigit(left)) && isUpperAscii(right)) {
        return { lineNumber, column };
      }
      if (isUpperAscii(left) && isUpperAscii(right)) {
        if (column + 1 < maxColumn) {
          const rightRight = line.charCodeAt(column);
          if (isLowerAscii(rightRight) || isAsciiDigit(rightRight)) {
            return { lineNumber, column };
          }
        }
      }
    }
    return { lineNumber, column: maxColumn };
  }

  deleteWordLeft(
    model: WordModel,
    position: WordPosition,
    wordNavigationType = WordNavigationType.WordStart,
    whitespaceHeuristics = true,
  ): WordRange | null {
    if (position.lineNumber === 1 && position.column === 1) return null;

    if (whitespaceHeuristics) {
      const line = model.getLineContent(position.lineNumber);
      const startIndex = position.column - 2;
      const lastNonWhitespace = lastNonWhitespaceIndex(line, startIndex);
      if (lastNonWhitespace + 1 < startIndex) {
        return {
          from: {
            lineNumber: position.lineNumber,
            column: lastNonWhitespace + 2,
          },
          to: position,
        };
      }
    }

    let lineNumber = position.lineNumber;
    let column = position.column;
    let previous = this.findPreviousWordOnLine(model, position);

    if (wordNavigationType === WordNavigationType.WordStart) {
      if (previous) column = previous.start + 1;
      else if (column > 1) column = 1;
      else {
        lineNumber--;
        column = model.getLineMaxColumn(lineNumber);
      }
    } else {
      if (previous && column <= previous.end + 1) {
        previous = this.findPreviousWordOnLine(model, {
          lineNumber,
          column: previous.start + 1,
        });
      }
      if (previous) column = previous.end + 1;
      else if (column > 1) column = 1;
      else {
        lineNumber--;
        column = model.getLineMaxColumn(lineNumber);
      }
    }

    return {
      from: { lineNumber, column },
      to: position,
    };
  }

  deleteWordRight(
    model: WordModel,
    position: WordPosition,
    wordNavigationType = WordNavigationType.WordEnd,
    whitespaceHeuristics = true,
  ): WordRange | null {
    const lineCount = model.getLineCount();
    const maxColumn = model.getLineMaxColumn(position.lineNumber);
    if (position.lineNumber === lineCount && position.column === maxColumn) {
      return null;
    }

    if (whitespaceHeuristics) {
      const line = model.getLineContent(position.lineNumber);
      const startIndex = position.column - 1;
      const firstNonWhitespace = firstNonWhitespaceIndex(line, startIndex);
      if (startIndex < firstNonWhitespace) {
        return {
          from: position,
          to: {
            lineNumber: position.lineNumber,
            column: firstNonWhitespace + 1,
          },
        };
      }
    }

    let lineNumber = position.lineNumber;
    let column = position.column;
    let next = this.findNextWordOnLine(model, position);

    if (wordNavigationType === WordNavigationType.WordEnd) {
      if (next) column = next.end + 1;
      else if (column < maxColumn || lineNumber === lineCount) {
        column = maxColumn;
      } else {
        lineNumber++;
        next = this.findNextWordOnLine(model, { lineNumber, column: 1 });
        column = next ? next.start + 1 : model.getLineMaxColumn(lineNumber);
      }
    } else {
      if (next && column >= next.start + 1) {
        next = this.findNextWordOnLine(model, {
          lineNumber,
          column: next.end + 1,
        });
      }
      if (next) column = next.start + 1;
      else if (column < maxColumn || lineNumber === lineCount) {
        column = maxColumn;
      } else {
        lineNumber++;
        next = this.findNextWordOnLine(model, { lineNumber, column: 1 });
        column = next ? next.start + 1 : model.getLineMaxColumn(lineNumber);
      }
    }

    return {
      from: position,
      to: { lineNumber, column },
    };
  }

  /**
   * Implements the non-drag part of VS Code's `WordOperations.word` used by
   * double-click selection.  The caller can still use the editor's mouse bias
   * when it needs visual-side disambiguation at a boundary.
   */
  selectWord(model: WordModel, position: WordPosition): WordRange {
    const previous = this.findPreviousWordOnLine(model, position);
    const next = this.findNextWordOnLine(model, position);
    const offset = position.column - 1;

    const touches = (word: FoundWord) =>
      word.start <= offset &&
      (word.type === WordType.Regular ? offset <= word.end : offset < word.end);

    if (previous && touches(previous)) {
      return this.rangeForWord(position.lineNumber, previous);
    }
    if (next && touches(next)) {
      return this.rangeForWord(position.lineNumber, next);
    }

    return {
      from: {
        lineNumber: position.lineNumber,
        column: previous ? previous.end + 1 : 1,
      },
      to: {
        lineNumber: position.lineNumber,
        column: next
          ? next.start + 1
          : model.getLineMaxColumn(position.lineNumber),
      },
    };
  }

  private rangeForWord(lineNumber: number, word: FoundWord): WordRange {
    return {
      from: { lineNumber, column: word.start + 1 },
      to: { lineNumber, column: word.end + 1 },
    };
  }

  private doFindPreviousWordOnLine(
    line: string,
    column: number,
    classifier: WordCharacterClassifier,
  ): FoundWord | null {
    let wordType = WordType.None;
    const previousIntlWord = classifier.findPrevIntlWordBeforeOrAtOffset(
      line,
      column - 2,
    );

    for (let index = column - 2; index >= 0; index--) {
      const charClass = classifier.get(line.charCodeAt(index));

      if (previousIntlWord && index === previousIntlWord.index) {
        return this.createIntlWord(previousIntlWord, charClass);
      }

      if (charClass === WordCharacterClass.Regular) {
        if (wordType === WordType.Separator) {
          return this.createWord(
            wordType,
            charClass,
            index + 1,
            this.findEndOfWord(line, classifier, wordType, index + 1),
          );
        }
        wordType = WordType.Regular;
      } else if (charClass === WordCharacterClass.WordSeparator) {
        if (wordType === WordType.Regular) {
          return this.createWord(
            wordType,
            charClass,
            index + 1,
            this.findEndOfWord(line, classifier, wordType, index + 1),
          );
        }
        wordType = WordType.Separator;
      } else if (wordType !== WordType.None) {
        return this.createWord(
          wordType,
          charClass,
          index + 1,
          this.findEndOfWord(line, classifier, wordType, index + 1),
        );
      }
    }

    if (wordType !== WordType.None) {
      return this.createWord(
        wordType,
        WordCharacterClass.Whitespace,
        0,
        this.findEndOfWord(line, classifier, wordType, 0),
      );
    }
    return null;
  }

  private doFindNextWordOnLine(
    line: string,
    column: number,
    classifier: WordCharacterClassifier,
  ): FoundWord | null {
    let wordType = WordType.None;
    const nextIntlWord = classifier.findNextIntlWordAtOrAfterOffset(
      line,
      column - 1,
    );

    for (let index = column - 1; index < line.length; index++) {
      const charClass = classifier.get(line.charCodeAt(index));

      if (nextIntlWord && index === nextIntlWord.index) {
        return this.createIntlWord(nextIntlWord, charClass);
      }

      if (charClass === WordCharacterClass.Regular) {
        if (wordType === WordType.Separator) {
          return this.createWord(
            wordType,
            charClass,
            this.findStartOfWord(line, classifier, wordType, index - 1),
            index,
          );
        }
        wordType = WordType.Regular;
      } else if (charClass === WordCharacterClass.WordSeparator) {
        if (wordType === WordType.Regular) {
          return this.createWord(
            wordType,
            charClass,
            this.findStartOfWord(line, classifier, wordType, index - 1),
            index,
          );
        }
        wordType = WordType.Separator;
      } else if (wordType !== WordType.None) {
        return this.createWord(
          wordType,
          charClass,
          this.findStartOfWord(line, classifier, wordType, index - 1),
          index,
        );
      }
    }

    if (wordType !== WordType.None) {
      return this.createWord(
        wordType,
        WordCharacterClass.Whitespace,
        this.findStartOfWord(line, classifier, wordType, line.length - 1),
        line.length,
      );
    }
    return null;
  }

  private findEndOfWord(
    line: string,
    classifier: WordCharacterClassifier,
    wordType: WordType,
    startIndex: number,
  ): number {
    const nextIntlWord = classifier.findNextIntlWordAtOrAfterOffset(
      line,
      startIndex,
    );
    for (let index = startIndex; index < line.length; index++) {
      const charClass = classifier.get(line.charCodeAt(index));

      if (
        nextIntlWord &&
        index === nextIntlWord.index + nextIntlWord.segment.length
      ) {
        return index;
      }
      if (charClass === WordCharacterClass.Whitespace) return index;
      if (
        wordType === WordType.Regular &&
        charClass === WordCharacterClass.WordSeparator
      ) {
        return index;
      }
      if (
        wordType === WordType.Separator &&
        charClass === WordCharacterClass.Regular
      ) {
        return index;
      }
    }
    return line.length;
  }

  private findStartOfWord(
    line: string,
    classifier: WordCharacterClassifier,
    wordType: WordType,
    startIndex: number,
  ): number {
    const previousIntlWord = classifier.findPrevIntlWordBeforeOrAtOffset(
      line,
      startIndex,
    );
    for (let index = startIndex; index >= 0; index--) {
      const charClass = classifier.get(line.charCodeAt(index));

      if (previousIntlWord && index === previousIntlWord.index) {
        return index;
      }
      if (charClass === WordCharacterClass.Whitespace) return index + 1;
      if (
        wordType === WordType.Regular &&
        charClass === WordCharacterClass.WordSeparator
      ) {
        return index + 1;
      }
      if (
        wordType === WordType.Separator &&
        charClass === WordCharacterClass.Regular
      ) {
        return index + 1;
      }
    }
    return 0;
  }

  private createWord(
    type: WordType,
    nextCharClass: WordCharacterClass,
    start: number,
    end: number,
  ): FoundWord {
    return { start, end, type, nextCharClass };
  }

  private createIntlWord(
    word: IntlWordSegmentData,
    nextCharClass: WordCharacterClass,
  ): FoundWord {
    return {
      start: word.index,
      end: word.index + word.segment.length,
      type: WordType.Regular,
      nextCharClass,
    };
  }
}

function lastNonWhitespaceIndex(line: string, startIndex: number): number {
  for (let index = Math.min(startIndex, line.length - 1); index >= 0; index--) {
    if (line.charCodeAt(index) !== 0x20 && line.charCodeAt(index) !== 0x09) {
      return index;
    }
  }
  return -1;
}

function firstNonWhitespaceIndex(line: string, startIndex: number): number {
  for (let index = Math.max(startIndex, 0); index < line.length; index++) {
    if (line.charCodeAt(index) !== 0x20 && line.charCodeAt(index) !== 0x09) {
      return index;
    }
  }
  return line.length;
}

function isLowerAscii(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

function isUpperAscii(code: number): boolean {
  return code >= 0x41 && code <= 0x5a;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function comparePosition(a: WordPosition, b: WordPosition): number {
  return a.lineNumber - b.lineNumber || a.column - b.column;
}

function maxPosition(...positions: WordPosition[]): WordPosition {
  return positions.reduce((max, position) =>
    comparePosition(position, max) > 0 ? position : max,
  );
}

function minPosition(...positions: WordPosition[]): WordPosition {
  return positions.reduce((min, position) =>
    comparePosition(position, min) < 0 ? position : min,
  );
}
