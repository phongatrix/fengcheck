/**
 * Layouts of the two real printed answer-sheet templates ("Giấy 12" and
 * "Giấy 10-11"), extracted from their vector PDFs
 * (tulieuchambai/maugiay/Giay12.pdf, Giay10_11.pdf).
 *
 * All coordinates are display-space fractions: x / pageWidth, y / pageHeight,
 * radii divided by min(pageWidth, pageHeight). The same PDFs the schools print
 * are therefore the source of truth — scanning a printout of them aligns
 * pixel-perfectly with these numbers.
 *
 * Sheet structure (both):
 *   - 4 solid black square markers (warp anchors) + extra edge markers,
 *   - Mã đề: 3–4 digit columns × 10 (0–9 top→bottom),
 *   - PHẦN I: multiple-choice câu, 4 options (A–D) per row,
 *   - PHẦN II: câu with 4 sub-rows (a–d), 2 options each (Đúng/Sai),
 *   - PHẦN III: numeric câu, 4 digit columns × 10 (0–9).
 */

import type {
  Bubble,
  DigitColumnLayout,
  FormKind,
  Part3Question,
  Part3Signs,
  QuestionLayout,
  SheetLayout,
} from "./types";

function bubble(xPt: number, yPt: number, rPt: number, W: number, H: number): Bubble {
  return { x: xPt / W, y: yPt / H, r: rPt / Math.min(W, H) };
}

/**
 * Vị trí các ô dấu "−" và dấu thập phân của một câu PHẦN III, đo từ PDF vector
 * của cả ba mẫu (Giấy 12, Giấy 10-11, QM A4) — cùng một quy luật:
 *   ô "−"      : cùng x cột số 1, cao hơn dòng số 0 đúng 2 bước hàng;
 *   ô "," sau số 1 : cùng x cột số 2, cao hơn dòng số 0 đúng 1 bước hàng;
 *   ô "," sau số 2 : cùng x cột số 3, cùng hàng với ô trước.
 */
function p3Signs(colXs: number[], digitRows: number[], R: number, W: number, H: number): Part3Signs {
  const pitch = digitRows[1] - digitRows[0];
  const y0 = digitRows[0];
  return {
    neg: bubble(colXs[0], y0 - 2 * pitch, R, W, H),
    comma1: bubble(colXs[1], y0 - pitch, R, W, H),
    comma2: bubble(colXs[2], y0 - pitch, R, W, H),
  };
}

/* ------------------------------------------------------------------ */
/* Giấy 12 — 589.61 × 841.89 pt                                        */
/*   PHẦN I: 40 câu (4 cột × 10), A–D                                  */
/*   PHẦN II: 8 câu × a–d × (Đúng/Sai)                                 */
/*   PHẦN III: 6 câu số, 4 chữ số                                      */
/*   Số báo danh: 8 cột × 10;  Mã đề: 4 cột × 10                        */
/* ------------------------------------------------------------------ */

const G12 = { W: 589.61, H: 841.89 };

const G12_P1_ROWS = [309.1, 323.3, 337.5, 351.6, 365.8, 380.0, 394.2, 408.3, 422.5, 436.7];
const G12_P1_BLOCKS = [
  [64.0, 87.6, 111.3, 134.7],
  [197.2, 220.9, 244.5, 267.9],
  [330.4, 354.1, 377.8, 401.1],
  [463.7, 487.3, 511.0, 534.4],
];
const G12_P2_ROWS = [508.5, 522.7, 536.8, 551.0];
const G12_P2_PAIRS = [
  [64.2, 87.4],
  [111.2, 134.9],
  [196.8, 220.8],
  [244.3, 268.0],
  [330.3, 353.8],
  [377.8, 401.2],
  [463.2, 486.9],
  [510.4, 534.4],
];
const G12_P3_DIGIT_ROWS = [647.2, 662.9, 678.8, 694.6, 710.4, 726.2, 742.0, 757.8, 773.6, 789.4];
const G12_P3_GROUPS = [
  [60.9, 75.1, 89.3, 103.4],
  [146.0, 160.1, 174.3, 188.5],
  [231.0, 245.2, 259.3, 273.5],
  [316.0, 330.2, 344.4, 358.6],
  [401.1, 415.2, 429.4, 443.6],
  [486.1, 500.3, 514.5, 528.6],
];
const G12_CODE_ROWS = [96.3, 112.8, 129.4, 146.0, 162.5, 179.1, 195.6, 212.2, 228.7, 245.3];
const G12_SBD_COLS = [413.1, 424.5, 435.9, 447.4, 458.8, 470.3, 481.7, 493.1];
const G12_MADE_COLS = [515.9, 527.3, 538.7, 550.3];

