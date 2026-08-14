const MAIL_URL = "https://mail.bmstu.ru/*";
const MAIL_ENTRY_URL = "https://mail.bmstu.ru";
const YANDEX_MUSIC_URLS = ["https://music.yandex.ru/*", "https://yandex.ru/music/*"];
const SETTINGS_KEY = "bmstuCallAssistantSettings";
const DEFAULT_SETTINGS = {
  muteYandexMusicDuringCall: true,
  muteRingsDuringProvisioned: true,
  showConnectedNotification: true
};

let notificationId = null;
const injectedWatcherTabs = new Set();
const injectedEmergencyButtonTabs = new Set();
const manualUnmuteTabs = new Set();
const lastStateByTab = new Map();
const audioPolicyQueueByTab = new Map();

function log(...args) {
  console.log("[BMSTU]", ...args);
}

async function getSettings() {
  const storage = chrome?.storage?.sync || chrome?.storage?.local;
  if (!storage?.get) return { ...DEFAULT_SETTINGS };

  try {
    const result = await storage.get(SETTINGS_KEY);
    const storedSettings = result?.[SETTINGS_KEY] || {};
    return {
      ...DEFAULT_SETTINGS,
      ...storedSettings
    };
  } catch (error) {
    log("Failed to read settings, using defaults:", error?.message || error);
    return { ...DEFAULT_SETTINGS };
  }
}

function getConnectedNotificationMessage(settings) {
  if (settings?.muteYandexMusicDuringCall) {
    return "Вкладка звонка разглушена, Яндекс Музыка заглушена.";
  }
  return "Вкладка звонка разглушена.";
}

function getScriptingApi() {
  if (chrome?.scripting?.executeScript) return chrome.scripting;
  if (browser?.scripting?.executeScript) return browser.scripting;
  throw new Error("Scripting API недоступен: проверьте загрузку расширения и permission 'scripting'");
}

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function normalizeCallState(state) {
  const value = String(state || "").trim();
  if (value === "Connected" || value === "connected") return "Connected";
  if (value === "Provisioned" || value === "Outgoing" || value === "Ringing") return "Provisioned";
  if (value === "provisioned" || value === "outgoing" || value === "ringing") return "Provisioned";
  if (value === "Idle" || value === "idle") return "Idle";
  return null;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Таймаут загрузки вкладки mail.bmstu.ru"));
    }, timeoutMs);

    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== "complete" || done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function setYandexMusicMuted(muted) {
  log("Yandex Music mute ->", muted);
  const tabs = await chrome.tabs.query({ url: YANDEX_MUSIC_URLS });
  log("Yandex Music tabs:", tabs.map((tab) => tab.id).filter((id) => typeof id === "number"));
  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) =>
        chrome.tabs.update(tab.id, { muted }).then(
          () => log("Yandex Music tab updated:", tab.id, "muted =", muted),
          (error) => log("Yandex Music tab update failed:", tab.id, error?.message || error)
        )
      )
  );
}

async function setCallTabMuted(tabId, muted) {
  if (typeof tabId !== "number") return;
  try {
    log("Call tab mute ->", tabId, muted);
    await chrome.tabs.update(tabId, { muted });
    log("Call tab updated:", tabId, "muted =", muted);
    return true;
  } catch (_) {
    // Вкладка могла уже закрыться.
    log("Call tab update failed:", tabId, muted);
    return false;
  }
}

function showConnectedNotification(settings) {
  log("Show connected notification");
  if (notificationId) {
    chrome.notifications.clear(notificationId);
    notificationId = null;
  }

  chrome.notifications.create(
    "bmstu-call-connected",
    {
      type: "basic",
      iconUrl: "icon.png",
      title: "Звонок соединен",
      message: getConnectedNotificationMessage(settings),
      priority: 2,
      requireInteraction: true
    },
    (id) => {
      notificationId = id;
    }
  );
}

function clearConnectedNotification() {
  if (!notificationId) return;
  chrome.notifications.clear(notificationId);
  notificationId = null;
}

function showErrorNotification(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: "Ошибка звонка",
    message
  });
}

