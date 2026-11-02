// Read this file locally, replace /^module.exports = /m with an empty string,
// remove the trailing semicolon, then pass the function expression to the
// Playwright MCP browser_run_code_unsafe tool. No browser-side module loader is required.
// Every non-Vite request is intercepted. This checks rendered fixtures, never
// backend authorization, persistence, payments, messages or production readiness.
module.exports = async function clinicBrowserSmoke(page) {
  page.setDefaultTimeout(5000);
  const base = 'http://127.0.0.1:5431';
  const ids = { user: '10000000-0000-4000-8000-000000000001', doctor: '10000000-0000-4000-8000-000000000002',
    patient: '10000000-0000-4000-8000-000000000003', visit: '10000000-0000-4000-8000-000000000004',
    appointment: '10000000-0000-4000-8000-000000000005', department: '10000000-0000-4000-8000-000000000006' };
  let assertions = 0;
  const scenarios = [], pageErrors = [], failures = [];
  const state = { role: 'user', payment: 'pending', searchCalls: [], calls: [], mutations: [], visit: null, encounter: null, ledger: [] };
  const check = (condition, message) => { assertions++; if (!condition) throw new Error(message); };
  const reset = role => {
    state.role = role;
    state.visit = { id: ids.visit, patient_id: ids.patient, doctor_id: ids.doctor, appointment_id: null,
      scheduled_at: '2030-01-07T02:00:00.000Z', source: 'walk_in', status: ['doctor', 'admin'].includes(role) ? 'in_consultation' : role === 'user' ? 'completed' : 'scheduled',
      queue_number: '123', consultation_fee: '100000', symptoms: 'Fixture symptom', version: 1,
      patient_name: 'Bệnh nhân kiểm thử', patient_code: 'BN-TEST-0001', doctor_name: 'Bác sĩ kiểm thử', paid_amount: '50000' };
    state.encounter = { id: ids.appointment, version: 1, status: role === 'user' ? 'final' : 'draft', vitals: { temperature: 36.8 },
      symptoms: 'Fixture symptom', diagnosis: 'Fixture diagnosis', treatment: 'Fixture instructions', notes: 'Fixture note', follow_up_date: null, updated_at: '2030-01-07T02:00:00.000Z' };
    state.ledger = [{ id: ids.appointment, visit_id: ids.visit, kind: 'deposit', amount: '50000', method: 'payos', reference: 'FIXTURE-NOT-A-TRANSACTION', reason: null,
      recorded_by: ids.user, created_at: '2030-01-07T02:00:00.000Z' }];
  };
  const patient = { id: ids.patient, patient_code: 'BN-TEST-0001', user_id: ids.user, full_name: 'Bệnh nhân kiểm thử',
    date_of_birth: '1990-01-01', sex: 'unspecified', phone: '0900000000', address: 'Địa chỉ dữ liệu giả', allergies: 'Fixture allergy', medical_history: 'Fixture history', version: 1 };
  const doctor = { id: ids.doctor, fullName: 'Bác sĩ kiểm thử', departmentId: ids.department, bio: 'Dữ liệu kiểm thử', experienceYears: 6, university: 'Fixture', avatarUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z', department: { id: ids.department, name: 'Tim mạch', description: null } };
  await page.addInitScript(() => {
    window.confirm = () => { window.__fixtureConfirmCalls = (window.__fixtureConfirmCalls || 0) + 1; return true; };
    window.prompt = () => 'Fixture confirmation reason';
    window.print = () => {};
  });
  await page.unroute('**/*');
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', async dialog => dialog.accept());
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === base) return route.continue();
    state.calls.push({ path: u.pathname, method: req.method() });
    if (req.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>' });
    let data = [];
    const path = u.pathname;
    const body = req.method() !== 'GET' && req.method() !== 'OPTIONS' ? req.postDataJSON() : {};
    if (req.method() !== 'GET' && req.method() !== 'OPTIONS') state.mutations.push({ path, body });
    if (path.endsWith('/auth/me')) data = { user: { id: ids.user, role: state.role, fullName: `Fixture ${state.role}`, email: 'fixture@example.invalid' } };
    else if (path.endsWith('/config/booking-policy')) data = { depositAmount: 50000, consultationFee: 100000 };
    else if (path.endsWith('/ai/policy')) data = { enabled: false, deploymentEnabled: false, policyVersion: '2026-11-01', consented: false, disclosure: 'Fixture disclosure: no provider request' };
    else if (path.endsWith('/departments')) data = [{ id: ids.department, name: 'Tim mạch', description: null }];
    else if (path.endsWith('/doctors/search')) {
      state.searchCalls.push(u.search);
      const p = Number(u.searchParams.get('page') || 1);
      data = { items: [{ ...doctor, id: p === 1 ? ids.doctor : ids.appointment, fullName: `Bác sĩ trang ${p}` }], total: 6, page: p, pageSize: 5, departmentCounts: { [ids.department]: 6 } };
    } else if (path.endsWith('/doctors')) data = path.includes('/clinic/') ? [{ id: ids.doctor, full_name: 'Bác sĩ kiểm thử' }] : [doctor];
    else if (path.endsWith('/clinic/patients')) data = [patient];
    else if (path.endsWith('/clinic/visits')) data = [{ ...state.visit, paid_amount: String(state.ledger.reduce((n, row) => n + Number(row.amount), 0)) }];
    else if (path.endsWith(`/clinic/visits/${ids.visit}/transition`)) { state.visit = { ...state.visit, status: body.status, version: state.visit.version + 1 }; data = state.visit; }
    else if (path.endsWith(`/clinic/visits/${ids.visit}/encounter`)) {
      state.encounter = { ...state.encounter, diagnosis: body.diagnosis, notes: body.notes, version: state.encounter.version + 1, status: body.finalize ? 'final' : 'draft' };
      if (body.finalize) state.visit.status = 'completed';
      data = state.encounter;
    } else if (path.endsWith(`/clinic/visits/${ids.visit}/collections`)) {
      const entry = { ...state.ledger[0], id: ids.visit, kind: 'collection', method: body.method, amount: String(body.amount), reference: body.reference };
      state.ledger.push(entry); data = entry;
    } else if (path.endsWith(`/clinic/visits/${ids.visit}`)) data = { visit: state.visit, patient, encounter: ['cashier', 'receptionist'].includes(state.role) ? null : state.encounter,
      ledger: ['cashier', 'admin', 'user'].includes(state.role) ? state.ledger : [], refunds: [], revisions: [], medicalRecordVersion: 0, legacyMedicalRecord: null, reconciliation: [] };
    else if (path.endsWith('/clinic/operations')) data = { unimported: [], unfinished: [], reconciliation: [], refunds: [], reminders: [] };
    else if (path.endsWith(`/appointments/${ids.appointment}/status`)) data = { id: ids.appointment, doctorId: ids.doctor, doctorName: 'Bác sĩ kiểm thử', slotTime: '2030-01-07T02:00:00.000Z',
      status: state.payment === 'paid' ? 'confirmed' : 'pending', paymentStatus: state.payment, amount: 50000, checkoutUrl: 'https://pay.payos.vn/web/fixture-only', expiresAt: new Date(Date.now() + 240000).toISOString(), reconciliationStatus: 'clear' };
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' }, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(base);
  const signIn = async (role, view = 'dashboard-clinic', tail = '') => {
    reset(role);
    await page.evaluate(({ id, role }) => { localStorage.setItem('sh_auth_token', 'fixture-only'); localStorage.setItem('sh_auth_user', JSON.stringify({ id, role, fullName: `Fixture ${role}`, email: 'fixture@example.invalid' })); }, { id: ids.user, role });
    await page.goto(`${base}/?view=${view}${tail}`);
  };
  const assertNoOverflow = async label => {
    const metrics = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    check(metrics.document <= metrics.viewport + 1, `${label}: document overflows ${JSON.stringify(metrics)}`);
  };
  for (const width of [1280, 320]) for (const role of ['user', 'receptionist', 'doctor', 'cashier', 'admin']) {
    const scenario = `${role}@${width}`;
    try {
      await page.setViewportSize({ width, height: 900 });
      await signIn(role);
      await page.getByRole('heading', { name: 'Phòng khám', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Mở ca khám', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Tiếp nhận lịch trực tuyến', exact: true }).count() === (['admin', 'receptionist'].includes(role) ? 1 : 0), `${scenario} receiving role controls`);
      check(await page.getByRole('button', { name: 'Theo dõi vận hành', exact: true }).count() === (['admin', 'receptionist', 'cashier'].includes(role) ? 1 : 0), `${scenario} operations role controls`);
      check(await page.getByRole('button', { name: 'Bệnh nhân', exact: true }).count() === (role === 'cashier' ? 0 : 1), `${scenario} cashier registry hidden`);
      await assertNoOverflow(`${scenario} queue`);
      await page.getByRole('button', { name: 'Mở ca khám', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: /Bệnh nhân kiểm thử/ }).waitFor();
      check(await dialog.evaluate(el => el.contains(document.activeElement)), `${scenario} dialog receives focus`);
      check(await page.evaluate(() => document.body.style.overflow) === 'hidden', `${scenario} dialog locks background`);
      check(await dialog.getByRole('button', { name: 'Xác nhận đã thu tiền', exact: true }).count() === (['admin', 'cashier'].includes(role) ? 1 : 0), `${scenario} financial writes scoped`);
      check(await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).count() === (['admin', 'doctor'].includes(role) ? 1 : 0), `${scenario} clinical writes scoped`);
      if (role === 'user') check(await dialog.getByRole('button', { name: 'In kết quả khám', exact: true }).count() === 1, `${scenario} signed result printable`);
      if (role === 'receptionist') {
        await dialog.getByRole('button', { name: 'Check-in: bệnh nhân đã đến', exact: true }).click();
        await dialog.getByText('Chờ khám', { exact: false }).first().waitFor();
        check(state.visit.status === 'checked_in', `${scenario} check-in request wired`);
      }
      if (role === 'doctor') {
        await dialog.getByLabel('Lý do lưu / chỉnh sửa', { exact: true }).fill('Fixture edit reason');
        await dialog.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
        await dialog.getByRole('heading', { name: /phiên bản 2/ }).waitFor();
        check(state.encounter.version === 2, `${scenario} versioned draft wired`);
        await dialog.getByLabel('Lý do lưu / chỉnh sửa', { exact: true }).fill('Fixture final confirmation');
        await dialog.getByRole('button', { name: 'Xác nhận và hoàn tất ca', exact: true }).click();
        await dialog.getByRole('button', { name: 'In kết quả khám', exact: true }).waitFor();
        check(state.visit.status === 'completed', `${scenario} explicit finalization wired`);
      }
      if (role === 'cashier') {
        await dialog.getByLabel('Số tiền (VND)', { exact: true }).fill('1000');
        await dialog.getByRole('button', { name: 'Xác nhận đã thu tiền', exact: true }).click();
        await dialog.getByText('51.000 đ', { exact: true }).first().waitFor();
        check(state.ledger.length === 2 && state.mutations.at(-1).body.confirmed === true, `${scenario} collection explicit confirmation wired`);
      }
      await assertNoOverflow(`${scenario} visit dialog`);
      for (let i = 0; i < 28; i++) await page.keyboard.press('Tab');
      check(await dialog.evaluate(el => el.contains(document.activeElement)), `${scenario} keyboard focus trapped`);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      check(await page.evaluate(() => document.body.style.overflow) !== 'hidden', `${scenario} background restored after close`);
      scenarios.push({ scenario, status: 'pass' });
    } catch (error) { failures.push({ scenario, message: error.message }); scenarios.push({ scenario, status: 'fail' }); await page.keyboard.press('Escape').catch(() => {}); }
  }
  for (const payment of ['pending', 'paid']) {
    state.payment = payment;
    await signIn('user', 'booking-success', `&appointmentId=${ids.appointment}`);
    await page.getByRole('heading', { name: payment === 'pending' ? 'Kiểm tra thanh toán' : 'Lịch khám đã được xác nhận', exact: true }).waitFor();
    check(await page.getByRole('link', { name: 'Tiếp tục thanh toán', exact: true }).count() === (payment === 'pending' ? 1 : 0), `payment ${payment} shows server state`);
    await assertNoOverflow(`payment ${payment}@320`);
  }
  state.searchCalls = []; state.calls = [];
  await signIn('user', 'search');
  await page.getByRole('button', { name: 'Sau', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sau', exact: true }).click();
  await page.getByText('BS. Bác sĩ trang 2', { exact: false }).first().waitFor().catch(async () => page.getByText(/Bác sĩ trang 2/).first().waitFor());
  check(state.searchCalls.some(q => new URLSearchParams(q).get('page') === '2'), 'search server page 2 requested');
  check(!state.calls.some(x => /\/doctors\/[^/]+\/slots$/.test(x.path)), 'search does not issue per-doctor slot requests');
  await assertNoOverflow('search@320');
  check(pageErrors.length === 0, `no browser exceptions: ${pageErrors.join('; ')}`);
  const result = { assertions, scenarios, failures, pageErrors, interceptedApiMutations: state.mutations.length,
    evidence: 'Fixture-rendered UI only; all non-Vite requests intercepted and native confirmations accepted by fixture; no backend/provider calls.' };
  page.__clinicQaResult = result;
  return result;
};
