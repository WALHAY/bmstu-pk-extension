// ==========================================
// BACKGROUND SERVICE WORKER
// ==========================================

console.log('[BG] Service worker запущен');

let lastStatus = null;
let notificationId = null;
let injectedTabs = new Set();

// ==========================================
// УПРАВЛЕНИЕ МЬЮТОМ
// ==========================================

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

async function setCallTabMuted(tabId, muted) {
  try {
    await chrome.tabs.update(tabId, { muted });
    console.log(`[BG] Вкладка звонка ${tabId} ${muted ? 'заглушена' : 'разглушена'}`);
  } catch (e) { /* ignore */ }
}

// ==========================================
// УВЕДОМЛЕНИЕ
// ==========================================

function showConnectedNotification() {
  if (notificationId) {
    chrome.notifications.clear(notificationId);
    notificationId = null;
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: '✅ Звонок соединён',
    message: 'Яндекс Музыка заглушена, вкладка звонка разглушена.',
    priority: 2,
    requireInteraction: true
  }, (id) => {
    notificationId = id;
    console.log('[BG] Уведомление показано');
  });
}

// ==========================================
// ОБРАБОТКА СТАТУСА
// ==========================================

function handleStatus(status, tabId) {
  console.log('[BG] Обработка статуса:', status, 'tabId:', tabId);

  if (!tabId) {
    console.warn('[BG] Нет tabId для обработки статуса');
    return;
  }

  if (status === 'waiting') {
    setCallTabMuted(tabId, true);
    setYandexMusicMuted(false);
  } else if (status === 'connected') {
    setCallTabMuted(tabId, false);
    setYandexMusicMuted(true);
  } else { // disconnected или idle
    setCallTabMuted(tabId, false);
    setYandexMusicMuted(false);
  }

  if (status === 'connected' && lastStatus !== 'connected') {
    showConnectedNotification();
  }

  lastStatus = status;
}

// ==========================================
// ВНЕДРЕНИЕ СКРИПТА ДЛЯ ОТСЛЕЖИВАНИЯ СТАТУСА
// ==========================================

