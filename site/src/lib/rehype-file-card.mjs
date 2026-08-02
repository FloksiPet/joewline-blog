// Бот вставляє нетекстові вкладення (усе, крім фото й .md/.txt, які йдуть
// прямо в текст) звичайним markdown-посиланням з розміром у title:
//   [Назва файлу.pdf](/uploads/telegram/167213-abcd1234.pdf "2.4 МБ")
// Це залишається робочим посиланням, навіть якщо цей плагін колись
// зламається — деградує до звичайного `<a>`, файл усе одно скачається.
// Тут такий параграф-з-єдиним-посиланням підмінюється на картку з
// іконкою-розширенням, назвою, розміром і кнопкою "скачати" — той самий
// підхід, що й rehype-gallery.mjs для фото (шукаємо параграф, що містить
// рівно один потрібний елемент).
//
// Розширення тут навмисно НЕ фільтруються за "це ж картинка" — фото від
// бота завжди йдуть через `![]()` і рендеряться як `<img>`, до цього коду
// взагалі не доходячи. Якщо хтось надішле картинку саме як документ (не
// стиснене фото), вона теж має стати нормальною карткою для скачування,
// а не голим неоформленим посиланням.
const UPLOAD_PREFIX = '/uploads/';

export function rehypeFileCard() {
  return function transformer(tree) {
    walk(tree);
  };

  function walk(node) {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type === 'element' && child.tagName === 'p') {
        const link = onlyChildLink(child);
        if (link) return buildFileCard(link);
      }
      walk(child);
      return child;
    });
  }

  function onlyChildLink(paragraph) {
    const meaningful = paragraph.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
    if (meaningful.length !== 1) return null;
    const [node] = meaningful;
    if (node.type !== 'element' || node.tagName !== 'a') return null;
    const href = node.properties?.href;
    if (typeof href !== 'string' || !href.startsWith(UPLOAD_PREFIX)) return null;
    return node;
  }

  function extOf(href) {
    const match = href.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function buildFileCard(link) {
    const href = link.properties.href;
    const size = link.properties.title || '';
    const ext = extOf(href) || 'файл';
    const label = (link.children[0] && link.children[0].value) || href.split('/').pop();

    const infoChildren = [
      { type: 'element', tagName: 'span', properties: { className: ['file-card-name'] }, children: [{ type: 'text', value: label }] },
    ];
    if (size) {
      infoChildren.push({ type: 'element', tagName: 'span', properties: { className: ['file-card-size'] }, children: [{ type: 'text', value: size }] });
    }

    return {
      type: 'element',
      tagName: 'a',
      // download — реальний шлях у репозиторії (`/uploads/telegram/<хеш>.ext`)
      // так лишається прихованим за людською назвою файла, так само як фото
      // ховаються за alt-текстом "Вкладення".
      properties: { className: ['file-card'], href, download: label },
      children: [
        { type: 'element', tagName: 'span', properties: { className: ['file-card-ext'] }, children: [{ type: 'text', value: ext }] },
        { type: 'element', tagName: 'span', properties: { className: ['file-card-info'] }, children: infoChildren },
        { type: 'element', tagName: 'span', properties: { className: ['file-card-download'], ariaHidden: 'true' }, children: [{ type: 'text', value: '⬇' }] },
      ],
    };
  }
}
