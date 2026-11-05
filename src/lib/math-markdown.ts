/** Normalize model delimiters while leaving fenced code and ordinary inline code alone. */
export function normalizeMathMarkdown(value: string): string {
  const whole = value.trim().match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  const input = whole?.[1] ?? value;
  return input.split(/(```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)|`+[^`\n]+`+)/g).map(part => {
    if (/^(```|~~~)/.test(part)) return part;
    if (part.startsWith('`')) {
      const formula = part.replace(/^`+|`+$/g, '').trim();
      const tex=/\\(?:frac|sum|sqrt|alpha|beta|theta|sigma|Delta)\b/.test(formula);
      const equation=/\b[A-Za-z]_(?:\{[^}]+\}|[A-Za-z0-9](?![A-Za-z0-9_]))/.test(formula)&&/[=+*/()−-]/.test(formula);
      if ((!tex&&!equation) || /["';]|=>|\b(?:const|let|return|import)\b/.test(formula)) return part;
      const fraction = formula.replace(/\(([^()]+)\)\s*\/\s*(?:\(([^()]+)\)|([A-Za-z](?:_\{[^}]+\}|_[A-Za-z0-9]+)?))/g, (_m, a, b, c) => `\\frac{${a}}{${b ?? c}}`);
      return `$${fraction}$`;
    }
    return part.replace(/\\\[([\s\S]*?)\\\]/g, (_m, math) => `\n$$\n${math.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_m, math) => `$${math.trim()}$`);
  }).join('');
}
