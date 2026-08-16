/**
 * Project XIX — In-VR Enquiry Form  (enquiry.js)
 * Fix 05: closes the sales loop without leaving the 3D world.
 *
 * Injects a "Register Interest" form into the plot panel.
 * On submit: POSTs to Google Apps Script web app which appends to a Google Sheet.
 * Falls back to a mailto: link if the Apps Script URL is not configured.
 *
 * HOW TO CONFIGURE:
 *   1. In Google Sheets, create a sheet named "XIX Enquiries" with columns:
 *      Timestamp | Name | Phone | Email | Plot | Message
 *   2. In Extensions → Apps Script, paste the doPost() function below as a comment.
 *   3. Deploy as Web App (Execute as: Me, Who has access: Anyone).
 *   4. Copy the /exec URL and set it as APPS_SCRIPT_URL below.
 *
 * Apps Script server code (paste into Apps Script editor):
 *
 *   function doPost(e) {
 *     const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('XIX Enquiries');
 *     const data  = JSON.parse(e.postData.contents);
 *     sheet.appendRow([new Date(), data.name, data.phone, data.email, data.plot, data.message]);
 *     return ContentService.createTextOutput(JSON.stringify({ok:true}))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   }
 */

// ── CONFIGURE THIS ──────────────────────────────────────────────────────────
// Set your deployed Apps Script /exec URL here.
// Leave as empty string to fall back to mailto.
const APPS_SCRIPT_URL = '';
const FALLBACK_EMAIL  = 'o.olasunkanmi@mixtafrica.com';
// ────────────────────────────────────────────────────────────────────────────

/**
 * Injects the enquiry form into the plot panel.
 * Call this once after DOMContentLoaded.
 */
export function initEnquiryForm() {
  const panel = document.getElementById('plot-panel');
  if (!panel) return;

  // Insert form after the plot-disclaimer paragraph
  const disclaimer = panel.querySelector('.plot-disclaimer');
  if (!disclaimer) return;

  const form = document.createElement('div');
  form.id = 'enquiry-form';
  form.innerHTML = `
    <div class="enq-divider"></div>
    <div class="enq-heading">Register Your Interest</div>
    <div class="enq-sub">Our concierge will contact you within 24 hours.</div>
    <div class="enq-fields">
      <div class="enq-field">
        <label class="enq-label" for="enq-name">Full Name *</label>
        <input class="enq-input" id="enq-name" type="text" placeholder="Your full name" autocomplete="name" />
        <div class="enq-error" id="enq-name-err"></div>
      </div>
      <div class="enq-field">
        <label class="enq-label" for="enq-phone">Phone Number *</label>
        <input class="enq-input" id="enq-phone" type="tel" placeholder="+234 …" autocomplete="tel" />
        <div class="enq-error" id="enq-phone-err"></div>
      </div>
      <div class="enq-field">
        <label class="enq-label" for="enq-email">Email Address</label>
        <input class="enq-input" id="enq-email" type="email" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div class="enq-field">
        <label class="enq-label" for="enq-message">Message (optional)</label>
        <textarea class="enq-input enq-textarea" id="enq-message" rows="2" placeholder="Any questions or preferred viewing time…"></textarea>
      </div>
    </div>
    <button class="enq-submit btn btn-gold" id="enq-submit" style="width:100%;margin-top:0.8rem;justify-content:center;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      Send Enquiry
    </button>
    <div class="enq-success" id="enq-success" style="display:none;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      <div>
        <div style="font-weight:600;margin-bottom:2px;">Enquiry received</div>
        <div style="font-size:0.8rem;opacity:0.75;">Our team will call you within 24 hours.</div>
      </div>
    </div>
  `;

  disclaimer.insertAdjacentElement('afterend', form);
  _injectEnquiryStyles();
  _bindForm();
}

/** Updates the plot ID shown in the form (call when a new plot is selected). */
export function setEnquiryPlot(plotKey) {
  // Store for submission
  _currentPlot = plotKey || '';
}

let _currentPlot = '';

function _bindForm() {
  const btn = document.getElementById('enq-submit');
  if (!btn) return;
  btn.addEventListener('click', _handleSubmit, { capture: true });

  // Clear errors on input
  ['enq-name','enq-phone'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      document.getElementById(id + '-err').textContent = '';
    });
  });
}

