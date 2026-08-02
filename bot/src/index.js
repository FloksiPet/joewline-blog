/**
 * Telegram → GitHub intake bot.
 *
 * Що робить:
 *  1. Приймає webhook від Telegram (голосове або текстове повідомлення).
 *  2. Якщо голос — розшифровує через Workers AI (Whisper), без зовнішніх ключів.
 *  3. Формує markdown-файл кейсу з правильним frontmatter (status: draft/done).
 *  4. Створює цей файл коммітом напряму в GitHub-репозиторії через Contents API
 *     (git на сервері не потрібен — усе через звичайний fetch).
 *  5. Відповідає в Telegram посиланням на новий файл.
 *
 * Обов'язкові секрети (wrangler secret put <NAME>):
 *   TELEGRAM_BOT_TOKEN        — токен бота від BotFather
 *   TELEGRAM_WEBHOOK_SECRET   — довільний рядок, який Telegram надсилатиме
 *                                назад у заголовку, щоб відсіяти чужі запити
 *   GITHUB_TOKEN              — fine-grained PAT, доступ Contents:
 *                                Read and write лише для цього репозиторію
 *
 * Змінні (у wrangler.toml, не секрет):
 *   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, CONTENT_PATH, SITE_URL,
 *   ANNOUNCE_CHAT_ID — опційно: chat_id групи/каналу, куди дублюється
 *     анонс кожного збереженого запису (порожньо — анонс вимкнений).
 *
 * ВАЖЛИВО: зміни в цьому файлі не діють на живого бота, доки не виконаєш
 *   cd bot && npx wrangler deploy
 * Пуш у GitHub перезбирає лише сайт (site/), не бота — для бота автодеплою
 * поки немає.
 */

function helpText(env) {
  const siteUrl = env.SITE_URL || 'https://floksipet.github.io/joewline-blog/';
  return [
    'Як це працює:',
    '',
    '• «Створити думку» — вільна нотатка-роздум. На сайті це «роздуми».',
    '• «Створити кейс» — проблема → хід розбору → рішення. Поки не завершив — на сайті це «нотатка».',
    '• «Зберегти» — зберігає написане як чернетку/нотатку.',
    '• «Опублікувати як статтю» — позначає кейс завершеним. На сайті це «стаття», і вона переїжджає в окремий блок збоку.',
    '',
    'Теги: просто пиши #тег будь-де в тексті (наприклад #проєкт-x або #мікроконтролери) — на сайті він стане клікабельним кольоровим тегом. Можна декілька.',
    '',
    'Команди: /start — меню, /help — ця підказка, /done — зберегти чернетку, /publish — опублікувати як статтю.',
    'Повідомлення, що починається з #case, теж перемикає в режим кейсу.',
    '',
    `Сайт (звичайне посилання, відкриється в браузері): ${siteUrl}`,
    'Кнопка «🌐 Сайт» нижче відкриває той самий сайт прямо в Telegram.',
  ].join('\n');
}

const START_TEXT = 'Привіт! Я перетворюю твої повідомлення на записи в блозі. Обери режим кнопкою нижче або напиши /help, щоб побачити, як усе працює (роздуми/нотатка/стаття, теги).';

