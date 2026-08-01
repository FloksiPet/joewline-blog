# Joewline Blog Agent Instructions

Цей репозиторій — блог/архів у форматі markdown, який збирається в статичний сайт за допомогою Astro і розгортається на GitHub Pages.

## Що тут є
- site/ — Astro-сайт, який показує контент з папки site/src/content/cases
- bot/ — Telegram-бот на Cloudflare Workers, який приймає текст/голос/фото і створює markdown-файли
- .github/workflows/deploy.yml — автоматичний build + deploy на GitHub Pages при push у main

## Формат контенту
Кожен файл у site/src/content/cases/ повинен бути markdown із frontmatter.

Обов'язкові поля:
- title: string
- date: YYYY-MM-DD
- status: draft | in-progress | done
- kind: thought | case
- tags: string[]
- targets: [site] або [site, dou] або [site, drukarnia]
- canonical: true

Рекомендований структури для кейсу:
```markdown
---
title: "Назва"
date: 2026-08-01
status: draft
kind: case
tags: []
targets: [site]
canonical: true
---

## Проблема

## Хід розбору

## Рішення
```

Для стрічки думок можна використовувати:
```markdown
---
title: "Коротка думка"
date: 2026-08-01
status: draft
kind: thought
tags: []
targets: [site]
canonical: true
---

Текст думки...
```

## Правила для AI
Коли AI має створити або змінити контент у цьому репозиторії:
1. Створювати нові файли тільки в папці site/src/content/cases/
2. Дотримуватись формату markdown + frontmatter
3. Для звичайних думок ставити kind: thought
4. Для готових кейсів ставити kind: case і status: done або in-progress
5. Не створювати нові сторінки вручну, лише контентні файли
6. Після змін потрібно залишити проєкт у стані, який збирається командою:
   - cd site && npm run build

## Як працює бот
Бот приймає:
- текст
- голосове повідомлення
- фото з підписом

Якщо повідомлення починається з #case або case:, то файл буде як кейс (kind: case). Якщо ні — то як думка (kind: thought).

Для зображень бот може вставити markdown-рядок з даними зображення у текст. У продакшині це працює як базова інтеграція, але для великих файлів краще зберігати зображення в репозиторії і вставляти відносний шлях.

## Рекомендація для довгих текстів
Якщо текст значно довший за одне повідомлення, краще:
- або розбивати на кілька повідомлень/доповнень,
- або створити чернетку з основою, а потім редагувати файл у репозиторії вручну.

## Коли пушити в GitHub
Після внесення контенту або змін у структуру треба робити коміт і push у main, щоб GitHub Actions перебудував сайт.
