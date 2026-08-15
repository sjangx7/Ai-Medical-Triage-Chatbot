const chatWindow = document.getElementById("chatWindow");
const inputField = document.getElementById("userInput");
const severityIndicator = document.getElementById("severityIndicator");
const stepIndicator = document.getElementById("stepIndicator");

let sessionId = Date.now().toString();

/* -----------------------------
   Quick Reply UI
----------------------------- */

let quickBarEl = null;

function clearQuickReplies() {
  if (quickBarEl) quickBarEl.remove();
  quickBarEl = null;
}

function createQuickBar() {
  clearQuickReplies();
  const host = document.getElementById("quickReplies");
  if (!host) return null;

  quickBarEl = document.createElement("div");
  quickBarEl.className = "quick-replies";
  host.appendChild(quickBarEl);
  return quickBarEl;
}

function addQuickButton(label, valueToSend) {
  if (!quickBarEl) createQuickBar();
  if (!quickBarEl) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "quick-btn";
  btn.innerText = label;

  btn.addEventListener("click", () => {
    inputField.value = valueToSend;
    sendMessage();
  });

  quickBarEl.appendChild(btn);
}

function showSafetyYesNo() {
  createQuickBar();
  addQuickButton("Yes", "yes");
  addQuickButton("No", "no");
}

function showQuickRepliesForStep(step, label) {
  clearQuickReplies();

  // ✅ Safety check gets YES/NO automatically
  if (label && label.toLowerCase().includes("safety")) {
    showSafetyYesNo();
    return;
  }

  // Step 1: Symptom examples
  if (step === 1) {
    createQuickBar();
    addQuickButton("Cough + fever", "I have a cough and fever");
    addQuickButton("Headache", "I have a headache");
    addQuickButton("Stomach pain", "I have stomach pain");
    addQuickButton("Sore throat", "I have a sore throat");
    addQuickButton("Dizziness", "I feel dizzy");
    addQuickButton("Chest pain", "I have chest pain");
    return;
  }

  // Step 2: Severity 1–10
  if (step === 2) {
    createQuickBar();
    for (let i = 1; i <= 10; i++) addQuickButton(String(i), String(i));
    return;
  }

  // Step 3: Duration presets
  if (step === 3) {
    createQuickBar();
    addQuickButton("Today", "0");
    addQuickButton("Yesterday", "1");
    addQuickButton("2–3 days", "3");
    addQuickButton("1 week", "7");
    addQuickButton("2 weeks", "14");
    return;
  }

  // Step 4: Additional symptoms
  if (step === 4) {
    createQuickBar();
    addQuickButton("None", "none");
    addQuickButton("Fever", "fever");
    addQuickButton("Vomiting", "vomiting");
    addQuickButton("Dizziness", "dizziness");
    addQuickButton("Worsening pain", "worsening pain");
    return;
  }
}

/* -----------------------------
   Core chat UI
----------------------------- */

inputField.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

function addMessage(text, sender) {
  const div = document.createElement("div");
  div.classList.add("message", sender);
  div.innerText = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showTyping() {
  if (document.getElementById("typingIndicator")) return;

  const div = document.createElement("div");
  div.classList.add("message", "bot", "typing");
  div.id = "typingIndicator";
  div.innerText = "Typing...";
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function setSeverity(colour, level) {
  severityIndicator.classList.remove("green", "orange", "red");
  if (colour) severityIndicator.classList.add(colour);
  severityIndicator.innerText = "Risk Level: " + (level || "Not Assessed");
}

function setStep(step, label, completed) {
  if (completed) {
    stepIndicator.innerText = "Assessment Complete";
    clearQuickReplies();
    return;
  }

  if (step && label) {
    stepIndicator.innerText = `Step ${step}: ${label}`;
    showQuickRepliesForStep(step, label);
  } else {
    // if no step info, don’t show quick replies
    clearQuickReplies();
  }
}

/* -----------------------------
   Send message
----------------------------- */

async function sendMessage() {
  const message = inputField.value.trim();
  if (!message) return;

  // disable quick replies while waiting
  clearQuickReplies();

  addMessage(message, "user");
  inputField.value = "";

  showTyping();

  try {
    const resp = await fetch("/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message })
    });

    const data = await resp.json();

    const baseDelay = Math.min(1400, 450 + ((data.reply || "").length || 30) * 8);

    setTimeout(() => {
      hideTyping();

      // Reset flow
      if (data.reset) {
        sessionId = Date.now().toString();
        chatWindow.innerHTML = "";
        setSeverity(null, "Not Assessed");
        stepIndicator.innerText = "Step 1: Symptom";
        showQuickRepliesForStep(1, "Symptom");
      }

      // Main reply
      addMessage(data.reply, "bot");

      // Optional fields
      if (Array.isArray(data.aftercare) && data.aftercare.length) {
        addMessage("Next steps:", "bot");
        data.aftercare.forEach(item => addMessage("• " + item, "bot"));
      }

      if (data.explanation) addMessage("🧠 Risk Breakdown: " + data.explanation, "bot");
      if (data.confidence) addMessage("Confidence: " + data.confidence, "bot");

      if (data.level) setSeverity(data.colour, data.level);

      setStep(data.step, data.stepLabel, data.completed);

      // Auto follow-up
      if (data.autoFollowUp && data.autoPayload) {
        const ms = typeof data.autoDelayMs === "number" ? data.autoDelayMs : 1200;

        showTyping();

        setTimeout(() => {
          hideTyping();

          const p = data.autoPayload;

          addMessage(p.reply, "bot");

          if (Array.isArray(p.aftercare) && p.aftercare.length) {
            addMessage("Next steps:", "bot");
            p.aftercare.forEach(item => addMessage("• " + item, "bot"));
          }

          if (p.explanation) addMessage("🧠 Risk Breakdown: " + p.explanation, "bot");
          if (p.confidence) addMessage("Confidence: " + p.confidence, "bot");

          if (p.level) setSeverity(p.colour, p.level);

          setStep(null, null, true);
        }, ms);
      }

    }, baseDelay);

  } catch (err) {
    hideTyping();
    addMessage("⚠️ Unable to connect to the triage service. Please try again.", "bot");
  }
}

// initial state
showQuickRepliesForStep(1, "Symptom");