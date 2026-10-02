# Khảo thí CLO

Website ra đề, giao bài, làm bài trực tuyến, chấm điểm và báo cáo CLO cho Khoa CNTT – ĐH Phạm Văn Đồng.

| Tệp | Vai trò |
|---|---|
| `index.html` | Toàn bộ website (một tệp) |
| `config.js` | Địa chỉ máy chủ Apps Script. Không có địa chỉ → chạy bản xem trước |
| `Code.gs` | Máy chủ: dán vào Apps Script của Google Sheet (không đưa lên Vercel cũng được) |

## Cài máy chủ (Google, làm một lần)

1. Tạo Google Sheet mới, ví dụ “Khảo thí CLO – Dữ liệu”.
2. **Tiện ích mở rộng → Apps Script**, xóa mã mặc định, dán toàn bộ `Code.gs`, bấm Lưu.
3. Chọn hàm `setup` → **Chạy** → cấp quyền. Nhật ký in ra **mật khẩu tạm** của tài khoản giảng viên (chính là email Google đang dùng); mật khẩu này cũng nằm ở trang tính `CauHinh`.
4. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**: *Thực thi với tư cách*: **Tôi**; *Người có quyền truy cập*: **Bất kỳ ai** → Triển khai → chép URL `…/exec`.
5. Dán URL đó vào `config.js`.

Sửa `Code.gs` về sau: **Triển khai → Quản lý triển khai → biểu tượng bút → Phiên bản: Phiên bản mới → Triển khai** (URL giữ nguyên).
Quên mật khẩu giảng viên: chạy hàm `capLaiMatKhauGV` trong trình soạn Apps Script.

## Đưa website lên (GitHub + Vercel)

1. Tạo kho GitHub, đưa lên 3 tệp `index.html`, `config.js`, `README.md`.
2. Vercel → **Add New → Project** → chọn kho → Framework: **Other**, không cần lệnh build → **Deploy**.
3. Mỗi lần đẩy (push) bản mới lên GitHub, Vercel tự cập nhật.

## Tài khoản

- **Giảng viên**: email + mật khẩu. Lần đầu dùng mật khẩu tạm, hệ thống yêu cầu đổi. Thêm giảng viên khác ở **Kết nối & dữ liệu**.
- **Sinh viên**: đăng nhập bằng **MSSV**, mật khẩu mặc định **là MSSV**; sinh viên tự đổi ở nút “Đổi mật khẩu”. Sinh viên quên mật khẩu: giảng viên vào **Danh sách lớp → Đặt lại MK** (về lại MSSV).
- Chỉ sinh viên có tên trong ít nhất một lớp học phần mới đăng nhập được.

## Dữ liệu nằm ở đâu

- Drive của chủ Sheet, thư mục `Khao thi CLO`: `catalog.json` (học phần, CLO, lớp, sinh viên, đề), `Anh bai lam/` (ảnh dán, hình vẽ), `Mau xls/` (tệp .xls của trường), `Luu tru/`, `Sao luu/` (sao lưu hằng ngày, giữ 30 ngày).
- Trang tính `DuLieu_BaiLam`: mỗi bài làm một dòng (không sửa tay). `TaiKhoan`: mật khẩu đã băm.
- Trang tính dễ đọc `HocPhan, CLO, LopHocPhan, SinhVien, DanhSachLop, DeThi, CauHoi, BaiLam, Diem` tự dựng lại 10 phút một lần, hoặc bấm **Đồng bộ ra bảng tính**.

## Đồng bộ thời gian thực

Bài làm tự lưu vài giây một lần; giám sát thi cập nhật mỗi 4 giây; sinh viên bị khóa thấy được mở khóa sau vài giây. Mất mạng: bài vẫn giữ trên máy và tự gửi khi có mạng lại. Đáp án trắc nghiệm không gửi xuống máy sinh viên; trắc nghiệm và lập trình được chấm trên máy chủ.
