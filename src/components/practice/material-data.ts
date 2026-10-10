"use server";

import { getMaterial } from "@/lib/bank";
import type { Material } from "@/lib/types";

/**
 * 资料只存在于服务端产物里（data/banks/<bank>/materials.json，由 src/lib/bank.ts 读取，
 * 并把磁盘上已不存在的图片指针置空）。/practice 是客户端页面，取资料必须过这道一次性函数。
 *
 * 只按 id 单点回查、并且限定条数：一次翻页最多要两组，绝不可能把整本资料都拖进浏览器。
 */
const MAX_PER_CALL = 24;

export interface MaterialsPayload {
  materials: Material[];
  /** 请求过但题库里已经没有的 id（重建题库后残留的旧引用）。 */
  missing: string[];
}

export async function loadMaterials(ids: string[]): Promise<MaterialsPayload> {
  const materials: Material[] = [];
  const missing: string[] = [];
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id))].slice(
    0,
    MAX_PER_CALL,
  );
  for (const id of unique) {
    const material = getMaterial(id);
    if (material) materials.push(material);
    else missing.push(id);
  }
  return { materials, missing };
}
