export function splitContent(content: string): { title: string; notes: string } {
  const [first = '', ...rest] = content.replace(/\r\n/g, '\n').split('\n');
  return { title: first.replace(/^#+\s*/, '').trim(), notes: rest.join('\n').replace(/^\n+/, '').trimEnd() };
}

export function joinContent(title: string, notes: string): string {
  const t = title.trim();
  const n = notes.trim();
  return n ? `${t}\n\n${n}` : t;
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}
