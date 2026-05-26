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

export type MathFailureAnalysis = {
  reason: string;
  suggestion: string;
};

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

  return text
    .replace(
      /\r(?=(ight|angle|brace|brack|ceil|floor|vert|Vert)\b)/g,
      "\\r",
    )
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n(?=[$\\A-Z0-9\u4e00-\u9fff\s]|$)/g, "\n")
    .replace(/\\t(?=\s|$)/g, "\t");
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
  let result = value
    .replace(/^(?:\s|\\[nrt])+/, "")
    .replace(/(?:\s|\\[nrt])+$/, "");

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

function countUnescaped(source: string, char: string): number {
  let count = 0;

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== char) continue;

    let slashCount = 0;
    for (let j = i - 1; j >= 0 && source[j] === "\\"; j--) {
      slashCount += 1;
    }

    if (slashCount % 2 === 0) {
      count += 1;
    }
  }

  return count;
}

export function analyzeMathFailure(
  source: string,
  message: string,
  sourceKind: string,
): MathFailureAnalysis {
  if (source.includes("$")) {
    return {
      reason: "公式 token 内仍含有 `$` 分隔符，通常说明 tokenizer 把相邻内容一起吃进来了。",
      suggestion: "检查这个字段里失败公式前后的 `$...$` 或 `$$...$$` 是否成对。",
    };
  }

  if (countUnescaped(source, "{") !== countUnescaped(source, "}")) {
    return {
      reason: "花括号数量不平衡，KaTeX 无法确定命令参数范围。",
      suggestion: "优先检查 `\\frac{...}{...}`、上标、下标、`\\left...\\right` 附近。",
    };
  }

  if (/Undefined control sequence/.test(message)) {
    return {
      reason: "KaTeX 不支持其中某个 LaTeX 命令，或命令名被脏数据截断。",
      suggestion: "查看报错里的命令名；若是 `ight`、`rac` 这类残缺命令，说明原始转义损坏。",
    };
  }

  if (/Expected 'EOF'/.test(message) || /Unexpected character/.test(message)) {
    return {
      reason: "公式语法在中途结束或出现异常字符，常见原因是 token 边界切错。",
      suggestion: "把失败记录里的原字段和公式前后文一起看，定位是否多吃了中文、标点或下一段公式。",
    };
  }

  if (sourceKind === "tabular") {
    return {
      reason: "`tabular` 已转换为 KaTeX `array`，但其中可能仍有 KaTeX 不支持的表格语法。",
      suggestion: "检查列格式、`\\hline`、文本内容以及单元格内的 `$` 是否需要清洗。",
    };
  }

  return {
    reason: "该公式在当前 token 和 displayMode 下未通过 KaTeX。若公式单独可渲染，优先怀疑上下文切分。",
    suggestion: "复制失败记录中的 source、field、questionId，和原字段前后文本一起排查。",
  };
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
