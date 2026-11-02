# Review SmartHospital — 01/11/2026

> Đây là snapshot review trước triển khai tại commit 29d8c26. Trạng thái sau sửa và bằng chứng kiểm chứng: [Implementation status](docs/IMPLEMENTATION_STATUS.md).

Mục tiêu: thử nghiệm tại phòng khám thực tế, theo xác nhận của người dùng.

**Kết luận: chưa đủ điều kiện dùng dữ liệu bệnh nhân thật.** Hai lỗi P0 ở phân quyền và phản hồi API công khai phải được xử lý trước. Build thành công chưa chứng minh luồng đặt lịch, thu tiền và lưu hồ sơ an toàn.

## Phạm vi và bằng chứng

- Áp dụng ECC `production-audit`, và `click-path-audit` cho luồng đặt lịch/thanh toán. Review toàn bộ nhóm module nghiệp vụ chính; không phải kiểm toán mọi dòng code hay chứng nhận tuân thủ y tế.
- Checkout: nhánh `main`, commit `29d8c26`. Có thay đổi của người dùng ở `sh.server/src/ai/openai.service.ts`; giữ nguyên.
- Đã đọc controller/service/entity/schema, frontend đặt lịch và dashboard, cấu hình chạy/build, script migration.
- Backend build: PASS. Frontend TypeScript: PASS. Frontend production build: PASS, JS chính 707,05 kB, gzip 185,27 kB; Vite cảnh báo chunk trên 500 kB.
- Chạy Jest backend: FAIL vì **không tìm thấy test**; không diễn giải đây là test nghiệp vụ thành công. Không có cấu hình `test/jest-e2e.json` mà package script tham chiếu.
- Bảy tình huống kiểm chứng cục bộ bằng module đã build và fixture trong bộ nhớ: guard admin; phản hồi doctor có hash; bác sĩ bị khóa vẫn qua xác thực JWT; webhook trên lịch canceled; webhook trên lịch completed; retry đặt lịch bị 409; hai request ghi hai hồ sơ cho cùng lịch ở tầng service.
- Script kiểm chứng: `sh.server/.tmp/review-evidence.cjs` (local, được ignore). Chạy bằng Node v22.23.2 đã cài; không đổi cấu hình Node toàn máy. Lệnh `npm` ban đầu gặp proxy NVM chưa chọn version nên các kiểm tra sau gọi Node trực tiếp.
- Không kết nối cơ sở dữ liệu thật; không gọi PayOS/OpenAI/SMTP/Supabase; không đọc giá trị bí mật; không gửi email, giao dịch hay dữ liệu bệnh nhân. Các kiểm chứng fixture không thay thế HTTP E2E hay thử đồng thời trên PostgreSQL.
- Chưa kiểm tra giao diện bằng trình duyệt, thiết bị thật, remote CI, triển khai, backup thực tế hoặc UAT với nhân viên phòng khám. Những giới hạn này cần được giải quyết trước pilot.

## Những tính năng đã có

| Nhóm | Hiện trạng trong source |
|---|---|
| Bệnh nhân | Đăng ký/đăng nhập, quên mật khẩu, sửa hồ sơ/avatar, tìm bác sĩ/chuyên khoa, đặt lịch, cọc PayOS, tự hủy lịch, xem lịch sử giao dịch và kết quả khám |
| Bác sĩ | Lịch ca, lịch hẹn theo ngày/tuần, danh sách bệnh nhân, tạo/sửa hồ sơ khám, thống kê, xin nghỉ phép, trợ lý tra cứu hồ sơ bằng RAG |
| Quản trị | Khoa, người dùng/bác sĩ, khóa tài khoản, nghỉ phép, giao dịch/thống kê, tiền cọc, quảng cáo, thống kê chi phí AI |
| Tự động hóa | Thu hồi lịch chưa cọc, email nhắc H-24/H-1, xóa slot trống quá hạn, hết hạn quảng cáo |

