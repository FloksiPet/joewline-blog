#!/usr/bin/env node
// Третій вхідний канал з ТЗ (розділ 4, Етап 1): "нотатка пишеться просто
// поруч із кодом" — без Telegram, без виходу з поточного проєкту. Формує
// той самий markdown-файл кейсу, що й Telegram-бот (bot/src/index.js —
// логіка тегів/slug/frontmatter навмисно продубльована звідти 1-в-1, щоб
// поведінка не розходилась між каналами), і комітить його напряму в
// репозиторій блогу через GitHub CLI (`gh api`), тому не потрібен окремий
// GITHUB_TOKEN — досить, щоб `gh auth status` вже показував логін.
//
// Не викликай напряму без потреби — зазвичай через tools/note.sh (той
// сам підхопить nvm/node, якщо node не в PATH) або через Claude Code
// skill tools/note-skill/SKILL.md.
//
// Використання:
//   note.mjs --title "..." [--kind thought|case] [--status draft|in-progress|done]
//            [--tags tag1,tag2] [--image /шлях/до/фото.jpg] [--body "текст"]
//   Якщо --body не задано — читає з stdin (зручно для heredoc).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const REPO_OWNER = 'floksipet';
const REPO_NAME = 'joewline-blog';
const BRANCH = 'main';
const CONTENT_PATH = 'site/src/content/cases';

function parseArgs(argv) {
  const args = { kind: 'thought', status: 'draft', tags: '', title: '', body: '', image: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--title') args.title = argv[++i];
    else if (key === '--kind') args.kind = argv[++i];
    else if (key === '--status') args.status = argv[++i];
    else if (key === '--tags') args.tags = argv[++i];
    else if (key === '--body') args.body = argv[++i];
    else if (key === '--image') args.image = argv[++i];
    else if (key === '-h' || key === '--help') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Невідомий аргумент: ${key}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(
    'note.mjs --title "..." [--kind thought|case] [--status draft|in-progress|done] ' +
      '[--tags tag1,tag2] [--image /шлях/до/фото.jpg] [--body "текст"]\n' +
      'Без --body читає текст зі stdin.'
  );
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Ідентично bot/src/index.js: extractTags / stripTags.
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

// Ідентично bot/src/index.js: slugify.
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function mimeExtension(filePath) {
  const ext = extname(filePath).toLowerCase().replace('.', '');
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  return 'jpg';
}

function ghApiPut(path, body) {
  const output = execFileSync('gh', ['api', '--method', 'PUT', path, '--input', '-'], {
    input: JSON.stringify(body),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
  return JSON.parse(output);
}

function uploadImage(localPath) {
  const buffer = readFileSync(localPath);
  const ext = mimeExtension(localPath);
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
  const repoPath = `site/public/uploads/cli/${fileName}`;

  ghApiPut(`repos/${REPO_OWNER}/${REPO_NAME}/contents/${repoPath}`, {
    message: `upload: ${fileName}`,
    content: buffer.toString('base64'),
    branch: BRANCH,
  });

  return `/uploads/cli/${fileName}`;
}

function buildBody(rawText, imagePath) {
  let body = rawText.trim();
  if (imagePath) {
    const imageMarkdown = `![Вкладення](${imagePath})`;
    body = body ? `${body}\n\n${imageMarkdown}` : imageMarkdown;
  }
  return body;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawBody = args.body || readStdin();

  if (!rawBody.trim() && !args.image) {
    throw new Error('Немає ні тексту, ні фото — нічого зберігати.');
  }
  if (!['thought', 'case'].includes(args.kind)) {
    throw new Error('--kind має бути thought або case');
  }
  if (!['draft', 'in-progress', 'done'].includes(args.status)) {
    throw new Error('--status має бути draft, in-progress або done');
  }

  const explicitTags = args.tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const inlineTags = extractTags(rawBody);
  const tags = [...new Set([...explicitTags, ...inlineTags])];
  const textWithoutTags = stripTags(rawBody);

  const imagePath = args.image ? uploadImage(args.image) : null;
  const body = buildBody(textWithoutTags, imagePath);

  const title = (args.title || body.split('\n')[0].slice(0, 70).trim() || 'Нова нотатка').trim();
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const isoDateTime = now.toISOString();
  const slug = slugify(`${isoDate}-${title}`);
  const path = `${CONTENT_PATH}/${slug}.md`;

  const block =
    args.kind === 'case'
      ? ['## Проблема', '', body.trim(), '', '## Хід розбору', '', '', '## Рішення', '', ''].join('\n')
      : body.trim();

  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    `date: ${isoDateTime}`,
    `status: ${args.status}`,
    `kind: ${args.kind}`,
    `tags: [${tags.join(', ')}]`,
    'targets: [site]',
    'canonical: true',
    '---',
    '',
    block,
  ].join('\n');

  ghApiPut(`repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    message: `note: ${title}`,
    content: Buffer.from(frontmatter, 'utf8').toString('base64'),
    branch: BRANCH,
  });

  console.log(`Збережено: "${title}"`);
  console.log(path);
  if (tags.length > 0) console.log(`Теги: ${tags.map((t) => `#${t}`).join(' ')}`);
  console.log('Сайт перезбереться сам за 30-60с (GitHub Actions) після цього коміту.');
}

main();