export function giay12Layout(): SheetLayout {
  const { W, H } = G12;
  const R = 4.19;
  const questions: QuestionLayout[] = [];

  // PHẦN I — câu k: block = ⌊k/10⌋, row = k%10.
  for (let k = 0; k < 40; k++) {
    const block = G12_P1_BLOCKS[Math.floor(k / 10)];
    const y = G12_P1_ROWS[k % 10];
    questions.push({ index: k, bubbles: block.map((x) => bubble(x, y, R, W, H)) });
  }
  // PHẦN II — câu 1..8, mỗi câu 4 dòng (a–d) × (Đúng, Sai).
  G12_P2_PAIRS.forEach((pair, c) => {
    for (let sub = 0; sub < 4; sub++) {
      questions.push({
        index: 40 + c * 4 + sub,
        bubbles: pair.map((x) => bubble(x, G12_P2_ROWS[sub], R, W, H)),
      });
    }
  });

  // PHẦN III — 6 câu, mỗi câu 4 cột chữ số (+ ô dấu − và dấu thập phân).
  const part3: Part3Question[] = G12_P3_GROUPS.map((group, c) => ({
    label: c + 1,
    columns: group.map((x) => ({
      bubbles: G12_P3_DIGIT_ROWS.map((y) => bubble(x, y, R, W, H)),
    })),
    signs: p3Signs(group, G12_P3_DIGIT_ROWS, R, W, H),
  }));

  return {
    width: 1,
    height: G12.H / G12.W,
    kind: "GIAY12" as FormKind,
    markers: {
      tl: bubble(18.97, 15.55, 5.37, W, H),
      tr: bubble(573.86, 15.23, 5.37, W, H),
      br: bubble(574.03, 816.53, 5.37, W, H),
      bl: bubble(18.85, 816.55, 5.37, W, H),
    },
    questions,
    part1Count: 40,
    part2Count: 32,
    part3,
    examCode: {
      // 4 cột — thí sinh tô 3 số bên phải; phần đọc chuẩn hóa về 3 chữ số.
      columns: G12_MADE_COLS.map((x) => ({
        bubbles: G12_CODE_ROWS.map((y) => bubble(x, y, 3.96, W, H)),
      })),
      label: { x: 505 / W, y: 70 / H, w: 60 / W, h: 14 / H },
    },
    studentCode: {
      columns: G12_SBD_COLS.map((x) => ({ bubbles: G12_CODE_ROWS.map((y) => bubble(x, y, 3.96, W, H)) })),
      label: { x: 405 / W, y: 70 / H, w: 80 / W, h: 14 / H },
    },
    scoreAnchor: { x: 0.04, y: 0.075 },
    columns: 4,
    rows: 10,
  };
}

/* ------------------------------------------------------------------ */
/* Giấy 10-11 — 595 × 842 pt (PDF xoay 270°, quy về khổ dọc)           */
/*   PHẦN I: 30 câu (1 cột, 3 khối × 10), A–D                          */
/*   PHẦN II: 10 câu (2 khối × 5) × a–d × (Đúng/Sai)                   */
/*   PHẦN III: 10 câu số (2 khối × 5), 4 chữ số                        */
/*   Mã đề: 3 cột × 10 (không có lưới SBD)                             */
/* ------------------------------------------------------------------ */

const G1011 = { W: 595.0, H: 842.0 };

const G1011_P1_ROWS = [
  436.4, 447.3, 458.3, 469.3, 480.3, 491.2, 502.1, 513.2, 524.1, 535.1,
  557.1, 568.0, 578.9, 590.0, 600.9, 611.9, 622.9, 633.9, 644.8, 655.7,
  677.7, 688.7, 699.7, 710.7, 721.6, 732.5, 743.6, 754.5, 765.5, 776.5,
];
const G1011_P1_COLS = [94.34, 109.1, 123.86, 138.62];
const G1011_P2_PAIRS = [
  [202.34, 225.86],
  [271.7, 295.22],
  [341.18, 364.58],
  [410.54, 434.06],
  [479.9, 503.42],
];
const G1011_P2_BLOCK_ROWS = [
  [334.86, 345.78, 356.82, 367.74],
  [407.1, 418.02, 429.06, 439.98],
];
const G1011_P3_COLS = [
  [189.14, 200.06, 211.1, 222.02],
  [258.5, 269.54, 280.46, 291.38],
  [327.86, 338.9, 349.82, 360.86],
  [397.34, 408.26, 419.3, 430.22],
  [466.7, 477.62, 488.66, 499.58],
];
const G1011_P3_BLOCK_ROWS = [
  // [dòng −, dòng ",", 10 dòng chữ số 0..9]
  [494.3, 505.3, 516.3, 527.2, 538.3, 549.2, 560.2, 571.1, 582.1, 593.1, 604.0, 615.1],
  [655.7, 666.8, 677.7, 688.7, 699.7, 710.7, 721.6, 732.5, 743.6, 754.5, 765.5, 776.5],
];
const G1011_MD_ROWS = [180.3, 191.22, 202.26, 213.18, 224.1, 235.14, 246.06, 257.1, 268.02, 279.06];
const G1011_MD_COLS = [483.74, 494.66, 505.7];

