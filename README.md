# Studio Vị Trí – Nhà Đất Vân Anh

Công cụ tạo **video giới thiệu vị trí lô đất / căn nhà và tiện ích xung quanh** cho video review bất động sản (TikTok, Reels, YouTube, Zalo, Facebook).

- ✅ **Miễn phí, không giới hạn số video**: không tài khoản, không credit, không API key
- ✅ Chạy ngay trên trình duyệt (điện thoại hoặc máy tính) – video được dựng **ngay trên máy bạn**, không tải dữ liệu khách lên server nào
- ✅ Xuất **MP4 1080p / 720p**, khung **dọc 9:16 · ngang 16:9 · vuông 1:1**, kèm **ảnh bìa**

## Tính năng

| Bước | Làm được gì |
|---|---|
| 1. Vị trí & ranh đất | Dán link Google Maps / toạ độ / tìm địa chỉ · kéo ghim chỉnh vị trí · **vẽ ranh lô đất** bằng cách chạm từng góc trên ảnh vệ tinh · **nhập toạ độ VN-2000 trên sổ đỏ** (tự đổi sang GPS theo kinh tuyến trục từng tỉnh) · tự đo diện tích và chiều dài các cạnh |
| 2. Tiện ích xung quanh | Tự quét trường học, bệnh viện, chợ, siêu thị, TTTM, công viên, ngân hàng, UBND, bến xe/ga, KCN… trong bán kính 1–8 km · chọn tối đa 10 · thêm điểm còn thiếu bằng tay · làm nổi bật 2 tuyến đường chính · **vùng 5–10–15 phút** di chuyển (xe máy / ô tô / đi bộ) theo đường thật |
| 3. Thông tin | Giá, diện tích, kích thước, kết cấu, hướng, pháp lý, điểm nổi bật, tên + SĐT môi giới · tối đa 6 ảnh + 3 video ngắn |
| 4. Kiểu video | Bản đồ đường phố / tối giản / **vệ tinh** · bay theo đường đi tới từng tiện ích hoặc quét radar · màu chủ đạo · tốc độ |
| 5. Kịch bản & âm thanh | Tự viết kịch bản theo 4 giọng văn · **thu âm giọng đọc ngay trong app** hoặc tải file giọng AI (Vbee, FPT.AI, CapCut…) · nhạc nền · **phụ đề tự động** · video tự kéo dài theo giọng đọc |
| 6. Xuất | Xem trước, tua · xuất MP4 · tải ảnh bìa · lưu / mở dự án (file .json) |

Video gồm các cảnh: bay từ trên cao vào vị trí → cận cảnh lô đất xoay 3D với thẻ thông tin → vùng thời gian di chuyển → lần lượt từng tiện ích (vẽ đường đi, hiện khoảng cách và số phút) → toàn cảnh tất cả tiện ích → ảnh/video thực tế → màn hình liên hệ.

## Cách dùng

1. Mở trang web (xem mục **Đưa lên mạng** bên dưới), tốt nhất bằng **Chrome hoặc Edge** trên máy tính hay Android. iPhone dùng Safari iOS 16.4 trở lên.
2. Làm lần lượt 6 bước bên trái, rồi bấm **“Dựng & xem trước”**.
3. Bấm **“Xuất MP4”**, giữ màn hình sáng và ở yên tab cho tới khi xong. Video khoảng 45 giây mất vài phút tuỳ máy.
4. Đưa file MP4 vào CapCut hoặc phần mềm dựng của bạn để ghép với cảnh quay thực tế.

### Mẹo

