/**
 * Bank registry shared by server and client code.
 *
 * Identities and ordering are fixed here; everything else (titles, totals,
 * taxonomy) is derived from each bank's meta.json written by pipeline/books.py.
 * Adding a bank = adding it to pipeline/books.py and listing it here.
 */

export type BankLayout =
  /** one stem + four options, numbering restarts per teaching block */
  "flat"
  /** one 资料 (table / chart / text) shared by a group of items */
  | "material-group";

export interface BankDef {
  id: string;
  /** Short module name shown in the 题型广场. */
  title: string;
  /** Full book title, used before the bank has a meta.json of its own. */
  fullTitle: string;
  layout: BankLayout;
  /** OCR cache directory names per side, mirroring pipeline/books.py. */
  tags: { up: string; dn: string };
  /** Scanned page counts per side, so the plaza can show build progress. */
  pages: { up: number; dn: number };
}

export const BANK_LIST: BankDef[] = [
  {
    id: "panduan",
    title: "判断推理",
    fullTitle: "决战行测5000题·判断推理（粉笔公考 2025年9月版）",
    layout: "flat",
    tags: { up: "up", dn: "dn" },
    pages: { up: 392, dn: 510 },
  },
  {
    id: "shuliang",
    title: "数量关系",
    fullTitle: "决战行测5000题·数量关系（粉笔公考 2025年9月版）",
    layout: "flat",
    tags: { up: "sl-up", dn: "sl-dn" },
    pages: { up: 256, dn: 368 },
  },
  {
    id: "ziliao",
    title: "资料分析",
    fullTitle: "决战行测5000题·资料分析（粉笔公考 2025年9月版）",
    layout: "material-group",
    tags: { up: "zl-up", dn: "zl-dn" },
    pages: { up: 312, dn: 504 },
  },
  {
    id: "yanyu",
    title: "言语理解",
    fullTitle: "决战行测5000题·言语理解与表达（粉笔公考 2025年9月版）",
    layout: "flat",
    tags: { up: "yy-up", dn: "yy-dn" },
    pages: { up: 360, dn: 412 },
  },
];

export const bankTags = (id: string): string[] => {
  const def = BANK_LIST.find((b) => b.id === id);
  return def ? [def.tags.up, def.tags.dn] : [];
};

export const bankPageTotal = (id: string): number => {
  const def = BANK_LIST.find((b) => b.id === id);
  return def ? def.pages.up + def.pages.dn : 0;
};

export function bankDef(id: string | null | undefined): BankDef {
  return BANK_LIST.find((b) => b.id === id) ?? BANK_LIST[0];
}

/** Globally unique chapter identity across banks: chapterIndex restarts per book. */
export const chapterKey = (bankId: string, chapterIndex: number): string =>
  `${bankId}:${chapterIndex}`;

/** OCR page tag → book side of the pair it belongs to. */
export const sideOfTag = (tag: string): "up" | "dn" => (tag.endsWith("dn") ? "dn" : "up");

/**
 * 200 dpi OCR page geometry per cache tag: bbox coordinates live in this pixel
 * space while page JPEGs are 115 dpi renders of the same page. Percentages of
 * these dimensions map onto the displayed image at any size.
 */
export const PAGE_DIMS: Record<string, { w: number; h: number }> = {
  up: { w: 1386, h: 2008 },
  dn: { w: 1441, h: 2048 },
  "sl-up": { w: 1417, h: 2025 },
  "sl-dn": { w: 1442, h: 2047 },
  "zl-up": { w: 1394, h: 2016 },
  "zl-dn": { w: 1441, h: 2048 },
  "yy-up": { w: 1433, h: 2048 },
  "yy-dn": { w: 1441, h: 2048 },
};

export const BOOK_LABEL: Record<string, string> = {
  up: "上册 · 题目",
  dn: "下册 · 答案与解析",
};
