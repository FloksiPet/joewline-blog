import type { CollectionEntry } from 'astro:content';

// Дата в frontmatter тепер містить час публікації (не тільки день), тому
// записи за один день сортуються по-справжньому хронологічно. Якщо час
// теж збігається — впорядковуємо за назвою, щоб порядок був стабільним.
export function sortEntries(entries: CollectionEntry<'cases'>[]): CollectionEntry<'cases'>[] {
  return [...entries].sort((a, b) => {
    const byDate = b.data.date.valueOf() - a.data.date.valueOf();
    if (byDate !== 0) return byDate;
    return a.data.title.localeCompare(b.data.title, 'uk');
  });
}

function toPlainText(body: string): string {
  return body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(body: string, maxLength = 200): string {
  const plain = toPlainText(body);
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

// Довжина "чистого" тексту без markdown-розмітки — використовується, щоб
// вирішити, чи допис узагалі вартий індексації пошуковиками (коротке
// "збереження в чернетку" на пару слів лише засмічує видачу, а не
// приносить трафік).
export function plainTextLength(body: string): number {
  return toPlainText(body).length;
}
