import type { Metadata, Viewport } from "next";
import Link from "next/link";
import SwRegister from "@/components/sw-register";
import DataRestore from "@/components/data-restore";
import pkg from "../../package.json";
import "./globals.css";

/** Phiên bản app — hiển thị ở header để biết chắc bản đang chạy trên server. */
const APP_VERSION = pkg.version;

export const metadata: Metadata = {
  title: "Feng Check - Hỗ trợ chấm bài trắc nghiệm",
  description:
    "Feng Check — hỗ trợ chấm bài trắc nghiệm: chụp phiếu bằng webcam với frame định vị theo template, tự động đọc đáp án và tính điểm.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Feng Check" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2456d9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <SwRegister />
        <DataRestore />
        <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3">
              <Link href="/" className="flex min-w-0 items-center gap-2 font-bold text-brand-700">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">✓</span>
                {/*
                  Tên app dài: màn hẹp (<640px) chỉ hiện "Feng Check" để badge
                  phiên bản không bị đẩy tràn dòng; từ sm trở lên hiện đầy đủ
                  "Feng Check - Hỗ trợ chấm bài trắc nghiệm". Tab title luôn đầy đủ.
                */}
                <span className="truncate">
                  <span className="sm:hidden">Feng Check</span>
                  <span className="hidden sm:inline">Feng Check - Hỗ trợ chấm bài trắc nghiệm</span>
                </span>
                <span className="ml-1 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                  v{APP_VERSION}
                </span>
              </Link>
              <nav className="hidden items-center gap-1 text-sm font-medium text-slate-600 sm:flex">
                <Link href="/scan" className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                  Chụp bài
                </Link>
                <Link href="/keys" className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                  Đáp án
                </Link>
                <Link href="/results" className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                  Kết quả
                </Link>
                <Link href="/template" className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                  Mẫu phiếu
                </Link>
                <Link href="/settings" className="rounded-lg px-3 py-1.5 hover:bg-slate-100">
                  Cài đặt
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1 px-4 py-5">{children}</main>
          <nav className="sticky bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden">
            {[
              { href: "/scan", label: "Chụp bài" },
              { href: "/keys", label: "Đáp án" },
              { href: "/results", label: "Kết quả" },
              { href: "/template", label: "Mẫu phiếu" },
              { href: "/settings", label: "Cài đặt" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-1 py-2.5 text-center text-xs font-medium text-slate-600 active:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </body>
    </html>
  );
}
