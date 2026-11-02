# Sử dụng nghiệp vụ phòng khám

Tài liệu mô tả các thao tác đã có trong mã nguồn. Nó không thay thế buổi nghiệm thu với nhân viên phòng khám. Trước khi thử với dữ liệu thật, chạy migration, kiểm thử các vai trò và diễn tập khôi phục theo [OPERATIONS.md](OPERATIONS.md).

## Chuẩn bị tài khoản và dữ liệu

1. Trong `sh.server`, cài dependency, chạy `npm run db:migrate`, build rồi khởi động API. Migration phải chạy trước phiên bản API mới; không dùng `db:reset` để nâng cấp.
2. Kiểm tra `/health/ready`, sau đó mở frontend. Cấu hình môi trường và Supabase dùng cho upload được mô tả trong file ví dụ; không đưa `.env` hoặc dữ liệu bệnh nhân vào Git.
3. Đăng nhập tài khoản quản trị để tạo tài khoản bác sĩ, lễ tân và thu ngân. Cấp từng người một tài khoản riêng. Khóa hoặc đổi mật khẩu sẽ vô hiệu các phiên cũ.
4. Trong khu vực phòng khám, lễ tân tạo mã bệnh nhân hoặc tiếp nhận lịch trực tuyến. Mã bệnh nhân được quản lý riêng với tài khoản đăng nhập; người đến khám tại quầy không bị buộc tạo tài khoản giả.

Mỗi người dùng đã đăng nhập có thể mở khu vực **Phòng khám · Tiếp đón · Hồ sơ · Thu ngân**. Các tab và hành động phụ thuộc vai trò; API tiếp tục kiểm tra quyền và chủ sở hữu khi được gọi trực tiếp.

## Vai trò

| Vai trò | Công việc chính |
|---|---|
| Quản trị (`admin`) | Tài khoản và quyền truy cập; ca làm việc/ngày ngoại lệ; duyệt hoàn tiền; xem công việc và nhật ký nghiệp vụ |
| Lễ tân (`receptionist`) | Mã bệnh nhân, xác minh người đại diện, tiếp nhận lịch, đăng ký điện thoại/tại quầy, check-in, ghi vắng mặt, danh sách chờ và công việc tiếp đón |
| Bác sĩ (`doctor`) | Xem các ca được phân cho mình; bắt đầu khám; nhập chỉ số/nội dung khám; lưu nháp, xác nhận, bổ sung phiên bản và mốc tái khám |
| Thu ngân (`cashier`) | Ghi nhận tiền đã thu, đề nghị hoàn, xác nhận khoản đã chi hoàn sau khi duyệt, chuyển khoản đã thu giữa các ca cùng bệnh nhân và đối soát giao dịch ngoại lệ |
| Bệnh nhân (`user`) | Lịch và thanh toán của mình; ca/hồ sơ được cấp quyền; kết quả đã xác nhận; lịch tái khám và đồng ý khung giờ được đề nghị trong danh sách chờ |

Lễ tân và thu ngân không nhận nội dung chẩn đoán/điều trị, dị ứng, tiền sử hoặc hồ sơ nháp từ màn hình chi tiết. Bác sĩ không mở được ca của bác sĩ khác. Bệnh nhân không được tự cấp quyền đọc hồ sơ cho tài khoản khác.

## Một lượt khám tại quầy hoặc qua điện thoại

1. **Tìm bệnh nhân trước khi tạo mới.** Tra theo mã, tên hoặc số điện thoại. Kiểm tra thông tin với người đến khám, bổ sung ngày sinh/điện thoại/địa chỉ cần thiết.
2. **Đăng ký ca.** Chọn bệnh nhân, bác sĩ, nguồn đăng ký, thời điểm và phí khám. Đặt điện thoại phải chọn slot còn trống; hệ thống giữ slot đó. Đăng ký tại quầy có thời điểm tiếp nhận riêng, không tạo tài khoản đăng nhập giả.
3. **Check-in khi bệnh nhân thực sự đến.** Lễ tân chuyển `scheduled` sang `checked_in`. Qua giờ hẹn không tự động được coi là đã khám.
4. **Bác sĩ bắt đầu khám.** Bác sĩ được phân công chuyển ca sang `in_consultation`, xem tiền sử/dị ứng, ghi chỉ số và nội dung khám.
5. **Lưu nháp hoặc xác nhận.** Bản nháp chưa được trả cho bệnh nhân. Cần chẩn đoán và lý do lưu trước khi xác nhận hoàn tất. Ca chuyển thành `completed`; lần sửa sau phải là bản bổ sung được xác nhận, có lý do và phiên bản mới.
6. **Thu ngân kiểm tra số còn phải thu.** Ghi nhận khoản thực tế đã nhận và chứng từ tương ứng. Số thu mới không được vượt phần còn phải thu của ca.
7. **In khi cần.** Phiếu kết quả lấy từ bản hồ sơ đã xác nhận. Phiếu thu/chi là bản ghi nhận các khoản trong ứng dụng, không phải chức năng phát hành hóa đơn thuế.

