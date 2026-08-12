function findPhoneField() {
  return document.querySelector("input.contact-single-value-input.contact-copy-value.iti__tel-input");
}

function formatPhoneNumber(phoneNumber) {
  let cleaned = String(phoneNumber).replace(/[\s\-().]/g, "");

  if (cleaned.startsWith("+7")) {
    cleaned = "8" + cleaned.slice(2);
  } else if (cleaned.startsWith("7")) {
    cleaned = "8" + cleaned.slice(1);
  } else if (/^\d{10}$/.test(cleaned)) {
    cleaned = "8" + cleaned;
  }

  return cleaned;
}

function createDialButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Набрать";
  button.style.cssText = [
    "margin-left: 10px",
    "padding: 6px 12px",
    "background: #8da7c2",
    "color: #fff",
    "border: none",
    "border-radius: 4px",
    "cursor: pointer",
    "font-size: 14px",
    "transition: all 0.2s ease",
    "white-space: nowrap"
  ].join(";");

  button.addEventListener("mouseenter", () => {
    button.style.background = "#446e9b";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "#8da7c2";
  });

  return button;
}

function injectDialButton() {
  const phoneField = findPhoneField();
  if (!phoneField) return;

  const container = phoneField.closest(".contact-single-row-column");
  if (!container || container.querySelector(".bmstu-dial-button")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "bmstu-dial-button";
  wrapper.style.cssText = "display:inline-block;margin-left:10px;vertical-align:middle;";

  const button = createDialButton();
  wrapper.appendChild(button);
  container.appendChild(wrapper);

  button.addEventListener("click", async () => {
    const rawPhone = phoneField.value;
    if (!rawPhone || !rawPhone.trim()) {
      alert("Номер телефона не найден");
      return;
    }

    const phoneNumber = formatPhoneNumber(rawPhone.trim());
    const response = await chrome.runtime.sendMessage({ action: "dialPhone", phoneNumber });
    if (!response?.success) {
      alert(response?.error || "Не удалось инициировать звонок");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectDialButton);
} else {
  injectDialButton();
}

const observer = new MutationObserver(() => {
  if (!document.querySelector(".bmstu-dial-button")) {
    injectDialButton();
  }
});

observer.observe(document.body, { childList: true, subtree: true });
