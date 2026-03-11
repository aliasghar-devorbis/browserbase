// server.ts — HTTP API wrapper for the BrowserBase booking task
// Deploy this anywhere Node.js runs (VPS, Railway, Render, your own server)
//
// Usage:
//   POST http://your-server:3000/book
//   Body: { "firstName": "John", "lastName": "Doe", ... }
//   Returns: { "success": true, "message": "Booking successful...", ... }

import "dotenv/config";
import express from "express";
import { runBookingTask } from "./browserbase-booking-task-module.js";

const app = express();
app.use(express.json());

const API_SECRET = process.env.API_SECRET || "change-me-to-a-real-secret";

// Simple auth middleware
function authCheck(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (token !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Main booking endpoint
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
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`🚀 Booking API server running on port ${PORT}`);
  console.log(`   POST /book  — run a booking`);
  console.log(`   GET  /health — health check`);
});