export function giay10_11Layout(): SheetLayout {
  const { W, H } = G1011;
  const R = 3.9;
  const questions: QuestionLayout[] = [];

  // PHẦN I — 30 câu, 3 khối 10 câu.
  for (let k = 0; k < 30; k++) {
    const y = G1011_P1_ROWS[k];
    questions.push({ index: k, bubbles: G1011_P1_COLS.map((x) => bubble(x, y, R, W, H)) });
  }
  // PHẦN II — 10 câu (2 khối × 5), mỗi câu 4 dòng × (Đúng, Sai).
  for (let block = 0; block < 2; block++) {
    for (let c = 0; c < 5; c++) {
      for (let sub = 0; sub < 4; sub++) {
        questions.push({
          index: 30 + (block * 5 + c) * 4 + sub,
          bubbles: G1011_P2_PAIRS[c].map((x) => bubble(x, G1011_P2_BLOCK_ROWS[block][sub], R, W, H)),
        });
      }
    }
  }

  // PHẦN III — 10 câu (2 khối × 5), mỗi câu 4 cột chữ số. Hai dòng trên cùng
  // của mỗi khối là ô dấu "−" (dòng 0) và ô dấu "," (dòng 1) — đọc cùng lưới.
  const part3: Part3Question[] = [];
  for (let block = 0; block < 2; block++) {
    const rows = G1011_P3_BLOCK_ROWS[block];
    const digitRows = rows.slice(2); // bỏ dòng "−" và dòng ","
    for (let c = 0; c < 5; c++) {
      part3.push({
        label: block * 5 + c + 1,
        columns: G1011_P3_COLS[c].map((x) => ({
          bubbles: digitRows.map((y) => bubble(x, y, R, W, H)),
        })),
        signs: p3Signs(G1011_P3_COLS[c], digitRows, R, W, H),
      });
    }
  }

  return {
    width: 1,
    height: G1011.H / G1011.W,
    kind: "GIAY10_11" as FormKind,
    markers: {
      tl: bubble(72.4, 161.0, 5.75, W, H),
      tr: bubble(522.8, 161.0, 5.75, W, H),
      br: bubble(522.8, 796.3, 5.75, W, H),
      bl: bubble(72.4, 796.3, 5.75, W, H),
    },
    questions,
    part1Count: 30,
    part2Count: 40,
    part3,
    examCode: {
      columns: G1011_MD_COLS.map((x) => ({ bubbles: G1011_MD_ROWS.map((y) => bubble(x, y, R, W, H)) })),
      label: { x: 470 / W, y: 150 / H, w: 60 / W, h: 14 / H },
    },
    studentCode: null,
    scoreAnchor: { x: 0.03, y: 0.055 },
    /**
     * Khung "Điểm bài kiểm tra" in sẵn (x 105–315 pt, y 156–274 pt trên trang
     * 595×842). Hai ô trống nằm dưới tiêu đề: ô "Viết bằng số/chữ" (y 193–225)
     * và ô "Giám khảo 1/2" (y 241–272) — chữ kết quả xếp 4 dòng vào đúng hai ô
     * này, cỡ 0.016H (nửa khối chữ cũ).
     */
    /**
     * Khung "Điểm bài kiểm tra" in sẵn (x 105–315 pt, y 156–274 pt trên trang
     * 595×842), chia 2 cột bởi vạch dọc x = 210 pt và 2 hàng trống:
     *   hàng trên  y 192–225 (dưới nhãn "Viết bằng số / bằng chữ")
     *   hàng dưới  y 239–273 (dưới nhãn "Giám khảo 1 / Giám khảo 2")
     * Kết quả xếp DỌC theo thứ tự P1 → P2 → P3 → Tong ở cột trái, MĐ/SBD ở cột
     * phải, mỗi ô 2 dòng, cỡ chữ 0.016H (nửa khối chữ cũ).
     */
    scoreBox: {
      /**
       * Vị trí đo từ ẢNH MẪU KẾT QUẢ chuẩn (2026-11-16, ảnh 979×1400):
       * 4 dòng đỏ P1 / P2 / P3 / Tong, ink cao 1.50%H, y (%H → pt trên 842):
       *   P1   0.2600 → 219 pt
       *   P2   0.2757 → 232 pt
       *   P3   0.3114 → 262 pt
       *   Tong 0.3286 → 277 pt
       * Trước đây đặt 192.5/208/239.5/255 (cao hơn mẫu ~26pt) nên khối chữ đỏ
       * nằm lệch lên, đè nhãn in sẵn "Viết bằng số / Giám khảo 1".
       */
      slots: [
        { x: 108 / G1011.W, y: 219 / G1011.H, maxX: 207 / G1011.W }, // P1
        { x: 108 / G1011.W, y: 232 / G1011.H, maxX: 207 / G1011.W }, // P2
        { x: 108 / G1011.W, y: 262 / G1011.H, maxX: 207 / G1011.W }, // P3
        { x: 108 / G1011.W, y: 277 / G1011.H, maxX: 207 / G1011.W }, // Tong
        { x: 213 / G1011.W, y: 232 / G1011.H, maxX: 312 / G1011.W }, // SBD
      ],
      // MĐ ghi vào ô riêng cột phải, cùng dòng với P1 (trước đây nằm trong
      // danh sách slot — giờ tách qua mdSlot để không bị ảnh hưởng khi bỏ mục).
      mdSlot: { x: 213 / G1011.W, y: 219 / G1011.H, maxX: 312 / G1011.W },
      mdPrefix: "MD: ",
      // 0.0146H → ink cao ~1.50%H đúng ảnh mẫu (trước 0.016 → 1.64%H, to hơn).
      fs: 0.0146,
      advance: 0.42,
    },
    /**
     * KHUNG CẮT ẢNH — vùng cắt dùng cho ảnh UPLOAD.
     *
     * ⚠️ ĐO TỪ ẢNH CHỤP THẬT, KHÔNG phải khung đỏ của ảnh tiêu chí: khung đỏ
     * (`tc_qm10_11.png`: x 20.9..574.5, y 27.7..813.9 pt) rộng hơn vùng đáp án
     * — lề TRÊN tới 133pt (16.9% chiều cao khung). Trên ảnh chụp thật lề đó là
     * NỀN BÀN TỐI: cắt theo khung đỏ làm ảnh kết quả dính ~300px dải tối phía
     * trên (đo 5 ảnh Thu/11a8: mean hàng đầu 82-120 so với 168-181 ở giữa).
     *
     * Vì vậy cropBox = ĐÚNG vùng bao 4 MỐC in (mốc + lề nhỏ 1.5% mỗi phía), đo
     * từ chính 4 mốc của layout: x 72.4..522.8, y 161.0..796.3 pt. Ảnh ra chỉ
     * còn vùng đáp án — không nền, không lề giấy thừa.
     */
    cropBox: { x0: 65.9 / G1011.W, y0: 154.5 / G1011.H, x1: 529.3 / G1011.W, y1: 802.8 / G1011.H },
    columns: 1,
    rows: 30,
  };
}

