// Управление мьютом Яндекс Музыки
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

// Управление мьютом вкладки звонка
async function setCallTabMuted(tabId, muted) {
  try {
    await chrome.tabs.update(tabId, { muted });
    console.log(`[BG] Вкладка звонка ${tabId} ${muted ? 'заглушена' : 'разглушена'}`);
  } catch (e) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callStatus') {
    const status = message.status; // 'waiting', 'connected', 'disconnected'
    console.log('[BG] Статус:', status);

    // Логика:
    // - Ожидание: глушим звонок, музыку не трогаем
    // - Соединено: разглушаем звонок, глушим музыку
    // - Завершён: разглушаем и звонок, и музыку

    if (status === 'waiting') {
      setCallTabMuted(sender.tab.id, true);
      setYandexMusicMuted(false); // музыка играет
    } else if (status === 'connected') {
      setCallTabMuted(sender.tab.id, false);
      setYandexMusicMuted(true); // музыка заглушена
    } else { // disconnected или null
      setCallTabMuted(sender.tab.id, false);
      setYandexMusicMuted(false);
    }

    sendResponse({ received: true });
  }
  return true;
});