Điểm nên giữ: đặt lịch có transaction và khóa slot; schema có partial UNIQUE chống hai lịch chưa hủy cùng slot; webhook có kiểm tra chữ ký; API hồ sơ có lọc chủ sở hữu; truy vấn RAG có điều kiện `doctor_id` ở SQL. Các lớp bảo vệ này có ích nhưng chưa bao phủ các lỗi dưới đây.

## Lỗi cần khắc phục

P0: chặn thử nghiệm có dữ liệu thật. P1: sửa trước pilot vận hành. P2: cải thiện sau khi nền tảng đúng hoặc trước khi mở rộng.

### R01 — P0: tài khoản bệnh nhân vượt kiểm tra vai trò quản trị

- **Bằng chứng:** `sh.server/src/auth/roles.guard.ts:11` chỉ đọc metadata ở `context.getHandler()`; dòng 12 cho qua nếu thiếu. `sh.server/src/admin/admin.controller.ts:32` gắn `@Roles('admin')` trên class. Các controller quảng cáo, duyệt nghỉ, bác sĩ và doctor AI cũng dùng kiểu này.
- **Kịch bản:** bệnh nhân đã đăng nhập gọi `POST /admin/users` với role admin hoặc API đổi mật khẩu người dùng. Guard không đọc quyền trên class; `createManagedUser` nhận role từ controller, không có kiểm tra vai trò người gọi trong service.
- **Hậu quả:** vượt quyền quản trị, xem danh sách người dùng/giao dịch, tạo admin hoặc đổi mật khẩu tài khoản khác. Khóa giao diện frontend không ngăn gọi API trực tiếp.
- **Xác nhận:** fixture dùng Reflector thật, AdminController thật: role user được `canActivate = true`; đối chứng `DepartmentsController.create` gắn role ở method bị từ chối.
- **Sửa:** dùng `reflector.getAllAndOverride(ROLES_KEY, [context.getHandler(), context.getClass()])`; lập ma trận quyền cho mọi route. `AdminAppointmentsController` gắn role ở từng method nên không mắc riêng lỗi metadata này.
- **Nghiệm thu:** guest 401; bệnh nhân/bác sĩ 403 trên mọi API admin; admin truy cập được đúng quyền. Test cả metadata class và method, cùng các thao tác tạo admin/đổi mật khẩu.

### R02 — P0: API bác sĩ công khai trả hash mật khẩu

- **Bằng chứng:** `sh.server/src/models/user.model.ts:56` khai báo passwordHash bằng Column thông thường; `sh.server/src/doctors/doctors.service.ts:62` và `:75` lấy/trả nguyên UserEntity. `DoctorsController` công khai `/doctors` và `/doctors/:id`.
- **Kịch bản:** khách đọc danh sách/chi tiết bác sĩ nhận cả trường passwordHash, cùng các trường nội bộ không cần hiển thị công khai.
- **Hậu quả:** lộ hash mật khẩu bác sĩ, tạo điều kiện dò mật khẩu ngoại tuyến. Đây là hash, không phải mật khẩu dạng rõ.
- **Xác nhận:** kiểm tra metadata TypeORM cho thấy cột được select mặc định; entity fixture đi qua public controller vẫn còn passwordHash sau JSON serialization. Chưa gọi endpoint triển khai thật.
- **Sửa:** DTO công khai với danh sách trường cho phép; đặt `select: false` cho passwordHash và chỉ select tường minh ở các luồng xác thực cần dùng. Khi đổi select, phải cập nhật login/đổi mật khẩu để tránh làm hỏng xác thực.
- **Nghiệm thu:** kiểm tra JSON mọi API có quan hệ users, không chỉ endpoint bác sĩ. Nếu xác nhận bản triển khai từng lộ hash, đánh giá phạm vi truy cập và thực hiện quy trình thay mật khẩu/thu hồi phiên phù hợp.

### R03 — P1: webhook làm sống lại lịch hủy, đưa lịch hoàn tất về confirmed