/* ------------------------------------------------------------------ */
/* Mẫu mới 2025 ("moi") — 406 × 600 px, hiệu chuẩn từ data/maugiay/    */
/*   của chambaiV3 (moi_cells.json + đo lưới PHẦN III trên ảnh).       */
/*   P1: 20 câu ABCD (cột trái)                                        */
/*   P2: 4 câu × ý a-d × (Đúng/Sai)                                    */
/*   P3: 8 câu số × 4 cột chữ số (2 khối: câu 1-5 / 6-8)               */
/*   Mã đề: 3 cột × 10 (SBD viết tay — không có lưới)                  */
/* ------------------------------------------------------------------ */

const MOI = { W: 406, H: 600 };

const MOI_P1_COLS = [57.94, 68.81, 79.68, 90.6];
// Hàng 305.56pt là hàng HEADER "A B C D" in sẵn, KHÔNG phải câu 1 — câu 1 in ở
// hàng kế tiếp (đo 18/18 ảnh Test/fs11: câu 1 → câu 20 = 773 → 1160 canonical).
// Layout cũ lấy header làm câu 1 nên MỌI phiếu đọc lệch 1 câu ở PHẦN I.
const MOI_P1_Y0 = 313.85;
const MOI_P1_PITCH = 8.27; // (471.4 - 313.85) / 19 — canonical 20.37px
const MOI_P2_ROWS_Y = [237.59, 245.52, 253.45, 261.38]; // ý a-d
const MOI_P2_PAIRS = [
  [136.45, 153.23],
  [186.0, 202.73],
  [235.55, 252.33],
  [285.56, 302.72],
];
const MOI_MD_COLS = [336.7, 344.7, 352.8];
// Đo trên ảnh thật BGD2025 (Test/fs11, fit least-squares 56 hàng): hàng đầu
// 120.14pt, pitch 8.02pt — KHÔNG phải 106.5/9.6733 (sai ~35pxcanonical ở hàng đầu).
const MOI_MD_Y0 = 120.14;
const MOI_MD_PITCH = 8.02; // (477.4 - 295.9) / 9 canonical px
// PHẦN III — hàng chữ số d0 (0) → d9 (9), dấu − ở cột 1, dấu , ở cột 2-3.
const MOI_P3_BLOCKS = [
  {
    digitRows: [371.6, 379.9, 388.2, 396.7, 405.0, 413.1, 421.8, 429.6, 438.0, 446.5],
    cauCols: [
      [127.3, 135.3, 143.3, 151.2],
      [177.3, 185.5, 193.7, 201.3],
      [227.5, 235.7, 243.5, 251.7],
      [278.3, 286.3, 294.3, 302.5],
      [329.8, 337.8, 346.3, 354.3],
    ],
  },
  {
    digitRows: [495.1, 503.8, 512.0, 520.8, 529.2, 537.7, 545.9, 554.2, 562.8, 571.2],
    cauCols: [
      [127.2, 135.3, 143.3, 151.5],
      [178.2, 186.5, 194.8, 202.5],
      [229.5, 237.5, 245.8, 254.2],
    ],
  },
];

