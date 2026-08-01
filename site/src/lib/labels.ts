export const kindLabel: Record<string, string> = {
  thought: 'роздуми',
  case: 'кейс',
};

export function formatDate(date: Date): string {
  const datePart = date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' });
  const timePart = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}
