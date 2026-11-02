function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/[,;]/g, "\\$&");
}
export function appointmentCalendar(
  id: string,
  start: string,
  doctorName: string,
  now = new Date(),
): string {
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) throw new Error("Giờ hẹn không hợp lệ");
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SmartHospital//Appointments//VI",
    "BEGIN:VEVENT",
    `UID:${escapeText(id)}@smarthospital`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(date)}`,
    `SUMMARY:${escapeText(`Lịch khám - ${doctorName}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
export function downloadAppointmentCalendar(
  id: string,
  start: string,
  doctorName: string,
) {
  const url = URL.createObjectURL(
    new Blob([appointmentCalendar(id, start, doctorName)], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich-kham-${id}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