async function applyAudioPolicyByState(rawState, tabId) {
  if (typeof tabId !== "number") return;
  const state = normalizeCallState(rawState);
  const settings = await getSettings();
  log("Apply audio policy:", { rawState, state, tabId, manualUnmute: manualUnmuteTabs.has(tabId), lastState: lastStateByTab.get(tabId) });
  if (!state) return;

  const previousState = lastStateByTab.get(tabId);
  lastStateByTab.set(tabId, state);

  if (state === "Provisioned") {
    const shouldMuteCallTab = settings.muteRingsDuringProvisioned && !manualUnmuteTabs.has(tabId);
    const shouldMuteYandexMusic = false;
    await Promise.all([
      setCallTabMuted(tabId, shouldMuteCallTab),
      setYandexMusicMuted(shouldMuteYandexMusic)
    ]);
    return;
  }

  if (state === "Connected") {
    manualUnmuteTabs.delete(tabId);
    await Promise.all([
      setCallTabMuted(tabId, false),
      setYandexMusicMuted(Boolean(settings.muteYandexMusicDuringCall))
    ]);
    if (settings.showConnectedNotification && previousState !== "Connected") {
      showConnectedNotification(settings);
    }
    return;
  }

  if (state === "Idle") {
    clearConnectedNotification();
  }

  manualUnmuteTabs.delete(tabId);
  await Promise.all([setCallTabMuted(tabId, false), setYandexMusicMuted(false)]);
}

function enqueueAudioPolicyByState(rawState, tabId) {
  if (typeof tabId !== "number") return Promise.resolve();

  const previous = audioPolicyQueueByTab.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => applyAudioPolicyByState(rawState, tabId));

  audioPolicyQueueByTab.set(
    tabId,
    next.finally(() => {
      if (audioPolicyQueueByTab.get(tabId) === next) {
        audioPolicyQueueByTab.delete(tabId);
      }
    })
  );

  return next;
}

async function injectStatusWatcher(tabId) {
  if (typeof tabId !== "number" || injectedWatcherTabs.has(tabId)) return;
  const scripting = getScriptingApi();
  log("Inject status watcher:", tabId);

  await scripting.executeScript({
    target: { tabId },
    func: () => {
      if (window.__bmstuCallBridgeInstalled) return;
      window.__bmstuCallBridgeInstalled = true;

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== "bmstu-call-state") return;
        console.log("[BMSTU] message bridge received state:", event.data.state);
        chrome.runtime
          .sendMessage({ type: "callState", state: event.data.state })
          .then(() => console.log("[BMSTU] callState sent to background"))
          .catch((error) => console.log("[BMSTU] callState send failed:", error));
      });
    }
  });

  await scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      if (window.__bmstuCallWatcherInstalled) return;
      window.__bmstuCallWatcherInstalled = true;

      const originalTitle = document.title;
      let lastSentState = null;
      let hasSeenCallState = false;

      function readCallState() {
        try {
          if (!window.angular) {
            console.log("[BMSTU watcher] angular not found");
            return null;
          }
          const host = document.getElementById("pronto-call-group");
          if (!host) {
            console.log("[BMSTU watcher] pronto-call-group element not found");
            return null;
          }
          const scope = window.angular.element(host).scope();
          const state = scope?.call?.state || null;
          if (state) {
            console.log("[BMSTU watcher] read state:", state);
          }
          return state;
        } catch (error) {
          console.log("[BMSTU watcher] readCallState error:", error?.message);
          return null;
        }
      }

      function mapState(rawState) {
        const value = String(rawState || "").trim();
        if (value === "Connected" || value === "connected") return "Connected";
        if (value === "Provisioned" || value === "Outgoing" || value === "Ringing") return "Provisioned";
        if (value === "provisioned" || value === "outgoing" || value === "ringing") return "Provisioned";
        if (value === "Idle" || value === "idle") return "Idle";
        return null;
      }

      function updateTitle(state) {
        if (state === "Connected") {
          document.title = "Соединено";
          return;
        }

        if (state === "Provisioned") {
          document.title = "Вызываем";
          return;
        }

        document.title = originalTitle;
      }

      function postState(state) {
        updateTitle(state);
        console.log("[BMSTU watcher] post state:", state, "new title:", document.title);
        window.postMessage({ source: "bmstu-call-state", state }, "*");
      }

      setInterval(() => {
        const rawState = readCallState();
        const mappedState = mapState(rawState);

        if (mappedState) {
          hasSeenCallState = true;
          if (mappedState !== lastSentState) {
            lastSentState = mappedState;
            console.log("[BMSTU watcher] state change:", { rawState, mappedState });
            postState(mappedState);
          }
          return;
        }

        if (rawState) {
          console.log("[BMSTU watcher] unknown state (not mapped):", rawState);
          return;
        }

        if (hasSeenCallState && lastSentState !== "Idle") {
          lastSentState = "Idle";
          console.log("[BMSTU watcher] fallback -> Idle");
          updateTitle("Idle");
          postState("Idle");
        }
      }, 400);
    }
  });

  injectedWatcherTabs.add(tabId);
}

