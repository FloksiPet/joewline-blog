// Контент-колекції Astro не підставляють `base` у корене-відносні шляхи
// вкладень (`/uploads/...`), тому на GitHub Pages (сайт живе в підпапці
// /joewline-blog/) такі фото й файли не завантажувались — браузер шукав їх
// у /uploads/... замість /joewline-blog/uploads/....
// Цей rehype-плагін проходить по вже зрендеренному HTML-дереву кожного
// markdown-файлу й дописує base до src/href, якщо він ще не підставлений.
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
      // Фото вантажаться лише коли доскролив до них — картинок у стрічці
      // може бути багато, і без цього браузер тягнув би все одразу.
      node.properties.loading = 'lazy';
      node.properties.decoding = 'async';
    }
    // Картки файлів (rehype-file-card.mjs) — теж `/uploads/...`, той самий
    // фікс потрібен і для їхнього href, інакше кнопка "скачати" веде повз
    // підпапку сайту на GitHub Pages. Звужено саме до `/uploads/`, а не
    // до будь-якого корене-відносного href — щоб випадково не переписати
    // майбутні ручні внутрішні посилання в тексті допису.
    if (node.type === 'element' && node.tagName === 'a') {
      const href = node.properties?.href;
      if (typeof href === 'string' && href.startsWith('/uploads/') && !alreadyPrefixed(href)) {
        node.properties.href = `${prefix}${href}`;
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