Nếu dữ liệu vừa được người khác sửa, màn hình báo xung đột phiên bản. Tải lại và đối chiếu trước khi lưu; không tự ghi đè nội dung mới hơn.

## Tiếp nhận lịch đặt trực tuyến

Lễ tân chọn ngày trong tab lịch trực tuyến, tìm đúng bệnh nhân rồi **Tiếp nhận lịch**. Lịch phải đã xác nhận hoặc hoàn tất; hệ thống tạo mã bệnh nhân nếu cần và liên kết ca với lịch gốc.

Mỗi giao dịch cọc đã xác nhận được liên kết đúng một khoản ghi nhận tiền. Tiếp nhận lại cùng lịch không tạo thêm ca hay thêm tiền cọc. Lịch chờ thanh toán hoặc lịch đã hủy không được tiếp nhận thành một ca khám đang hoạt động.

Sau khi tiếp nhận, thực hiện check-in và khám như ca tại quầy. Đổi lịch trước check-in cập nhật ca đã tiếp nhận theo lịch gốc. Khi ca đã tiếp đón hoặc bắt đầu khám, hệ thống yêu cầu xử lý qua người phụ trách thay vì âm thầm chuyển ca.

## Lịch làm việc và nghỉ phép

Quản trị chọn bác sĩ trong phần quản lý ca làm việc, sửa các khung giờ theo thứ/ngày và thời lượng. **Xem trước ảnh hưởng** trước khi xác nhận. Những thay đổi ảnh hưởng ca đã đặt sẽ bị chặn để người phụ trách xử lý các lịch đó trước.

Ngoại lệ theo ngày chỉ mở/đóng ca trống theo lịch thường; không âm thầm hủy lịch bệnh nhân. Đơn nghỉ phép được duyệt chỉ khi không còn ca đã đặt xung đột. Tác vụ sinh lịch duy trì khoảng tương lai 30 ngày, tôn trọng khóa tài khoản, ngày đóng và nghỉ đã duyệt; chạy lại không tạo trùng slot.

## Hủy và ghi vắng mặt

Hủy ca tại quầy/điện thoại cần lý do; slot điện thoại được trả nếu chưa có người khác giữ. Với lịch trực tuyến đã tiếp nhận, quản trị mở chi tiết ca, mở **Hủy lịch trực tuyến đã tiếp nhận**, nhập lý do và xác nhận đã kiểm tra/thông báo. API cập nhật đồng thời lịch, ca tiếp nhận và slot. Lễ tân không được cấp quyền hủy trực tuyến thay quản trị. Bệnh nhân vẫn dùng chức năng tự hủy lịch của mình trước giờ khám.

Chỉ ghi vắng mặt sau thời điểm hẹn. Ca đang khám hoặc đã hoàn tất không được hủy bằng thao tác đặt lịch. Hủy lịch không tự động phát sinh chuyển tiền hoàn: quyết định xử lý cọc được ghi thành nghiệp vụ tài chính riêng, theo người có quyền duyệt.

## Thu, hoàn và chuyển khoản đã thu

### Ghi nhận thu tiền

Thu ngân mở ca, đối chiếu phí và các khoản đã ghi nhận, nhập số tiền, hình thức nhận và mã giao dịch/chứng từ. Chỉ bấm xác nhận khi khoản thực tế đã nhận. API có khóa giao dịch, kiểm tra phần còn phải thu và mã thao tác để retry cùng lần thu không ghi tiền hai lần.

### Đề nghị hoàn và chi hoàn

1. Thu ngân nhập số tiền và lý do, gửi đề nghị. Đây chưa phải chi hoàn thực tế.
2. Quản trị khác người đề nghị kiểm tra và duyệt/từ chối, kèm ý kiến. Khoản đang chờ hoặc đã duyệt được giữ khỏi số tiền có thể đề nghị tiếp/chuyển.
3. Sau khi khoản đã hoàn thực tế, người có quyền nhập chứng từ và xác nhận chi hoàn. Cùng đề nghị chỉ được ghi khoản chi một lần; retry phải giữ cùng chứng từ.

Đề nghị hoàn cũng có mã thao tác: retry cùng nội dung trả về cùng đề nghị, còn dùng lại mã với số tiền hoặc lý do khác sẽ bị từ chối. Trường hợp quản trị tự tạo đề nghị cần quản trị khác duyệt; không bỏ qua kiểm tra người duyệt để làm thao tác chạy qua.

