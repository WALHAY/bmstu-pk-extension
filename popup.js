const SETTINGS_KEY = "bmstuCallAssistantSettings";
const DEFAULT_SETTINGS = {
  muteYandexMusicDuringCall: true,
  muteRingsDuringProvisioned: true,
  showConnectedNotification: true
};

function getStorageArea() {
  return chrome?.storage?.sync || chrome?.storage?.local || null;
}

function getSettingsFromForm() {
  return {
    muteYandexMusicDuringCall: Boolean(document.getElementById("mute-yandex")?.checked),
    muteRingsDuringProvisioned: Boolean(document.getElementById("mute-rings")?.checked),
    showConnectedNotification: Boolean(document.getElementById("notify-connected")?.checked)
  };
}

function applySettingsToForm(settings) {
  const data = { ...DEFAULT_SETTINGS, ...settings };
  const muteYandex = document.getElementById("mute-yandex");
  const muteRings = document.getElementById("mute-rings");
  const notifyConnected = document.getElementById("notify-connected");

  if (muteYandex) muteYandex.checked = data.muteYandexMusicDuringCall;
  if (muteRings) muteRings.checked = data.muteRingsDuringProvisioned;
  if (notifyConnected) notifyConnected.checked = data.showConnectedNotification;
}

async function loadSettings() {
  const storage = getStorageArea();
  if (!storage?.get) {
    applySettingsToForm(DEFAULT_SETTINGS);
    return;
  }

  const result = await storage.get(SETTINGS_KEY);
  applySettingsToForm(result?.[SETTINGS_KEY] || DEFAULT_SETTINGS);
}

async function saveSettings() {
  const storage = getStorageArea();
  if (!storage?.set) return;

  const settings = getSettingsFromForm();
  await storage.set({ [SETTINGS_KEY]: settings });
}

function bindEvents() {
  const controls = [
    document.getElementById("mute-yandex"),
    document.getElementById("mute-rings"),
    document.getElementById("notify-connected")
  ];

  for (const control of controls) {
    if (!control) continue;
    control.addEventListener("change", () => {
      saveSettings().catch((error) => {
        console.error("[BMSTU] failed to save settings:", error);
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings()
    .then(() => {
      bindEvents();
    })
    .catch((error) => {
      console.error("[BMSTU] failed to load settings:", error);
      applySettingsToForm(DEFAULT_SETTINGS);
      bindEvents();
    });
});
