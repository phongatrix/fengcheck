import Link from "next/link";

const MENU = [
  {
    href: "/scan",
    title: "Chụp bài & chấm điểm",
    desc: "Mở webcam, căn phiếu vào frame định vị, hệ thống tự đọc đáp án và tính điểm.",
    icon: "📷",
  },
  {
    href: "/keys",
    title: "Quản lý đáp án chuẩn",
    desc: "Tạo bài thi, nhập/import đáp án (CSV, XLSX, mã chia sẻ, quét QR).",
    icon: "🔑",
  },
  {
    href: "/results",
    title: "Kết quả & xuất Excel",
    desc: "Lịch sử bài chấm kèm ảnh annotated, xuất file .xlsx.",
    icon: "📊",
  },
  {
    href: "/template",
    title: "In mẫu phiếu & hướng dẫn",
    desc: "Tạo/in template phiếu A4/A6/A8 và xem quy trình chụp chuẩn.",
    icon: "🖨️",
  },
  {
    href: "/settings",
    title: "Cài đặt",
    desc: "Âm thanh, chế độ tự chụp, cooldown, điểm tối đa, dữ liệu.",
    icon: "⚙️",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <section className="card mb-5 overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-8 text-white">
          <h1 className="text-2xl font-bold">Feng Check - Hỗ trợ chấm bài trắc nghiệm</h1>
          <p className="mt-2 max-w-xl text-sm text-brand-50/90">
            Đặt phiếu bài thi (marker-based A4/A6/A8) trước camera — ứng dụng tự tìm 4 góc
            marker, warp perspective, đọc bubble + mã đề + mã SV rồi tính điểm theo đáp án chuẩn.
          </p>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {MENU.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="card group flex items-start gap-4 p-4 transition-shadow hover:shadow-md"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-50 text-xl">
              {item.icon}
            </span>
            <span>
              <span className="block font-semibold text-slate-800 group-hover:text-brand-700">
                {item.title}
              </span>
              <span className="mt-0.5 block text-sm text-slate-500">{item.desc}</span>
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Không cần đăng nhập — dữ liệu lưu trực tiếp trên máy bạn (IndexedDB).
      </p>

      {/*
        QUÉT HÌNH BẰNG ĐIỆN THOẠI — app Android riêng (Feng Scanner) chụp phiếu
        rồi gửi ảnh về Feng Check để chấm. Link tải APK đặt ngay trên trang chủ
        để giáo viên không phải tìm trong tài liệu.
      */}
      <section className="card mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-xl">📱</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">App quét hình bằng điện thoại Android: Feng Scanner</p>
          <p className="mt-0.5 text-sm text-slate-500">
            Dùng điện thoại chụp phiếu nhanh hơn rồi đưa ảnh sang Feng Check để chấm — tải APK
            (Android arm64, bản debug):
          </p>
        </div>
        <a
          href="https://github.com/phongatrix/fengscan/blob/main/apk/FengScan-arm64-debug.apk"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
        >
          ⬇ Tải Feng Scanner (APK)
        </a>
      </section>
    </div>
  );
}
