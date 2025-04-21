Các File code xử lý ghi log
MisaLogger.ts
+ class MsLogger để xử lý ghi log dùng hàm saveLog
+ các hàm setTaskId, setMode đặt vào sự kiện thay đổi task, thay đổi mode để bắt taskId và mode(act|plan) phục vụ monitor
user-info.utils.ts để lấy thông tin user đang dùng
**Đẩy code lên git tfs thì dùng `origin-tfs` không dùng `origin`**
- Ví dụ git `push origin-tfs feature/abc`