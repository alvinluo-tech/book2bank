"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookTag } from "@/lib/types";
import { bookLabel, pageDims, pageSrc, type OverlayRect } from "./helpers";

/**
 * Page scan with clickable bbox annotations.
 * bboxes live in the 200 dpi OCR pixel space while the JPEG is a 115 dpi render of
 * the same page, so positions are expressed as percentages of the OCR page size —
 * which keeps the overlay aligned at any display width.
 */
export default function PageOverlay({
  tag,
  page,
  rects,
}: {
  tag: BookTag;
  page: number;
  rects: OverlayRect[];
}) {
  const [failed, setFailed] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  /** natural height / width of the rendered scan, once known; refines the vertical scale. */
  const [aspect, setAspect] = useState<number | null>(null);

  const geom = pageDims(tag);
  const ocrH = aspect ? geom.w * aspect : geom.h;
  const src = pageSrc(tag, page);
  const pct = (value: number, base: number) => `${((value / base) * 100).toFixed(3)}%`;

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
        <span className="text-muted">
          {bookLabel(tag)} 第 <span className="tabular-nums">{page}</span> 页 ·{" "}
          <span className="tabular-nums">{rects.length}</span> 处标注 ·{" "}
          <code className="chip">{src}</code>
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowBoxes((v) => !v)} className="btn px-2 py-1 text-xs">
            {showBoxes ? "隐藏标注" : "显示标注"}
          </button>
          <button type="button" onClick={() => setFailed(false)} className="btn px-2 py-1 text-xs">
            重载图片
          </button>
        </div>
      </div>

      {failed ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-sm font-medium">该页扫描图尚未生成</p>
          <p className="max-w-md text-xs leading-relaxed text-muted">
            <code>{src}</code> 不存在。页面图由 <code>python pipeline/crop_images.py --pages</code> 导出，
            仍可翻页或从右侧列表直接进入题目详情。
          </p>
        </div>
      ) : (
        <div className="relative bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${tag} 第 ${page} 页扫描`}
            width={geom.w}
            height={geom.h}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth > 0) setAspect(el.naturalHeight / el.naturalWidth);
            }}
            onError={() => setFailed(true)}
            className="block h-auto w-full select-none"
          />
          {showBoxes &&
            rects.map((r) => {
              const [x, y, w, h] = r.bbox;
              const heightPct = (h / ocrH) * 100;
              return (
                <Link
                  key={r.id}
                  href={`/question/${encodeURIComponent(r.id)}`}
                  title={`第 ${r.num} 题 · ${r.id} · ${r.title}`}
                  style={{
                    left: pct(x, geom.w),
                    top: pct(y, ocrH),
                    width: pct(w, geom.w),
                    height: pct(h, ocrH),
                    borderColor: "var(--brand)",
                    background: "rgba(79, 70, 229, 0.10)",
                  }}
                  className="group absolute z-10 overflow-hidden rounded border transition-shadow hover:z-20 hover:shadow-md"
                >
                  <span
                    style={{
                      color: "#fff",
                      background: "var(--brand)",
                      display: heightPct < 2.2 ? "none" : undefined,
                    }}
                    className="max-w-full truncate rounded-br px-1 text-[10px] leading-[1.4] tabular-nums"
                  >
                    {r.num} · {r.id}
                  </span>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
