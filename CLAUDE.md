# Studio Vị Trí – Nhà Đất Vân Anh

Web app tĩnh (HTML + JS thuần, **không có bước build**) tạo video giới thiệu vị trí lô đất / căn nhà
và tiện ích xung quanh cho video review bất động sản. Video được dựng và xuất MP4 **ngay trong trình duyệt**.

- Bản chạy thật: https://hovananhboss-cmd.github.io/nha-dat-van-anh/ (GitHub Pages, tự đăng khi push lên `main`)
- Người dùng là môi giới BĐS, giao tiếp **tiếng Việt**. Giao diện, chú thích code, commit message đều viết tiếng Việt.

## Chạy trên máy

```bash
python3 -m http.server 8000      # hoặc: npx serve .
# mở http://localhost:8000
```
Phải chạy qua http (không mở file trực tiếp) vì dùng ES modules và WebCodecs.
Trong VS Code: `Terminal → Run Task → Chạy Studio Vị Trí`, hoặc extension Live Server.

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `css/app.css` | Giao diện 6 bước (vị trí → tiện ích → thông tin → kiểu video → kịch bản → xuất) |
| `js/app.js` | Điều khiển UI, trạng thái `state`, lưu localStorage (`va-studio-v1`, có số phiên bản `v`), dựng & xem trước, gọi xuất |
| `js/scenes.js` | **Lõi chuyển động**: `buildTimeline(S)` tạo danh sách cảnh `{name, dur, cam(p), ms(p), draw(ctx,p,lt,E)}` |
| `js/stage.js` | Bản đồ MapLibre dùng để dựng (không tương tác), các lớp `va-*` (lô đất, đường, hạ tầng, vùng phút…), `settle()` chờ vẽ xong |
| `js/overlay.js` | Vẽ canvas: ghim, thẻ tên (`measureCard`/`cardBox`), đốm sáng `comet`, tiện ích chữ |
| `js/mapstyles.js` | Bộ dựng style bản đồ (Vệ tinh + tên đường, Đêm, Ngày, 3 bảng tối Navy & Gold / Emerald Noir / Đen champagne, 32 theme nghệ thuật) trên dữ liệu OpenFreeMap. Ảnh vệ tinh tắt `raster-fade-duration` để xuất nhanh |
| `js/themes-artistic.js` | 32 bảng màu từ MapToPoster JS (MIT – giữ nguyên thông báo giấy phép) |
| `js/tiles.js` | **Nguồn tiện ích chính**: giải mã ô vector z14 OpenFreeMap (lớp `poi`, `transportation_name`) |
| `js/data.js` | Danh mục tiện ích `CATS`, Photon (nguồn phụ), OSRM (xếp hàng 1 yêu cầu/giây, nhớ cả yêu cầu đang chạy), Valhalla, Nominatim (tìm địa chỉ + **khu công nghiệp**: ô bản đồ không có tên vùng KCN), giải link rút gọn Google Maps |
| `js/geo.js` | Hình học, đọc link/toạ độ, **VN-2000 → WGS84** (proj4, 7 tham số, KTT theo tỉnh – TT 973/2001) |
| `js/regional.js`, `js/infra-data.js` | Điểm mốc "Kết nối vùng"; tuyến Vành đai 3, Vành đai 4, Cao tốc TP.HCM – TDM – Chơn Thành (trích từ OSM) |
| `js/exporter.js` | Xuất MP4: WebCodecs + mp4-muxer, trộn giọng đọc/nhạc bằng OfflineAudioContext |
| `js/sound.js` | Nhạc nền + SFX tự tổng hợp (Web Audio), xếp theo `start` của từng cảnh – không dùng file nhạc |
| `js/script.js` | Mẫu kịch bản lời đọc (không dùng AI) |
| `.github/workflows/pages.yml` | Đăng Pages; gắn `?v=<commit>` vào mọi import để điện thoại không dùng bản cũ trong bộ nhớ đệm |

