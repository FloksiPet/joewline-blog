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
    const message = update.message;
    if (!message) return new Response('ok');

    const chatId = message.chat.id;

    try {
      let rawText = null;

      if (message.voice) {
        rawText = await transcribeVoice(message.voice.file_id, env);
      } else if (message.text) {
        rawText = message.text;
      }

      if (!rawText || !rawText.trim()) {
        await sendTelegram(env, chatId, 'Не побачив ні тексту, ні голосу — спробуй ще раз.');
        return new Response('ok');
      }

      const { path, title } = await createCaseFile(rawText, env);
      await sendTelegram(
        env,
        chatId,
        `Записав: "${title}"\n${path}\n\nЦе чернетка (status: draft) — допиши деталі й onови статус у файлі, коли буде готово.`
      );
    } catch (err) {
      await sendTelegram(env, chatId, `Щось пішло не так: ${err.message}`);
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

async function createCaseFile(rawText, env) {
  const firstLine = rawText.split('\n')[0].slice(0, 70).trim();
  const title = firstLine || 'Нова нотатка';
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const slug = slugify(`${isoDate}-${title}`);
  const path = `${env.CONTENT_PATH}/${slug}.md`;

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    `date: ${isoDate}`,
    'status: draft',
    'tags: []',
    'targets: [site]',
    'canonical: true',
    '---',
    '',
    '## Проблема',
    '',
    rawText.trim(),
    '',
    '## Хід розбору',
    '',
    '',
    '## Рішення',
    '',
    '',
  ].join('\n');

  await githubApi(env, 'PUT', `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`, {
    message: `note: ${title}`,
    content: base64Encode(frontmatter),
    branch: env.GITHUB_BRANCH,
  });

  return { path, title };
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

async function telegramApi(env, method, params) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return resp.json();
}

async function sendTelegram(env, chatId, text) {
  return telegramApi(env, 'sendMessage', { chat_id: chatId, text });
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
