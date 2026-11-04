# LoRa Link Monitor

Phiên bản chuyển đổi từ website SmartAir cũ sang dashboard phục vụ đồ án đánh giá truyền dữ liệu LoRa.

## Chức năng chính

- Hiển thị RSSI, SNR, PDR và Packet Loss hiện tại.
- Hiển thị Node ID, Sequence Number, khoảng cách, nhiệt độ/độ ẩm và số gói gửi/nhận.
- Biểu đồ RSSI, SNR, PDR và Packet Loss theo thời gian.
- Tra cứu dữ liệu thực nghiệm và xuất Excel.
- Gửi cấu hình LoRa (SF, BW, CR, TX Power, tần số, chu kỳ gửi, khoảng cách thử nghiệm) lên Firebase.
- Cho phép đổi Firebase Host, Auth và đường dẫn dữ liệu ngay trên web.

## Cấu trúc Firebase đề xuất

```text
lora_monitor/
  current/
    nodeId: "NODE_01"
    sequence: 128
    temperature: 30.2
    humidity: 68.5
    rssi: -93
    snr: 7.5
    packetsSent: 130
    packetsReceived: 128
    pdr: 98.46
    packetLoss: 1.54
    distance: 500
    sf: 7
    bw: 125
    cr: "4/5"
    txPower: 17
    frequency: 433
    interval: 5000
    timestamp: "2026-10-07 10:20:00"
    timeMillis: 1791343200000
  history/
    <push-key-1>/
      ... cùng cấu trúc như current
    <push-key-2>/
      ...
  control/
    nodeId: "NODE_01"
    frequency: 433
    sf: 7
    bw: 125
    cr: "4/5"
    txPower: 17
    interval: 5000
    distance: 500
```

`pdr` và `packetLoss` có thể bỏ nếu ESP32 đã gửi `packetsSent` và `packetsReceived`; website sẽ tự tính khi có đủ hai bộ đếm.

## Chạy thử

Website là static HTML/CSS/JS. Có thể chạy bằng Firebase Hosting hoặc một static HTTP server. Cần Internet để tải Bootstrap, Font Awesome, Chart.js, SheetJS và Moment.js từ CDN.

## Giao diện bản Beautiful

- Giao diện dashboard hiện đại hơn theo phong cách phòng thí nghiệm / RF measurement.
- Hero banner LoRa, hiệu ứng sóng radio CSS, thẻ chỉ số RSSI/SNR/PDR/Packet Loss được làm lại.
- Bảng, form, tab và biểu đồ được đồng bộ màu sắc, typography và responsive tốt hơn.
- Không thay đổi cấu trúc dữ liệu Firebase hay các ID chức năng chính, nên logic cũ vẫn tương thích.