Thư viện tải từ CDN, **ghim phiên bản cố định**: maplibre-gl 4.7.1, mp4-muxer 5.1.3, proj4 2.12.1,
@mapbox/vector-tile 2.0.3, pbf 4.0.1. Không có package.json / node_modules.

## Thứ tự cảnh trong video
intro (lao thẳng xuống) → zoomlot (nhìn thẳng, lô đất phát sáng, kích thước cạnh, thẻ **THÔNG TIN BẤT ĐỘNG SẢN** 3D)
→ plot (flycam 1 vòng 360°) → road (nối tới đường chính) → iso (vùng 5–10–15 phút, tuỳ chọn)
→ scan (radar theo bán kính) → poi × N (dẫn đường từng tiện ích) → overview → region × N + region-all (kết nối vùng) → infra (hạ tầng) → media (ảnh/video) → outro.

Camera: `lerpCam` di chuyển tâm theo tỉ lệ zoom (như flyTo); `chase()` + `chaseCamFn()` cho cảnh dẫn đường.

## Quyết định đã chốt với người dùng (đừng đổi nếu không được yêu cầu)
- Tên đường của bản đồ hiện ở mọi cảnh giữ hướng Bắc, mờ đi khi flycam xoay (`ms.labels`) – "tên đường bay vòng quanh rối mắt".
- **Camera luôn giữ hướng Bắc**, chỉ lia/zoom theo đường đi ("bay nhiều hướng nhìn rối"). Chỉ cảnh flycam lô đất được xoay: 360° / 180° / 90° / không xoay (90°, 180° lia đối xứng quanh hướng Bắc).
- Radar quét (cảnh `scan`, trước các cảnh tiện ích) có bán kính = bán kính quét tiện ích ở bước 2. Đường: tối đa 3 chính (nổi bật + đường nối) và 3 phụ (vẽ mảnh).
- Mặc định **Vệ tinh + tên đường**; **Video sạch** bật mặc định (không tiêu đề, giá, liên hệ, phụ đề – chỉ lô đất, diện tích, tiện ích).
- Toạ độ VN-2000 **nhập tay** (đã bỏ tính năng chụp ảnh sổ / OCR). Diện tích & cạnh tính trực tiếp từ X,Y để khớp số trên sổ.
- Khi flycam, lô đất nằm **giữa màn hình**.
- Không dùng Google Places (điều khoản cấm hiển thị trên bản đồ không phải Google), không dùng style CARTO (cần giấy phép thương mại), không dùng datawan-labs (cấm thương mại).
- Giữ dòng ghi công bản đồ nhỏ ở góc video (giấy phép OSM/Esri).

## Kiểm thử
Chưa có bộ test tự động trong repo. Cách đã dùng: Playwright điều khiển trang, gọi `window.__va`
(`state`, `timeline`, `stage`, `ensureBuilt`, `renderPreview`, `setCenter`, `doExport`) rồi chụp khung hình,
và quét `timeline.applyMap(t)` theo từng 1/30 s để phát hiện camera giật (zoom > 0,3, pitch > 6°, xoay > 12° mỗi khung).
Dữ liệu mẫu của người dùng: GPS `10.9402770, 106.7212813`; VN-2000 (KTT 105°45', 130 m², 5 × 26 m):
```
1210022,957 605979,2481
1210017,957 605979,2231
1210018,086 605953,2231
1210023,086 605953,2481
```

## Quy ước khi sửa
- Không thêm bước build / framework nếu không thật cần.
- Đổi định dạng dữ liệu lưu → tăng `v` trong `snapshot()` và xử lý chuyển đổi trong `restore()`.
- Xuất video chạy từng khung, chờ `stage.settle()`; mọi hiệu ứng phải tính theo thời gian `t` (không dùng trạng thái theo khung trước) để xem trước và xuất cho kết quả giống nhau.