export function moiLayout(): SheetLayout {
  const { W, H } = MOI;
  const R = 2.9; // bán kính ô P1/P2/MD (px) → min-side units
  const questions: QuestionLayout[] = [];

  // PHẦN I — 20 câu, 1 cột.
  for (let k = 0; k < 20; k++) {
    const y = MOI_P1_Y0 + k * MOI_P1_PITCH;
    questions.push({ index: k, bubbles: MOI_P1_COLS.map((x) => bubble(x, y, R, W, H)) });
  }
  // PHẦN II — 4 câu × 4 ý × (Đúng, Sai).
  for (let c = 0; c < 4; c++) {
    for (let sub = 0; sub < 4; sub++) {
      questions.push({
        index: 20 + c * 4 + sub,
        bubbles: MOI_P2_PAIRS[c].map((x) => bubble(x, MOI_P2_ROWS_Y[sub], R, W, H)),
      });
    }
  }

  // PHẦN III — 8 câu × 4 cột chữ số (d0 trên, d9 dưới).
  const part3: Part3Question[] = [];
  let cau = 0;
  for (const block of MOI_P3_BLOCKS) {
    for (const cols of block.cauCols) {
      cau += 1;
      part3.push({
        label: cau,
        columns: cols.map((x) => ({
          bubbles: block.digitRows.map((y) => bubble(x, y, 2.0, W, H)),
        })),
      });
    }
  }

  return {
    width: 1,
    height: MOI.H / MOI.W,
    kind: "MOI" as FormKind,
    markers: {
      tl: bubble(40, 111, 4.5, W, H),
      tr: bubble(365, 105, 4.5, W, H),
      br: bubble(377, 585.5, 4.5, W, H),
      bl: bubble(41, 588, 4.5, W, H),
    },
    /**
     * Khung "Điểm bài kiểm tra" in sẵn trên phiếu BGD2025 (đo trên ảnh chụp thật
     * fs11, toạ độ canonical → pt): khung y 267..479 px (108.4..194.4pt), vạch
     * ngang chia tại 307px (124.6pt) và 393px (159.6pt), cột divider x 138px
     * (56pt) và 299px (121.4pt).
     *
     * Bố cục CHỮ ĐỎ theo mẫu kết quả:
     *   "Viết bằng số"  → P1 (dòng 1), P2 (dòng 2, dưới P1)
     *   "Viết bằng chữ" → MD (cùng dòng với P1)
     *   "Giám khảo 1"   → P3
     *   "Giám khảo 2"   → Tong (dòng dưới P3)
     * Không có SBD (phiếu này SBD viết tay, không có lưới) → mục SBD rỗng.
     */
    scoreBox: {
      slots: [
        { x: 0.155, y: 0.2212, maxX: 0.33 }, // P1  — ô "Viết bằng số"
        { x: 0.155, y: 0.24, maxX: 0.33 },   // P2  — dưới P1
        { x: 0.155, y: 0.2779, maxX: 0.33 }, // P3  — ô "Giám khảo 1"
        { x: 0.155, y: 0.2971, maxX: 0.26 }, // Tong — dưới P3
      ],
      // Mã đề đang chấm ghi vào Ô "PHÁCH" (x 300..385, y 307..392 canonical —
      // ô trống bên phải khung điểm, học sinh ghi số phách bằng tay).
      mdSlot: { x: 0.345, y: 0.2293, maxX: 0.382 },
      mdPrefix: "",
      fs: 0.0175,
      advance: 0.42,
    },
    questions,
    part1Count: 20,
    part2Count: 16,
    part3,
    examCode: {
      columns: MOI_MD_COLS.map((x) => ({
        bubbles: Array.from({ length: 10 }, (_, d) => bubble(x, MOI_MD_Y0 + d * MOI_MD_PITCH, 2.6, W, H)),
      })),
      label: { x: 320 / W, y: 88 / H, w: 70 / W, h: 14 / H },
    },
    studentCode: null,
    scoreAnchor: { x: 0.03, y: 0.05 },
    columns: 1,
    rows: 20,
    snapFactor: 1.5, // reconstruction: hàng lệch ít — density gate chặn snap sai đích
  };
}

