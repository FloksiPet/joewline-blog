import type { CollectionEntry } from 'astro:content';

export function formatDate(date: Date): string {
  const datePart = date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' });
  const timePart = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

// Три види чипів, які реально видно на сайті: вільна думка, робоча
// нотатка (кейс у процесі) і завершена стаття (кейс зі статусом done).
// Статус як такий (чернетка/у процесі/завершено) публічно не показуємо —
// це внутрішнє поле, тут воно лише впливає на назву й колір чипа.
export function displayKind(entry: CollectionEntry<'cases'>): { label: string; className: string } {
  if (entry.data.kind === 'thought') return { label: 'роздуми', className: 'chip-thought' };
  if (entry.data.status === 'done') return { label: 'стаття', className: 'chip-article' };
  return { label: 'нотатка', className: 'chip-note' };
}
