import { describe, expect, it } from "vitest";
import {
  normalizeMathMarkdown,
  renderMathHtml,
  sanitizeMathSource,
  tokenizeMathText,
} from "./mathText";

describe("sanitizeMathSource", () => {
  it("repairs JSON strings where \\right became a carriage return", () => {
    const broken = "\\left(x" + "\r" + "ight)";

    expect(sanitizeMathSource(broken)).toBe("\\left(x\\right)");
  });
});

describe("tokenizeMathText", () => {
  it("recognizes inline dollar math", () => {
    const tokens = tokenizeMathText("设随机变量 $X$ 满足条件");

    expect(tokens).toEqual([
      { type: "text", value: "设随机变量 " },
      {
        type: "math",
        value: "X",
        displayMode: false,
        sourceKind: "single-dollar",
      },
      { type: "text", value: " 满足条件" },
    ]);
  });

  it("recognizes display dollar math and consecutive display blocks", () => {
    const tokens = tokenizeMathText("前 $$a=1$$ $$b=2$$ 后");

    expect(tokens.filter((token) => token.type === "math")).toEqual([
      {
        type: "math",
        value: "a=1",
        displayMode: true,
        sourceKind: "double-dollar",
      },
      {
        type: "math",
        value: "b=2",
        displayMode: true,
        sourceKind: "double-dollar",
      },
    ]);
  });

  it("recognizes LaTeX bracket and paren delimiters", () => {
    const tokens = tokenizeMathText("行内 \\(x+1\\) 展示 \\[ y=2 \\]");

    expect(tokens.filter((token) => token.type === "math")).toEqual([
      {
        type: "math",
        value: "x+1",
        displayMode: false,
        sourceKind: "paren",
      },
      {
        type: "math",
        value: "y=2",
        displayMode: true,
        sourceKind: "bracket",
      },
    ]);
  });

  it("converts naked tabular environments to KaTeX array display math", () => {
    const [token] = tokenizeMathText(
      "\\begin{tabular}{c|cc}\n$X$ & 0 & 1 \\\\\n\\hline$p$ & $1/2$ & $1/2$\n\\end{tabular}",
    ).filter((item) => item.type === "math");

    expect(token).toEqual({
      type: "math",
      value:
        "\\begin{array}{c|cc}\n X  & 0 & 1 \\\\\n\\hline p  &  1/2  &  1/2 \n\\end{array}",
      displayMode: true,
      sourceKind: "tabular",
    });
  });

  it("does not swallow text around empty double-dollar separators", () => {
    const source = "P\\{X=0\\}=0 $$ $$ P\\{X=1\\}=1";

    expect(tokenizeMathText(source)).toEqual([{ type: "text", value: source }]);
  });
});

describe("renderMathHtml", () => {
  it("renders valid math to KaTeX HTML", () => {
    const result = renderMathHtml("\\frac{1}{2}", false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.html).toContain("katex");
    }
  });

  it("returns an error result for invalid math", () => {
    const result = renderMathHtml("\\definitelyUnknownCommand", false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.source).toBe("\\definitelyUnknownCommand");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeMathMarkdown", () => {
  it("exports normalized inline and display delimiters", () => {
    expect(normalizeMathMarkdown("A \\(x\\) B \\[ y \\]")).toBe(
      "A $x$ B \n$$\ny\n$$\n",
    );
  });
});
