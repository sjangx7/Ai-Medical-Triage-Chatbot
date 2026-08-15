const express = require("express");
const router = express.Router();

const { assessEmergency } = require("../engine/redFlags");
const { runTriageFlow, getSession } = require("../engine/riskScoring");

router.post("/", (req, res) => {
  const sessionId = req.body.sessionId || "default";
  const msgRaw = req.body.message || "";

  const session = getSession(sessionId);

  // ✅ If waiting for safety answer, DO NOT re-run emergency tree
  if (session && (session.awaitingSafetyCheck || session.awaitingPainLocation)) {
  return runTriageFlow(sessionId, msgRaw, res, null);
  }

  // Otherwise run emergency assessment normally
  const emerg = assessEmergency(msgRaw);

  return runTriageFlow(sessionId, msgRaw, res, emerg);
});

module.exports = router;