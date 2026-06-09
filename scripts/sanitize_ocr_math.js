const fs = require("fs");
const path = require("path");
const katex = require("../mathreact/node_modules/katex");

const TARGETS = [401, 404, 405, 407, 408, 409, 412, 413, 416, 417, 419, 420, 421, 422];
const CHAPTER_DIR = path.join("mathreact", "public", "data", "chapters");

const MANUAL_TEXT_FIXES = {
  "407001": {
    question:
      "A,B 两个地区种植同一型号的小麦. 现抽取了 19 块面积相同的麦田, 其中 9 块属于地区 A, 另外 10 块属于地区 B, 测得它们的小麦产量(以 kg 计)分别如下:\n" +
      "地区 A: 100, 105, 110, 125, 110, 98, 105, 116, 112\n" +
      "地区 B: 101, 100, 105, 115, 111, 107, 106, 121, 102, 92\n" +
      "设地区 A 的小麦产量 $X\\sim N(\\mu_1,\\sigma^2)$, 地区 B 的小麦产量 $Y\\sim N(\\mu_2,\\sigma^2)$, $\\mu_1,\\mu_2,\\sigma^2$ 均未知, 则这两个地区小麦的平均产量之差 $\\mu_1-\\mu_2$ 的 90% 置信区间为 ( ).",
  },
  "420001": {
    question:
      "总体 $X\\sim N(\\mu_1,\\sigma_1^2)$, 总体 $Y\\sim N(\\mu_2,\\sigma_2^2)$, 其中 $\\mu_1,\\mu_2$ 未知. $X_1,X_2,\\cdots,X_{n_1}$ 与 $Y_1,Y_2,\\cdots,Y_{n_2}$ 分别是来自总体 $X,Y$ 的样本, 两样本独立. 设两样本的样本方差分别为 $S_1^2,S_2^2$, 对 $H_0:\\frac{\\sigma_1^2}{\\sigma_2^2}=\\lambda(\\lambda>0)$, $H_1:\\frac{\\sigma_1^2}{\\sigma_2^2}\\ne\\lambda$, 其检验统计量 $F=(\\quad)$",
  },
};

function canRender(source, displayMode) {
  try {
    katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function repairFormula(source) {
  let fixed = source
    .replace(/\\boldmath/g, "\\mathbf")
    .replace(/\\textlangle/g, "<")
    .replace(/\\textbackslash\s*lambda/g, "\\lambda")
    .replace(/\\right\\(?![}\])])/g, "\\right\\}")
    .replace(/\$\$/g, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (fixed.length > 800 && (fixed.match(/\{\}/g) || []).length > 20) {
    return "";
  }
  return fixed;
}

function sanitizeMath(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf("$", index);
    if (start < 0) {
      result += text.slice(index);
      break;
    }
    result += text.slice(index, start);
    const display = text[start + 1] === "$";
    const openLen = display ? 2 : 1;
    const close = text.indexOf(display ? "$$" : "$", start + openLen);
    if (close < 0) {
      result += text.slice(start).replace(/\$/g, "");
      break;
    }

    const source = text.slice(start + openLen, close);
    if (canRender(source, display)) {
      result += text.slice(start, close + openLen);
    } else {
      const fixed = repairFormula(source);
      if (fixed && canRender(fixed, display)) {
        const fence = display ? "$$" : "$";
        result += `${fence}${fixed}${fence}`;
      } else if (fixed) {
        result += fixed;
      }
    }
    index = close + openLen;
  }
  return result
    .replace(/\s+([,，.。;；:：])/g, "$1")
    .replace(/\b(?:Neu\w*|eul\w*|athe)\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let changed = 0;
for (const cid of TARGETS) {
  const file = path.join(CHAPTER_DIR, `neumathe_chapter_${cid}_raw.json`);
  const pages = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const page of pages) {
    for (const question of page.data.questions) {
      const manual = MANUAL_TEXT_FIXES[String(question.id)];
      if (manual?.question) question.question = manual.question;
      question.question = sanitizeMath(question.question || "");
      question.analysis = sanitizeMath(question.analysis || "");
      for (const choice of question.choices) {
        choice.choice = sanitizeMath(choice.choice || "");
      }
      changed += 1;
    }
  }
  fs.writeFileSync(file, JSON.stringify(pages, null, 2), "utf8");
}

console.log(`sanitized ${changed} OCR questions`);
