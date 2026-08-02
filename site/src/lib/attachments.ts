import type { CollectionEntry } from 'astro:content';

export type AttachmentCategory = 'image' | 'document' | 'archive' | 'audio' | 'video' | 'other';

export interface Attachment {
  href: string;
  label: string;
  ext: string;
  size: string | null;
  category: AttachmentCategory;
  postSlug: string;
  postTitle: string;
  postDate: Date;
  tags: string[];
}

// Розширення → категорія. Список навмисно невеликий: покриває те, що бот
// (`handleDocument` у bot/src/index.js) реально може прислати, а не всі
// можливі MIME-типи в природі.
const CATEGORY_BY_EXT: Record<string, AttachmentCategory> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document', csv: 'document',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video',
};

export const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  image: 'Зображення',
  document: 'Документи',
  archive: 'Архіви',
  audio: 'Аудіо',
  video: 'Відео',
  other: 'Інше',
};

export const CATEGORY_ORDER: AttachmentCategory[] = ['image', 'document', 'archive', 'audio', 'video', 'other'];

function extOf(href: string): string {
  const clean = href.split(/[?#]/)[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function categoryOf(ext: string): AttachmentCategory {
  return CATEGORY_BY_EXT[ext] ?? 'other';
}

interface RawAttachment {
  href: string;
  label: string;
  size: string | null;
}

// Вкладення в тілі допису бувають двох форм: фото — `![alt](src)`
// (uploadPhotoToGitHub), і файли — `[назва](src "розмір")` (handleDocument)
// з опційним розміром у markdown title. Обидва — завжди корене-відносний
// шлях під `/uploads/...`.
function extractAttachments(body: string): RawAttachment[] {
  const results: RawAttachment[] = [];

  for (const match of body.matchAll(/!\[([^\]]*)\]\((\/uploads\/[^)\s]+)\)/g)) {
    const href = match[2];
    const alt = match[1];
    // Бот завжди підписує фото як "Вкладення" — це не справжня назва
    // файла, показувати її як таку сенсу нема.
    results.push({ href, label: alt && alt !== 'Вкладення' ? alt : 'Фото', size: null });
  }

  for (const match of body.matchAll(/(?<!!)\[([^\]]*)\]\((\/uploads\/[^)\s]+)(?:\s+"([^"]*)")?\)/g)) {
    const href = match[2];
    const label = match[1] || href.split('/').pop() || href;
    results.push({ href, label, size: match[3] ?? null });
  }

  return results;
}

// Збирає всі вкладення з усіх дописів для сторінки /files/ — кожне несе
// контекст свого допису (дата, теги, посилання назад), щоб на сторінці
// вкладень можна було фільтрувати/сортувати за тегом, як і за датою.
export function collectAttachments(entries: CollectionEntry<'cases'>[]): Attachment[] {
  const all: Attachment[] = [];

  for (const entry of entries) {
    for (const item of extractAttachments(entry.body)) {
      const ext = extOf(item.href);
      all.push({
        href: item.href,
        label: item.label,
        ext,
        size: item.size,
        category: categoryOf(ext),
        postSlug: entry.slug,
        postTitle: entry.data.title,
        postDate: entry.data.date,
        tags: entry.data.tags,
      });
    }
  }

  return all.sort((a, b) => b.postDate.valueOf() - a.postDate.valueOf());
}
