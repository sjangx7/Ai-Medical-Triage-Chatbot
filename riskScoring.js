const fs = require("fs");
const path = require("path");

const sessions = {};

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */

function nowISO() { return new Date().toISOString(); }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function normalize(text) { return (text || "").toLowerCase().trim(); }

function isGreeting(msg) {
  const m = normalize(msg);
  const loose = ["hi", "hey", "hiya", "hello", "helo", "helloo", "yo", "sup"];
  return loose.some(p => m === p || m.startsWith(p + " "));
}

function isConfused(msg) {
  const m = normalize(msg);
  return [
    "what do i do", "what should i do", "help",
    "dont know", "don't know", "confused", "not sure",
    "idk", "i dont know", "i don't know"
  ].some(p => m.includes(p));
}

function isRestart(msg) {
  const m = normalize(msg);
  return ["restart", "start over", "new assessment", "reset"].some(p => m.includes(p));
}

function isMetaQuestion(msg) {
  const m = normalize(msg);
  return [
    "why", "what is this", "what are you", "how does this work",
    "is this real", "what do you do", "how do you decide"
  ].some(p => m.includes(p));
}

function parseSeverity(msg) {
  const n = parseInt(msg, 10);
  if (Number.isNaN(n)) return null;
  if (n < 1 || n > 10) return null;
  return n;
}

function parseDurationDays(msg) {
  const m = normalize(msg);

  const num = m.match(/\b(\d+)\b/);
  if (num) {
    const value = parseInt(num[1], 10);
    if (m.includes("hour")) return Math.max(0, Math.round(value / 24));
    if (m.includes("week")) return value * 7;
    return value;
  }

  if (m.includes("today") || m.includes("since morning") || m.includes("this morning") || m.includes("few hours")) return 0;
  if (m.includes("yesterday")) return 1;
  if (m.includes("couple of days")) return 2;
  if (m.includes("few days")) return 3;
  if (m.includes("week")) return 7;

  return null;
}

function calculateKeywordScore(msg) {
  const m = normalize(msg);
  const weights = {
    severe: 3, intense: 3, worsening: 2, spreading: 2, persistent: 2,
    fever: 2, vomiting: 2, faint: 2, dizzy: 1, dizziness: 1,
    headache: 1, pain: 1, sharp: 2, breathless: 2, cough: 1, wheeze: 2
  };

  let score = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (m.includes(k)) score += w;
  }
  return score;
}

// Require a symptom signal (prevents “helo” treated as symptom)
function hasSymptomSignal(msg) {
  const m = normalize(msg);

  const keywords = [
    "pain", "ache", "cough", "fever", "temperature", "sore", "throat",
    "breath", "breathing", "wheeze", "chest", "tight", "pressure",
    "vomit", "vomiting", "nausea", "diarr", "stomach", "abdominal",
    "headache", "migraine", "dizzy", "dizziness", "rash", "swelling",
    "injury", "bleeding", "burn", "infection", "flu", "cold",
    "back", "arm", "leg", "neck", "ear", "eye"
  ];

  const patterns = [
    "i have", "i've got", "i feel", "im feeling", "i am feeling",
    "suffering", "been having", "my", "hurts", "hurting"
  ];

  if (m.length < 6) return false;
  if (patterns.some(p => m.includes(p))) return true;
  if (keywords.some(k => m.includes(k))) return true;

  return false;
}

function isNoneReply(msg) {
  const m = normalize(msg);
  return ["none", "no", "nope", "nothing", "n/a", "nah"].includes(m);
}

function symptomCategory(msg) {
  const m = normalize(msg);
  const cats = [
    { name: "respiratory", keys: ["cough", "wheeze", "breath", "shortness", "chest tight"] },
    { name: "fever_flu", keys: ["fever", "chills", "body aches", "sore throat"] },
    { name: "gastro", keys: ["vomit", "vomiting", "diarr", "nausea", "stomach", "abdominal"] },
    { name: "neuro", keys: ["headache", "migraine", "dizzy", "dizziness", "faint"] },
    { name: "general", keys: [] }
  ];
  for (const c of cats) if (c.keys.some(k => m.includes(k))) return c.name;
  return "general";
}

