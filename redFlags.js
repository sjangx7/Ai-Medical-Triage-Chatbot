function normalize(text) {
  return (text || "").toLowerCase().trim();
}

function includesAny(text, terms) {
  return terms.some(t => text.includes(t));
}

/**
 * Rule-based emergency decision tree.
 * Returns:
 *  - action: "EMERGENCY" => advise 999 now
 *  - action: "SCREEN"    => ask clarifying question(s)
 *  - action: "NONE"      => continue normal triage flow
 */
function assessEmergency(msgRaw) {
  const msg = normalize(msgRaw);

  // --- Universal "always emergency" signals ---
  const cannotBreathe = includesAny(msg, [
    "can't breathe", "cannot breathe", "struggling to breathe",
    "gasping", "breathing very hard", "severe shortness of breath"
  ]);

  const unconscious = includesAny(msg, [
    "unconscious", "passed out", "collapsed", "collapse", "fainted",
    "not responding"
  ]);

  const stroke = includesAny(msg, [
    "face drooping", "slurred speech", "one sided weakness",
    "one-sided weakness", "stroke", "can't speak"
  ]);

  const majorBleeding = includesAny(msg, [
    "severe bleeding", "heavy bleeding", "won't stop bleeding",
    "blood loss", "bleeding a lot"
  ]);

  const anaphylaxis = includesAny(msg, [
    "anaphylaxis", "throat swelling", "swollen tongue",
    "severe allergic", "allergic reaction and can't breathe"
  ]);

  const blueLips = includesAny(msg, ["blue lips", "turning blue"]);

  if (cannotBreathe || unconscious || stroke || majorBleeding || anaphylaxis || blueLips) {
    return {
      action: "EMERGENCY",
      reply: "⚠️ Your description includes symptoms that may indicate a medical emergency. Please call 999 immediately.",
      explanation: "Emergency red-flag detected (airway/breathing, collapse, stroke signs, major bleeding, anaphylaxis, or cyanosis)."
    };
  }

  // --- Chest pain: NOT automatically emergency unless high-risk pattern ---
  const mentionsChestPain = includesAny(msg, [
    "chest pain", "tight chest", "chest pressure", "pressure in chest",
    "crushing", "tightness in chest"
  ]);

  if (mentionsChestPain) {
    const highRiskModifiers = includesAny(msg, [
      "crushing", "severe", "sudden", "worst", "heavy",
      "radiating", "left arm", "arm pain", "jaw", "shoulder",
      "sweating", "clammy", "nausea",
      "breathless", "shortness of breath", "can't breathe",
      "collapse", "faint", "dizzy"
    ]);

    // Clear emergency pattern
    if (highRiskModifiers) {
      return {
        action: "EMERGENCY",
        reply: "⚠️ Chest pain with high-risk features can be serious. Please call 999 immediately.",
        explanation: "Chest pain detected with high-risk modifiers (e.g., severe/sudden, radiating pain, breathlessness, collapse, sweating/clamminess)."
      };
    }

    // Otherwise: screen with a clarifying question (safer + more realistic)
    return {
      action: "SCREEN",
      reply:
        "I need to check something important for safety. Is the chest pain severe or sudden, OR does it come with breathlessness, collapse/fainting, or pain spreading to your arm/jaw? (yes/no)",
      explanation: "Chest pain detected without high-risk modifiers — screening question required before emergency escalation."
    };
  }

  // --- Default ---
  return { action: "NONE" };
}

module.exports = { assessEmergency };