/* ------------------------------------------------------------------ */
/* QM 2025 - A4 ("Ky kiểm tra") — 595 × 842 pt (PDF xoay 270°)         */
/*   P1: 40 câu ABCD (4 khối × 10)                                     */
/*   P2: 8 câu × ý a-d × (Đúng/Sai)                                    */
/*   P3: 6 câu số × 4 cột chữ số (d0 trên → d9 dưới)                   */
/*   SBD: 6 cột × 10;  Mã đề: 3 cột × 10                               */
/* ------------------------------------------------------------------ */

const QMA4 = { W: 595, H: 842 };

const QMA4_P1_ROWS = [317.8, 330.7, 343.5, 356.3, 369.1, 381.9, 394.7, 407.6, 420.4, 433.3];
const QMA4_P1_BLOCKS = [
  [65.1, 92.5, 120.0, 147.5],
  [196.7, 224.2, 251.7, 279.0],
  [328.3, 355.7, 383.2, 410.7],
  [459.9, 487.3, 514.8, 542.3],
];
const QMA4_P2_ROWS = [509.5, 522.3, 535.1, 548.0];
const QMA4_P2_PAIRS = [
  [65.1, 92.5],
  [120.0, 147.5],
  [196.7, 224.2],
  [251.7, 279.0],
  [328.3, 355.7],
  [383.2, 410.7],
  [459.9, 487.3],
  [514.8, 542.3],
];
const QMA4_P3_DIGIT_ROWS = [
  651.3, 664.1, 677.0, 689.8, 702.7, 715.5, 728.3, 741.1, 753.9, 766.7,
]; // d0 (trên) → d9 (dưới)
const QMA4_P3_GROUPS = [
  [65.1, 77.9, 90.7, 103.6],
  [152.9, 165.6, 178.5, 191.3],
  [240.6, 253.5, 266.2, 279.0],
  [328.3, 341.2, 353.9, 366.7],
  [416.1, 428.9, 441.7, 454.5],
  [503.8, 516.6, 529.5, 542.3],
];
const QMA4_MD_ROWS = [115.9, 130.7, 145.6, 160.5, 175.4, 190.3, 205.1, 220.0, 234.9, 249.8];
const QMA4_MD_COLS = [520.3, 530.9, 541.3];
const QMA4_SBD_COLS = [432.0, 442.6, 453.0, 463.6, 474.0, 484.6];

export function qmA4Layout(): SheetLayout {
  const { W, H } = QMA4;
  const R = 5.5; // bán kính bubble P1/P2 (px)
  const R3 = 4.4; // bán kính bubble P3/MD
  const questions: QuestionLayout[] = [];

  // PHẦN I — câu k: block = ⌊k/10⌋, row = k%10.
  for (let k = 0; k < 40; k++) {
    const block = QMA4_P1_BLOCKS[Math.floor(k / 10)];
    const y = QMA4_P1_ROWS[k % 10];
    questions.push({ index: k, bubbles: block.map((x) => bubble(x, y, R, W, H)) });
  }
  // PHẦN II — 8 câu × 4 ý × (Đúng, Sai).
  QMA4_P2_PAIRS.forEach((pair, c) => {
    for (let sub = 0; sub < 4; sub++) {
      questions.push({
        index: 40 + c * 4 + sub,
        bubbles: pair.map((x) => bubble(x, QMA4_P2_ROWS[sub], R, W, H)),
      });
    }
  });

  // PHẦN III — 6 câu × 4 cột chữ số (+ ô dấu − và dấu thập phân).
  const part3: Part3Question[] = QMA4_P3_GROUPS.map((group, c) => ({
    label: c + 1,
    columns: group.map((x) => ({
      bubbles: QMA4_P3_DIGIT_ROWS.map((y) => bubble(x, y, R3, W, H)),
    })),
    signs: p3Signs(group, QMA4_P3_DIGIT_ROWS, R3, W, H),
  }));

  return {
    width: 1,
    height: QMA4.H / QMA4.W,
    kind: "QM_A4" as FormKind,
    markers: {
      tl: bubble(34.2, 49.7, 6.7, W, H),
      tr: bubble(560.5, 49.7, 6.8, W, H),
      br: bubble(560.5, 792.1, 6.8, W, H),
      bl: bubble(34.2, 792.1, 6.7, W, H),
    },
    questions,
    part1Count: 40,
    part2Count: 32,
    part3,
    examCode: {
      columns: QMA4_MD_COLS.map((x) => ({
        bubbles: QMA4_MD_ROWS.map((y) => bubble(x, y, R3, W, H)),
      })),
      label: { x: 505 / W, y: 96 / H, w: 60 / W, h: 14 / H },
    },
    studentCode: {
      columns: QMA4_SBD_COLS.map((x) => ({
        bubbles: QMA4_MD_ROWS.map((y) => bubble(x, y, R3, W, H)),
      })),
      label: { x: 415 / W, y: 96 / H, w: 80 / W, h: 14 / H },
    },
    scoreAnchor: { x: 0.06, y: 0.06 },
    columns: 4,
    rows: 10,
  };
}

