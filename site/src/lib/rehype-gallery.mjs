// Коли в одному повідомленні Telegram кілька фото (альбом), бот вставляє
// їх у markdown підряд, кожне окремим рядком `![Вкладення](...)`. Кожне
// таке зображення рендериться remark-ом як окремий <p><img></p>. Цей
// rehype-плагін знаходить такі йдучі підряд "параграфи з самим лише фото"
// і склеює їх в один блок каруселі — замість купи великих картинок одна
// за одною.
export function rehypeGallery() {
  return function transformer(tree) {
    process(tree);
  };

  function process(node) {
    if (node.children) {
      node.children = groupImages(node.children);
      node.children.forEach(process);
    }
  }

  function isImageParagraph(node) {
    if (node.type !== 'element' || node.tagName !== 'p') return false;
    const meaningful = node.children.filter((child) => !(child.type === 'text' && !child.value.trim()));
    return meaningful.length === 1 && meaningful[0].type === 'element' && meaningful[0].tagName === 'img';
  }

  function isWhitespace(node) {
    return node.type === 'text' && !node.value.trim();
  }

  function groupImages(children) {
    const result = [];
    let run = [];

    const flush = () => {
      if (run.length === 0) return;
      if (run.length === 1) {
        result.push(run[0]);
      } else {
        result.push(buildCarousel(run));
      }
      run = [];
    };

    children.forEach((child) => {
      if (isImageParagraph(child)) {
        run.push(child);
      } else if (isWhitespace(child)) {
        // пробіли/переноси рядків між блоками — ігноруємо, вони не мають
        // розривати серію фото, що йдуть підряд
      } else {
        flush();
        result.push(child);
      }
    });
    flush();

    return result;
  }

  function buildCarousel(paragraphs) {
    const images = paragraphs.map((p) => p.children.find((c) => c.type === 'element' && c.tagName === 'img'));

    return {
      type: 'element',
      tagName: 'div',
      properties: { className: ['carousel'] },
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['carousel-track'] },
          children: images.map((img) => ({
            type: 'element',
            tagName: 'div',
            properties: { className: ['carousel-slide'] },
            children: [img],
          })),
        },
        {
          type: 'element',
          tagName: 'button',
          properties: { type: 'button', className: ['carousel-prev'], ariaLabel: 'Попереднє фото' },
          children: [{ type: 'text', value: '‹' }],
        },
        {
          type: 'element',
          tagName: 'button',
          properties: { type: 'button', className: ['carousel-next'], ariaLabel: 'Наступне фото' },
          children: [{ type: 'text', value: '›' }],
        },
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['carousel-dots'] },
          children: images.map(() => ({
            type: 'element',
            tagName: 'button',
            properties: { type: 'button', className: ['carousel-dot'] },
            children: [],
          })),
        },
      ],
    };
  }
}
