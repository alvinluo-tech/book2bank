"use client";

import { useState } from "react";
import clsx from "clsx";

/**
 * Plain <img> that degrades to a hint when the pipeline has not produced the
 * asset yet (figures / crops / page scans are all optional artifacts).
 */
export default function SmartImage({
  src,
  alt,
  hint = "图片尚未生成",
  className,
  boxClassName,
  width,
  height,
}: {
  src: string | null;
  alt: string;
  hint?: string;
  className?: string;
  boxClassName?: string;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        role="note"
        className={clsx(
          "flex items-center justify-center rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] leading-relaxed text-muted",
          boxClassName,
          className,
        )}
      >
        {hint}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- page scans / crops are pipeline artifacts served straight from /public
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={clsx(className)}
    />
  );
}
