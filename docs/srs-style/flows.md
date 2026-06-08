<!-- 01 login -->
```mermaid
flowchart TD
  A([Start]) --> B[Người dùng nhập tên đăng nhập và mật khẩu]
  B --> C[Gửi yêu cầu đăng nhập tới hệ thống]
  C --> D{Thông tin hợp lệ?}
  D -->|NO| E[Báo lỗi sai thông tin và quay lại form đăng nhập]
  D -->|YES| F[Hệ thống phát hành JWT token]
  F --> G[Trả về thông tin người dùng và vào hệ thống]
  E --> H([End])
  G --> H
```

<!-- 02 book-court -->
```mermaid
flowchart TD
  A([Start]) --> B[Khách chọn sân, ngày và khung giờ]
  B --> C[Hệ thống kiểm tra slot khả dụng]
  C --> D{Slot còn trống?}
  D -->|NO| E[Báo khung giờ đã có người đặt, chọn lại]
  D -->|YES| F[Tạo booking trạng thái chờ và khóa slot]
  F --> G[Sinh hóa đơn chưa thanh toán]
  G --> H[Chuyển sang thanh toán trực tuyến bắt buộc]
  E --> Z([End])
  H --> Z
```

<!-- 03 fixed-schedule -->
```mermaid
flowchart TD
  A([Start]) --> B[Khách chọn sân, chu kỳ và khoảng ngày]
  B --> C[Hệ thống tạo danh sách buổi dự kiến - preview]
  C --> D{Tất cả buổi đều trống?}
  D -->|NO| E[Hiển thị buổi trùng để đổi giờ hoặc đổi sân]
  E --> C
  D -->|YES| F[Tính giá gói và chốt thông tin khách]
  F --> G[Tạo gói cố định cùng các buổi và booking]
  G --> H[Thanh toán trực tuyến cho cả gói]
  H --> Z([End])
```

<!-- 04 order -->
```mermaid
flowchart TD
  A([Start]) --> B[Khách chọn sản phẩm vào giỏ hàng]
  B --> C[Nhập thông tin nhận hàng và chọn hình thức nhận]
  C --> D[Hệ thống chọn kho phục vụ và kiểm tra tồn]
  D --> E{Đủ tồn kho?}
  E -->|NO| F[Báo sản phẩm hết hàng]
  E -->|YES| G[Tạo đơn hàng chờ xử lý và sinh hóa đơn]
  G --> H[Thanh toán trực tuyến hoặc tiền mặt khi nhận]
  F --> Z([End])
  H --> Z
```

<!-- 05 payment -->
```mermaid
flowchart TD
  A([Start]) --> B[Khách chọn phương thức thanh toán]
  B --> C{Cổng tự động xác thực được? - VNPay/MoMo/SePay}
  C -->|YES| D[Tạo link hoặc mã QR của cổng thanh toán]
  D --> E[Khách thanh toán trên cổng]
  E --> F[Cổng gửi IPN, hệ thống tự xác nhận]
  C -->|NO| G[Chuyển khoản thủ công, nhân viên đối soát và xác nhận]
  F --> H[Cập nhật hóa đơn đã thanh toán]
  G --> H
  H --> Z([End])
```

<!-- 06 review -->
```mermaid
flowchart TD
  A([Start]) --> B[Người dùng chọn sân đã từng chơi]
  B --> C[Nhập số sao và nội dung đánh giá]
  C --> D{Đã đánh giá sân này trước đó?}
  D -->|YES| E[Báo đã đánh giá, không cho gửi trùng]
  D -->|NO| F[Lưu đánh giá vào hệ thống]
  F --> G[Cập nhật điểm trung bình của sân]
  E --> Z([End])
  G --> Z
```