function riskFromScore(score) {
  if (score >= 8) return { level: "Urgent", colour: "red", confidence: "High" };
  if (score >= 4) return { level: "Moderate", colour: "orange", confidence: "Moderate" };
  return { level: "Low Risk", colour: "green", confidence: "Preliminary" };
}

function adviceForLevel(level) {
  if (level === "Urgent") return "Urgent medical assessment is recommended within 24 hours (e.g., urgent care / out-of-hours service).";
  if (level === "Moderate") return "A GP consultation is recommended within 48 hours. If symptoms worsen, seek more urgent help.";
  return "Self-care is appropriate at this stage. Monitor symptoms and seek medical advice if they worsen or persist.";
}

function aftercareForLevel(level) {
  if (level === "Urgent") {
    return [
      "If symptoms worsen suddenly, or you develop breathing difficulty, severe chest pain, confusion, or collapse, seek emergency help immediately.",
      "If it’s safe to do so, arrange urgent assessment today/within 24 hours.",
      "Avoid driving yourself if you feel faint or severely unwell."
    ];
  }
  if (level === "Moderate") {
    return [
      "Book a GP appointment within 48 hours (or use out-of-hours if needed).",
      "Monitor: worsening severity, new fever, persistent vomiting, breathing changes, fainting, or confusion.",
      "Seek urgent help sooner if symptoms escalate."
    ];
  }
  return [
    "Self-care: rest, hydration, and symptom monitoring.",
    "Monitor for: worsening severity, high fever, breathing difficulty, chest pain, fainting, confusion, or symptoms lasting longer than expected.",
    "If symptoms worsen or you feel unsafe, seek medical advice."
  ];
}

/* --------------------------------------------------
   Human Layer (lightweight + deterministic)
-------------------------------------------------- */

// A tiny “reflective listening” summary (not diagnosis)
function summarizeSymptomText(msgRaw) {
  const m = normalize(msgRaw);

  const tags = [];
  const tagMap = [
    { k: ["chest pain", "chest pressure", "tight chest"], t: "chest discomfort" },
    { k: ["shortness of breath", "breathless", "wheeze", "wheezing"], t: "breathing symptoms" },
    { k: ["cough"], t: "cough" },
    { k: ["fever", "temperature", "chills"], t: "feverish symptoms" },
    { k: ["sore throat"], t: "sore throat" },
    { k: ["headache", "migraine"], t: "headache" },
    { k: ["dizzy", "dizziness", "lightheaded"], t: "dizziness" },
    { k: ["vomit", "vomiting", "nausea"], t: "nausea/vomiting" },
    { k: ["diarr"], t: "diarrhoea" },
    { k: ["stomach", "abdominal"], t: "abdominal discomfort" },
    { k: ["rash"], t: "rash" },
    { k: ["swelling"], t: "swelling" },
    { k: ["injury", "hurt", "sprain", "twist"], t: "injury" },
    { k: ["bleeding"], t: "bleeding" }
  ];

  for (const item of tagMap) {
    if (item.k.some(x => m.includes(x))) tags.push(item.t);
  }

  if (tags.length === 0) {
    // fallback: pick a short cleaned snippet
    const cleaned = msgRaw.trim().replace(/\s+/g, " ");
    return cleaned.length > 42 ? cleaned.slice(0, 42) + "…" : cleaned;
  }

  // Deduplicate + limit to 2–3 tags
  const unique = [...new Set(tags)].slice(0, 3);
  return unique.join(", ");
}

// One clarification rule: “pain” but no location word
function needsPainLocationClarification(msgRaw) {
  const m = normalize(msgRaw);
  const mentionsPain = m.includes("pain") || m.includes("ache") || m.includes("hurts") || m.includes("hurting");
  if (!mentionsPain) return false;

  const locations = [
    "head", "chest", "stomach", "abdomen", "back", "neck", "throat",
    "arm", "leg", "knee", "ankle", "wrist", "shoulder", "ear", "eye",
    "tooth", "teeth", "jaw"
  ];

  // If they already mention a location, no clarification needed
  if (locations.some(l => m.includes(l))) return false;

  // Avoid asking if symptom is already something else like “headache”
  if (m.includes("headache") || m.includes("migraine")) return false;

  return true;
}