/** Total keyable questions of a layout (P1 + P2 choice, P3 digit columns). */
export function layoutQuestionCount(l: SheetLayout): number {
  return l.questions.length + l.part3.reduce((s, q) => s + q.columns.length, 0);
}

/** Số câu PHẦN III có in ô dấu − / dấu thập phân. */
export function layoutSignCauCount(l: SheetLayout): number {
  return l.part3.reduce((s, q) => s + (q.signs ? 1 : 0), 0);
}

/**
 * Tổng số Ô ĐÁP ÁN của một layout = câu lựa chọn + ô chữ số + Ô DẤU.
 * Vector đáp án (mã đề, key, bài đọc) có độ dài bằng số này: các ô dấu "−"
 * và dấu thập phân nằm SAU các ô chữ số, mỗi câu có dấu 2 ô liên tiếp
 * [ô −, ô dấu thập phân] theo thứ tự câu.
 */
export function layoutAnswerSlots(l: SheetLayout): number {
  return layoutQuestionCount(l) + layoutSignCauCount(l) * 2;
}

/** Loại ô tại một vị trí trong vector đáp án. */
export type SlotKind = "choice" | "digit" | "signNeg" | "signComma" | "none";

export function layoutSlotKind(l: SheetLayout, i: number): SlotKind {
  const qc = layoutQuestionCount(l);
  if (i < l.questions.length) return "choice";
  if (i < qc) return "digit";
  if (i < layoutAnswerSlots(l)) return i - qc < layoutSignCauCount(l) * 2 && (i - qc) % 2 === 0 ? "signNeg" : "signComma";
  return "none";
}

/** Options available for one question index (4/2 choice, 10 digits, 1/2 sign, 0 = n/a). */
export function layoutOptionCount(l: SheetLayout, qIndex: number): number {
  if (qIndex < l.questions.length) return l.questions[qIndex].bubbles.length;
  if (qIndex < layoutQuestionCount(l)) return 10;
  if (layoutSlotKind(l, qIndex) === "signNeg") return 1;
  if (layoutSlotKind(l, qIndex) === "signComma") return 2;
  return 0;
}

/** Nhãn các lựa chọn của một ô (A–D / Đ,S / 0–9 / − / dấu thập phân). */
export function layoutSlotLabels(l: SheetLayout, i: number): string[] {
  const kind = layoutSlotKind(l, i);
  if (kind === "digit") return Array.from({ length: 10 }, (_, d) => String(d));
  if (kind === "signNeg") return ["−"];
  if (kind === "signComma") return [".1", ".2"];
  const n = layoutOptionCount(l, i);
  if (n === 2) return ["Đ", "S"];
  return Array.from({ length: n }, (_, oi) => String.fromCharCode(65 + oi));
}

/** Readable labels for the key editor, per question index. */
export function layoutQuestionLabel(l: SheetLayout, qIndex: number): string {
  if (qIndex < l.part1Count) return `Câu ${qIndex + 1}`;
  if (qIndex < l.part1Count + l.part2Count) {
    const rel = qIndex - l.part1Count;
    return `Câu ${Math.floor(rel / 4) + 1}${"abcd"[rel % 4]})`;
  }
  const rel = qIndex - l.questions.length;
  const perCau = l.part3[0]?.columns.length ?? 4;
  return `P3 Câu ${Math.floor(rel / perCau) + 1} · số ${Math.floor((rel % perCau) + 1)}`;
}

/**
 * Nhãn riêng cho Ô DẤU (vượt quá layoutQuestionCount): "P3 Câu N · dấu −".
 */
export function layoutSlotTitle(l: SheetLayout, i: number): string {
  if (i < layoutQuestionCount(l)) return layoutQuestionLabel(l, i);
  const rel = i - layoutQuestionCount(l);
  const cau = Math.floor(rel / 2) + 1;
  return layoutSlotKind(l, i) === "signNeg" ? `P3 Câu ${cau} · dấu −` : `P3 Câu ${cau} · dấu thập phân`;
}

