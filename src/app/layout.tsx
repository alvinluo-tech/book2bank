import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import Nav from "@/components/nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "行测 5000 题库 · 刷题工作台",
  description:
    "粉笔《决战行测5000题》本地题库：判断推理、数量关系、资料分析、言语理解四科刷题、错题本、收藏、统计分析。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={geistSans.variable}>
      <body className="min-h-screen">
        <div className="mx-auto flex min-h-screen w-full max-w-[1400px] gap-6 px-4 py-6 md:px-6">
          <aside className="hidden w-[190px] shrink-0 md:block">
            <div className="sticky top-6">
              <Link href="/" className="mb-5 block px-1">
                <span className="block text-[15px] font-semibold tracking-tight">行测 5000 题库</span>
                <span className="block text-[11px] text-muted">判断 · 数量 · 资料 · 言语</span>
              </Link>
              <Nav />
            </div>
          </aside>
          <main className="min-w-0 flex-1 pb-24 md:pb-0">{children}</main>
        </div>
        <Nav mobile />
      </body>
    </html>
  );
}
