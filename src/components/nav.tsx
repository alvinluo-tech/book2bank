"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  IconChartPie,
  IconCircleX,
  IconDashboard,
  IconDatabase,
  IconLayoutGrid,
  IconListDetails,
  IconBook,
  IconPencil,
  IconShieldCheck,
  IconStar,
} from "@tabler/icons-react";

/** One icon set (Tabler, stroke 1.5), one nav definition for both shells. */
const ITEMS = [
  { href: "/", label: "题型广场", icon: IconLayoutGrid, group: "练习" },
  { href: "/practice", label: "刷题", icon: IconPencil, group: "练习" },
  { href: "/bank", label: "题库", icon: IconListDetails, group: "题库" },
  { href: "/book", label: "原书", icon: IconBook, group: "题库" },
  { href: "/overview", label: "学习概览", icon: IconDashboard, group: "复盘" },
  { href: "/wrong", label: "错题本", icon: IconCircleX, group: "复盘" },
  { href: "/favorites", label: "收藏", icon: IconStar, group: "复盘" },
  { href: "/stats", label: "统计分析", icon: IconChartPie, group: "复盘" },
  { href: "/verification", label: "数据校验", icon: IconShieldCheck, group: "数据" },
  { href: "/settings", label: "数据", icon: IconDatabase, group: "数据" },
] as const;

/** Mobile keeps the five destinations worth a thumb-reach; the rest live in the sidebar and on 题型广场. */
const MOBILE_ITEMS = ["/", "/practice", "/bank", "/wrong", "/stats"];

const GROUPS = ["练习", "题库", "复盘", "数据"] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Nav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  if (mobile) {
    return (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="主导航"
      >
        <div className="grid grid-cols-5 px-1 py-1.5">
          {ITEMS.filter((it) => MOBILE_ITEMS.includes(it.href)).map((it) => {
            const active = isActive(pathname, it.href);
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] transition-colors",
                  active ? "text-brand" : "text-muted hover:text-ink",
                )}
              >
                <Icon size={20} stroke={1.5} />
                {it.label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-4" aria-label="主导航">
      {GROUPS.map((group) => (
        <div key={group}>
          <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-muted/70">
            {group}
          </div>
          <div className="flex flex-col gap-0.5">
            {ITEMS.filter((it) => it.group === group).map((it) => {
              const active = isActive(pathname, it.href);
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand-soft font-medium text-brand"
                      : "text-muted hover:bg-panel-soft hover:text-ink",
                  )}
                >
                  <Icon size={17} stroke={1.5} className="shrink-0" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
