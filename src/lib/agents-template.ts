export const RA_AGENTS_MARKER_START = "<!-- RESEARCH_ATELIER_MANAGED_START -->";
export const RA_AGENTS_MARKER_END = "<!-- RESEARCH_ATELIER_MANAGED_END -->";
export const RA_AGENTS_SECTION = [
  RA_AGENTS_MARKER_START, "# Research Atelier execution rules", "",
  "- Check the Git status before work and never overwrite existing user changes.",
  "- Complete one coherent engineering unit per commit.",
  "- Solve ordinary engineering bugs independently.",
  "- Ask before changing scientific meaning: data definitions, model method, loss, evaluation, or paper goal.",
  "- Do not rewrite Git history that existed before this handoff.", RA_AGENTS_MARKER_END,
].join("\n");
