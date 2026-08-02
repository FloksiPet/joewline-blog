import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import AstroPWA from '@vite-pwa/astro';
import { rehypeBaseUrl } from './src/lib/rehype-base-url.mjs';
import { rehypeGallery } from './src/lib/rehype-gallery.mjs';
import { rehypeFileCard } from './src/lib/rehype-file-card.mjs';

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
  integrations: [
    sitemap(),
    AstroPWA({
      registerType: 'autoUpdate',
      includeAssets: ['jwl-icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'joewline',
        short_name: 'joewline',
        description:
          'Особистий блог-стрічка JoeWline: нотатки, роздуми та кейси про мікроконтролери, іграшки на залізі й автоматизацію через ШІ.',
        theme_color: '#1c2126',
        background_color: '#1c2126',
        lang: 'uk',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Стрічка порожня чи повна — все одно один HTML per URL, тож
        // navigateFallback на офлайні не потрібен: просто кешуємо статичні
        // асети (CSS/JS/шрифти/іконки) і даємо мережі йти першою для HTML,
        // щоб новий контент з'являвся одразу, а не залипав у кеші.
        globPatterns: ['**/*.{css,js,svg,png,woff2}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              // Без цього Workbox кешує БУДЬ-яку відповідь мережі, включно
              // з 404 — якщо хтось відкрив посилання на щойно опублікований
              // допис до того, як GitHub Pages встиг задеплоїтись (~30-60с),
              // той 404 застрягав у кеші service worker'а і показувався й
              // після того, як сторінка вже була жива. cacheableResponse
              // обмежує кеш лише успішними (200) відповідями.
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  markdown: {
    // Фото й файли з Telegram-бота вставляються як `/uploads/...`
    // (корене-відносний шлях). Порядок важливий: спершу rehypeGallery
    // (фото → карусель) і rehypeFileCard (посилання на файл → картка
    // скачування), і лише тоді rehypeBaseUrl дописує `base` — інакше на
    // GitHub Pages вони ведуть повз підпапку сайту і просто не працюють.
    rehypePlugins: [rehypeGallery, rehypeFileCard, [rehypeBaseUrl, base]],
  },
});
