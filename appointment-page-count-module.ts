// appointment-page-count-module.ts
// Logs into Sera, goes directly to filtered appointments URL,
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
    await page.goto("https://misterquik.sera.tech/admins/login", { waitUntil: "load", timeoutMs: 60000 });
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    await page.waitForTimeout(1000);

    const loginSelectors = ['input[type="submit"]', 'button[type="submit"]', 'button.btn-primary'];
    for (const sel of loginSelectors) {
      try {
        const vis = await page.locator(sel).first().isVisible();
        if (vis) { await page.locator(sel).first().click(); break; }
      } catch {}
    }

    await page.waitForTimeout(5000);
    const loginUrl = page.url();
    if (loginUrl.includes("/login")) {
      throw new Error("Login failed — still on login page. Check credentials.");
    }
    console.log(`    ✅ Logged in → ${loginUrl}`);

    // ==================== STEP 2: GO DIRECTLY TO FILTERED APPOINTMENTS ====================
    const targetUrl = `https://misterquik.sera.tech/reports/appointments?jobs-table_scheduled_time=${encodeURIComponent(dateFilter)}&jobs-table_status=completed`;
    console.log(`  → Navigating directly to: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: "load", timeoutMs: 60000 });
    await page.waitForTimeout(8000);
    console.log(`    ✅ On: ${page.url()}`);

    // ==================== STEP 3: GET TOTAL PAGE COUNT ====================
    console.log("  → Reading page count");

    const result = await page.evaluate(() => {
      const allText = document.body.innerText;

      // Method 1: Calculate from "Showing X - Y of Z" (most accurate)
      // Matches: "Showing 1 - 25 of 144" or "Showing 1-25 of 144"
      const showingMatch = allText.match(/Showing\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i);
      if (showingMatch) {
        const from = parseInt(showingMatch[1], 10);
        const to = parseInt(showingMatch[2], 10);
        const total = parseInt(showingMatch[3], 10);
        const perPage = to - from + 1;
        if (perPage > 0 && total > 0) {
          const pages = Math.ceil(total / perPage);
          return { pages, total, perPage, method: "showing-x-of-y" };
        }
      }

      // Method 2: Find highest numbered page link in Sera's pagination
      // Sera uses: ul.pagination > li.dt-paging-button > a.page-link
      const pageLinks = document.querySelectorAll('ul.pagination a.page-link, .dt-paging-button a, .page-item a');
      let maxPage = 0;
      for (const link of pageLinks) {
        const text = link.textContent?.trim() || "";
        // Extract number, handling ">6" or "6" format
        const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num) && num > maxPage) maxPage = num;
      }
      if (maxPage > 0) return { pages: maxPage, total: 0, perPage: 0, method: "pagination-buttons" };

      // Method 3: Check data-dt-idx attributes (Sera DataTables specific)
      const dtBtns = document.querySelectorAll('[data-dt-idx]');
      let maxIdx = 0;
      for (const btn of dtBtns) {
        const idx = parseInt(btn.getAttribute("data-dt-idx") || "0", 10);
        // data-dt-idx is 0-based for page buttons, but also includes prev/next
        // The page number in the text is more reliable
        const text = btn.textContent?.trim() || "";
        const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num) && num > maxIdx) maxIdx = num;
      }
      if (maxIdx > 0) return { pages: maxIdx, total: 0, perPage: 0, method: "data-dt-idx" };

      // Method 4: Generic fallback
      const genericBtns = document.querySelectorAll('.pagination a, .pagination button, .paginate_button');
      let max2 = 0;
      for (const btn of genericBtns) {
        const num = parseInt(btn.textContent?.trim() || "", 10);
        if (!isNaN(num) && num > max2) max2 = num;
      }
      if (max2 > 0) return { pages: max2, total: 0, perPage: 0, method: "generic-pagination" };

      return { pages: 0, total: 0, perPage: 0, method: "none" };
    });

    console.log(`    ℹ️  Method: ${result.method}, Pages: ${result.pages}, Total: ${result.total}, PerPage: ${result.perPage}`);

    let resultMessage: string;
    if (result.pages > 0) {
      resultMessage = `Total pages found: ${result.pages}`;
    } else {
      console.log("    ℹ️  DOM extraction failed, trying AI extract...");
      const extracted = await stagehand.extract(
        "Look at the bottom of the page. There is text like 'Showing 1 - 25 of 144' and pagination buttons. How many total pages are there? Calculate: total items divided by items per page, rounded up. Return just the number."
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

    return { status: "COMPLETED", result: resultMessage, sessionUrl };
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    try { await stagehand.close(); } catch {}
    return { status: "FAILED", result: `Error: ${error.message}`, sessionUrl };
  }
}