- **Bằng chứng:** `sh.server/src/appointments/appointments.service.ts:571` ghi payment paid, sau đó ghi appointment confirmed vô điều kiện tại dòng 586; hai lần save không chung transaction. Controller webhook dòng 30 chỉ chuyển orderCode, không đối chiếu amount với payment.
- **Kịch bản:** webhook hợp lệ gửi lại sau khi bác sĩ hoàn tất ca; hoặc người dùng/hệ thống đã hủy lịch rồi webhook mới đến.
- **Hậu quả:** completed → confirmed; canceled → confirmed. Nếu slot đã được người khác đặt, partial UNIQUE có thể chặn cập nhật appointment, nhưng payment đã được ghi paid trước đó, để lại trạng thái lệch và lỗi webhook. Không kết luận hệ thống chắc chắn đặt trùng: UNIQUE hiện có là lớp chặn việc đó.
- **Xác nhận:** fixture chạy method thật tái hiện cả canceled và completed bị đổi thành confirmed.
- **Sửa:** transaction, khóa và thống nhất thứ tự khóa; kiểm tra số tiền và trạng thái thanh toán trong payload đã xác thực; xử lý lặp không đổi trạng thái kết thúc. Tiền đến sau hạn phải vào hàng đợi đối soát, không tự khôi phục lịch. Đồng bộ hạn thanh toán phía nhà cung cấp với thời hạn giữ chỗ; có tác vụ đối soát khi mất webhook.
- **Nghiệm thu:** webhook lặp, đến muộn, đến đồng thời với cron/hủy lịch, lệch số tiền, provider timeout và slot đã được đặt lại.

### R04 — P1: khóa tài khoản và đổi mật khẩu không thu hồi JWT đang dùng

- **Bằng chứng:** `sh.server/src/auth/auth.service.ts:130` chỉ kiểm tra khóa lúc login; `:144` validateUserById không kiểm tra isLocked. `auth.module.ts:23` cấp JWT 7 ngày. Các luồng đổi/reset mật khẩu không cập nhật phiên/token version; logout chỉ trả message.
- **Hậu quả:** bác sĩ bị khóa vẫn dùng token cũ để truy cập API; token bị lộ còn dùng được sau đổi mật khẩu cho tới hết hạn.
- **Xác nhận:** validateUserById vẫn trả user cho fixture bác sĩ isLocked=true.
- **Sửa:** kiểm tra trạng thái tài khoản mỗi request; session hoặc tokenVersion/passwordChangedAt; thu hồi phiên khi khóa/reset/đổi mật khẩu theo chính sách rõ ràng. Từ chối khởi động khi thiếu JWT_SECRET ở môi trường chạy thật: hiện có fallback secret cố định (`auth.module.ts:22`, `jwt.strategy.ts:23`). Chưa xác nhận deployment thực tế có dùng fallback.
- **Nghiệm thu:** token cấp trước thời điểm khóa/reset bị từ chối; token/phiên hợp lệ mới hoạt động đúng.

### R05 — P1: lịch trống chỉ được tạo một lần, trong 14 ngày

- **Bằng chứng:** `sh.server/src/admin/admin.service.ts:64`, `:135`, `:441`. generateSlotsForDoctor chỉ được gọi lúc tạo bác sĩ; vòng lặp giới hạn 14 ngày. Không tìm thấy tác vụ sinh nối tiếp hay API quản lý lịch làm việc để sinh slot trong source đã review.
- **Hậu quả:** sau khi qua khoảng đã tạo, bác sĩ cũ không có lịch tương lai để bệnh nhân đặt nếu không có thao tác bổ sung ngoài ứng dụng.
- **Sửa:** lịch làm việc định kỳ và ngoại lệ; sinh cuốn chiếu 14–30 ngày bằng job idempotent, UNIQUE `(doctor_id, slot_time)`; tôn trọng khóa/nghỉ phép và giữ nguyên lịch đã đặt. Backend đặt lịch cũng phải kiểm tra bác sĩ còn hoạt động.
- **Nghiệm thu:** giả lập ngày thứ 15 trở đi; chạy job lặp không tạo trùng; ngày nghỉ/ngày lễ không mở ca nhầm.