async function injectEmergencyButton(tabId) {
  if (typeof tabId !== "number") return;
  const scripting = getScriptingApi();
  log("Inject emergency button:", tabId);

  await scripting.executeScript({
    target: { tabId },
    func: () => {
      const existingButton = document.getElementById("bmstu-emergency-unmute-button");
      if (existingButton) return;

      const button = document.createElement("button");
      button.id = "bmstu-emergency-unmute-button";
      button.type = "button";
      button.textContent = "Вернуть звук";
      button.style.cssText = [
        "position: fixed",
        "right: 16px",
        "bottom: 16px",
        "z-index: 2147483647",
        "padding: 8px 12px",
        "border: none",
        "border-radius: 6px",
        "background: #d9534f",
        "color: #fff",
        "font-size: 13px",
        "cursor: pointer",
        "box-shadow: 0 2px 8px rgba(0,0,0,.2)"
      ].join(";");

      button.addEventListener("mouseenter", () => {
        button.style.background = "#c9302c";
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = "#d9534f";
      });

      button.addEventListener("click", async () => {
        const previousText = button.textContent;
        button.textContent = "Размучено";
        console.log("[BMSTU] emergency unmute clicked");
        try {
          const response = await chrome.runtime.sendMessage({ action: "emergencyUnmuteCallTab" });
          console.log("[BMSTU] emergency unmute response:", response);
          if (!response?.success) {
            button.textContent = "Не удалось";
            setTimeout(() => {
              button.textContent = previousText;
            }, 1500);
            return;
          }
        } catch (_) {
          button.textContent = "Не удалось";
          setTimeout(() => {
            button.textContent = previousText;
          }, 1500);
          return;
        }

        setTimeout(() => {
          button.textContent = previousText;
        }, 1500);
      });

      document.body.appendChild(button);
    }
  });

  injectedEmergencyButtonTabs.add(tabId);
}

async function resolveMailTabId(sender) {
  if (typeof sender.tab?.id === "number") {
    log("Resolved mail tab from sender:", sender.tab.id);
    return sender.tab.id;
  }

  const tabs = await chrome.tabs.query({ url: MAIL_URL });
  const mailTab = tabs.find((tab) => typeof tab.id === "number");
  log("Resolved mail tab from query:", mailTab?.id);
  return mailTab?.id;
}

async function executeCallOnPage(tabId, phoneNumber) {
  const scripting = getScriptingApi();
  const execution = await scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (phone) => {
      try {
        const dialerNode = document.querySelector('li.pronto-dialer__item[ng-click="dial();"]');
        if (!dialerNode) {
          return { success: false, error: "Кнопка набора не найдена на mail.bmstu.ru" };
        }

        const scope = window.angular?.element(dialerNode).scope();
        if (!scope) {
          return { success: false, error: "Angular scope не найден" };
        }

        let ctx = scope;
        let onCall = null;
        while (ctx) {
          if (typeof ctx.onCall === "function") {
            onCall = ctx.onCall;
            break;
          }
          ctx = ctx.$parent;
        }

        if (onCall) {
          onCall({ address: phone, useVideo: false });
          return { success: true };
        }

        if (typeof scope.dial === "function") {
          scope.dial(false);
          return { success: true };
        }

        return { success: false, error: "Не найдена функция вызова" };
      } catch (error) {
        return { success: false, error: error?.message || "Неизвестная ошибка" };
      }
    },
    args: [phoneNumber]
  });

  return execution?.[0]?.result || { success: false, error: "Не удалось выполнить скрипт звонка" };
}

