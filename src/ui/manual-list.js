(() => {
  function parse(rawText) {
    const valid = [];
    const invalid = [];
    const seen = new Set();
    for (const rawLine of String(rawText || "").split(/\r?\n/)) {
      const cleaned = rawLine
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .trim()
        .replace(/^@/, "");
      if (!cleaned) continue;
      if (!/^[A-Za-z0-9._]{2,32}$/.test(cleaned)) {
        invalid.push(rawLine.trim() || rawLine);
        continue;
      }
      const key = cleaned.toLocaleLowerCase("tr");
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(cleaned);
    }
    return { valid, invalid };
  }

  window.BTGManualListParser = { parse };
})();