### R06 — P1: xóa bệnh nhân kéo theo mất lịch, giao dịch và hồ sơ khám

- **Bằng chứng:** `sh.server/src/admin/admin.service.ts:397` chỉ chặn dữ liệu liên quan khi đối tượng là bác sĩ; dòng 433 remove user. Schema `:108`, `:152`, `:190` dùng CASCADE từ bệnh nhân → lịch/giao dịch/hồ sơ.
- **Hậu quả:** thao tác xóa bệnh nhân làm mất lịch sử khám và tài chính. Slot có thể còn booked vì xóa theo FK không chạy logic trả slot của cancelInternal.
- **Mức chứng cứ:** xác nhận từ service và schema local; chưa thực hiện xóa trên DB.
- **Sửa:** vô hiệu hóa/ẩn tài khoản thay cho hard delete bệnh nhân đã phát sinh nghiệp vụ; tách quy trình xử lý dữ liệu khỏi CRUD thông thường, ghi nhật ký và bảo toàn liên kết hồ sơ/giao dịch.
- **Nghiệm thu:** thao tác vô hiệu hóa không làm mất hồ sơ/thu tiền; lịch tương lai được xử lý minh bạch; báo cáo lịch sử không thay đổi ngoài ý muốn.

### R07 — P1: tạo hồ sơ khám có thể bị trùng và lưu dở dang

- **Bằng chứng:** `sh.server/src/medical-records/medical-records.service.ts:167` check tồn tại trước, `:205` lưu record rồi `:208` cập nhật appointment riêng. Schema `:202` chỉ có INDEX thường trên appointment_id, entity không có UNIQUE tương ứng.
- **Kịch bản:** hai tab hoặc request retry chạy đồng thời; hoặc lưu record thành công nhưng cập nhật appointment thất bại.
- **Hậu quả:** hai hồ sơ cho một lịch, hoặc đã có hồ sơ nhưng appointment chưa completed; retry có thể bị báo đã tồn tại thay vì hoàn tất thao tác còn thiếu.
- **Xác nhận:** hai request với fixture cùng nhìn thấy chưa có record và lưu hai bản. Khả năng DB cho phép phù hợp schema local; cần integration test PostgreSQL sau sửa.
- **Sửa:** UNIQUE appointment_id khi khác null, dọn dữ liệu trùng trước migration; transaction khóa appointment, kiểm tra trạng thái và lưu cả hai thay đổi. Embedding chạy sau commit bằng tác vụ có retry.
- **Nghiệm thu:** nhiều request đồng thời chỉ tạo một hồ sơ; chèn lỗi giữa hai lần ghi không để trạng thái dở dang.

### R08 — P1: backfill AI xử lý hồ sơ toàn hệ thống, không giới hạn theo bác sĩ

- **Bằng chứng:** `medical-records.controller.ts:39` không truyền current doctor; `medical-record-embeddings.service.ts:110` nhận limit từ request, `:113`/`:118` chọn medical_records toàn cục. Không có ràng buộc giới hạn dương/tối đa ở controller.
- **Hậu quả:** ngay cả khi sửa R01, một bác sĩ vẫn có thể kích hoạt tái xử lý hồ sơ của bác sĩ khác, gây chi phí API và tải server. Đây là vượt phạm vi xử lý; không đồng nghĩa response backfill trả toàn bộ nội dung hồ sơ.
- **Sửa:** backfill cá nhân có điều kiện doctor_id, giới hạn batch; backfill toàn hệ thống là job quản trị riêng, quota/ngân sách và chống chạy trùng.
- **Bổ sung:** `/ai/suggest-departments` công khai gọi LLM khi cache miss; chưa thấy rate limit/quota trong ứng dụng. Cache không chặn người dùng gửi nhiều nội dung khác nhau. Thêm hạn mức và giới hạn đồng thời cho AI, login, forgot-password.
- **Nghiệm thu:** bác sĩ A không kích hoạt xử lý hồ sơ B; giới hạn request/batch có hiệu lực; vượt ngân sách không gọi nhà cung cấp.

