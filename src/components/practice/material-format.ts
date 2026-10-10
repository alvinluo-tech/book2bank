/**
 * 资料的展示层纯函数：类型标签、标题清洗、把 OCR 的 "A | B | C" 行还原成表格。
 *
 * 这里刻意不 import fs、react 或 next —— 既能被客户端的 MaterialPanel 用，
 * 也能被服务端页面用，还能单独跑校验。
 */

import type { Material, MaterialKind } from "@/lib/types";

export const KIND_LABEL: Record<MaterialKind, string> = {
  table: "表格资料",
  chart: "图形资料",
  text: "文字资料",
  mixed: "综合资料",
};

export const kindLabel = (kind: MaterialKind | string | null | undefined): string =>
  (kind && KIND_LABEL[kind as MaterialKind]) || "资料";

/** OCR 会把「作业题1|」这类竖线噪声写进标题，展示前统一抹掉。 */
export function cleanLabel(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

/** （2023国考副省121～125） → 2023国考副省121～125 */
export function cleanSource(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[（）()]/g, "").replace(/\s+/g, "").trim();
  return s || null;
}

/** 作业题 +（二）这类组标记合成一条标签；两者都缺时退回 null。 */
export function groupLabelOf(material: Material): string | null {
  const label = [cleanLabel(material.setTitle), cleanLabel(material.groupLabel)]
    .filter(Boolean)
    .join(" · ");
  return label || null;
}

/* ------------------------------------------------------------------ */
/* 文字版数据 → 表格                                                   */
/* ------------------------------------------------------------------ */

export interface ParsedTable {
  header: string[];
  /** 长度为 1 的行是「续表 / 注」这类跨列说明行。 */
  rows: string[][];
  cols: number;
}

export function pad(row: string[], cols: number): string[] {
  return row.length >= cols ? row.slice(0, cols) : [...row, ...Array<string>(cols - row.length).fill("")];
}

/** 单元格里有数字：这一列按数字排（等宽数字 + 右对齐）。 */
const hasDigits = (s: string): boolean => /\d/.test(s);

/** 至少两行、且这些行确有多个单元格时才当表格，否则退回文字段落。 */
export function parseTable(text: string | null | undefined): ParsedTable | null {
  const rows = (text ?? "")
    .split("\n")
    .map((line) => line.replace(/\s*\|\s*/g, " | ").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split("|").map((cell) => cell.trim()));
  const multi = rows.filter((r) => r.length >= 2);
  if (multi.length < 2) return null;
  const cols = Math.max(...multi.map((r) => r.length));
  if (cols < 2) return null;

  let header: string[] | null = null;
  const body: string[][] = [];
  for (const row of rows) {
    if (!header && row.length >= 2) {
      header = row;
      continue;
    }
    body.push(row);
  }
  if (!header) return null;
  return { header: pad(header, cols), rows: body, cols };
}

export function toParagraphs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 每列是否右对齐。第一列是行标签（省份 / 行业名）固定左对齐；其余列按「带数字的单元格
 * 占多数」右对齐，这样表头「2016年」和数据「1318」视线能一列走下来，不用逐格判断。
 */
export function columnAligns(table: ParsedTable): boolean[] {
  const out: boolean[] = [];
  for (let c = 0; c < table.cols; c += 1) {
    if (c === 0) {
      out.push(false);
      continue;
    }
    let filled = 0;
    let numeric = 0;
    for (const row of table.rows) {
      if (row.length === 1) continue; // 「续表 / 注」这类跨列行不参与投票
      const cell = pad(row, table.cols)[c];
      if (!cell) continue;
      filled += 1;
      if (hasDigits(cell)) numeric += 1;
    }
    out.push(filled > 0 && numeric * 2 >= filled);
  }
  return out;
}
