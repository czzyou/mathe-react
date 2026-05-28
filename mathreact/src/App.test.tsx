import { describe, expect, it } from "vitest";
import {
  buildChapterTree,
  compareChapterNodes,
  type ChapterNode,
} from "./App";

describe("chapter ordering", () => {
  it("orders chapter names by numeric section parts instead of internal ids", () => {
    const nodes: ChapterNode[] = [
      { id: 138, chapter_name: "4.4 协方差与相关系数", count: 43 },
      { id: 146, chapter_name: "4.5 矩", count: 5 },
      { id: 166, chapter_name: "4.3 期望与方差计算", count: 39 },
    ];

    expect(nodes.toSorted(compareChapterNodes).map((node) => node.chapter_name))
      .toEqual([
        "4.3 期望与方差计算",
        "4.4 协方差与相关系数",
        "4.5 矩",
      ]);
  });

  it("keeps sibling tree nodes in chapter-number order", () => {
    const nodes: ChapterNode[] = [
      { id: 1, parent_id: null, chapter_name: "概率统计", count: 87 },
      { id: 111, parent_id: 1, chapter_name: "第4章 随机变量的数字特征", count: 87 },
      { id: 138, parent_id: 111, chapter_name: "4.4 协方差与相关系数", count: 43 },
      { id: 146, parent_id: 111, chapter_name: "4.5 矩", count: 5 },
      { id: 166, parent_id: 111, chapter_name: "4.3 期望与方差计算", count: 39 },
    ];

    const [chapter] = buildChapterTree(nodes, new Set([138, 146, 166]));

    expect(chapter.children.map((node) => node.name)).toEqual([
      "4.3 期望与方差计算",
      "4.4 协方差与相关系数",
      "4.5 矩",
    ]);
  });
});