### R09 — P1: duyệt nghỉ phép có cửa sổ tranh chấp với đặt lịch

- **Bằng chứng:** `leave-requests.service.ts:168` đọc đơn; `:181` đếm booked; `:196` chỉ đổi slot còn available; `:208` lưu approved, không transaction/khóa chung với booking.
- **Kịch bản:** sau khi đếm được 0 booked, bệnh nhân đặt một slot; UPDATE on_leave bỏ qua slot vừa booked nhưng đơn vẫn approved. Hai admin duyệt/từ chối đồng thời cũng không được serialize.
- **Hậu quả:** nghỉ đã duyệt nhưng vẫn có lịch bệnh nhân trong khoảng nghỉ.
- **Mức chứng cứ:** phân tích đường ghi và thứ tự thao tác; chưa thử đồng thời trên PostgreSQL.
- **Sửa:** transaction, khóa request và các slot theo thứ tự nhất quán, kiểm tra lại trước commit; booking và sinh slot cũng kiểm tra lịch nghỉ đã duyệt.
- **Nghiệm thu:** integration test booking ↔ approve, approve ↔ reject; không tồn tại trạng thái nghỉ đã duyệt với ca mới được đặt trái phép.

### R10 — P2: cơ chế tiếp tục thanh toán và trang kết quả chưa tin cậy

- **Bằng chứng:** `appointments.service.ts:135` từ chối slot booked trước khi tìm pending cùng người tại `:144`. Nhánh idempotency không thể phục vụ retry bình thường sau khi đặt thành công.
- **Xác nhận:** fixture slot booked trả 409 trước khi tới truy vấn tìm lịch đang chờ.
- **Frontend:** `BookingFlow.tsx:767` returnUrl chỉ có view=booking-success; `App.tsx:362` render thành công không đọc trạng thái từ server. User đăng nhập mở trực tiếp URL này vẫn thấy thành công. Điều này không tự ghi paid vào DB nhưng gây hiểu nhầm vận hành.
- **Mất trạng thái:** pendingAppointmentId/selectedDoctor nằm trong React state. Reload hoặc redirect cancel về view=booking không khôi phục lịch/bác sĩ; `window.open` sau await không kiểm tra popup bị chặn.
- **Sửa:** khóa slot rồi tìm pending chính chủ trước khi báo conflict; lưu checkout/session cần thiết; có endpoint trạng thái lịch chính chủ; URL chứa định danh lịch và frontend xác minh server, hiển thị pending/paid/expired/canceled; khôi phục sau reload, cho mở lại link và đếm ngược thời hạn giữ chỗ.
- **Nghiệm thu:** reload, đóng/mở tab, popup bị chặn, mạng đứt sau khi tạo lịch, redirect trước webhook, retry cùng request không tạo thêm lần thu tiền.

### R11 — P1: schema và đường nâng cấp cơ sở dữ liệu chưa đáng tin cậy

