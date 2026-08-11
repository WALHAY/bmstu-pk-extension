// ==================== ПОИСК СТАТУСА ВЕЗДЕ ====================
function findTextInDocument(doc, text) {
  const xpath = `//*[contains(text(),'${text}')]`;
  let result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  let node = result.singleNodeValue;
  if (node) return node;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null, false);
  let current = walker.currentNode;
  while (current) {
    if (!['SCRIPT','STYLE','META','LINK','HEAD'].includes(current.tagName)) {
      if (current.textContent.includes(text)) {
        return current;
      }
    }
    current = walker.nextNode();
  }

  const allElements = doc.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      const found = findTextInDocument(el.shadowRoot, text);
      if (found) return found;
    }
  }

  const iframes = doc.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const found = findTextInDocument(iframeDoc, text);
        if (found) return found;
      }
    } catch (e) { /* игнорируем cross-origin */ }
  }
  return null;
}

function extractCallStatus() {
  let el = findTextInDocument(document, 'Соединено');
  if (el) {
    console.log('[Muter] Найдено "Соединено" в элементе:', el);
    return 'connected';
  }
  el = findTextInDocument(document, 'Ожидание');
  if (el) {
    console.log('[Muter] Найдено "Ожидание" в элементе:', el);
    return 'waiting';
  }
  // Если ничего не найдено — звонок завершён
  console.log('[Muter] Статус не найден (вероятно, звонок завершён)');
  return null;
}

// ==================== УВЕДОМЛЕНИЕ ====================
function showNotification(show) {
  const id = 'yandex-music-muter-notification';
  let el = document.getElementById(id);
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4d4d;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 16px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        transition: opacity 0.3s;
        opacity: 1;
        pointer-events: none;
      `;
      el.textContent = '🔇 Яндекс Музыка заглушена';
      document.body.appendChild(el);
    } else {
      el.style.opacity = '1';
      el.style.display = 'block';
    }
  } else {
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 300);
    }
  }
}

// ==================== ОТПРАВКА СТАТУСА ====================
let previousStatus = null;

function reportStatus() {
  const status = extractCallStatus();
  console.log('[Muter] Текущий статус:', status);

  // Если статус изменился (включая null → завершён)
  if (status !== previousStatus) {
    previousStatus = status;
    // Отправляем статус: если null, отправляем 'disconnected' (что приведёт к размуту)
    const sendStatus = status || 'disconnected';
    chrome.runtime.sendMessage({ type: 'callStatus', status: sendStatus }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Muter] Ошибка отправки:', chrome.runtime.lastError.message);
      } else {
        console.log('[Muter] Ответ от background:', response);
      }
    });
    // Уведомление показываем только при 'connected'
    showNotification(status === 'connected');
  }
}

// ==================== НАБЛЮДЕНИЕ ====================
function observeStatusChanges() {
  const targetNode = document.body;
  if (!targetNode) {
    setTimeout(observeStatusChanges, 500);
    return;
  }
  const config = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: false
  };
  const observer = new MutationObserver(() => {
    reportStatus();
  });
  observer.observe(targetNode, config);
  console.log('[Muter] MutationObserver запущен');
}

// Периодическая проверка (каждые 2 секунды)
function startPeriodicCheck() {
  setInterval(() => {
    reportStatus();
  }, 2000);
  console.log('[Muter] Периодическая проверка запущена (каждые 2 секунды)');
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
function init() {
  console.log('[Muter] Content script загружен на:', window.location.href);
  reportStatus();
  observeStatusChanges();
  startPeriodicCheck();
}

if (document.readyState === 'complete') {
  init();
} else {
  window.addEventListener('load', init);
}
