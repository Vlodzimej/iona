export function renderWebview(
  template: string,
  values: Record<'csp' | 'nonce' | 'script' | 'style' | 'markdown', string>,
): string {
  return template.replace(
    /\{\{\s*(csp|nonce|script|style|markdown)\s*\}\}/gu,
    (_, key: keyof typeof values) => values[key],
  );
}
