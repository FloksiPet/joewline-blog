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
 *   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, CONTENT_PATH, SITE_URL
 *
 * ВАЖЛИВО: зміни в цьому файлі не діють на живого бота, доки не виконаєш
 *   cd bot && npx wrangler deploy
 * Пуш у GitHub перезбирає лише сайт (site/), не бота — для бота автодеплою
 * поки немає.
 */

const HELP_TEXT = [
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
].join('\n');

const START_TEXT = 'Привіт! Я перетворюю твої повідомлення на записи в блозі. Обери режим кнопкою нижче або напиши /help, щоб побачити, як усе працює (роздуми/нотатка/стаття, теги).';

function modeText(mode) {
  return mode === 'case'
    ? 'Режим: кейс. Пиши проблему, хід розбору й рішення. Теги — просто #тег у тексті. Коли закінчиш: «Зберегти» (чернетка) або «Опублікувати як статтю» (готово).'
    : 'Режим: думка. Пиши текст і/або фото. Теги — просто #тег у тексті. Коли закінчиш — «Зберегти» або /done.';
}

export default {
  async fetch(request, env) {
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
      await sendMenu(env, chatId, HELP_TEXT);
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
        await sendTelegram(env, chatId, HELP_TEXT, getMainKeyboard(env));
        return new Response('ok');
      }

      await sendTelegram(env, chatId, HELP_TEXT, getMainKeyboard(env));
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
        rawText = message.caption || message.text || '';
      } else if (text) {
        rawText = text;
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
  const { path, title } = await createCaseFile(withoutTags, env, { kind: mode, status, tags });
  await env.joewline_bot_drafts.delete(key);
  await env.joewline_bot_drafts.delete(`mode:${chatId}`);

  const tagsNote = tags.length > 0 ? `\nТеги: ${tags.map((t) => `#${t}`).join(' ')}` : '';
  const statusNote = status === 'done' ? ' (стаття)' : '';
  await sendTelegram(env, chatId, `Збережено${statusNote}: "${title}"\n${path}${tagsNote}`, getMainKeyboard(env));
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
  const firstLine = rawText.split('\n')[0].slice(0, 70).trim();
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

  return { path, title };
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
    await sendTelegram(env, chatId, HELP_TEXT, getMainKeyboard(env));
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