function modeText(mode) {
  return mode === 'case'
    ? 'Режим: кейс. Пиши проблему, хід розбору й рішення. Теги — просто #тег у тексті. Коли закінчиш: «Зберегти» (чернетка) або «Опублікувати як статтю» (готово).'
    : 'Режим: думка. Пиши текст і/або фото. Теги — просто #тег у тексті. Коли закінчиш — «Зберегти» або /done.';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Публічний ендпоінт для лайків/переглядів з сайту — окрема гілка,
    // ДО перевірки Telegram-секрету нижче: відвідувачі сайту не мають і
    // не повинні мати цей секрет, він лише для самого Telegram-вебхука.
    if (url.pathname.startsWith('/reactions/')) {
      return handleReactions(request, env, url);
    }

    if (request.method !== 'POST') {
      return new Response('ok', { status: 200 });
    }

    // Захист від чужих запитів — Telegram підставляє цей заголовок сам,
    // якщо його задати при реєстрації webhook (див. README, крок 10).
    const secretHeader = request.headers.get('x-telegram-bot-api-secret-token');
    if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }

    const update = await request.json();
    const callbackQuery = update.callback_query;
    if (callbackQuery) {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data || '';
      await handleCallback(env, chatId, data);
      await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'Ок' });
      return new Response('ok');
    }

    const message = update.message;
    if (!message) return new Response('ok');

    const chatId = message.chat.id;
    const text = message.text?.trim() || '';

    if (text === 'Створити думку') {
      await setDraftMode(env, chatId, 'thought');
      await sendMenu(env, chatId, modeText('thought'));
      return new Response('ok');
    }

    if (text === 'Створити кейс') {
      await setDraftMode(env, chatId, 'case');
      await sendMenu(env, chatId, modeText('case'));
      return new Response('ok');
    }

    if (text === 'Зберегти') {
      await finishDraft(env, chatId);
      return new Response('ok');
    }

    if (text === 'Опублікувати як статтю') {
      await finishDraft(env, chatId, { status: 'done' });
      return new Response('ok');
    }

    if (text === 'Допомога') {
      await sendMenu(env, chatId, helpText(env));
      return new Response('ok');
    }

    if (text.startsWith('/')) {
      if (text === '/start') {
        await sendMenu(env, chatId, START_TEXT);
        return new Response('ok');
      }

      if (text === '/done') {
        await finishDraft(env, chatId);
        return new Response('ok');
      }

      if (text === '/publish') {
        await finishDraft(env, chatId, { status: 'done' });
        return new Response('ok');
      }

      if (text === '/help') {
        await sendTelegram(env, chatId, helpText(env), getMainKeyboard(env));
        return new Response('ok');
      }

      await sendTelegram(env, chatId, helpText(env), getMainKeyboard(env));
      return new Response('ok');
    }

    try {
      let rawText = null;
      let imageDataUrl = null;
      let kind = (await getDraftMode(env, chatId)) || 'thought';

      if (message.voice) {
        rawText = await transcribeVoice(message.voice.file_id, env);
      } else if (message.photo) {
        imageDataUrl = await uploadPhotoToGitHub(message.photo, env);
        rawText = entitiesToMarkdown(message.caption || message.text || '', message.caption_entities || message.entities);
      } else if (text) {
        rawText = entitiesToMarkdown(message.text || '', message.entities);
      }

      if (rawText && rawText.trim().match(/^(#case|case:)/i)) {
        kind = 'case';
        rawText = rawText.replace(/^(#case|case:)\s*/i, '').trim();
      }

      const hasContent = Boolean(rawText?.trim() || imageDataUrl);
      if (!hasContent) {
        await sendTelegram(env, chatId, 'Не побачив ні тексту, ні голосу, ні фото з підписом — спробуй ще раз.', getMainKeyboard(env));
        return new Response('ok');
      }

      await setDraftMode(env, chatId, kind);
      await appendToDraft(env, chatId, rawText, imageDataUrl, kind);
      await sendTelegram(
        env,
        chatId,
        `Додано до чернетки. Пиши далі або натисни кнопку «Зберегти».`,
        getMainKeyboard(env)
      );
    } catch (err) {
      await sendTelegram(env, chatId, `Щось пішло не так: ${err.message}`, getMainKeyboard(env));
    }

    return new Response('ok');
  },
};

async function transcribeVoice(fileId, env) {
  const fileInfo = await telegramApi(env, 'getFile', { file_id: fileId });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

  const audioResp = await fetch(fileUrl);
  const audioBuffer = await audioResp.arrayBuffer();

  // Workers AI: Whisper працює прямо тут, без зовнішнього API-ключа.
  const result = await env.AI.run('@cf/openai/whisper', {
    audio: [...new Uint8Array(audioBuffer)],
  });

  return result.text;
}

async function appendToDraft(env, chatId, rawText, imageDataUrl, kind) {
  const key = `draft:${chatId}`;
  const existing = await getDraft(env, key);
  const block = imageDataUrl ? `\n\n![Вкладення](${imageDataUrl})\n\n${rawText.trim()}` : rawText.trim();
  const next = existing ? `${existing}\n\n${block}` : block;
  await env.joewline_bot_drafts.put(key, next, { expirationTtl: 60 * 60 * 24 * 7 });
  return { next };
}

async function finishDraft(env, chatId, options = {}) {
  const { status = 'draft' } = options;
  const key = `draft:${chatId}`;
  const draftText = await getDraft(env, key);
  if (!draftText || !draftText.trim()) {
    await sendTelegram(env, chatId, 'Чернетка пуста — нічого не зберігав.', getMainKeyboard(env));
    return;
  }

  const mode = (await getDraftMode(env, chatId)) || 'thought';
  const normalized = draftText.replace(/^(#case|case:)\s*/i, '').trim();
  const tags = extractTags(normalized);
  const withoutTags = stripTags(normalized);
  const { title, slug } = await createCaseFile(withoutTags, env, { kind: mode, status, tags });
  await env.joewline_bot_drafts.delete(key);
  await env.joewline_bot_drafts.delete(`mode:${chatId}`);

  const tagsNote = tags.length > 0 ? `\nТеги: ${tags.map((t) => `#${t}`).join(' ')}` : '';
  const statusNote = status === 'done' ? ' (стаття)' : '';
  const siteUrl = env.SITE_URL || 'https://floksipet.github.io/joewline-blog/';
  const postUrl = `${siteUrl}${slug}/`;
  // Посилання на сайт, а не сирий шлях у репозиторії (`path`) — раніше тут
  // був `path`, який не відкривався у браузері. Явно попереджаємо про
  // затримку деплою (~30-60с), бо посилання, відкрите одразу після цього
  // повідомлення, може ще на мить показати 404, доки GitHub Pages не
  // перезбереться.
  await sendTelegram(
    env,
    chatId,
    `Збережено${statusNote}: "${title}"\n${postUrl}${tagsNote}\n(сайт оновиться за ~30-60с)`,
    getMainKeyboard(env)
  );
  await announceNewPost(env, { title, slug, tags, status, bodyMarkdown: withoutTags });
}

// Дублює анонс кожного збереженого запису в групу/канал, якщо той
// налаштований (ANNOUNCE_CHAT_ID у wrangler.toml). Якщо ні — просто нічого
// не робить, збереження в репозиторій це не зупиняє.
//
// На відміну від сайту, у Telegram-групу йде не лише посилання, а й сам
// текст посту (сконвертований назад у Telegram HTML-розмітку) — фото при
// цьому навмисно НЕ вставляються прямо в текст: Telegram не вміє показати
// їх як карусель/галерею так, як це робить сайт, тож вони йдуть окремим
// фото/альбомом перед текстом, а сама "галерея" в тексті просто відсутня.
async function announceNewPost(env, { title, slug, tags, status, bodyMarkdown }) {
  if (!env.ANNOUNCE_CHAT_ID) return;

  const siteUrl = env.SITE_URL || 'https://floksipet.github.io/joewline-blog/';
  const postUrl = `${siteUrl}${slug}/`;
  const emoji = status === 'done' ? '📄' : '📝';
  const tagsLine = tags.length > 0 ? `\n${tags.map((t) => `#${t}`).join(' ')}` : '';

  const images = extractImagePaths(bodyMarkdown).map((src) => resolveImageUrl(env, src));

  try {
    // Медіа шлються окремо й не блокують текст нижче, якщо, наприклад,
    // GitHub ще не встиг роздати щойно закомічений файл фото.
    await sendAnnounceMedia(env, env.ANNOUNCE_CHAT_ID, images);
  } catch (err) {
    // ігноруємо — текст анонсу все одно піде далі
  }

  const header = `${emoji} <b>${escapeHtml(title)}</b>\n\n`;
  const footer = `\n\n${postUrl}${tagsLine}`;
  const budget = Math.max(200, TELEGRAM_TEXT_LIMIT - header.length - footer.length - 300);
  const { text: safeBody, truncated } = truncateForTelegram(stripImagesMarkdown(bodyMarkdown), budget);
  const html = `${header}${markdownToTelegramHtml(safeBody)}${truncated ? '…' : ''}${footer}`;

  try {
    await telegramApi(env, 'sendMessage', {
      chat_id: env.ANNOUNCE_CHAT_ID,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: images.length > 0 },
    });
  } catch (err) {
    // Анонс — це бонус, а не критична частина потоку: якщо бот ще не
    // адмін групи чи ID неправильний, головне збереження вже відбулось.
  }
}

const TELEGRAM_TEXT_LIMIT = 4096;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Прибирає markdown-картинки з тексту анонсу — в Telegram-групу вони йдуть
// окремим sendPhoto/sendMediaGroup, а не інлайном у повідомленні.
function stripImagesMarkdown(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractImagePaths(text) {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
}

// Фото від бота лежать у репозиторії відносними шляхами (`/uploads/...`) —
// сайт роздає їх лише після деплою GitHub Pages (~30-60с), а анонс іде
// одразу. GitHub Raw роздає щойно закомічений файл миттєво, тож для
// Telegram-анонсу беремо звідти, а не з SITE_URL.
function resolveImageUrl(env, src) {
  if (/^https?:\/\//i.test(src)) return src;
  const cleanPath = src.startsWith('/') ? src : `/${src}`;
  return `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/site/public${cleanPath}`;
}

async function sendAnnounceMedia(env, chatId, images) {
  if (images.length === 0) return;
  if (images.length === 1) {
    await telegramApi(env, 'sendPhoto', { chat_id: chatId, photo: images[0] });
    return;
  }
  // sendMediaGroup приймає 2-10 елементів — більше 10 фото в одному пості
  // для особистого блогу вкрай малоймовірно, тож зайве просто відкидаємо.
  await telegramApi(env, 'sendMediaGroup', {
    chat_id: chatId,
    media: images.slice(0, 10).map((url) => ({ type: 'photo', media: url })),
  });
}

// Обрізає текст під ліміт Telegram (4096 символів на sendMessage), по
// можливості на межі абзацу/речення, щоб не розірвати форматування
// посеред слова.
function truncateForTelegram(text, maxLength) {
  if (text.length <= maxLength) return { text, truncated: false };
  const slice = text.slice(0, maxLength);
  const paragraphBreak = slice.lastIndexOf('\n\n');
  const spaceBreak = slice.lastIndexOf(' ');
  const cut = paragraphBreak > maxLength * 0.5 ? paragraphBreak : spaceBreak > maxLength * 0.5 ? spaceBreak : maxLength;
  return { text: slice.slice(0, cut).trimEnd(), truncated: true };
}

// Зворотна конвертація до entitiesToMarkdown — markdown, який зберігається
// у файлі кейсу, назад у Telegram HTML-розмітку (parse_mode: 'HTML') для
// анонсу в групу. HTML-екранування йде першим кроком, тому символи
// markdown-синтаксису (*, `, [, ] і т.д.) лишаються як є і безпечно
// розпізнаються нижче.
function markdownToTelegramHtml(markdown) {
  let html = escapeHtml(markdown);

  html = html.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');

  html = html.replace(/```([a-zA-Z0-9]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${code.replace(/\n$/, '')}</code></pre>`;
  });

  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  html = html.replace(/\[([^\]]*)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/(^&gt; ?.*(?:\n&gt; ?.*)*)/gm, (block) =>
    `<blockquote>${block
      .split('\n')
      .map((line) => line.replace(/^&gt; ?/, ''))
      .join('\n')}</blockquote>`
  );

  return html;
}

async function getDraft(env, key) {
  return env.joewline_bot_drafts.get(key);
}

async function setDraftMode(env, chatId, mode) {
  await env.joewline_bot_drafts.put(`mode:${chatId}`, mode, { expirationTtl: 60 * 60 * 24 * 7 });
}

async function getDraftMode(env, chatId) {
  return env.joewline_bot_drafts.get(`mode:${chatId}`);
}

// Telegram шле контекстне форматування (жирний/курсив/код/закреслення/
// посилання і т.д.) окремо від тексту — масивом entities з offset/length
// у UTF-16 code units. JS-рядки теж індексуються в UTF-16 code units, тож
// offset/length з Telegram напряму збігаються з .slice() на JS-рядку —
// перераховувати сурогатні пари не треба.
//
// Entities від Telegram або не перетинаються, або вкладені одна в одну
// (дерево) — часткового перетину не буває, це дозволяє безпечно побудувати
// дерево й рекурсивно згорнути його в markdown, не боячись поламати
// вкладеність дужок/зірочок.
// CommonMark вимагає, щоб відкриваючий/закриваючий маркер емфази (**/*/~~)
// не межував із пробілом — інакше він не сприймається як маркер, а
// лишається буквальними зірочками в тексті. Telegram, обираючи текст
// для жирного/курсиву через контекстне меню, часто захоплює пробіл на
// краю виділення — тому пробіли з країв виносимо ЗА межі маркерів,
// а не всередину них.
function wrapEmphasis(inner, marker) {
  const [, lead, core, trail] = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!core) return inner;
  return `${lead}${marker}${core}${marker}${trail}`;
}

const ENTITY_WRAPPERS = {
  bold: (inner) => wrapEmphasis(inner, '**'),
  italic: (inner) => wrapEmphasis(inner, '*'),
  underline: (inner) => `<u>${inner}</u>`,
  strikethrough: (inner) => wrapEmphasis(inner, '~~'),
  code: (inner) => `\`${inner}\``,
  pre: (inner, node) => `\n\`\`\`${node.language || ''}\n${inner}\n\`\`\`\n`,
  text_link: (inner, node) => `[${inner}](${node.url})`,
  blockquote: (inner) => inner.split('\n').map((line) => `> ${line}`).join('\n'),
  expandable_blockquote: (inner) => inner.split('\n').map((line) => `> ${line}`).join('\n'),
};
// Інші типи (mention, hashtag, cashtag, bot_command, url, email,
// phone_number, text_mention, custom_emoji, spoiler) навмисно без обгортки:
// текст уже читається сам по собі, а для spoiler на сайті ще нема
// відповідного стилю, щоб чесно його відтворити.

function buildEntityTree(text, entities) {
  const sorted = [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length);
  const root = { type: 'root', offset: 0, length: text.length, children: [] };
  const stack = [root];

  for (const entity of sorted) {
    const start = entity.offset;
    while (stack.length > 1 && stack[stack.length - 1].offset + stack[stack.length - 1].length <= start) {
      stack.pop();
    }
    const node = { ...entity, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root;
}

function renderEntityNode(text, node) {
  // code/pre — листові вузли: беремо текст як є, без рекурсії в дітей і
  // без ризику, що вкладене форматування поламає символи всередині коду.
  if (node.type === 'code' || node.type === 'pre') {
    const raw = text.slice(node.offset, node.offset + node.length);
    return ENTITY_WRAPPERS[node.type](raw, node);
  }

  let cursor = node.offset;
  let inner = '';
  for (const child of node.children) {
    inner += text.slice(cursor, child.offset);
    inner += renderEntityNode(text, child);
    cursor = child.offset + child.length;
  }
  inner += text.slice(cursor, node.offset + node.length);

  const wrap = ENTITY_WRAPPERS[node.type];
  return wrap ? wrap(inner, node) : inner;
}

function entitiesToMarkdown(text, entities) {
  if (!text || !entities || entities.length === 0) return text || '';
  return renderEntityNode(text, buildEntityTree(text, entities));
}

// Знімає markdown-обгортки (з ENTITY_WRAPPERS вище) з рядка — потрібно там,
// де текст показується як звичайний рядок, а не рендериться markdown-ом
// (заголовок посту, підпис у Telegram-анонсі).
function stripMarkdownForTitle(text) {
  return text
    .replace(/<\/?u>/g, '')
    .replace(/```[a-zA-Z0-9]*\n?/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/^>\s?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

// Хештеги (#тег) будь-де в тексті стають тегами на сайті — не треба
// окремої команди чи меню, досить писати їх природно по ходу тексту.
function extractTags(text) {
  const matches = text.match(/#([\p{L}\p{N}_-]+)/gu) || [];
  const tags = matches.map((m) => m.slice(1).toLowerCase()).filter((tag) => tag !== 'case');
  return [...new Set(tags)];
}

function stripTags(text) {
  return text
    .replace(/#([\p{L}\p{N}_-]+)/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function createCaseFile(rawText, env, options = {}) {
  const { kind = 'thought', imageDataUrl = null, status = 'draft', tags = [] } = options;
  // rawText тут уже пройшов entitiesToMarkdown (може містити **/*/`/<u>` і
  // т.д.), а title показується на сайті як звичайний текст, без markdown-
  // рендеру (<h1>{title}</h1>) — тому для заголовка форматування знімаємо,
  // інакше жирний текст на початку публікується буквально із зірочками.
  const firstLine = stripMarkdownForTitle(rawText.split('\n')[0]).slice(0, 70).trim();
  const title = firstLine || 'Нова нотатка';
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  // Повний час потрібен, щоб кілька нотаток за один день сортувались у
  // стрічці хронологічно, а не лише за датою (без часу вони б "злипались").
  const isoDateTime = now.toISOString();
  const slug = slugify(`${isoDate}-${title}`);
  const path = `${env.CONTENT_PATH}/${slug}.md`;

  const body = buildBody(rawText, imageDataUrl);
  const block = kind === 'case'
    ? [
        '## Проблема',
        '',
        body.trim(),
        '',
        '## Хід розбору',
        '',
        '',
        '## Рішення',
        '',
        '',
      ].join('\n')
    : body.trim();

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    `date: ${isoDateTime}`,
    `status: ${status}`,
    `kind: ${kind}`,
    `tags: [${tags.join(', ')}]`,
    'targets: [site]',
    'canonical: true',
    '---',
    '',
    block,
  ].join('\n');

  await githubApi(env, 'PUT', `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`, {
    message: `note: ${title}`,
    content: base64Encode(frontmatter),
    branch: env.GITHUB_BRANCH,
  });

  return { path, title, slug };
}

function buildBody(rawText, imageDataUrl) {
  let body = rawText.trim();

  if (imageDataUrl) {
    const imageMarkdown = `![Вкладення](${imageDataUrl})`;
    body = body.replace(/\[\[image\]\]/g, imageMarkdown);
    if (!body.includes('![Вкладення](')) {
      body = `${body}\n\n${imageMarkdown}`;
    }
  }

  return body;
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64EncodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function telegramApi(env, method, params) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return resp.json();
}

async function uploadPhotoToGitHub(photo, env) {
  const bestPhoto = photo[photo.length - 1];
  const fileInfo = await telegramApi(env, 'getFile', { file_id: bestPhoto.file_id });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const resp = await fetch(fileUrl);
  const buffer = await resp.arrayBuffer();
  const mimeType = resp.headers.get('content-type') || 'image/jpeg';
  const ext = mimeTypeToExtension(mimeType);
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const repoPath = `site/public/uploads/telegram/${fileName}`;

  await githubApi(env, 'PUT', `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${repoPath}`, {
    message: `upload: ${fileName}`,
    content: base64EncodeBuffer(buffer),
    branch: env.GITHUB_BRANCH,
  });

  return `/uploads/telegram/${fileName}`;
}

function mimeTypeToExtension(mimeType) {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

async function sendTelegram(env, chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi(env, 'sendMessage', payload);
}

async function sendMenu(env, chatId, text = 'Оберіть режим') {
  await telegramApi(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Відкрити меню' },
      { command: 'help', description: 'Підказка' },
      { command: 'done', description: 'Зберегти чернетку' },
      { command: 'publish', description: 'Опублікувати як статтю' },
    ],
  });

  await telegramApi(env, 'setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'commands' },
  });

  return sendTelegram(env, chatId, text, getMainKeyboard(env));
}

function getMainKeyboard(env) {
  const siteUrl = env.SITE_URL || 'https://floksipet.github.io/joewline-blog/';
  return {
    keyboard: [
      [{ text: 'Створити думку' }, { text: 'Створити кейс' }],
      [{ text: 'Зберегти' }, { text: 'Опублікувати як статтю' }],
      [{ text: 'Допомога' }, { text: '🌐 Сайт', web_app: { url: siteUrl } }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function handleCallback(env, chatId, data) {
  if (data === 'create_thought') {
    await setDraftMode(env, chatId, 'thought');
    await sendTelegram(env, chatId, modeText('thought'), getMainKeyboard(env));
  } else if (data === 'create_case') {
    await setDraftMode(env, chatId, 'case');
    await sendTelegram(env, chatId, modeText('case'), getMainKeyboard(env));
  } else if (data === 'save_draft') {
    await finishDraft(env, chatId);
  } else if (data === 'help') {
    await sendTelegram(env, chatId, helpText(env), getMainKeyboard(env));
  }
}

async function githubApi(env, method, path, body) {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'user-agent': 'joewline-bot',
      accept: 'application/vnd.github+json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  return resp.json();
}

// ---- Реакції (лайки/перегляди) ----
//
// Публічний, неавторизований ендпоінт — його викликає JS у браузері будь-
// якого відвідувача сайту, тож тут свій, легший захист від накрутки, а не
// секрет-токен, як для Telegram-вебхука:
//   - CORS обмежений одним конкретним origin (сайтом), не "*"
//   - перегляд рахується не за кожен запит, а раз на IP+пост на 12 годин
//     (SHA-256 хеш IP+slug — сирий IP ніде не зберігається)
//   - лайк — раз на IP+пост назавжди (можна зняти, повторно поставити)
//   - грубий rate-limit на весь /reactions/* — 60 запитів/хв на IP
//
// Чесно про межі: це стримує випадкове/скриптове накручування з одного
// місця, а не гарантований захист від рішучого атакувальника з пулом IP —
// для особистого блогу без комерційної цінності лічильників цього досить,
// повноцінний anti-bot (напр. Turnstile) тут явно надмірний.

async function handleReactions(request, env, url) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = origin === env.SITE_ORIGIN ? origin : '';
  const corsHeaders = {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const jsonResponse = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });

  const parts = url.pathname.split('/').filter(Boolean); // ['reactions', 'counts'|'view'|'like', slug]
  const action = parts[1];
  const slug = decodeURIComponent(parts[2] || '');

  if (!slug || !['counts', 'view', 'like'].includes(action)) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  if (await isRateLimited(env, ip)) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }

  const visitor = await hashVisitor(ip, slug);

  if (action === 'counts' && request.method === 'GET') {
    const [views, likes, liked] = await Promise.all([
      getCounter(env, `views:${slug}`),
      getCounter(env, `likes:${slug}`),
      env.joewline_reactions.get(`liked:${slug}:${visitor}`),
    ]);
    return jsonResponse({ views, likes, liked: Boolean(liked) });
  }

  if (action === 'view' && request.method === 'POST') {
    const seenKey = `seen:${slug}:${visitor}`;
    if (!(await env.joewline_reactions.get(seenKey))) {
      await bumpCounter(env, `views:${slug}`, 1);
      await env.joewline_reactions.put(seenKey, '1', { expirationTtl: 60 * 60 * 12 });
    }
    return jsonResponse({ views: await getCounter(env, `views:${slug}`) });
  }

  if (action === 'like' && request.method === 'POST') {
    const likedKey = `liked:${slug}:${visitor}`;
    const alreadyLiked = await env.joewline_reactions.get(likedKey);
    if (alreadyLiked) {
      await env.joewline_reactions.delete(likedKey);
      await bumpCounter(env, `likes:${slug}`, -1);
    } else {
      await env.joewline_reactions.put(likedKey, '1');
      await bumpCounter(env, `likes:${slug}`, 1);
    }
    return jsonResponse({ likes: await getCounter(env, `likes:${slug}`), liked: !alreadyLiked });
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405);
}

async function hashVisitor(ip, slug) {
  const data = new TextEncoder().encode(`joewline-reactions:${ip}:${slug}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getCounter(env, key) {
  const raw = await env.joewline_reactions.get(key);
  return raw ? parseInt(raw, 10) : 0;
}

async function bumpCounter(env, key, delta) {
  const next = Math.max(0, (await getCounter(env, key)) + delta);
  await env.joewline_reactions.put(key, String(next));
  return next;
}

async function isRateLimited(env, ip) {
  const key = `ratelimit:${ip}`;
  const current = await getCounter(env, key);
  if (current >= 60) return true;
  await env.joewline_reactions.put(key, String(current + 1), { expirationTtl: 60 });
  return false;
}