function empathyLine() {
  return randomChoice([
    "Thanks — I’ll keep this quick and structured.",
    "Understood — thanks for explaining.",
    "Thanks — I’ll ask a couple of short questions to assess urgency."
  ]);
}

function recapLine(session) {
  const symptom = session.symptomSummary || "your symptom";
  const sev = (session.severity !== null) ? `${session.severity}/10` : "not provided";
  const dur = (session.durationDays !== null) ? `${session.durationDays} day(s)` : "not provided";
  const extra = session.associatedText ? "yes" : "no";

  return `Quick recap: ${symptom}. Severity: ${sev}. Duration: ${dur}. Additional symptoms: ${extra}.`;
}

/* --------------------------------------------------
   Session + Logging
-------------------------------------------------- */

function makeSession(sessionId) {
  sessions[sessionId] = {
    sessionId,
    step: 1,
    symptomText: "",
    symptomSummary: "",
    symptomCategory: "general",
    severity: null,
    durationDays: null,
    associatedText: "",
    baseScore: 0,
    score: 0,
    level: null,
    colour: null,
    confidence: null,
    advice: null,
    explanation: null,
    completed: false,
    awaitingSafetyCheck: false,
    awaitingPainLocation: false, // ✅ NEW (clarification state)
    createdAt: nowISO(),
    transcript: []
  };
  return sessions[sessionId];
}

function getSession(sessionId) {
  return sessions[sessionId] || null;
}