<!-- 07 checkin -->
```mermaid
flowchart TD
  A([Start]) --> B[Nhân viên quét mã hoặc nhập mã booking]
  B --> C[Hệ thống tra cứu thông tin booking]
  C --> D{Hợp lệ và đã thanh toán?}
  D -->|NO| E[Báo lỗi hoặc yêu cầu thanh toán trước]
  D -->|YES| F[Cập nhật trạng thái sang đang chơi]
  F --> G[Cho khách vào sân]
  E --> Z([End])
  G --> Z
```

<!-- 08 confirm-payment -->
```mermaid
flowchart TD
  A([Start]) --> B[Nhân viên mở booking đang chờ thanh toán]
  B --> C[Đối soát chuyển khoản hoặc tiền mặt]
  C --> D{Khớp số tiền?}
  D -->|NO| E[Giữ trạng thái chờ và ghi chú]
  D -->|YES| F[Cập nhật hóa đơn đã thanh toán]
  F --> G[Booking chuyển sang đã xác nhận]
  E --> Z([End])
  G --> Z
```

<!-- 09 pos -->
```mermaid
flowchart TD
  A([Start]) --> B[Nhân viên chọn khách hoặc tạo khách vãng lai]
  B --> C[Thêm sản phẩm vào đơn bán]
  C --> D[Tạo đơn bán trạng thái chờ duyệt]
  D --> E[Gửi quản lý phê duyệt]
  E --> Z([End])
```

<!-- 10 import-stock -->
```mermaid
flowchart TD
  A([Start]) --> B[Nhân viên mở phiếu nhập kho]
  B --> C[Chọn kho, sản phẩm và nhập số lượng]
  C --> D{Thông tin hợp lệ?}
  D -->|NO| E[Báo lỗi và nhập lại]
  D -->|YES| F[Cộng tồn kho on_hand và available]
  F --> G[Ghi nhận giao dịch nhập kho]
  E --> Z([End])
  G --> Z
```

<!-- 11 approve-sales -->
```mermaid
flowchart TD
  A([Start]) --> B[Quản lý mở đơn bán chờ duyệt]
  B --> C[Kiểm tra thông tin đơn và tồn kho]
  C --> D{Duyệt đơn?}
  D -->|NO| E[Từ chối đơn và lưu lý do]
  D -->|YES| F[Cập nhật trạng thái đã duyệt]
  F --> G[Xác nhận thanh toán]
  G --> H[Xuất kho và trừ tồn]
  E --> Z([End])
  H --> Z
```

<!-- 12 purchase-order -->
```mermaid
flowchart TD
  A([Start]) --> B[Admin chọn nhà cung cấp và sản phẩm]
  B --> C[Tạo đơn mua hàng trạng thái nháp]
  C --> D[Gửi đơn cho nhà cung cấp]
  D --> E{Nhà cung cấp xác nhận?}
  E -->|NO| F[Hủy đơn mua hàng]
  E -->|YES| G[Nhận hàng và lập phiếu nhập kho]
  G --> H[Cập nhật tồn kho, đơn chuyển đã nhận]
  F --> Z([End])
  H --> Z
```

<!-- 13 transfer -->
```mermaid
flowchart TD
  A([Start]) --> B[Tạo yêu cầu chuyển kho từ kho A sang kho B]
  B --> C{Yêu cầu được duyệt?}
  C -->|NO| D[Từ chối yêu cầu chuyển kho]
  C -->|YES| E[Xuất kho nguồn, trạng thái đang chuyển]
  E --> F[Nhập kho đích khi hàng tới nơi]
  F --> G[Hoàn tất và cân bằng tồn hai kho]
  D --> Z([End])
  G --> Z
```

<!-- 14 dashboard -->
```mermaid
flowchart TD
  A([Start]) --> B[Admin chọn khoảng thời gian thống kê]
  B --> C[Hệ thống tổng hợp doanh thu, booking và đơn hàng]
  C --> D{Có dữ liệu trong kỳ?}
  D -->|NO| E[Hiển thị trạng thái không có dữ liệu]
  D -->|YES| F[Hiển thị biểu đồ và các chỉ số chính]
  E --> Z([End])
  F --> Z
```
