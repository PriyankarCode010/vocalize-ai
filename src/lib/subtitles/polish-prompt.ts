/** Single-shot prompt for sign / fingerspelling recognition cleanup (Gemini). */
export function buildSubtitlePolishPrompt(raw: string): string {
  return `You fix noisy automatic text from sign language recognition (fingerspelling and sign labels).

Rules:
- Output ONE line of clean English only. No quotes. No labels. No explanation.
- Merge repeated letters (e.g. appppleee → apple). Fix obvious spelling errors.
- Insert spaces in run-on text when the meaning is clear (e.g. "iampriyankariamamcastudent" → split into words; capitalize names only if clearly implied).
- Do not invent facts, numbers, or proper names not suggested by the input. When unsure, stay close to the input.
- Preserve first-person intent. Use normal capitalization and punctuation.

Raw input:
"""
${raw}
"""`
}
