function adviceForLevel(level) {
  if (level === "Emergency") {
    return "This may indicate a medical emergency. Please call emergency services immediately.";
  }
  if (level === "Urgent") {
    return "Urgent medical assessment is recommended within 24 hours (e.g., urgent care / out-of-hours service).";
  }
  if (level === "Moderate") {
    return "A GP consultation is recommended within 48 hours. If symptoms worsen, seek more urgent help.";
  }
  return "Self-care is appropriate at this stage. Monitor symptoms and seek medical advice if they worsen or persist.";
}

function aftercareForLevel(level) {
  if (level === "Emergency") {
    return [
      "Call emergency services immediately if you have severe breathing difficulty, severe chest pain, confusion, collapse, or blue lips.",
      "If you are alone, try to alert someone nearby and keep your phone accessible.",
      "Do not delay seeking help if symptoms are severe or worsening."
    ];
  }
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

module.exports = { adviceForLevel, aftercareForLevel };