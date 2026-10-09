(function () {
  "use strict";
  const asked = new URLSearchParams(location.search).get("theme");
  let pref = LOGIC.THEMES.includes(asked) ? asked : "light";
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => {
    const next = LOGIC.resolveTheme(pref, mq !== null && mq.matches);
    document.documentElement.dataset.theme = next;

    for (const frame of document.querySelectorAll("iframe.botframe")) {
      if (frame.contentWindow) frame.contentWindow.postMessage({ ddai: "theme", theme: next }, "*");
    }
  };
  apply();
  if (mq !== null) mq.addEventListener("change", apply);
  window.setTheme = (next) => {
    pref = LOGIC.THEMES.includes(next) ? next : "light";
    apply();
  };
})();