- **Lấy toạ độ từ Google Maps**: nhấn giữ vào vị trí → chạm vào dãy số toạ độ để sao chép → dán vào ô ở bước 1.
- **Link rút gọn `maps.app.goo.gl`**: trình duyệt không đọc được toạ độ trong link này. Hãy mở link, đợi bản đồ hiện ra rồi copy địa chỉ đầy đủ trên thanh địa chỉ.
- **Toạ độ sổ đỏ (VN-2000)**: ở bước 1 mở mục “📜 Nhập toạ độ từ sổ đỏ”. Có 2 cách nhập:
  - **Chụp ảnh bảng toạ độ**: ảnh được đọc ngay trên máy, không gửi đi đâu.
  - **Gõ hoặc dán tay**: mỗi dòng `STT  X  Y`. Hiểu cả kiểu số `1180081,47` và `1.180.081,47`.

  Để “Tự dò kinh tuyến trục” (nên dùng), hãy định vị căn nhà trước. Hoặc chọn tỉnh, hoặc gõ đúng KTT in trên sơ đồ thửa (VD `105°45'`). Bấm **Đọc toạ độ** để xem bảng cạnh và diện tích (tính trực tiếp từ X, Y, khớp với số trên sổ), rồi bấm **Dùng làm lô đất**. Nếu ranh lệch vài mét so với ảnh vệ tinh, dùng nút **Dịch ranh**.
- **Thiếu tiện ích**: dữ liệu lấy từ OpenStreetMap nên có thể thiếu một số điểm mới. Chọn **➕ Thêm tiện ích** rồi chạm lên bản đồ để thêm.
- **Số phút** được ước tính từ quãng đường thực tế chia cho tốc độ ở bước 2 (mặc định 30 km/h).
- Dự án tự lưu trên trình duyệt. Riêng ảnh, video và âm thanh không lưu được, nên khi mở lại cần tải lên lại.

## Đưa lên mạng (GitHub Pages – miễn phí)

1. Gộp nhánh này vào `main`.
2. Trên GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Đợi tác vụ “Đăng Studio Vị Trí lên GitHub Pages” chạy xong (tab **Actions**). Trang sẽ có địa chỉ dạng `https://<tên-tài-khoản>.github.io/nha-dat-van-anh/`.

Chạy thử trên máy: trong thư mục dự án, chạy `python3 -m http.server 8000` rồi mở `http://localhost:8000`.

## Công nghệ & nguồn dữ liệu (đều miễn phí)

- Bản đồ: [MapLibre GL JS](https://maplibre.org), nền [OpenFreeMap](https://openfreemap.org), ảnh vệ tinh Esri World Imagery
- Tiện ích & đường: [OpenStreetMap](https://www.openstreetmap.org) qua Overpass API
- Đường đi: OSRM · Vùng thời gian: Valhalla (FOSSGIS) · Tìm địa chỉ: Nominatim
- Đổi VN-2000 → WGS84: [proj4js](https://github.com/proj4js/proj4js) (7 tham số theo QĐ 05/2007/QĐ-BTNMT)
- Xuất video: WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)

Video có dòng ghi công bản đồ nhỏ ở góc dưới (© OpenStreetMap…) theo yêu cầu giấy phép dữ liệu, vui lòng giữ lại.
Các máy chủ OSRM, Valhalla, Nominatim, Overpass là dịch vụ cộng đồng dành cho sử dụng vừa phải. Nếu sau này bạn làm số lượng rất lớn, nên chuyển sang dịch vụ trả phí hoặc tự dựng máy chủ.

## Cấu trúc mã

```
index.html        giao diện
css/app.css       giao diện
js/app.js         điều khiển giao diện, lưu dự án, xem trước
js/geo.js         toạ độ, đọc link Google Maps, VN-2000, đo diện tích
js/data.js        lấy tiện ích / đường đi / vùng thời gian / tìm địa chỉ
js/stage.js       bản đồ dựng video và các lớp (ranh, đường, vùng phút)
js/scenes.js      kịch bản chuyển động camera và đồ hoạ từng cảnh
js/overlay.js     vẽ ghim, thẻ, chữ
js/exporter.js    xuất MP4 (WebCodecs), trộn giọng đọc + nhạc
js/script.js      mẫu kịch bản lời đọc
```