function ensureLogsDir() {
  const dir = path.join(__dirname, "..", "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logLine(session) {
  const dir = ensureLogsDir();
  const file = path.join(dir, "interactions.jsonl");
  fs.appendFileSync(file, JSON.stringify({ ...session, completedAt: nowISO() }) + "\n", "utf8");
}

/* --------------------------------------------------
   Aftercare Chat
-------------------------------------------------- */

function handleAftercareChat(session, msg) {
  if (isRestart(msg)) {
    return { reply: "No problem — type your main symptom to begin a new assessment.", reset: true };
  }

  if (isConfused(msg) || msg.includes("now what") || msg.includes("next") || msg.includes("what should")) {
    const bullets = aftercareForLevel(session.level).map(x => `• ${x}`).join("\n");
    return {
      reply:
        `Here’s what I would recommend right now based on your ${session.level} result:\n${bullets}\n\nYou can ask “why” for the reasoning, or type “restart” to begin a new assessment.`,
      level: session.level,
      colour: session.colour,
      completed: true
    };
  }

  if (msg.includes("why") || msg.includes("explain") || msg.includes("how did you")) {
    return {
      reply: `Of course — here’s the reasoning: ${session.explanation}`,
      level: session.level,
      colour: session.colour,
      completed: true
    };
  }

  return {
    reply: "I can help with next steps. Ask what to do now, ask why you got this result, or type 'restart' to begin a new assessment.",
    level: session.level,
    colour: session.colour,
    completed: true
  };
}

/* --------------------------------------------------
   Main Triage Flow
-------------------------------------------------- */

function runTriageFlow(sessionId, msgRaw, res, emerg = null) {
  const msg = normalize(msgRaw);

  if (!sessions[sessionId]) makeSession(sessionId);
  const session = sessions[sessionId];

  // Emergency tree decisions (from router)
  if (emerg && emerg.action === "EMERGENCY") {
    session.completed = true;
    session.level = "Emergency";
    session.colour = "red";
    session.confidence = "High";
    session.explanation = emerg.explanation;

    return res.json({
      reply: emerg.reply,
      level: "Emergency",
      colour: "red",
      confidence: "High",
      explanation: emerg.explanation,
      completed: true
    });
  }

  if (emerg && emerg.action === "SCREEN") {
    session.awaitingSafetyCheck = true;
    return res.json({
      reply: emerg.reply,
      level: "Safety Check",
      colour: "orange",
      confidence: "Moderate",
      explanation: emerg.explanation,
      step: 1,
      stepLabel: "Safety check",
      completed: false
    });
  }

  session.transcript.push({ role: "user", text: msgRaw, at: nowISO() });

  // Handle safety-screen answer ONLY when active
  if (session.awaitingSafetyCheck) {
    session.awaitingSafetyCheck = false;

    if (msg === "yes" || msg === "y") {
      session.completed = true;
      session.level = "Emergency";
      session.colour = "red";
      session.confidence = "High";
      session.explanation = "User confirmed high-risk features during safety screening.";

      return res.json({
        reply: "⚠️ Based on your answer, this may be serious. Please call 999 immediately.",
        level: "Emergency",
        colour: "red",
        confidence: "High",
        explanation: session.explanation,
        completed: true
      });
    }

    // If "no", continue normal assessment
  }

  // Restart at any time
  if (isRestart(msg)) {
    delete sessions[sessionId];
    return res.json({
      reply: "No problem — I’ve reset the assessment. Please describe your main symptom when you’re ready.",
      reset: true,
      step: 1,
      stepLabel: "Symptom"
    });
  }

  // Meta questions mid-flow
  if (!session.completed && isMetaQuestion(msg)) {
    const reply =
      "I’m a research triage prototype. I’ll ask about your symptom, severity (1–10), and duration, then suggest an urgency level (not a diagnosis). " +
      "To begin, please describe your main symptom (e.g., 'cough and fever', 'sharp headache', 'stomach pain').";
    session.transcript.push({ role: "bot", text: reply, at: nowISO() });
    return res.json({ reply, step: 1, stepLabel: "Symptom" });
  }

  // Aftercare mode
  if (session.completed) {
    const followUp = handleAftercareChat(session, msg);
    session.transcript.push({ role: "bot", text: followUp.reply, at: nowISO() });
    return res.json(followUp);
  }

  /* ---------------------------------
     Clarification: Pain location
  ---------------------------------- */
  if (session.awaitingPainLocation) {
    // user should respond with location
    session.awaitingPainLocation = false;
    // append location into symptomText and continue to severity
    session.symptomText = `${session.symptomText} (location: ${msgRaw})`;
    session.symptomSummary = `${session.symptomSummary} (location: ${msgRaw.trim()})`;
    session.baseScore = calculateKeywordScore(session.symptomText);
    session.step = 2;

    const reply =
      `${randomChoice(["Thanks.", "Got it.", "Understood."])} On a scale from 1 to 10, how severe is this right now (10 = most severe)?`;
    session.transcript.push({ role: "bot", text: reply, at: nowISO() });
    return res.json({ reply, step: 2, stepLabel: "Severity" });
  }

  /* ---------------------------------
     Step 1: Symptom
  ---------------------------------- */
  if (session.step === 1) {
    if (isGreeting(msg)) {
      const reply = "Hello 👋 What symptom are you experiencing today? (e.g., headache, cough, chest pain, fever)";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 1, stepLabel: "Symptom" });
    }

    if (isConfused(msg) || msg.length < 3 || msg.includes("unwell") || msg.includes("sick")) {
      const reply = "That’s okay — please describe your main symptom clearly (e.g., 'cough and fever', 'sharp chest pain', 'vomiting').";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 1, stepLabel: "Symptom" });
    }

    if (!hasSymptomSignal(msg)) {
      const reply = "To start, please describe your main symptom clearly (e.g., 'sharp chest pain', 'cough and fever', 'vomiting').";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 1, stepLabel: "Symptom" });
    }

    // Human layer: reflective summary + (optional) clarification
    session.symptomText = msgRaw;
    session.symptomSummary = summarizeSymptomText(msgRaw);
    session.symptomCategory = symptomCategory(msg);

    // If pain but no location, ask ONE clarification question
    if (needsPainLocationClarification(msgRaw)) {
      session.awaitingPainLocation = true;
      const reply =
        `${empathyLine()} I just need one detail: where is the pain located (e.g., head, chest, stomach, back, arm/leg)?`;
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 1, stepLabel: "Symptom" });
    }

    session.baseScore = calculateKeywordScore(msg);
    session.step = 2;

    const reply =
      `${empathyLine()} I’m hearing: ${session.symptomSummary}. ` +
      `On a scale from 1 to 10, how severe is this right now (10 = most severe)?`;

    session.transcript.push({ role: "bot", text: reply, at: nowISO() });
    return res.json({ reply, step: 2, stepLabel: "Severity" });
  }

  /* ---------------------------------
     Step 2: Severity
  ---------------------------------- */
  if (session.step === 2) {
    const severity = parseSeverity(msg);

    if (severity === null) {
      const reply = "To assess safely, please enter a number from 1 to 10 for severity (e.g., 3, 7, 10).";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 2, stepLabel: "Severity" });
    }

    session.severity = severity;
    session.step = 3;

    const reply = "Thanks. How long have you been experiencing this (in days)? For example: 0 (today), 2, 7.";
    session.transcript.push({ role: "bot", text: reply, at: nowISO() });
    return res.json({ reply, step: 3, stepLabel: "Duration" });
  }

  /* ---------------------------------
     Step 3: Duration
  ---------------------------------- */
  if (session.step === 3) {
    const days = parseDurationDays(msg);

    if (days === null) {
      const reply = "No problem — please enter the duration as days (e.g., 0 for today, 2, 7), or phrases like 'yesterday' or 'a week'.";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 3, stepLabel: "Duration" });
    }

    session.durationDays = days;
    session.step = 4;

    const reply = "Any additional symptoms you’ve noticed? (e.g., fever, nausea, dizziness). You can also type 'none'.";
    session.transcript.push({ role: "bot", text: reply, at: nowISO() });
    return res.json({ reply, step: 4, stepLabel: "Additional symptoms" });
  }

  /* ---------------------------------
     Step 4: Additional symptoms -> Final
  ---------------------------------- */
  if (session.step === 4) {
    if (isConfused(msg)) {
      const reply = "That’s okay — list any other symptoms you’ve noticed, or type 'none' if there aren’t any.";
      session.transcript.push({ role: "bot", text: reply, at: nowISO() });
      return res.json({ reply, step: 4, stepLabel: "Additional symptoms" });
    }

    session.associatedText = isNoneReply(msg) ? "" : msgRaw;

    // Final calculation (unchanged)
    let score = session.baseScore;

    if (session.severity >= 8) score += 3;
    else if (session.severity >= 5) score += 2;

    if (session.durationDays > 7) score += 3;
    else if (session.durationDays > 3) score += 2;

    score += calculateKeywordScore(session.associatedText);

    if (session.symptomCategory === "respiratory" && score >= 4) score += 1;
    if (session.symptomCategory === "neuro" && session.severity >= 7) score += 1;

    const risk = riskFromScore(score);

    session.score = score;
    session.level = risk.level;
    session.colour = risk.colour;
    session.confidence = risk.confidence;
    session.advice = adviceForLevel(risk.level);

    const assoc = session.associatedText ? "yes" : "no";
    session.explanation =
      `Rule-based assessment using: symptom text, severity (${session.severity}/10), duration (${session.durationDays} days), ` +
      `keyword indicators, and category (${session.symptomCategory}). Additional symptoms provided: ${assoc}. Total risk score: ${score}.`;

    session.completed = true;

    // Human layer: recap before result
    const reviewingReply =
      `Thanks — I’m now reviewing what you’ve told me.\n${recapLine(session)}`;

    const finalReply =
      `${randomChoice(["Thank you.", "Understood.", "Thanks for clarifying."])} ` +
      `Based on what you’ve told me, this appears to fall under a ${session.level} category. ` +
      `${session.advice} ` +
      `If symptoms worsen, change suddenly, or you feel unsafe at any point, seek medical attention promptly.`;

    session.transcript.push({ role: "bot", text: reviewingReply, at: nowISO() });
    session.transcript.push({ role: "bot", text: finalReply, at: nowISO() });

    logLine(session);

    return res.json({
      reply: reviewingReply,
      step: 5,
      stepLabel: "Reviewing",
      autoFollowUp: true,
      autoDelayMs: 1200,
      autoPayload: {
        reply: finalReply,
        level: session.level,
        colour: session.colour,
        confidence: session.confidence,
        explanation: session.explanation,
        aftercare: aftercareForLevel(session.level),
        completed: true
      }
    });
  }

  return res.json({ reply: "Sorry — I didn’t catch that. Could you try again?" });
}

module.exports = { runTriageFlow, getSession };