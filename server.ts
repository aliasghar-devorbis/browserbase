import "dotenv/config";
import { declineQuotesOnPage } from "./decline-quotes-module.js";
import express from "express";
import { runBookingTask } from "./browserbase-booking-task-module.js";
import { getAppointmentPageCount } from "./appointment-page-count-module.js";

const app = express();
app.use(express.json());

const API_SECRET = process.env.API_SECRET || "change-me-to-a-real-secret";

function authCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (token !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/book", authCheck, async (req, res) => {
  const startTime = Date.now();
  console.log(`\n📥 Received booking request at ${new Date().toISOString()}`);
  console.log(`   Customer: ${req.body.firstName} ${req.body.lastName}`);
  console.log(`   Address: ${req.body.serviceAddress}`);
  try {
    const result = await runBookingTask(req.body);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`📤 Completed in ${elapsed}s — success: ${result.success}\n`);
    res.json({
      success: result.success,
      message: result.context?.completionMessage || null,
      stepsRun: result.stepsRun,
      stepsSkipped: result.stepsSkipped,
      totalSteps: result.totalSteps,
      elapsedMinutes: result.elapsedMinutes,
      sessionUrl: result.sessionUrl || null,
      context: result.context,
    });
  } catch (error: any) {
    console.error(`❌ Task failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/appointment-pages", authCheck, async (req, res) => {
  const dateFilter = req.body.dateFilter;
  if (!dateFilter) {
    res.status(400).json({ error: "Missing required field: dateFilter" });
    return;
  }
  console.log(`\n📥 Appointment pages request: dateFilter=${dateFilter}`);
  try {
    const result = await getAppointmentPageCount({ dateFilter });
    console.log(`📤 Result: ${result.status} — ${result.result}`);
    res.json({ data: { status: result.status, result: result.result } });
  } catch (error: any) {
    console.error(`❌ Failed: ${error.message}`);
    res.status(500).json({ data: { status: "FAILED", result: error.message } });
  }
});

app.post("/decline-quotes", authCheck, async (req, res) => {
  const { dateFilter, pageNumber } = req.body;
  if (!dateFilter || !pageNumber) {
    res.status(400).json({ error: "Missing required fields: dateFilter, pageNumber" });
    return;
  }
  console.log(`\n📥 Decline quotes: page=${pageNumber}, dateFilter=${dateFilter}`);
  try {
    const result = await declineQuotesOnPage({ dateFilter, pageNumber });
    console.log(`📤 Result: ${result.status} — ${result.result}`);
    res.json({
      data: {
        status: result.status,
        result: result.result,
        jobsProcessed: result.jobsProcessed,
        quotesDeclined: result.quotesDeclined,
      },
    });
  } catch (error: any) {
    console.error(`❌ Failed: ${error.message}`);
    res.status(500).json({ data: { status: "FAILED", result: error.message } });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`   POST /book               — run a booking`);
  console.log(`   POST /appointment-pages   — get appointment page count`);
  console.log(`   POST /decline-quotes      — decline quotes on a page`);
  console.log(`   GET  /health             — health check`);
});