import clsx from "clsx";
import Link from "next/link";
import { buildHref, PAGE_SIZES, type Filters } from "./helpers";

const PAGE_WINDOW = 2;

/** limit/offset pagination, entirely as links so filtered views stay shareable. */
export default function Pagination({
  total,
  limit,
  offset,
  current,
  base = "/bank",
}: {
  total: number;
  limit: number;
  offset: number;
  current: Filters;
  base?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.floor(offset / limit) + 1);
  const linkFor = (target: number, size = limit) =>
    buildHref(current, {
      limit: size,
      offset: target > 0 ? target * size : null,
    }, base);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);

  const numbers: number[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= PAGE_WINDOW) numbers.push(p);
  }

  return (
    <nav className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-xs" aria-label="分页">
      <span className="tabular-nums text-muted">
        第 {from}-{to} 条 / 共 {total} 题 · 第 {page}/{pages} 页
      </span>
      <div className="flex items-center gap-1">
        <Link
          href={linkFor(0)}
          aria-disabled={page <= 1}
          className={clsx("btn px-2 py-1 text-xs", page <= 1 && "pointer-events-none opacity-40")}
        >
          首页
        </Link>
        <Link
          href={linkFor(page - 2)}
          aria-disabled={page <= 1}
          className={clsx("btn px-2 py-1 text-xs", page <= 1 && "pointer-events-none opacity-40")}
        >
          上一页
        </Link>
        {numbers.map((p, i) => {
          const prev = numbers[i - 1];
          const gap = prev !== undefined && p - prev > 1;
          return (
            <span key={p} className="flex items-center gap-1">
              {gap && <span className="text-muted">…</span>}
              <Link
                href={linkFor(p - 1)}
                className={clsx(
                  "rounded-md border px-2 py-1 tabular-nums transition-colors",
                  p === page ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-ink",
                )}
              >
                {p}
              </Link>
            </span>
          );
        })}
        <Link
          href={linkFor(page)}
          aria-disabled={page >= pages}
          className={clsx("btn px-2 py-1 text-xs", page >= pages && "pointer-events-none opacity-40")}
        >
          下一页
        </Link>
        <Link
          href={linkFor(pages - 1)}
          aria-disabled={page >= pages}
          className={clsx("btn px-2 py-1 text-xs", page >= pages && "pointer-events-none opacity-40")}
        >
          末页
        </Link>
      </div>
      <span className="ml-auto flex items-center gap-1 text-muted">
        每页
        {PAGE_SIZES.map((size) => (
          <Link
            key={size}
            href={linkFor(0, size)}
            className={clsx(
              "rounded-md border px-1.5 py-0.5 tabular-nums",
              size === limit ? "border-brand bg-brand-soft text-brand" : "border-line hover:text-ink",
            )}
          >
            {size}
          </Link>
        ))}
        题
      </span>
    </nav>
  );
}