/**
 * Giá trị số của một câu PHẦN III từ vector đáp án — hiển thị dạng "-1.1", "22".
 * `answers` là vector đủ ô (có phần ô dấu); câu có `signs` mới đọc được dấu.
 */
export function p3ValueOf(l: SheetLayout, answers: number[], cauIndex: number): string {
  const q = l.part3[cauIndex];
  if (!q) return "-";
  const per = q.columns.length;
  const base = l.questions.length + cauIndex * per;
  const digits = answers.slice(base, base + per);
  if (!digits.some((d) => d >= 0)) return "-";
  let body = "";
  if (q.signs) {
    const signBase = layoutQuestionCount(l);
    const cells = answers.slice(signBase + cauIndex * 2, signBase + cauIndex * 2 + 2);
    const neg = cells[0] === 0;
    const comma = cells[1];
    digits.forEach((d, di) => {
      if (d >= 0) body += String(d);
      if (comma === di && d >= 0) body += ".";
    });
    if (neg) body = `-${body}`;
    return body || "-";
  }
  // Mẫu không có ô dấu (MOI): kiểu cũ — ô trống giữa các chữ số là dấu chấm.
  return digits.map((d) => (d >= 0 ? String(d) : ".")).join("").replace(/\.+$/, "") || "-";
}

/**
 * Chuẩn hoá vector key của ĐỊNH DẠNG ĐÁP ÁN CŨ (trước khi có ô dấu):
 * dấu chấm thập phân được mã hoá là MỘT Ô TRỐNG nằm giữa các chữ số (vd
 * "1.1" → [1,-1,1,-1]); giờ các mẫu in sẵn ô dấu nên dấu phải chuyển thành
 * ô dấu riêng và các chữ số dồn về phía trái liên tiếp.
 *
 * Nhận vector đủ mọi độ dài: thiếu ô dấu thì điền thêm -1. Chỉ chạy khi câu
 * PHẦN III của mẫu có ô dấu in; vector mới (không có ô trống xen giữa) giữ
 * nguyên. Chạy nhiều lần cho cùng một vector cho kết quả như nhau.
 */
export function normalizeKeyLegacy(answers: number[], layout: SheetLayout): number[] {
  const slots = layoutQuestionCount(layout) + layoutSignCauCount(layout) * 2;
  const out = answers.slice(0, slots);
  while (out.length < slots) out.push(-1);
  const signBase = layoutQuestionCount(layout);
  layout.part3.forEach((q, c) => {
    if (!q.signs) return;
    const per = q.columns.length;
    const base = layout.questions.length + c * per;
    const digits = out.slice(base, base + per);
    const last = digits.reduce((acc, d, i) => (d >= 0 ? i : acc), -1);
    let dot = -1;
    for (let i = 0; i < last; i++) {
      if (digits[i] < 0) {
        dot = i;
        break;
      }
    }
    if (dot < 0) return;
    // Chữ số trước dấu chấm giữ nguyên, chữ số sau dồn lên. Ô dấu thập phân =
    // số chữ số ĐƯỢC in TRƯỚC dấu phẩy (giảm 1 so với chỉ số ô dấu chấm):
    // [1,-1,1] = "1.1" → phẩy sau chữ số 1 → ô 0; [1,2,-1,3] = "12.3" → ô 1.
    // Chỉ tô được sau chữ số 1 hoặc 2; vị trí khác thì bỏ dấu phẩy.
    const merged = [...digits.slice(0, dot), ...digits.slice(dot + 1, last + 1)];
    for (let i = 0; i < per; i++) out[base + i] = i < merged.length ? merged[i] : -1;
    const commaCell = dot - 1;
    if (commaCell >= 0 && commaCell <= 1) out[signBase + c * 2 + 1] = commaCell;
  });
  return out;
}

/**
 * Xem nhanh một vector đáp án: PHẦN I/II chữ cái/Đ,S, PHẦN III giá trị số
 * ("-1.1"). Tự chuẩn hoá key encoding cũ trước khi dựng, nên danh sách mã đề
 * luôn hiển thị đúng kể cả key nhập trước khi có ô dấu.
 */
export function previewAnswers(rawAnswers: number[], layout: SheetLayout): string {
  const answers = normalizeKeyLegacy(rawAnswers, layout);
  const head = answers
    .slice(0, layout.questions.length)
    .map((a, i) => (a < 0 ? "-" : i < layout.part1Count ? "ABCD"[a] : a === 0 ? "Đ" : "S"))
    .join("");
  const p3 = layout.part3.map((_, c) => p3ValueOf(layout, answers, c)).join(" ");
  return `${head} ${p3}`.trimEnd();
}
