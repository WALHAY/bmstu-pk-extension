// Управление Яндекс Музыкой
async function setYandexMusicMuted(muted) {
  const tabs = await chrome.tabs.query({
    url: ["https://music.yandex.ru/*", "https://yandex.ru/music/*"]
  });
  for (const tab of tabs) {
    try {
      await chrome.tabs.update(tab.id, { muted });
      console.log(`[BG] Музыка: вкладка ${tab.id} ${muted ? 'заглушена' : 'разглушена'}`);
    } catch (e) { /* ignore */ }
  }
}

// Управление вкладкой звонка
async function setCallTabMuted(tabId, muted) {
  try {
    await chrome.tabs.update(tabId, { muted });
    console.log(`[BG] Вкладка звонка ${tabId} ${muted ? 'заглушена' : 'разглушена'}`);
  } catch (e) { /* ignore */ }
}

// === УВЕДОМЛЕНИЕ ТОЛЬКО ПРИ СОЕДИНЕНИИ ===
let notificationId = null;

function showConnectedNotification() {
  // Удаляем предыдущее уведомление, если есть
  if (notificationId) {
    chrome.notifications.clear(notificationId);
    notificationId = null;
  }

  // Создаём новое уведомление о соединении
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: '✅ Звонок соединён',
    message: 'Яндекс Музыка заглушена, вкладка звонка разглушена.',
    priority: 2,
    requireInteraction: true // остаётся до ручного закрытия
  }, (id) => {
    notificationId = id;
    console.log('[BG] Уведомление о соединении показано, ID:', id);
  });
}

let lastStatus = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callStatus') {
    const status = message.status; // 'waiting', 'connected', 'disconnected'
    console.log('[BG] Статус:', status);

    // === Логика мьютов ===
    if (status === 'waiting') {
      setCallTabMuted(sender.tab.id, true);
      setYandexMusicMuted(false);
    } else if (status === 'connected') {
      setCallTabMuted(sender.tab.id, false);
      setYandexMusicMuted(true);
    } else { // disconnected или null
      setCallTabMuted(sender.tab.id, false);
      setYandexMusicMuted(false);
    }

    // === Уведомление ТОЛЬКО при переходе в 'connected' ===
    if (status === 'connected' && lastStatus !== 'connected') {
      showConnectedNotification();
    }

    lastStatus = status;
    sendResponse({ received: true });
  }
  return true;
});

// При старте расширения чистим возможные старые уведомления
chrome.runtime.onStartup.addListener(() => {
  if (notificationId) chrome.notifications.clear(notificationId);
});