- **Bằng chứng:** `sh.server/scripts/apply-medical-records-core-migration.cjs:23` cùng các script migration khác đọc file ở `migrations/`, nhưng thư mục đó không có trong checkout. Nhiều script db:* trong package.json cũng trỏ file SQL không tồn tại.
- **Sai lệch cụ thể:** schema `:43` ghi chú có idx_users_phone_unique nhưng không tạo index đó; entity khai báo phone unique và service dựa vào quy tắc duy nhất. synchronize=false nên metadata entity không tự sửa DB tạo từ schema này.
- **Hậu quả:** lệnh migration không chạy được từ repo; DB mới theo hướng dẫn thiếu ràng buộc, hai request đồng thời có thể dùng trùng phone. CREATE TABLE IF NOT EXISTS không phải đường nâng cấp bảng đã tồn tại.
- **Sửa:** một bộ migration version hóa có lịch sử áp dụng; baseline nhất quán với entity; đóng gói đúng file; kiểm tra trùng trước thêm UNIQUE; test nâng cấp trên bản sao và khôi phục từ backup.
- **Nghiệm thu:** dựng DB trống từ checkout và nâng cấp DB phiên bản cũ đều qua kiểm tra schema/constraint; có bản backup đã thử restore.

## Những điểm tối ưu và kiểm soát cần bổ sung

| Ưu tiên | Điểm cần làm | Bằng chứng và giới hạn |
|---|---|---|
| Trước pilot | Lịch sử chỉnh sửa hồ sơ: người sửa, thời điểm, nội dung thay đổi, lý do, phiên bản chống ghi đè | updateMyRecord (`medical-records.service.ts:460`) ghi đè nội dung trực tiếp; schema chưa có bảng revision/audit |
| Trước bật AI với dữ liệu thật | Bật/tắt AI riêng, quyền xử lý dữ liệu, chính sách lưu giữ, danh mục dữ liệu gửi ra ngoài | createFromAppointment/updateMyRecord tự gọi embedRecord khi có key; scrub chỉ xử lý email/phone/tên đã cung cấp. Checkbox hiện có nói AI là tham khảo, chưa đại diện cho toàn bộ luồng kiểm soát gửi dữ liệu ra nhà cung cấp |
| Trước pilot | Nhắc lịch có trạng thái queued/processing/sent/failed, thời hạn giữ job và retry | appointment-reminders.service.ts:130 reserve sent_at trước khi gửi ở :145. Nếu process chết giữa hai bước, lần sau loại bản ghi đó dù mail chưa được gửi. Chưa diễn tập crash |
| Trước pilot | DTO validation runtime, whitelist trường, giới hạn độ dài và lỗi 400 nhất quán | main.ts chưa có ValidationPipe; DTO booking chỉ khai báo kiểu. Vẫn có validation thủ công một số luồng, vì vậy không kết luận toàn bộ API không kiểm tra đầu vào |
| Theo số đo | Phân trang/lọc ở API; truy vấn gộp tình trạng bác sĩ | DoctorSearch tải toàn bộ bác sĩ rồi slice 5 người/trang; bộ lọc lịch gọi getDoctorSlots cho từng bác sĩ (`DoctorSearch.tsx:159`). Chưa đo độ trễ với dữ liệu thực |
| Theo số đo | Giảm truy vấn/thao tác tải toàn bộ lịch sử | findMyAppointments/findMyPayments chưa phân trang; danh sách hồ sơ take 200 nhưng chưa có đường phân trang tiếp. Sidebar chat lấy toàn bộ user messages của 50 session rồi chọn bản cuối trong JS (`doctor-chat-sessions.service.ts:71`) |
| Sau sửa lỗi chặn | Lazy-load dashboard/admin/AI và chia bundle | App.tsx:13–15 import dashboard trực tiếp; build JS chính 707,05 kB. Đây là bằng chứng kích thước, chưa phải số đo thời gian tải hay mục tiêu tối ưu đã đạt |
| Trước công khai thông tin | Gỡ điểm đánh giá mặc định; hiển thị thông tin thực tế và nút có tác dụng | mappers.ts:31 đặt mọi rating=4.8, reviewsCount=0, location/hospital cố định. BookingFlow.tsx:306 có nút thêm lịch trong nhánh confirmed nhưng không có handler; nhánh này hiện cũng chưa được kích hoạt bằng setConfirmed(true) |
| Trước pilot | Health/readiness DB/schema, theo dõi lỗi và job, kiểm tra cấu hình khởi động | GET / hiện chỉ Hello World; chưa thấy pipeline CI trong tracked files, kiểm thử nghiệp vụ và quy trình restore trong repo. Không suy ra hạ tầng bên ngoài chắc chắn không có các cơ chế này |

