import katex from "katex";

export type MathTextToken =
  | { type: "text"; value: string }
  | {
      type: "math";
      value: string;
      displayMode: boolean;
      sourceKind: string;
    };

export type MathRenderResult =
  | { ok: true; html: string }
  | { ok: false; message: string; source: string };

const DISPLAY_ENVIRONMENTS = new Set([
  "aligned",
  "align",
  "align*",
  "array",
  "cases",
  "gathered",
  "matrix",
  "pmatrix",
  "bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);

export function sanitizeMathSource(text: string): string {
  if (!text) return "";

  return text.replace(
    /\r(?=(ight|angle|brace|brack|ceil|floor|vert|Vert)\b)/g,
    "\\r",
  );
}

function findUnescaped(source: string, needle: string, start: number): number {
  let cursor = start;

  while (cursor < source.length) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) return -1;

    let slashCount = 0;
    for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) {
      slashCount += 1;
    }

    if (slashCount % 2 === 0) {
      return index;
    }

    cursor = index + needle.length;
  }

  return -1;
}

function findEnvironmentEnd(
  source: string,
  environment: string,
  contentStart: number,
): number {
  const begin = `\\begin{${environment}}`;
  const end = `\\end{${environment}}`;
  let depth = 1;
  let cursor = contentStart;

  while (cursor < source.length) {
    const nextBegin = source.indexOf(begin, cursor);
    const nextEnd = source.indexOf(end, cursor);

    if (nextEnd === -1) return -1;

    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth += 1;
      cursor = nextBegin + begin.length;
      continue;
    }

    depth -= 1;
    if (depth === 0) return nextEnd + end.length;

    cursor = nextEnd + end.length;
  }

  return -1;
}

function parseBeginEnvironment(
  source: string,
  start: number,
): { environment: string; blockEnd: number } | null {
  const match = /^\\begin\{([^}]+)\}/.exec(source.slice(start));
  if (!match) return null;

  const environment = match[1];
  const blockStart = start + match[0].length;
  const blockEnd = findEnvironmentEnd(source, environment, blockStart);
  if (blockEnd === -1) return null;

  return { environment, blockEnd };
}

function normalizeMathValue(value: string, sourceKind: string): string {
  let result = value.trim();

  if (sourceKind === "tabular") {
    result = result
      .replace(/^\\begin\{tabular\}/, "\\begin{array}")
      .replace(/\\end\{tabular\}$/, "\\end{array}")
      .replace(/\$/g, " ");
  }

  return result;
}

function shouldDisplayMath(value: string, sourceKind: string): boolean {
  if (sourceKind !== "single-dollar") return true;

  const env = /^\\begin\{([^}]+)\}/.exec(value.trim());
  return !!env && DISPLAY_ENVIRONMENTS.has(env[1]);
}

function pushText(tokens: MathTextToken[], value: string): void {
  if (!value) return;

  const previous = tokens[tokens.length - 1];
  if (previous?.type === "text") {
    previous.value += value;
    return;
  }

  tokens.push({ type: "text", value });
}

function pushMath(
  tokens: MathTextToken[],
  value: string,
  displayMode: boolean,
  sourceKind: string,
): void {
  const normalizedValue = normalizeMathValue(value, sourceKind);
  if (!normalizedValue) return;

  tokens.push({
    type: "math",
    value: normalizedValue,
    displayMode,
    sourceKind,
  });
}

export function tokenizeMathText(text: string): MathTextToken[] {
  const source = sanitizeMathSource(text);
  const tokens: MathTextToken[] = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < source.length) {
    if (source.startsWith("$$", cursor)) {
      const end = findUnescaped(source, "$$", cursor + 2);
      if (end === -1) {
        cursor += 2;
        continue;
      }

      const value = source.slice(cursor + 2, end);
      if (value.trim()) {
        pushText(tokens, source.slice(textStart, cursor));
        pushMath(tokens, value, true, "double-dollar");
        cursor = end + 2;
        textStart = cursor;
        continue;
      }

      cursor = end + 2;
      continue;
    }

    if (source[cursor] === "$") {
      const end = findUnescaped(source, "$", cursor + 1);
      if (end === -1) {
        cursor += 1;
        continue;
      }

      const value = source.slice(cursor + 1, end);
      if (value.trim()) {
        pushText(tokens, source.slice(textStart, cursor));
        const displayMode = shouldDisplayMath(value, "single-dollar");
        pushMath(tokens, value, displayMode, "single-dollar");
        cursor = end + 1;
        textStart = cursor;
        continue;
      }

      cursor = end + 1;
      continue;
    }

    if (source.startsWith("\\[", cursor)) {
      const end = source.indexOf("\\]", cursor + 2);
      if (end === -1) {
        cursor += 2;
        continue;
      }

      pushText(tokens, source.slice(textStart, cursor));
      pushMath(tokens, source.slice(cursor + 2, end), true, "bracket");
      cursor = end + 2;
      textStart = cursor;
      continue;
    }

    if (source.startsWith("\\(", cursor)) {
      const end = source.indexOf("\\)", cursor + 2);
      if (end === -1) {
        cursor += 2;
        continue;
      }

      pushText(tokens, source.slice(textStart, cursor));
      pushMath(tokens, source.slice(cursor + 2, end), false, "paren");
      cursor = end + 2;
      textStart = cursor;
      continue;
    }

    if (source.startsWith("\\begin{", cursor)) {
      const parsed = parseBeginEnvironment(source, cursor);
      if (!parsed) {
        cursor += "\\begin{".length;
        continue;
      }

      const isDisplayEnvironment =
        parsed.environment === "tabular" ||
        DISPLAY_ENVIRONMENTS.has(parsed.environment);

      if (isDisplayEnvironment) {
        pushText(tokens, source.slice(textStart, cursor));
        pushMath(
          tokens,
          source.slice(cursor, parsed.blockEnd),
          true,
          parsed.environment === "tabular"
            ? "tabular"
            : `environment:${parsed.environment}`,
        );
        cursor = parsed.blockEnd;
        textStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  pushText(tokens, source.slice(textStart));
  return tokens;
}

export function renderMathHtml(
  source: string,
  displayMode: boolean,
): MathRenderResult {
  try {
    return {
      ok: true,
      html: katex.renderToString(source, {
        displayMode,
        output: "html",
        throwOnError: true,
        strict: "warn",
        trust: false,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown KaTeX error",
      source,
    };
  }
}

export function normalizeMathMarkdown(text: string): string {
  return tokenizeMathText(text)
    .map((token) => {
      if (token.type === "text") return token.value;

      if (!renderMathHtml(token.value, token.displayMode).ok) {
        return `<!-- math render failed: ${token.sourceKind} -->${token.value}`;
      }

      if (token.displayMode) {
        return `\n$$\n${token.value}\n$$\n`;
      }

      return `$${token.value}$`;
    })
    .join("");
}
