// Контент-колекції Astro не підставляють `base` у корене-відносні шляхи
// зображень (`/uploads/...`), тому на GitHub Pages (сайт живе в підпапці
// /joewline-blog/) такі фото не завантажувались — браузер шукав їх у
// /uploads/... замість /joewline-blog/uploads/....
// Цей rehype-плагін проходить по вже зрендеренному HTML-дереву кожного
// markdown-файлу й дописує base до src, якщо він ще не підставлений.
export function rehypeBaseUrl(base) {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;

  return function transformer(tree) {
    walk(tree);
  };

  function walk(node) {
    if (node.type === 'element' && node.tagName === 'img') {
      const src = node.properties?.src;
      if (typeof src === 'string' && isRootRelative(src) && !alreadyPrefixed(src)) {
        node.properties.src = `${prefix}${src}`;
      }
    }
    if (node.children) {
      node.children.forEach(walk);
    }
  }

  function isRootRelative(src) {
    return src.startsWith('/') && !src.startsWith('//');
  }

  function alreadyPrefixed(src) {
    return prefix !== '' && (src === prefix || src.startsWith(`${prefix}/`));
  }
}
