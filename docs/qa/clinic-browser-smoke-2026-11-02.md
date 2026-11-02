# SmartHospital browser smoke — 02/11/2026

Result: **128 assertions passed**, 10 role/viewport scenarios passed, no browser JavaScript exceptions and no document horizontal overflow in the checked views.

Local frontend: Vite at `http://127.0.0.1:5431`. Script: `sh.client/scripts/clinic-browser-smoke.cjs`.

## Coverage

Each of patient, receptionist, doctor, cashier and administrator was checked at **1280 px** and **320 px**:

- Clinic route renders and role-specific receiving, registry, clinical and finance controls appear correctly.
- Queue and visit dialog fit the document width; horizontal tab navigation remains contained.
- Dialog takes focus, keeps keyboard navigation inside, closes on Escape and restores background scrolling.
- Patient sees a final result with print control and has no clinical/financial write controls.
- Receptionist check-in sends the requested transition and renders the updated visit state.
- Doctor draft save advances its version; explicit confirmation finalizes the fixture encounter and visit.
- Cashier collection sends an explicit confirmation and renders the updated ledger balance.

Additional checks at 320 px:

- A `booking-success` URL with a pending server fixture renders pending, not a paid confirmation.
- A paid/confirmed fixture renders confirmation and hides the continue-payment link.
- Doctor search requests page 2 from `/doctors/search`; it sends no per-doctor slot requests.

## Evidence boundary

Every non-Vite request was intercepted with synthetic fixtures, including images/fonts and all API requests. Eight API mutations were handled by fixture code only. Native confirmation dialogs and printing were stubbed for repeatability. There were **no backend/provider calls, real patient data, emails or payments**.

These assertions prove rendered UI wiring, responsive containment and keyboard behavior. They do not prove backend authorization, database persistence, provider integration, printer output or clinic UAT. PostgreSQL integration tests are separate evidence.

## Repeat with Playwright MCP

Read the script as text locally, transform it with:

```js
const code = source.replace(/^module.exports = /m, '').replace(/;\s*$/, '');
```

Pass `code` as the function expression to `browser_run_code_unsafe`. The tool's VM has no CommonJS `require` or dynamic-import callback, so loading the script directly from inside its VM is not supported. Keep all request interception active throughout the smoke run.