function injectStatusWatcher(tabId) {
  if (injectedTabs.has(tabId)) {
    console.log('[BG] Вкладка уже содержит watcher, пропускаем');
    return;
  }

  console.log('[BG] Внедрение watcher в вкладку', tabId);

  // 1. Внедряем content script для приёма сообщений
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      console.log('[Content] Content script внедрён');

      // Слушаем сообщения от страницы
      window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'FROM_PAGE') {
          console.log('[Content] Получен статус из страницы:', event.data.status);
          chrome.runtime.sendMessage({
            type: 'callStatus',
            status: event.data.status
          }).catch(err => {
            console.warn('[Content] Ошибка отправки в background:', err);
          });
        }
      });
    }
  }).then(() => {
    // 2. После внедрения content script, внедряем page script
    const watcherFunction = function() {
      console.log('[Page] Watcher внедрён');

      let scope = null;
      let lastStatus = null;
      let watchRegistered = false;
      let isWaitingForScope = false;

      function sendStatus(status) {
        console.log('[Page] Отправка статуса:', status);
        window.postMessage({
          type: 'FROM_PAGE',
          status: status
        }, '*');
      }

      function getStatus() {
        if (!scope || !scope.call) return null;
        const state = scope.call.state;
        if (!state) return null;
        console.log('[Page] scope.call.state:', state);
        if (state === 'Connected') return 'connected';
        if (state === 'Provisioned' || state === 'Idle' || state === 'Ringing' || state === 'Outgoing') return 'waiting';
        return null;
      }

      function registerWatch() {
        if (watchRegistered) return;
        if (!scope || !scope.call) return;

        try {
          scope.$watch('call.state', function(newVal, oldVal) {
            if (newVal !== oldVal) {
              console.log(`[Page] call.state изменился: ${oldVal} → ${newVal}`);
              const status = getStatus();
              if (status && status !== lastStatus) {
                lastStatus = status;
                sendStatus(status);
              }
            }
          });

          watchRegistered = true;
          console.log('[Page] ✅ $watch на call.state установлен');
        } catch(e) {
          console.error('[Page] ❌ Ошибка установки $watch:', e.message);
        }
      }

      function tryGetScope() {
        if (!window.angular) {
          console.log('[Page] ⏳ Angular ещё не загружен');
          return false;
        }

        const element = document.getElementById('pronto-call-group');
        if (!element) {
          console.log('[Page] ⏳ Элемент #pronto-call-group ещё не появился');
          return false;
        }

        try {
          const newScope = window.angular.element(element).scope();
          if (!newScope) {
            console.log('[Page] ⏳ scope ещё не доступен');
            return false;
          }

          if (!newScope.call) {
            console.log('[Page] ⏳ scope.call ещё нет (звонок не начат)');
            return false;
          }

          scope = newScope;
          console.log('[Page] ✅ scope получен!');
          console.log('[Page] scope.call.state:', scope.call.state);

          // Отправляем текущий статус
          const status = getStatus();
          if (status) {
            lastStatus = status;
            sendStatus(status);
          }

          registerWatch();
          return true;
        } catch(e) {
          console.error('[Page] ❌ Ошибка получения scope:', e.message);
          return false;
        }
      }

      function waitForScope() {
        if (isWaitingForScope) return;
        isWaitingForScope = true;
        console.log('[Page] ⏳ Ожидание первого звонка...');

        const interval = setInterval(() => {
          const success = tryGetScope();
          if (success) {
            clearInterval(interval);
            console.log('[Page] 🎉 Scope получен, дальнейшие проверки остановлены');
            isWaitingForScope = false;
          }
        }, 500);
      }

      // Запуск
      if (document.readyState === 'complete') {
        setTimeout(waitForScope, 1000);
      } else {
        window.addEventListener('load', function() {
          setTimeout(waitForScope, 1000);
        });
      }
    };

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: watcherFunction
    }).then(() => {
      injectedTabs.add(tabId);
      console.log('[BG] Watcher успешно внедрён в вкладку', tabId);
    }).catch(err => {
      console.error('[BG] Ошибка внедрения page script:', err);
    });
  }).catch(err => {
    console.error('[BG] Ошибка внедрения content script:', err);
  });
}

// ==========================================
// ОБРАБОТЧИК СООБЩЕНИЙ
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[BG] Получено сообщение:', message);

  if (message.type === 'callStatus') {
    const status = message.status;
    const tabId = sender.tab?.id;
    
    if (tabId) {
      handleStatus(status, tabId);
    } else {
      console.warn('[BG] Неизвестный tabId для статуса:', status);
    }
    
    sendResponse({ received: true });
  }
  
  return true;
});

// ==========================================
// ОТСЛЕЖИВАНИЕ ОТКРЫТИЯ ВКЛАДКИ mail.bmstu.ru
// ==========================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('mail.bmstu.ru')) {
    console.log('[BG] Обнаружена загрузка mail.bmstu.ru');
    // Даём время на загрузку Angular
    setTimeout(() => {
      injectStatusWatcher(tabId);
    }, 2000);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url?.includes('mail.bmstu.ru')) {
    console.log('[BG] Создана вкладка mail.bmstu.ru');
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => {
          injectStatusWatcher(tabId);
        }, 2000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
});

// Проверяем уже открытые вкладки при старте
chrome.tabs.query({ url: 'https://mail.bmstu.ru/*' }, (tabs) => {
  for (const tab of tabs) {
    console.log('[BG] Найдена открытая вкладка mail.bmstu.ru');
    setTimeout(() => {
      injectStatusWatcher(tab.id);
    }, 2000);
  }
});

console.log('[BG] 🚀 Background service worker готов');
