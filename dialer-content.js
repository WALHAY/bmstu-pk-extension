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

function injectCommentOption() {
  const select = document.querySelector(".comment-new-text-default");
  if (!select) return;

  // Проверяем, не добавлена ли уже опция
  if (select.querySelector("option[value='не дозвон']")) return;

  const option = document.createElement("option");
  option.value = "не дозвон";
  option.textContent = "не дозвон";

  // Добавляем после первой опции (placeholder)
  const firstOption = select.querySelector("option[disabled]");
  if (firstOption && firstOption.nextElementSibling) {
    firstOption.nextElementSibling.before(option);
  } else {
    select.insertBefore(option, select.children[1]);
  }
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
    console.log("[BMSTU] dial button clicked:", phoneNumber);

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      console.error("[BMSTU] chrome.runtime.sendMessage unavailable");
      alert("Расширение недоступно. Обновите страницу и попробуйте снова.");
      return;
    }

    try {
      const response = await runtime.sendMessage({ action: "dialPhone", phoneNumber });
      console.log("[BMSTU] dial response:", response);
      if (!response?.success) {
        alert(response?.error || "Не удалось инициировать звонок");
      }
    } catch (error) {
      console.error("[BMSTU] dial sendMessage failed:", error);
      alert(error?.message || "Не удалось отправить сообщение в расширение");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    injectDialButton();
    injectCommentOption();
  });
} else {
  injectDialButton();
  injectCommentOption();
}

const observer = new MutationObserver(() => {
  if (!document.querySelector(".bmstu-dial-button")) {
    injectDialButton();
  }
  injectCommentOption();
});

observer.observe(document.body, { childList: true, subtree: true });
