function normalizeSegment(value, maxLength = null) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (maxLength == null || normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).trim();
}

export function buildKnowledgeSearchText(input = {}) {
  const title = normalizeSegment(input.title);
  const summary = normalizeSegment(input.summary);
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => normalizeSegment(tag)).filter(Boolean).join(" ")
    : "";
  const rawContent = normalizeSegment(input.rawContent, 4000);

  return [title, summary, tags, rawContent].filter(Boolean).join("\n\n");
}
