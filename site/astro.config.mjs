import { defineConfig } from 'astro/config';
import { rehypeBaseUrl } from './src/lib/rehype-base-url.mjs';
import { rehypeGallery } from './src/lib/rehype-gallery.mjs';

// ВАЖЛИВО: підлаштуй ці два поля під свій репозиторій, інакше посилання
// на сайті та фіди будуть вести не туди.
//
// Варіант А — сайт живе на адресі username.github.io/назва-репозиторію:
//   site: 'https://floksipet.github.io',
//   base: '/joewline-blog/',
//
// Варіант Б — підключений власний домен (напр. joewline.dev):
//   site: 'https://joewline.dev',
//   base: '/',
//
// В обох випадках base обов'язково закінчується "/" — інакше посилання
// на сайті склеюються без роздільника.
const base = '/joewline-blog/';

export default defineConfig({
  site: 'https://floksipet.github.io',
  base,
  markdown: {
    // Фото з Telegram-бота вставляються як `/uploads/...` (корене-відносний
    // шлях). rehypeBaseUrl дописує `base`, інакше на GitHub Pages вони
    // ведуть повз підпапку сайту і просто не завантажуються.
    rehypePlugins: [rehypeGallery, [rehypeBaseUrl, base]],
  },
});
