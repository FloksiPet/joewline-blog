// Стабільний колір на основі назви тега (той самий тег завжди того самого
// кольору), щоб теги в стрічці візуально розрізнялись без ручного
// призначення кольору кожному.
export function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash << 5) - hash + tag.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 68%)`;
}