RAG hiện có lọc bác sĩ ở SQL và trích nguồn, nên giữ. Tuy nhiên search luôn lấy top-k mà không có ngưỡng liên quan đã kiểm chứng; nội dung embedding có thể cũ nếu sửa hồ sơ rồi embed thất bại. Cần hàng đợi retry/index status và bộ câu hỏi đánh giá để đo trả lời không đủ bằng chứng, trích nguồn sai và cô lập dữ liệu. Không dùng nhãn similarity hiện có như xác suất câu trả lời đúng.

## Nên phát triển thêm tính năng nào cho phòng khám

Đề xuất dưới đây dựa trên khoảng trống giữa source hiện tại và luồng khám ngoại trú. Phòng khám cần xác nhận quy trình, trách nhiệm và chính sách thu phí trước khi triển khai; không mặc định mọi cơ sở vận hành giống nhau.

| Thứ tự | Tính năng | Giá trị và tiêu chí nghiệm thu |
|---|---|---|
| 1 | **Lễ tân/tiếp đón và hàng đợi khám** | Role receptionist riêng; tạo lịch tại quầy/điện thoại, check-in, chờ khám, đang khám, hoàn tất, vắng mặt; ca vắng không bị tự coi là đã khám chỉ vì qua giờ. Lễ tân chỉ xem/sửa đúng dữ liệu cần cho công việc |
| 2 | **Quản lý lịch làm việc** | Ca lặp, ca ngoại lệ/ngày nghỉ, thời lượng, mở/đóng ca, sinh slot cuốn chiếu. Có preview ảnh hưởng lên lịch đã đặt, không âm thầm hủy lịch bệnh nhân |
| 3 | **Đổi lịch và xử lý khi bác sĩ nghỉ** | Giữ slot mới và giải phóng slot cũ trong cùng giao dịch; giữ liên kết cọc; gửi thông báo; thất bại thì lịch cũ còn nguyên. Trường hợp phòng khám hủy cần chính sách hoàn/chuyển cọc được duyệt |
| 4 | **Hồ sơ bệnh nhân và hồ sơ khám có cấu trúc** | Mã bệnh nhân riêng với tài khoản đăng nhập; thông tin định danh cần thiết, dị ứng/tiền sử, chỉ số khám, chẩn đoán/điều trị có cấu trúc; bản nháp → xác nhận, lịch sử sửa và in phiếu. Đặt thay/người phụ thuộc cần quan hệ và quyền truy cập riêng |
| 5 | **Thu ngân, đối soát, hoàn/chuyển cọc** | Liên kết tiền cọc, phí khám còn lại, khoản thu và chứng từ; quyền thu/hoàn tách biệt; giao dịch đến muộn có danh sách chờ xử lý. Hiện logic hủy giữ cọc cho cả admin (`appointments.service.ts:351`), đây là chính sách cần xác nhận, không tự kết luận là lỗi |
| 6 | **Theo dõi tác vụ và thông báo vận hành** | Danh sách mail lỗi, lịch chờ cọc/hết hạn, giao dịch lệch, hồ sơ chưa hoàn tất; người phụ trách xử lý và nhật ký. Tận dụng cron/email đã có thay vì xây lại chức năng nhắc lịch |
| 7 | **Tái khám và danh sách chờ** | Đề xuất mốc tái khám do bác sĩ xác nhận, liên kết lần khám trước; khi slot trống thì thông báo người chờ và yêu cầu xác nhận trước khi đặt |

Không ưu tiên mở rộng chatbot, quảng cáo, đánh giá bác sĩ, app riêng hoặc nghiệp vụ nội trú trong vòng pilot đầu. Các phần đó không giải quyết lỗi quyền truy cập, mất hồ sơ, lệch thanh toán và thiếu tiếp đón đang ảnh hưởng trực tiếp mục tiêu đã chọn.