async function ensureMailTab() {
  const existingTabs = await chrome.tabs.query({ url: MAIL_URL });
  const existingTab = existingTabs.find((tab) => typeof tab.id === "number");
  if (existingTab?.id) {
    if (existingTab.status !== "complete") {
      await waitForTabComplete(existingTab.id);
    }
    return existingTab;
  }

  const tab = await chrome.tabs.create({ url: MAIL_ENTRY_URL, active: false });
  if (typeof tab.id !== "number") {
    throw new Error("Не удалось создать вкладку mail.bmstu.ru");
  }
  await waitForTabComplete(tab.id);
  return tab;
}

async function setupMailTab(tabId) {
  await Promise.all([injectStatusWatcher(tabId), injectEmergencyButton(tabId)]);
}

async function dialPhone(phoneNumber) {
  const normalizedPhone = normalizePhone(phoneNumber);
  log("Dial phone requested:", normalizedPhone);
  if (!normalizedPhone) {
    throw new Error("Номер телефона пустой");
  }

  const mailTab = await ensureMailTab();
  await setupMailTab(mailTab.id);

  const callResult = await executeCallOnPage(mailTab.id, normalizedPhone);
  log("Dial result:", callResult);
  if (!callResult.success) {
    throw new Error(callResult.error || "Не удалось инициировать звонок");
  }

  manualUnmuteTabs.delete(mailTab.id);
  await enqueueAudioPolicyByState("Provisioned", mailTab.id);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("Message received:", message?.action || message?.type, "senderTab =", sender.tab?.id);
  if (message?.action === "dialPhone") {
    (async () => {
      try {
        await dialPhone(message.phoneNumber);
        sendResponse({ success: true });
      } catch (error) {
        const errMessage = error?.message || "Неизвестная ошибка";
        showErrorNotification(errMessage);
        sendResponse({ success: false, error: errMessage });
      }
    })();
    return true;
  }

  if (message?.type === "callState") {
    (async () => {
      try {
        const tabId = await resolveMailTabId(sender);
        log("callState payload:", message.state, "tabId:", tabId);
        await enqueueAudioPolicyByState(message.state, tabId);
        sendResponse({ received: true });
      } catch (error) {
        sendResponse({ received: false, error: error?.message || "Не удалось обработать состояние звонка" });
      }
    })();
    return true;
  }

  if (message?.action === "emergencyUnmuteCallTab") {
    (async () => {
      const tabId = await resolveMailTabId(sender);
      log("Emergency unmute requested for tab:", tabId);
      if (typeof tabId === "number") {
        manualUnmuteTabs.add(tabId);
        const unmuted = await setCallTabMuted(tabId, false);
        log("Emergency unmute result:", { tabId, unmuted });
        if (!unmuted) {
          showErrorNotification("Не удалось размутить вкладку звонка");
        }
        sendResponse({ received: true, success: unmuted });
        return;
      }

      showErrorNotification("Не найдена вкладка звонка для экстренного размута");
      sendResponse({ received: true, success: false });
    })();
    return true;
  }

  if (message?.action === "muteCall") {
    (async () => {
      try {
        const tabId = await resolveMailTabId(sender);
        log("muteCall requested for tab:", tabId);
        await enqueueAudioPolicyByState("Provisioned", tabId);
        sendResponse({ received: true });
      } catch (error) {
        sendResponse({ received: false, error: error?.message || "Не удалось приглушить звонок" });
      }
    })();
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.url.includes("mail.bmstu.ru")) return;
  log("Tab updated complete:", tabId, tab.url);

  setTimeout(() => {
    setupMailTab(tabId).catch(() => {});
  }, 1200);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  log("Tab removed:", tabId);
  injectedWatcherTabs.delete(tabId);
  injectedEmergencyButtonTabs.delete(tabId);
  manualUnmuteTabs.delete(tabId);
  lastStateByTab.delete(tabId);
  audioPolicyQueueByTab.delete(tabId);
});

chrome.tabs.query({ url: MAIL_URL }).then((tabs) => {
  log("Initial mail tabs:", tabs.map((tab) => tab.id).filter((id) => typeof id === "number"));
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    setupMailTab(tab.id).catch(() => {});
  }
});
