// Перше зображення з тіла запису — використовується як og:image, щоб у
// прев'ю посилання в Telegram/соцмережах показувалась саме фото зі статті,
// а не завжди той самий логотип.
export function firstImagePath(body: string): string | null {
  const match = body.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  return match ? match[1] : null;
}
