/**
 * Telegram → GitHub intake bot.
 *
 * Що робить:
 *  1. Приймає webhook від Telegram (голосове або текстове повідомлення).
 *  2. Якщо голос — розшифровує через Workers AI (Whisper), без зовнішніх ключів.
 *  3. Формує markdown-файл кейсу з правильним frontmatter (status: draft).
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
 *   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, CONTENT_PATH
 */

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
      await sendMenu(env, chatId, 'Режим: думка. Пиши текст або фото. Коли закінчиш — натисни кнопку «Зберегти» або надішли /done.');
      return new Response('ok');
    }

    if (text === 'Створити кейс') {
      await setDraftMode(env, chatId, 'case');
      await sendMenu(env, chatId, 'Режим: кейс. Пиши проблему, хід розбору й рішення. Коли закінчиш — натисни кнопку «Зберегти» або надішли /done.');
      return new Response('ok');
    }

    if (text === 'Зберегти') {
      await finishDraft(env, chatId);
      return new Response('ok');
    }

    if (text === 'Допомога') {
      await sendMenu(env, chatId, 'Команди:\n/help — підказка\n/done — зберегти чернетку\n#case — створити кейс\nПросто пиши текст, додавай фото і продовжуй.');
      return new Response('ok');
    }

    if (text.startsWith('/')) {
      if (text === '/start') {
        await sendMenu(env, chatId, 'Оберіть режим для нової записи.');
        return new Response('ok');
      }

      if (text === '/done') {
        await finishDraft(env, chatId);
        return new Response('ok');
      }

      if (text === '/help') {
        await sendTelegram(
          env,
          chatId,
          'Команди:\n/help — підказка\n/done — зберегти чернетку\n#case — створити кейс\nПросто пиши текст, додавай фото і продовжуй.',
          getMainKeyboard()
        );
        return new Response('ok');
      }

      await sendTelegram(
        env,
        chatId,
        'Пиши думку послідовно: текст, фото, текст, фото. Коли закінчиш — надішли /done або натисни кнопку зберегти. Якщо хочеш створити готовий кейс, почни повідомлення з #case.',
        getMainKeyboard()
      );
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
        await sendTelegram(env, chatId, 'Не побачив ні тексту, ні голосу, ні фото з підписом — спробуй ще раз.', getMainKeyboard());
        return new Response('ok');
      }

      await setDraftMode(env, chatId, kind);
      await appendToDraft(env, chatId, rawText, imageDataUrl, kind);
      await sendTelegram(
        env,
        chatId,
        `Додано до чернетки. Пиши далі або натисни кнопку «Зберегти».`,
        getMainKeyboard()
      );
    } catch (err) {
      await sendTelegram(env, chatId, `Щось пішло не так: ${err.message}`, getMainKeyboard());
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

async function finishDraft(env, chatId) {
  const key = `draft:${chatId}`;
  const draftText = await getDraft(env, key);
  if (!draftText || !draftText.trim()) {
    await sendTelegram(env, chatId, 'Чернетка пуста — нічого не зберігав.');
    return;
  }

  const mode = (await getDraftMode(env, chatId)) || 'thought';
  const normalized = draftText.replace(/^(#case|case:)\s*/i, '').trim();
  const { path, title } = await createCaseFile(normalized, env, { kind: mode });
  await env.joewline_bot_drafts.delete(key);
  await env.joewline_bot_drafts.delete(`mode:${chatId}`);
  await sendTelegram(env, chatId, `Збережено: "${title}"\n${path}`);
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

async function createCaseFile(rawText, env, options = {}) {
  const { kind = 'thought', imageDataUrl = null } = options;
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
    'status: draft',
    `kind: ${kind}`,
    'tags: []',
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
    ],
  });

  await telegramApi(env, 'setChatMenuButton', {
    chat_id: chatId,
    menu_button: { type: 'commands' },
  });

  return sendTelegram(env, chatId, text, getMainKeyboard());
}

function getMainKeyboard() {
  return {
    keyboard: [
      [{ text: 'Створити думку' }, { text: 'Створити кейс' }],
      [{ text: 'Зберегти' }, { text: 'Допомога' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

async function handleCallback(env, chatId, data) {
  if (data === 'create_thought') {
    await setDraftMode(env, chatId, 'thought');
    await sendTelegram(env, chatId, 'Режим: думка. Пиши текст або фото. Коли закінчиш — натисни «Зберегти» або надішли /done.', getMainKeyboard());
  } else if (data === 'create_case') {
    await setDraftMode(env, chatId, 'case');
    await sendTelegram(env, chatId, 'Режим: кейс. Пиши проблему, хід розбору й рішення. Коли закінчиш — натисни «Зберегти» або надішли /done.', getMainKeyboard());
  } else if (data === 'save_draft') {
    await finishDraft(env, chatId);
  } else if (data === 'help') {
    await sendTelegram(env, chatId, 'Команди:\n/help — підказка\n/done — зберегти чернетку\n#case — створити кейс\nПросто пиши текст, додавай фото і продовжуй.', getMainKeyboard());
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
