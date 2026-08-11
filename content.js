// ========== ПОИСК СТАТУСА ==========
function findTextInDocument(doc, text) {
  // XPath
  const xpath = `//*[contains(text(),'${text}')]`;
  let result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
  let node = result.singleNodeValue;
  if (node) return node;

  // Обход всех элементов
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null, false);
  let current = walker.currentNode;
  while (current) {
    if (!['SCRIPT','STYLE','META','LINK','HEAD'].includes(current.tagName)) {
      if (current.textContent.includes(text)) return current;
    }
    current = walker.nextNode();
  }

  // Shadow DOM и iframe (рекурсивно)
  const all = doc.querySelectorAll('*');
  for (const el of all) {
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
    } catch (e) { /* cross-origin */ }
  }
  return null;
}

function extractCallStatus() {
  if (findTextInDocument(document, 'Соединено')) return 'connected';
  if (findTextInDocument(document, 'Ожидание')) return 'waiting';
  return null; // звонка нет или завершён
}

// ========== УВЕДОМЛЕНИЕ ==========
function showNotification(show) {
  const id = 'bmstu-call-notification';
  let el = document.getElementById(id);
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: #ff4d4d; color: white;
        padding: 12px 20px; border-radius: 8px;
        font-family: Arial, sans-serif; font-size: 16px; font-weight: bold;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999; transition: opacity 0.3s; opacity: 1;
        pointer-events: none;
      `;
      el.textContent = '🔇 Яндекс Музыка заглушена';
      document.body.appendChild(el);
    } else {
      el.style.opacity = '1'; el.style.display = 'block';
    }
  } else {
    if (el) { el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 300); }
  }
}

// ========== ОТПРАВКА СТАТУСА ==========
let previousStatus = null;

function reportStatus() {
  const status = extractCallStatus();
  console.log('[Content] Статус:', status);
  if (status !== previousStatus) {
    previousStatus = status;
    const sendStatus = status || 'disconnected';
    chrome.runtime.sendMessage({ type: 'callStatus', status: sendStatus }, (response) => {
      if (chrome.runtime.lastError) console.warn('[Content] Ошибка:', chrome.runtime.lastError.message);
    });
    showNotification(status === 'connected');
  }
}

// ========== НАБЛЮДЕНИЕ ==========
function observe() {
  const observer = new MutationObserver(() => reportStatus());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  console.log('[Content] Наблюдение запущено');
}

// ========== ЗАПУСК ==========
function init() {
  console.log('[Content] Скрипт загружен на', location.href);
  reportStatus();
  observe();
  setInterval(reportStatus, 2000); // страховка
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);
