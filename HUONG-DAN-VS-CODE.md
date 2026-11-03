# Đưa Studio Vị Trí về máy để viết tiếp trên VS Code

## 1. Cài sẵn (một lần)

| Phần mềm | Dùng để | Tải |
|---|---|---|
| **VS Code** | Sửa code | https://code.visualstudio.com |
| **Git** | Tải dự án về và đẩy lên GitHub | https://git-scm.com/downloads |
| **Python 3** *(hoặc extension Live Server)* | Chạy app trên máy | https://www.python.org/downloads (Windows: tick **Add Python to PATH**) |
| **Chrome / Edge** | Mở app, xuất video | đã có sẵn |
| *(tuỳ chọn)* **Claude Code** cho VS Code | Nhờ Claude sửa tiếp | Extension “Claude Code” trong VS Code |

## 2. Tải dự án về

### Cách A – khuyên dùng: clone bằng Git (giữ lịch sử, đẩy lên web được)
1. Mở VS Code → `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) → gõ **Git: Clone**.
2. Chọn **Clone from GitHub**, đăng nhập GitHub, chọn **hovananhboss-cmd/nha-dat-van-anh**.
3. Chọn thư mục lưu → **Open** để mở dự án.

Hoặc trong Terminal:
```bash
git clone https://github.com/hovananhboss-cmd/nha-dat-van-anh.git
cd nha-dat-van-anh
code .
```

### Cách B: dùng file zip
1. Giải nén `nha-dat-van-anh.zip`.
2. VS Code → **File → Open Folder…** → chọn thư mục vừa giải nén.
3. Muốn đẩy lên GitHub sau này, nên chuyển sang Cách A (zip không chứa lịch sử Git).

Khi VS Code hỏi cài extension đề xuất (**Live Server**, **Claude Code**) → bấm **Install**.

## 3. Chạy app trên máy

- **Cách 1:** `Terminal → Run Task… → Chạy Studio Vị Trí`, rồi mở **http://localhost:8000** bằng Chrome.
- **Cách 2:** chuột phải `index.html` → **Open with Live Server**.

> Không mở thẳng file `index.html` bằng cách nhấp đúp – app cần chạy qua `http://` mới hoạt động.

Sửa code xong → lưu → tải lại trang (`Ctrl+Shift+R` để bỏ bộ nhớ đệm).
Xuất video trên máy tính có card đồ hoạ nhanh hơn nhiều so với điện thoại.

## 4. Nhờ Claude Code sửa tiếp

Mở khung Claude Code trong VS Code và nói yêu cầu bằng tiếng Việt, ví dụ:
- “Thêm cảnh bay qua sông Sài Gòn trước khi tới tiện ích”
- “Đổi màu thẻ THÔNG TIN BẤT ĐỘNG SẢN sang vàng gold”

File **`CLAUDE.md`** ở thư mục gốc đã ghi sẵn cấu trúc dự án, thứ tự cảnh, các quyết định đã chốt
(giữ hướng Bắc, mặc định Vệ tinh, Video sạch…) và dữ liệu mẫu – Claude sẽ tự đọc khi bắt đầu.

## 5. Đưa bản sửa lên web

```bash
git add -A
git commit -m "Mô tả thay đổi"
git push
```
Đẩy lên nhánh **`main`** thì GitHub tự đăng lại trang trong ~1 phút
(xem tab **Actions** trên GitHub). Mã phiên bản dưới tên app sẽ đổi theo.
Muốn thử trước mà chưa đăng: tạo nhánh mới (`git checkout -b thu-nghiem`) rồi push nhánh đó.

## 6. Cấu trúc thư mục

```
index.html            giao diện
css/app.css           kiểu dáng
js/app.js             điều khiển giao diện, lưu dự án
js/scenes.js          kịch bản chuyển động camera + đồ hoạ từng cảnh
js/stage.js           bản đồ dựng video
js/overlay.js         vẽ ghim, thẻ, chữ
js/mapstyles.js       các mẫu bản đồ
js/tiles.js           quét tiện ích từ ô bản đồ OpenFreeMap
js/data.js            loại tiện ích, đường đi, vùng phút, tìm địa chỉ
js/geo.js             toạ độ, VN-2000
js/regional.js        điểm mốc kết nối vùng
js/infra-data.js      tuyến hạ tầng (Vành đai 3, 4, Cao tốc TP.HCM – TDM – Chơn Thành)
js/exporter.js        xuất MP4
js/script.js          mẫu kịch bản lời đọc
.github/workflows/    tự đăng lên GitHub Pages
.vscode/              cấu hình VS Code (task chạy app, extension đề xuất)
CLAUDE.md             hướng dẫn cho Claude Code
```
