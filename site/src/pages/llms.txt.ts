import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { sortEntries, excerpt, plainTextLength } from '../lib/entries';

export const prerender = true;

// llms.txt — неофіційний, але дедалі поширеніший еквівалент sitemap.xml
// для AI-агентів/пошукових LLM: короткий, чистий текстовий покажчик
// вартого уваги контенту, без верстки й навігаційного шуму. Генерується
// build-time з тих самих записів, що й сайт, — тож завжди відповідає
// поточному стану, а не окремим файлом, який хтось забуде оновити.
const INDEXABLE_MIN_LENGTH = 400;

export const GET: APIRoute = async ({ site }) => {
  const entries = sortEntries(await getCollection('cases'));
  const substantial = entries.filter((entry) => plainTextLength(entry.body) >= INDEXABLE_MIN_LENGTH);

  const lines = [
    '# joewline',
    '',
    '> Особистий блог-стрічка: нотатки, роздуми та кейси про мікроконтролери, іграшки на залізі й автоматизацію через ШІ. Ведеться українською.',
    '',
    '## Статті',
    '',
  ];

  if (substantial.length === 0) {
    lines.push('(поки що немає записів, вартих окремого індексування)');
  } else {
    for (const entry of substantial) {
      const url = new URL(`${import.meta.env.BASE_URL}${entry.slug}/`, site).href;
      lines.push(`- [${entry.data.title}](${url}): ${excerpt(entry.body, 140)}`);
    }
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
