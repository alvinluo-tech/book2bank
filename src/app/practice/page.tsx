"use client";

import { Suspense } from "react";
import Runner from "@/components/practice/runner";

/**
 * /practice — 刷题入口。
 * URL 参数：mode / chapter / section / point / kind / q / count / seconds / ids / auto / unanswered。
 * Runner 依赖 useSearchParams，因此包一层 Suspense（预渲染时必需）。
 */
export default function PracticePage() {
  return (
    <Suspense
      fallback={
        <div className="card p-6">
          <h1 className="text-lg font-semibold">刷题</h1>
          <p className="mt-2 text-sm text-muted">正在准备练习会话…</p>
        </div>
      }
    >
      <Runner />
    </Suspense>
  );
}