async function _handleSubmit(e) {
  e.stopPropagation();
  const name  = document.getElementById('enq-name')?.value.trim()  || '';
  const phone = document.getElementById('enq-phone')?.value.trim() || '';
  const email = document.getElementById('enq-email')?.value.trim() || '';
  const msg   = document.getElementById('enq-message')?.value.trim() || '';

  // Validation
  let valid = true;
  if (!name) {
    document.getElementById('enq-name-err').textContent = 'Please enter your name.';
    valid = false;
  }
  if (!phone || phone.length < 7) {
    document.getElementById('enq-phone-err').textContent = 'Please enter a valid phone number.';
    valid = false;
  }
  if (!valid) return;

  const btn = document.getElementById('enq-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const payload = { name, phone, email, plot: _currentPlot, message: msg };

  let ok = false;

  if (APPS_SCRIPT_URL) {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode:   'no-cors', // Apps Script requires no-cors
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // no-cors means we can't read the response — assume success if no error thrown
      ok = true;
    } catch(err) {
      console.warn('[XIX] Apps Script submission failed:', err);
    }
  }

  if (!ok) {
    // Fallback: open mailto with pre-filled subject/body
    const subject = encodeURIComponent(`Project XIX — Plot Enquiry: ${_currentPlot}`);
    const body    = encodeURIComponent(
      `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nPlot: ${_currentPlot}\nMessage: ${msg}`
    );
    window.open(`mailto:${FALLBACK_EMAIL}?subject=${subject}&body=${body}`, '_blank');
    ok = true; // treat as success since we opened mailto
  }

  if (ok) {
    document.getElementById('enq-submit').style.display = 'none';
    document.getElementById('enq-success').style.display = 'flex';
    // Auto-reset after 8 seconds
    setTimeout(_resetForm, 8000);
  } else {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Enquiry`;
  }
}

function _resetForm() {
  ['enq-name','enq-phone','enq-email','enq-message'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['enq-name-err','enq-phone-err'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  const btn = document.getElementById('enq-submit');
  if (btn) {
    btn.style.display = '';
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Enquiry`;
  }
  const succ = document.getElementById('enq-success');
  if (succ) succ.style.display = 'none';
}

function _injectEnquiryStyles() {
  if (document.getElementById('enq-styles')) return;
  const s = document.createElement('style');
  s.id = 'enq-styles';
  s.textContent = `
    .enq-divider {
      border: none; border-top: 1px solid rgba(201,168,76,0.15);
      margin: 1rem 0 0.9rem;
    }
    .enq-heading {
      font-family: "Cormorant Garamond", serif;
      font-size: 1.05rem; font-weight: 400; letter-spacing: 0.03em;
      color: var(--cream-100); margin-bottom: 2px;
    }
    .enq-sub {
      font-size: 0.72rem; color: rgba(240,236,224,0.5);
      margin-bottom: 0.9rem;
    }
    .enq-fields { display: flex; flex-direction: column; gap: 0.6rem; }
    .enq-field  { display: flex; flex-direction: column; gap: 3px; }
    .enq-label  { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em;
                  text-transform: uppercase; color: rgba(240,236,224,0.55); }
    .enq-input  {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(201,168,76,0.25);
      border-radius: 4px; color: var(--cream-100);
      font-family: Inter, sans-serif; font-size: 0.82rem;
      padding: 8px 10px; outline: none;
      transition: border-color 0.15s;
      -webkit-tap-highlight-color: transparent;
      min-height: 40px;
    }
    .enq-input:focus { border-color: rgba(201,168,76,0.65); }
    .enq-input::placeholder { color: rgba(240,236,224,0.28); }
    .enq-textarea { min-height: 56px; resize: vertical; }
    .enq-error {
      font-size: 0.68rem; color: #ff6b6b; min-height: 14px;
      letter-spacing: 0.02em;
    }
    .enq-success {
      display: flex; align-items: center; gap: 12px;
      background: rgba(30,120,80,0.18);
      border: 1px solid rgba(30,160,80,0.35);
      border-radius: 6px; padding: 12px 14px;
      color: rgba(100,220,140,0.9);
      margin-top: 0.8rem;
    }
    /* Billboard: bigger form targets */
    .device-billboard .enq-input { min-height: 52px; font-size: 1rem; padding: 12px 14px; }
    .device-billboard .enq-label { font-size: 0.78rem; }
    .device-billboard .enq-heading { font-size: 1.3rem; }
  `;
  document.head.appendChild(s);
}