### Chuyển khoản đã thu sang ca khác

Chỉ chuyển từ ca đã hủy/vắng mặt sang ca còn hiệu lực của **cùng bệnh nhân**. Chọn ca nhận, số tiền, lý do rồi xác nhận. Hệ thống ghi một khoản ra và một khoản vào trong cùng giao dịch; tổng tiền không tăng lên và không vượt số còn phải thu của ca nhận.

Các chức năng này ghi nhận tiền đã giao nhận hoặc phân bổ nội bộ. Chúng không tự gọi API ngân hàng để chuyển tiền cho bệnh nhân.

## Tiền đến muộn và giao dịch cần đối soát

Webhook không được khôi phục lịch đã hủy hoặc đưa lịch khám xong về trạng thái xác nhận. Khoản đến muộn hoặc có số tiền không khớp được giữ trong danh sách cần đối soát.

Với cọc **đã xác nhận nhận tiền** của lịch đã hủy, thu ngân/quản trị nhập ghi chú kiểm tra và chọn **Tiếp nhận / mở xử lý cọc** trong tab vận hành. Thao tác tạo hoặc mở một ca tài chính ở trạng thái hủy, liên kết từng khoản cọc một lần. Nó không đặt lại slot và không mở ca khám.

Dùng quy trình hoàn đã duyệt hoặc chuyển cọc như trên. Chỉ chọn **Xác nhận kết thúc đối soát** khi toàn bộ khoản đã thu được xử lý, không còn số dư và không còn đề nghị đang chờ. Kết quả và người xác nhận được ghi nhật ký.

Nếu giao dịch chưa có trạng thái nhận tiền hợp lệ, không tạo khoản thu từ số tiền suy đoán. Giữ công việc đối soát để kiểm tra với nhà cung cấp; không yêu cầu bệnh nhân trả lại lần nữa chỉ vì màn hình chưa cập nhật.

## Người phụ thuộc và quyền đại diện

Lễ tân/quản trị tìm tài khoản người đại diện và xác nhận đã kiểm tra quyền đại diện trước khi cấp quyền cho mã bệnh nhân. Quyền có thể bị thu hồi, có nhật ký. Người được cấp chỉ xem các ca/hồ sơ của bệnh nhân được liên kết; tự thay ID trong URL không cấp thêm quyền.

## Tái khám và danh sách chờ

Bác sĩ xác nhận ngày tái khám cùng hồ sơ. Bệnh nhân và nhân viên có quyền xem danh sách mốc này để đặt lịch tiếp theo.

Danh sách chờ lưu bác sĩ/ngày mong muốn. Khi có slot phù hợp, lễ tân đề nghị khung giờ; bệnh nhân xác nhận đồng ý. **Xác nhận đề nghị chưa phải đặt lịch và chưa thu cọc**: tiếp tục luồng đặt lịch thông thường để kiểm tra slot còn trống và thanh toán theo chính sách. Đề nghị có thể hết khả dụng nếu người khác đã đặt slot.

## Công việc tồn và AI

Tab vận hành tách ca chưa tiếp nhận, ca chưa hoàn tất, giao dịch lệch, đề nghị hoàn và tác vụ nhắc lịch. Nhận xử lý công việc, ghi tiến độ/kết quả và người phụ trách. Ghi công việc “đã xử lý” không tự làm biến mất nguyên nhân tài chính chưa được giải quyết.

AI cần cả cấu hình triển khai, công tắc quản trị và đồng ý xử lý dữ liệu của những người liên quan. Người dùng có thể từ chối/thu hồi; khám, ghi hồ sơ và thu ngân vẫn hoạt động. Trước khi bật, đọc nội dung công bố dữ liệu gửi ra ngoài; bộ lọc định danh không bảo đảm xóa mọi thông tin riêng tư.

## Phạm vi kiểm chứng

Các suite trong `sh.server/test` kiểm tra migration, quyền truy cập, đồng thời đặt lịch/hồ sơ, tài chính và luồng khám bằng dữ liệu giả trên PostgreSQL riêng. Gateway thanh toán, AI và gửi thư trong các kiểm thử nghiệp vụ dùng mock; chạy chúng không chứng minh giao dịch, thư hoặc suy luận AI thực tế đã thành công.

Trước pilot, cần người dùng từng vai trò đi hết một lượt khám trên môi trường thử, thử mất mạng/retry, kiểm tra thiết bị in/điện thoại, đối soát số dư và thực sự khôi phục bản backup. Không dùng số lượng test hoặc build thành công thay cho nghiệm thu tại cơ sở.
