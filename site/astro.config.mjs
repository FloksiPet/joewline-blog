import { defineConfig } from 'astro/config';

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
export default defineConfig({
  site: 'https://floksipet.github.io',
  base: '/joewline-blog/',
});
