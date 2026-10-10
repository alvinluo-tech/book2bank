"use client";

import { useEffect } from "react";
import { usePractice } from "@/lib/practice-store";
import { loadMaterials } from "./material-data";

/**
 * 把当前题（以及预取的下一题）需要的资料按需拉到练习会话的 store 里。
 *
 * 资料正文只存在服务端产物中，客户端只能经 material-data.ts 的一次性函数取回；
 * 这里负责去重与重试：同一个 id 一次会话只往返一次，失败则撤销认领、翻页时再试，
 * 期间 MaterialPanel 什么都不渲染，绝不会因为资料缺失而卡住答题。
 */
export function useMaterials(ids: (string | null | undefined)[]): void {
  const startedAt = usePractice((s) => s.startedAt);
  const requestMaterials = usePractice((s) => s.requestMaterials);
  const setMaterials = usePractice((s) => s.setMaterials);
  const releaseMaterials = usePractice((s) => s.releaseMaterials);

  const key = ids.filter((id): id is string => !!id).join(",");

  useEffect(() => {
    if (!key) return;
    const todo = requestMaterials(key.split(","));
    if (!todo.length) return;
    let alive = true;
    loadMaterials(todo)
      .then((res) => {
        if (!alive) return;
        setMaterials(res?.materials ?? [], res?.missing ?? []);
      })
      .catch(() => {
        if (alive) releaseMaterials(todo);
      });
    return () => {
      alive = false;
    };
  }, [key, startedAt, requestMaterials, setMaterials, releaseMaterials]);
}
