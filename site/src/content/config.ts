import { defineCollection, z } from 'astro:content';

// Ця схема — це і є контракт із розділу 3 ТЗ. Якщо файл кейсу не
// відповідає їй (наприклад, неправильний status), білд впаде з чіткою
// помилкою одразу, а не мовчки зламає сайт.
const cases = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    status: z.enum(['draft', 'in-progress', 'done']).default('draft'),
    kind: z.enum(['thought', 'case']).default('thought'),
    tags: z.array(z.string()).default([]),
    // куди цей файл потенційно годиться для крос-посту (сайт — завжди)
    targets: z.array(z.enum(['site', 'dou', 'drukarnia'])).default(['site']),
    canonical: z.boolean().default(true),
  }),
});

export const collections = { cases };
