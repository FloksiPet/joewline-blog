import type { CollectionEntry } from 'astro:content';

// Дата зберігається в UTC (ISO), але сайт збирається на CI-сервері з
// довільним часовим поясом (зазвичай UTC) — без явного timeZone дата на
// сторінці "поїде" відносно реального київського часу. Тому час завжди
// виводимо саме в Europe/Kyiv, незалежно від того, де відбувається білд.
export function formatDate(date: Date): string {
  const datePart = date.toLocaleDateString('uk-UA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Europe/Kyiv',
  });
  const timePart = date.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kyiv',
  });
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
