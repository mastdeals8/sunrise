// Captures the three states the standard screenshot scripts can't reach
// without driving user interaction:
//   - Estimate row showing the "Rate Card" provenance pill
//   - Letter-signage running-inch helper input populated with 27,26,26,26,28,27,27 (=187)
//   - Jobs → Client Report modal showing the WhatsApp summary text that
//     "Copy WhatsApp" places on the clipboard
//
// Output: screenshots/manual_states/NN-slug.png (+ .txt for the WA summary).

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const BASE = process.env.AUDIT_BASE || "http://localhost:5088";
const USER = "admin";
const PASS = "admin123";
const OUT = resolve(process.cwd(), "screenshots/manual_states");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

  // Login + seed
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!r.ok) { console.error("login failed"); process.exit(1); }
  const { token, user } = await r.json();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("sunrise_token", token);
    localStorage.setItem("sunrise_user", JSON.stringify(user));
  }, { token, user });

  // -----------------------------------------------------------------
  // 1) Rate Card pill on an estimate row (ABFRL / Peter England / CAPEX)
  //    Uses the demo rate card (id=2) that maps Flex Printing → ₹32.
  // -----------------------------------------------------------------
  {
    await page.goto(`${BASE}/operations?new=1#estimates`, { waitUntil: "networkidle2" });
    try {
      await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 15_000 });
    } catch {}
    await sleep(1500);

    // Drive the new-estimate selects by value (IDs are known: client=1 ABFRL,
    // brand=1 Peter England, format=ABFRL, projectType=CAPEX).
    const setSelectValue = async (matcher, value) => {
      await page.evaluate(({ matcher, value }) => {
        const selects = Array.from(document.querySelectorAll("select"));
        const target = selects.find(s => eval(matcher));
        if (target) {
          target.value = value;
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, { matcher, value });
      await sleep(450);
    };

    // Client: select the one offering ABFRL company name
    await setSelectValue(
      `Array.from(s.options).some(o => (o.textContent || "").includes("ABFRL"))`,
      "1",
    );
    // Brand: select the one with "Peter England" option
    await setSelectValue(
      `Array.from(s.options).some(o => (o.textContent || "").trim() === "Peter England")`,
      "1",
    );
    // Format: the format select has the value "ABFRL"
    await setSelectValue(
      `Array.from(s.options).some(o => o.value === "ABFRL")`,
      "ABFRL",
    );
    // ABFRL project type select has exactly SELEX,CAPEX
    await setSelectValue(
      `Array.from(s.options).map(o => o.value).join(",") === "SELEX,CAPEX"`,
      "CAPEX",
    );

    // Pick product = "Flex Printing" (id=6). Match the standard non-test entry —
    // the option text is "Flex Printing (₹25.00 / sqft)".
    await setSelectValue(
      `Array.from(s.options).some(o => o.value === "6" && /^Flex Printing /.test((o.textContent||"").trim()))`,
      "6",
    );
    // Resolver fetch happens after product change; let it settle.
    await sleep(1800);

    // Scroll to the estimate items grid so the pill is in frame
    await page.evaluate(() => {
      const pill = document.querySelector(".tag-pill-source-rate-card");
      if (pill) pill.scrollIntoView({ block: "center" });
    });
    await sleep(500);
    await page.screenshot({ path: resolve(OUT, "01-estimate-row-rate-card-pill.png"), fullPage: true });
    console.log("✓ 01-estimate-row-rate-card-pill.png");
  }

  // -----------------------------------------------------------------
  // 2) Letter-signage running-inch helper: 27,26,26,26,28,27,27 → 187 in Width
  //    We use a Normal-format estimate so we don't have to worry about
  //    multi-store store-assignment. Channel Letters (id=3, running_inch).
  // -----------------------------------------------------------------
  {
    await page.goto(`${BASE}/operations?new=1#estimates`, { waitUntil: "networkidle2" });
    try {
      await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 15_000 });
    } catch {}
    await sleep(1500);

    // Pick any client + brand so resolver has context (ABFRL is fine; format
    // stays "normal" which still lets running_inch products render the helper).
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      selects[0].value = "1"; selects[0].dispatchEvent(new Event("change",{bubbles:true}));
    });
    await sleep(500);
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      selects[1].value = "1"; selects[1].dispatchEvent(new Event("change",{bubbles:true}));
    });
    await sleep(500);

    // Pick Channel Letters (id=3, calc=running_inch). The first product select
    // is index 5 when format=normal (after client, brand, format, gst, store).
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const prod = selects.find(s => Array.from(s.options).some(o => o.value === "3" && /^Channel Letters/.test((o.textContent||"").trim())));
      if (prod) { prod.value = "3"; prod.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await sleep(1500);

    // Type the letter-size breakdown into the amber input
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="27,26,26"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "27,26,26,26,28,27,27");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await sleep(800);

    // Scroll the row into frame
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="27,26,26"]');
      if (input) input.scrollIntoView({ block: "center" });
    });
    await sleep(500);
    await page.screenshot({ path: resolve(OUT, "02-letter-signage-running-inch.png"), fullPage: true });
    console.log("✓ 02-letter-signage-running-inch.png");
  }

  // -----------------------------------------------------------------
  // 3) WhatsApp summary copy from the completion report.
  //    The button writes to navigator.clipboard and alert()s. We patch
  //    both, capture the text, and inject a visible preview panel so the
  //    screenshot shows what would have been copied.
  // -----------------------------------------------------------------
  {
    await page.goto(`${BASE}/jobs`, { waitUntil: "networkidle2" });
    try {
      await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 15_000 });
    } catch {}
    await sleep(1500);

    // Open the first job's Client Report
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent?.includes("Client Report"));
      if (b) b.click();
    });
    await sleep(1500);

    // Patch clipboard + alert + click Copy WhatsApp; harvest the text via DOM injection.
    const summary = await page.evaluate(async () => {
      let captured = "";
      const origAlert = window.alert;
      window.alert = () => {};
      const origWrite = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      navigator.clipboard.writeText = async (txt) => { captured = txt; };
      const btn = Array.from(document.querySelectorAll("button")).find(x => x.textContent?.includes("Copy WhatsApp"));
      if (btn) btn.click();
      // Wait a tick for the async handler
      await new Promise(r => setTimeout(r, 300));
      window.alert = origAlert;
      if (origWrite) navigator.clipboard.writeText = origWrite;
      // Inject a visible preview panel so the screenshot shows the summary
      const modal = document.querySelector("#report-print");
      if (modal && captured) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "margin:16px 0;padding:14px 16px;border:2px dashed #10b981;background:#ecfdf5;border-radius:8px;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;color:#064e3b";
        wrap.innerHTML = '<div style="font-weight:700;font-size:11px;color:#047857;letter-spacing:0.05em;margin-bottom:8px">WHATSAPP CLIPBOARD CONTENT (LIVE CAPTURE)</div><div></div>';
        wrap.lastElementChild.textContent = captured;
        modal.parentElement.insertBefore(wrap, modal);
        wrap.scrollIntoView({ block: "center" });
      }
      return captured;
    });
    await sleep(700);

    if (summary) {
      writeFileSync(resolve(OUT, "03-whatsapp-summary.txt"), summary, "utf8");
      console.log("✓ Captured WhatsApp text (", summary.length, "chars )");
    } else {
      console.warn("✗ Did not capture clipboard content");
    }
    await page.screenshot({ path: resolve(OUT, "03-whatsapp-summary-copy.png"), fullPage: true });
    console.log("✓ 03-whatsapp-summary-copy.png");
  }

  await browser.close();
  console.log(`Done. Output: ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
