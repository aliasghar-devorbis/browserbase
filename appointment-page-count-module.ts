// appointment-page-count-module.ts
// Logs into Sera, navigates to Appointments, applies date/status filters,
// and returns the total page count.

import { Stagehand } from "@browserbasehq/stagehand";

const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";

export async function getAppointmentPageCount(input: { dateFilter: string }): Promise<{
  status: string;
  result: string;
  sessionUrl: string;
}> {
  const EMAIL = process.env.STRATABLUE_EMAIL || "mcc@stratablue.com";
  const PASSWORD = process.env.STRATABLUE_PASSWORD || "";
  const dateFilter = input.dateFilter; // e.g. "03/17/2026-03/17/2026"

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: "google/gemini-2.5-flash",
    verbose: DEBUG ? 2 : 1,
    disablePino: !DEBUG,
  });

  let sessionUrl = "";

  try {
    await stagehand.init();
    sessionUrl = `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`;
    console.log(`✅ Session: ${sessionUrl}`);

    const page = stagehand.context.pages()[0];

    // ==================== STEP 1: LOGIN ====================
    console.log("  → Login");
    await page.goto("https://misterquik.sera.tech/admins/login", { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(1000);

    // Click login button — try multiple selectors
    const loginSelectors = ['input[type="submit"]', 'button[type="submit"]', 'button.btn-primary'];
    for (const sel of loginSelectors) {
      try {
        const vis = await page.locator(sel).first().isVisible();
        if (vis) { await page.locator(sel).first().click(); break; }
      } catch {}
    }

    // Wait for redirect
    await page.waitForTimeout(5000);
    const loginUrl = page.url();
    if (loginUrl.includes("/login")) {
      throw new Error("Login failed — still on login page. Check credentials.");
    }
    console.log(`    ✅ Logged in → ${loginUrl}`);

// ==================== STEP 2: NAVIGATE TO APPOINTMENTS ====================
console.log("  → Navigate to Appointments");
    
// Go directly to appointment list (skip Reports page to avoid timeout)
// Try the direct URL first
await page.goto("https://misterquik.sera.tech/reports/appointments", { waitUntil: "load", timeoutMs: 60000 });
await page.waitForTimeout(5000);

// If that didn't work (wrong URL), try via Reports page
const currentUrl = page.url();
if (!currentUrl.includes("appointment")) {
  console.log("    ℹ️  Direct URL didn't work, navigating via Reports...");
  await page.goto("https://misterquik.sera.tech/reports", { waitUntil: "load", timeoutMs: 60000 });
  await page.waitForTimeout(5000);
  await stagehandRef_act(stagehand, "click on Appointment List");
  await page.waitForTimeout(5000);
}

    // ==================== STEP 3: APPLY FILTERS VIA URL ====================
    console.log(`  → Applying filters: date=${dateFilter}, status=completed`);

    // Build the filtered URL by appending query params to current URL
    const currentUrl = page.url();
    const separator = currentUrl.includes("?") ? "&" : "?";
    const filteredUrl = `${currentUrl}${separator}jobs-table_scheduled_time=${encodeURIComponent(dateFilter)}&jobs-table_status=completed`;

    console.log(`    ℹ️  Navigating to: ${filteredUrl}`);
    await page.goto(filteredUrl, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(5000);

    // ==================== STEP 4: GET TOTAL PAGE COUNT ====================
    console.log("  → Reading page count");

    // Try to extract page count from the DOM via evaluate
    const pageCount = await page.evaluate(() => {
      // Method 1: Look for "Page X of Y" text
      const allText = document.body.innerText;
      const pageOfMatch = allText.match(/Page\s+\d+\s+of\s+(\d+)/i);
      if (pageOfMatch) return parseInt(pageOfMatch[1], 10);

      // Method 2: Look for pagination buttons — find the highest numbered one
      const paginationBtns = document.querySelectorAll('.pagination a, .pagination button, .paginate_button, [class*="page"] a, [class*="page"] button');
      let maxPage = 0;
      for (const btn of paginationBtns) {
        const num = parseInt(btn.textContent?.trim() || "", 10);
        if (!isNaN(num) && num > maxPage) maxPage = num;
      }
      if (maxPage > 0) return maxPage;

      // Method 3: Look for "Showing X to Y of Z" and calculate
      const showingMatch = allText.match(/Showing\s+\d+\s*[-–to]+\s*(\d+)\s+of\s+(\d+)/i);
      if (showingMatch) {
        const perPage = parseInt(showingMatch[1], 10);
        const total = parseInt(showingMatch[2], 10);
        if (perPage > 0 && total > 0) return Math.ceil(total / perPage);
      }

      // Method 4: Check for numbered page links at bottom
      const pageLinks = document.querySelectorAll('a[href*="page="], a[data-page], li.page-item a');
      let max2 = 0;
      for (const link of pageLinks) {
        const num = parseInt(link.textContent?.trim() || "", 10);
        if (!isNaN(num) && num > max2) max2 = num;
      }
      if (max2 > 0) return max2;

      return 0;
    });

    let resultMessage: string;
    if (pageCount > 0) {
      resultMessage = `Total pages found: ${pageCount}`;
    } else {
      // Fallback: use Stagehand extract to read it with AI
      console.log("    ℹ️  DOM extraction didn't find page count, trying AI extract...");
      const extracted = await stagehand.extract(
        "Look at the bottom of the table/page. Find the pagination or page count. How many total pages are there? Return just the number."
      );
      const aiText = typeof extracted === "string" ? extracted : JSON.stringify(extracted);
      const numMatch = aiText.match(/(\d+)/);
      if (numMatch) {
        resultMessage = `Total pages found: ${numMatch[1]}`;
      } else {
        resultMessage = "No pagination found — possibly only 1 page or no results";
      }
    }

    console.log(`    ✅ ${resultMessage}`);

    await stagehand.close();

    return {
      status: "COMPLETED",
      result: resultMessage,
      sessionUrl,
    };
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    try { await stagehand.close(); } catch {}
    return {
      status: "FAILED",
      result: `Error: ${error.message}`,
      sessionUrl,
    };
  }
}

// Helper: use stagehand.act() for natural language actions
async function stagehandRef_act(stagehand: Stagehand, instruction: string) {
  await stagehand.act(instruction);
}
