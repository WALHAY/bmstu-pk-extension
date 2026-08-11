async function setYandexMusicMuted(muted) {
  const tabs = await chrome.tabs.query({
    url: [
      "https://music.yandex.ru/*",
      "https://yandex.ru/music/*"
    ]
  });
  for (const tab of tabs) {
    try {
      await chrome.tabs.update(tab.id, { muted });
      console.log(`[Muter BG] Вкладка ${tab.id} ${muted ? 'заглушена' : 'разглушена'}`);
    } catch (e) {
      console.warn('[Muter BG] Ошибка мьюта:', e);
    }
  }
}

let lastStatus = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'callStatus') {
    const newStatus = message.status; // 'waiting', 'connected', или 'disconnected'
    console.log('[Muter BG] Получен статус:', newStatus);
    // Если статус 'connected' — мутим, иначе размучиваем
    if (newStatus === 'connected') {
      setYandexMusicMuted(true);
    } else {
      setYandexMusicMuted(false);
    }
    lastStatus = newStatus;
    sendResponse({ received: true, status: newStatus });
  }
  return true;
});