## Trình tự triển khai đề nghị

1. **Vòng 1 — khóa lỗi chặn:** R01/R02/R04, thêm kiểm thử ma trận quyền và JSON response, bỏ đường hard delete bệnh nhân có dữ liệu. Dùng dữ liệu giả để kiểm tra.
2. **Vòng 2 — làm đúng giao dịch:** R03/R05/R07/R09/R10; migration chuẩn, unique constraint, kiểm thử PostgreSQL đồng thời; bổ sung đối soát và xử lý cọc đến muộn.
3. **Vòng 3 — hoàn thành một lượt khám:** vai trò lễ tân → check-in → bác sĩ khám/hoàn tất hồ sơ → thu ngân → tái khám; có nhật ký và quyền rõ ràng.
4. **Vòng 4 — diễn tập vận hành:** restore backup, mất mạng, lỗi PayOS/email/AI, restart giữa job, ca bác sĩ nghỉ, dùng trên điện thoại; đo thời gian thao tác và độ trễ API rồi tối ưu đúng điểm nghẽn.

Không gán số ngày công khi chưa có quy mô nhóm, quy trình phòng khám, dữ liệu mẫu và yêu cầu triển khai.

## Điều kiện cho phép pilot có dữ liệu thật

- Không còn P0; các P1 liên quan quyền, dữ liệu, giao dịch và đường triển khai đã sửa và kiểm chứng.
- Một ca khám đi hết luồng trên môi trường staging, có bệnh nhân/lễ tân/bác sĩ/thu ngân cùng nghiệm thu; không chỉnh DB thủ công để hoàn thành ca.
- Test phân quyền/chủ sở hữu, webhook và tranh chấp lịch/hồ sơ chạy tự động trên PostgreSQL; build và test là các gate độc lập.
- Có backup đã thử khôi phục, cách quay về phiên bản trước, theo dõi lỗi, người xử lý sự cố và quy trình khi mạng/hệ thống không dùng được.
- Quyền truy cập và phạm vi dữ liệu đã được phòng khám phê duyệt; AI tắt được độc lập, và luồng khám/ghi hồ sơ vẫn dùng được khi AI lỗi hoặc bị tắt.
- Những yêu cầu chuyên môn, bảo mật và pháp lý áp dụng cho cơ sở phải được chủ cơ sở cùng người có thẩm quyền xác định riêng; bản review mã nguồn này không xác nhận các điều kiện đó.

## Tự kiểm chất lượng review theo ECC

| Tiêu chí | Điểm /5 | Bằng chứng/giới hạn |
|---|---|---|
| Chính xác | 4 | Bảy tình huống fixture, file/dòng cụ thể; chưa HTTP E2E và DB thật |
| Đầy đủ | 4 | Có lỗi, tối ưu, lộ trình và tính năng cho mục tiêu phòng khám; chưa UAT tại cơ sở |
| Rõ ràng | 4 | Tách P0/P1/P2 và mức chứng cứ; báo cáo dài, bản trả lời chat rút gọn các ưu tiên |
| Khả năng thực hiện | 4 | Có cách sửa/tiêu chí nghiệm thu; chưa có người phụ trách và yêu cầu quy trình đã duyệt |
| Ngắn gọn | 4 | Chi tiết nằm trong tài liệu, tránh đưa toàn bộ vào chat; vẫn có thể rút tiếp sau khi chốt phạm vi pilot |

Trung bình 4,0/5 là tự đánh giá chất lượng báo cáo, **không phải điểm sẵn sàng của sản phẩm**. Ba bước tăng độ tin cậy: integration test PostgreSQL; E2E trình duyệt với các vai trò; UAT và diễn tập khôi phục tại môi trường thử nghiệm. Giới hạn này có thể kiểm tra từ bằng chứng nêu trên, không dựa vào việc đã bật ECC.
