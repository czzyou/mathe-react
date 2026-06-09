import { describe, expect, it } from "vitest";
import {
  analyzeMathFailure,
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

  it("turns data-literal line breaks into real line breaks without breaking \\nu", () => {
    expect(sanitizeMathSource("前\\n$$x$$ and $\\nu$")).toBe(
      "前\n$$x$$ and $\\nu$",
    );
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

  it("strips literal line-break escapes from math token boundaries", () => {
    const tokens = tokenizeMathText(
      "$$\\nP\\{X_i=0\\}=\\left(\\frac{14}{15}\\right)^{10}\\n$$",
    );

    expect(tokens).toEqual([
      {
        type: "math",
        value: "P\\{X_i=0\\}=\\left(\\frac{14}{15}\\right)^{10}",
        displayMode: true,
        sourceKind: "double-dollar",
      },
    ]);
  });

  it("renders bare blank placeholders as readable text blanks", () => {
    expect(tokenizeMathText("则答案为( \\quad ).")).toEqual([
      { type: "text", value: "则答案为（　　）." },
    ]);
  });

  it("keeps \\quad untouched when it is inside math", () => {
    expect(tokenizeMathText("$P(A)=(\\quad)$")).toEqual([
      {
        type: "math",
        value: "P(A)=(\\quad)",
        displayMode: false,
        sourceKind: "single-dollar",
      },
    ]);
  });

  it("does not strip backslashes from LaTeX commands starting with n, r, or t at formula boundaries", () => {
    expect(tokenizeMathText("$\\theta_1$")).toEqual([
      {
        type: "math",
        value: "\\theta_1",
        displayMode: false,
        sourceKind: "single-dollar",
      },
    ]);
    expect(tokenizeMathText("$\\tau$")).toEqual([
      {
        type: "math",
        value: "\\tau",
        displayMode: false,
        sourceKind: "single-dollar",
      },
    ]);
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

  it("renders probability formulas with escaped braces and right delimiters", () => {
    const result = renderMathHtml(
      "P\\{X_i=0\\}=\\left(\\frac{14}{15}\\right)^{10}, \\quad P\\{X_i=1\\}=1-P\\{X_i=0\\}=1-\\left(\\frac{14}{15}\\right)^{10}",
      false,
    );

    expect(result.ok).toBe(true);
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

describe("analyzeMathFailure", () => {
  it("flags tokens that still contain math delimiters as boundary problems", () => {
    expect(
      analyzeMathFailure("$x$", "Expected 'EOF'", "single-dollar").reason,
    ).toContain("token");
  });
});

describe("normalizeMathMarkdown", () => {
  it("exports normalized inline and display delimiters", () => {
    expect(normalizeMathMarkdown("A \\(x\\) B \\[ y \\]")).toBe(
      "A $x$ B \n$$\ny\n$$\n",
    );
  });
});
