# Робочий посібник — що робити руками

Це не інструкція з розгортання з нуля (та лежить у `README.md`) і не
правила для AI (ті — в `AGENTS.md`). Це шпаргалка на випадок, коли ти сам
щось змінюєш і хочеш, щоб push/білд/деплой відпрацювали як слід.

## Три канали, якими зʼявляється контент

| Канал | Що робить | Треба виходити з поточного проєкту? |
|---|---|---|
| Telegram-бот (@ бот, кнопки в чаті) | Голос/текст/фото → файл у репо + анонс у `@jwl_blog` | Так, відкрити Telegram |
| `tools/note.sh` / Claude Code skill `joewline-note` | Той самий формат файлу, напряму з будь-якого проєкту через `gh api` | Ні |
| Ручне редагування файлу в `site/src/content/cases/` | Повний контроль над текстом | Ні, але треба `git push` самому |

Перші два канали публікують автоматично (комітять самі). Третій — ти сам
відповідаєш за `git push`.

## Що оновлюється автоматично, а що — ні

- **Сайт (`site/`)** оновлюється автоматично при будь-якому push у `main`,
  що зачіпає `site/**` — GitHub Actions (`.github/workflows/deploy.yml`)
  збирає й деплоїть на GitHub Pages. Перевірити прогін:
  ```bash
  gh run list --branch main --limit 3
  gh run watch <ID>          # дочекатись конкретного прогону
  ```
  Готово — за ~20-40 секунд.

- **Бот (`bot/`) автодеплою НЕ МАЄ.** Зміни в `bot/src/index.js` чи
  `bot/wrangler.toml`, запушені в git, ніяк не впливають на живого бота,
  доки не виконаєш вручну:
  ```bash
  cd bot
  npx wrangler deploy
  ```
  Це найчастіша причина "я щось поміняв, а бот поводиться по-старому".
  Перевірити, що деплой стався: у виводі команди є `Current Version ID: ...`
  і свіжий `Deployed joewline-intake-bot triggers`.

## Типовий цикл змін у коді (не в контенті)

```bash
cd "site"          # або bot/
npm install          # якщо додав/зняв залежність
npm run build         # для site/ — обов'язково перед push, щоб не зловити помилку в CI
git add -A
git commit -m "..."
git push origin main
gh run watch $(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')
```

Якщо чіпав `bot/` — додатково `cd bot && npx wrangler deploy`.

## Секрети й змінні бота

- **Секрети** (не лежать у git, тільки в Cloudflare):
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GITHUB_TOKEN`.
  Задаються/перезаписуються через `npx wrangler secret put <NAME>` з
  `bot/`. Подивитись, які секрети взагалі є (без значень):
  `npx wrangler secret list`.
- **Звичайні змінні** (лежать відкрито в `bot/wrangler.toml`, коментарі
  там же): `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `CONTENT_PATH`,
  `SITE_URL`, `ANNOUNCE_CHAT_ID` (зараз — `-1004424065462`, канал
  `@jwl_blog`). Зміна будь-якої з них вимагає `wrangler deploy`, щоб
  застосуватись.

## Типові завдання

- **Видалити допис** — видали `.md`-файл з `site/src/content/cases/`,
  закомить, запуш. Зникне з сайту після наступного деплою.
- **Позначити допис готовою статтею** — постав `status: done` у
  frontmatter (або через бота — кнопка "Опублікувати як статтю"/`/publish`,
  або через `tools/note.sh --status done`). Пост переїде з загальної
  стрічки в блок "Завершені статті" збоку.
- **Додати тег заднім числом** — впиши прямо в масив `tags: [...]` у
  frontmatter файлу.
- **Змінити канал анонсів** — постав інший `chat_id` у `ANNOUNCE_CHAT_ID`
  (`bot/wrangler.toml`) і задеплой бота.

## Нотатка з іншого проєкту, не виходячи з нього

`tools/note.sh` (і Claude Code skill `joewline-note`, підключений як
`~/.claude/skills/joewline-note` — симлінк на `tools/note-skill/`) дають
змогу зберегти запис у блог прямо з розмови в іншому репозиторії:

```bash
"/mnt/Edisk/VS CODE FILES/joewline-blog/tools/note.sh" \
  --title "Назва" --kind thought --status draft --tags "тег1,тег2" \
  --body "текст, можна з #хештегами прямо в тексті"
```

Без Telegram, без переключення вікон — комітить напряму через `gh api`
(GitHub CLI має бути залогінений: `gh auth status`). Якщо в Claude Code
просто попросиш "занотуй це в блог" — skill підхопить сам і викличе цей
скрипт за тебе, у будь-якому проєкті, доки на машині є симлінк вище.

**Обмеження:** на відміну від Telegram-каналу дописи, створені так, у
`@jwl_blog` не анонсуються (у скрипта немає й не повинно бути
`TELEGRAM_BOT_TOKEN` — це секрет бота).

Якщо переносиш роботу на іншу машину — символічне посилання
`~/.claude/skills/joewline-note` там саме собою не з'явиться, треба
перестворити:
```bash
mkdir -p ~/.claude/skills
ln -sfn "/шлях/до/joewline-blog/tools/note-skill" ~/.claude/skills/joewline-note
```

## Типові збої й де дивитись

| Симптом | Найімовірніша причина |
|---|---|
| Бот не бачить нову кнопку/команду | Забув `cd bot && npx wrangler deploy` |
| Сайт не оновився після push | Дивись `gh run list` — впав білд чи деплой |
| Фото не завантажується | У `GITHUB_TOKEN` бота нема прав Contents: Read/write на цей репо |
| Анонс не приходить у `@jwl_blog` | Бот не доданий у канал адміністратором |
| `tools/note.sh` падає з "gh не знайдено" | `gh auth status` — можливо, не залогінений на цій машині |
| Дата/час на сайті "не той" | Перевір, що в frontmatter `date` — повний ISO-таймстамп з часом, не тільки `YYYY-MM-DD` (сайт сам конвертує в Europe/Kyiv, але без часу в даті нема що конвертувати) |

## Відома технічна деталь, яку варто памʼятати

`@astrojs/sitemap` запінений на `3.2.1` в `site/package.json` —
новіші версії (3.4+) використовують хук `astro:routes:resolved`,
якого немає у встановленому Astro `4.16.19`, і білд падає з
`Cannot read properties of undefined (reading 'reduce')`. Не онови
цей пакет випадково без перевірки на реальному білді.
