(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.I18N = api;

  if (typeof document !== "undefined" && /[?&]lang=en(&|$)/.test(location.search)) document.documentElement.classList.add("i18n-wait");
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EN = {

    "Состояние бота": "Bot status",
    "запуск": "starting",
    "Пауза": "Pause",
    "Играть": "Play",
    "Продолжить игру": "Resume",
    "Пауза: бот встанет на месте": "Pause: the bot stands still",
    "Сервера DDNet": "DDNet servers",
    "Сервера": "Servers",
    "Лог бота": "Bot log",
    "Лог": "Log",
    "Настройки": "Settings",
    "Поверх всех окон": "Always on top",
    "Мини-режим поверх игры": "Mini mode over the game",
    "Обычное окно": "Normal window",
    "Свернуть": "Minimize",
    "Развернуть": "Maximize",
    "Восстановить": "Restore",
    "Закрыть": "Close",
    "Окно бота": "Bot window",
    "Запускаю бота": "Starting the bot",
    "Бот не запускается": "The bot won't start",
    "Поднимаю окно бота, обычно это пара секунд.": "Bringing up the bot's window, this usually takes a couple of seconds.",
    "Открыть лог": "Open the log",
    "Перезапустить": "Restart",
    "Бот перезапускается...": "The bot is restarting...",
    "Бот запускается...": "The bot is starting...",
    "Не нашёл папку бота": "The bot folder wasn't found",
    "@noroot":
      "The window looks for the folder that has <code>start.mjs</code> and <code>src</code>. The easiest is to unpack the window inside the bot folder as <code>app-win</code>. Or pick the folder yourself.",
    "Выбрать папку бота": "Choose the bot folder",

    "папка бота не найдена": "bot folder not found",
    "ждёт настройки": "waiting for setup",
    "Стартовый экран при запуске": "Start screen on launch",
    "С чем играть и история прошлых игр": "What to play with and the history of past games",
    "ждёт старта": "waiting to start",
    "меньше минуты": "under a minute",
    "{m} мин": "{m} min",
    "{h} ч {m} мин": "{h} h {m} min",
    "Запуск через {n} с": "Starting in {n} s",
    "подождать": "wait",
    "Автозапуск отменён": "Auto start cancelled",
    "Ник": "Name",
    "сыграно {t}": "played {t}",
    "Играть так": "Play like this",
    "Убрать из истории": "Remove from the history",
    "не вышло": "did not work",
    "Нет такой записи": "No such entry",
    "Играть как в прошлый раз или выбрать из истории.": "Play as last time or pick from the history.",
    "Изменить": "Change",
    "История": "History",
    "ждёт первой настройки": "waiting for the first setup",
    "перезапуск": "restarting",
    "запуск бота": "starting the bot",
    "запущен": "running",
    "пауза": "paused",
    "пауза · {name}": "paused · {name}",
    "бот": "bot",
    "{name} на {server} · против {target}": "{name} on {server} · vs {target}",
    "{name} на {server}": "{name} on {server}",
    "играет на {server}": "playing on {server}",
    "подключается": "connecting",
    "подключается к {server}": "connecting to {server}",
    "не на сервере": "not on a server",
    "не на сервере: {reason}": "not on a server: {reason}",

    "Первый запуск": "First launch",
    "Бот: сервер, ник, скин": "Bot: server, name, skin",
    "Четыре поля, и бот пойдёт играть. Потом всё это меняется в настройках.": "Four fields and the bot goes to play. You can change all of it later in the settings.",
    "Пара полей, и бот пойдёт играть. Потом всё это меняется в настройках.": "A couple of fields and the bot goes to play. You can change all of it later in the settings.",
    "После сохранения бот перезапустится с новыми настройками.": "After saving, the bot restarts with the new settings.",
    "Сервер": "Server",
    "Выбрать из списка": "Pick from the list",
    "пусто: самый живой блок-сервер": "empty: the liveliest block server",
    "сервер сам": "auto server",
    "Ник бота": "Bot name",
    "Клан": "Clan",
    "можно пусто": "optional",
    "Рисовать видеокартой": "Draw with the graphics card",
    "Меньше нагрузки на процессор. Мусор или чёрный экран в окне: выключи. Работает после перезапуска окна": "Less load on the CPU. Garbage or a black screen in the window: turn it off. Takes effect after the window restarts",
    "Применится после перезапуска окна": "Takes effect after the window restarts",
    "Второй бот (дамми)": "Second bot (dummy)",
    "на тот же сервер, в тиме с первым": "on the same server, on the first one's team",
    "включить": "on",
    "ник второго бота, пусто: ник + 2": "the second bot's nick, empty: nick + 2",
    "Ник второго бота должен отличаться": "The second bot needs a different nick",
    "Скин": "Skin",
    "Пароль сервера": "Server password",
    "стереть": "clear",
    "сохранён, пусто = не менять": "saved, empty = keep it",
    "будет стёрт": "will be cleared",
    "другой сервер: старый сотрётся": "another server: the old one will be cleared",
    "сохранён": "saved",
    "Чем играть": "Brain",
    "Планировщик": "Planner",
    "Просчёт на полсекунды вперёд в настоящей физике. Самый сильный, по умолчанию.": "Looks half a second ahead in the real game physics. The strongest, and the default.",
    "Экспериментальный": "Experimental",
    "Больше вариантов за тот же такт. Измерен слабее обычного.": "More candidates in the same tick. Measured weaker than the default.",
    "Скриптовый": "Scripted",
    "показать тестовые (слабее планировщика)": "show the test ones (weaker than the planner)",
    "Простой бот без поиска. Нужен только для сравнения.": "A simple bot without search. Only useful for comparison.",
    "планировщик": "planner",
    "экспериментальный": "experimental",
    "скриптовый": "scripted",
    "Отмена": "Cancel",
    "Сохранить и запустить": "Save and start",
    "Сохранить и перезапустить": "Save and restart",
    "Сохранено, бот перезапускается": "Saved, the bot is restarting",

    "Обновить список": "Refresh the list",
    "Сервер, карта, режим или ник игрока": "Server, map, mode or player name",
    "Не пустые": "Not empty",
    "Есть места": "Has slots",
    "Без пароля": "No password",
    "Избранные": "Favorites",
    "Карта": "Map",
    "Игроки": "Players",
    "Регион": "Region",
    "пароль сервера": "server password",
    "Адрес": "Address",
    "Играть здесь": "Play here",
    "или адрес вручную: 1.2.3.4:8303": "or type an address: 1.2.3.4:8303",
    "Зайти": "Join",
    "Загружаю список с мастер-сервера DDNet...": "Loading the list from the DDNet master server...",
    "Не загрузилось: {err}": "Didn't load: {err}",
    "{n} из {total} · {players} игроков онлайн": "{n} of {total} · {players} players online",
    "Ничего не нашлось. Попробуй снять фильтры.": "Nothing found. Try turning some filters off.",
    "Список пуст.": "The list is empty.",
    "Убрать из избранного": "Remove from favorites",
    "В избранное": "Add to favorites",
    "с паролем": "with a password",
    "и ещё {n}": "and {n} more",
    "никого": "nobody",
    "У этого сервера пароль: впиши его": "This server has a password: type it in",
    "Скопировано: {addr}": "Copied: {addr}",
    "Нужен адрес вида 1.2.3.4:8303": "An address like 1.2.3.4:8303 is needed",
    "Недавние:": "Recent:",
    "Мастер-серверы DDNet не ответили ({err})": "The DDNet master servers didn't answer ({err})",
    "пустой список": "empty list",

    "Бот": "Bot",
    "Сервер, ник, скин, мозг": "Server, name, skin, brain",
    "Перезапустить бота": "Restart the bot",
    "Если завис или после правки файлов": "If it hangs, or after editing its files",
    "Открыть в браузере": "Open in the browser",
    "Та же страница бота, во вкладке": "The same bot page, in a browser tab",
    "Файлы": "Files",
    "Собрать отчёт об ошибке": "Collect a bug report",
    "Записи, A/B, память, лог и демки в один zip на рабочий стол": "Clips, A/B, memory, log and demos in one zip on the desktop",
    "Папка записей": "Clips folder",
    "Папка бота": "Bot folder",
    "Ярлык на рабочий стол": "Desktop shortcut",
    "Запуск окна одним двойным кликом": "Open the window with one double click",
    "Приложение": "App",
    "Пауза и продолжение": "Pause and resume",
    "Работает, даже когда окно свёрнуто": "Works even when the window is minimized",
    "Нажми, затем нужное сочетание": "Click, then press the keys you want",
    "нажми сочетание...": "press the keys...",
    "Пауза теперь на {key}": "Pause is now on {key}",
    "Уведомления": "Notifications",
    "Отключился, вернулся, обновился, падает": "Disconnected, back, updated, crashing",
    "Крестик прячет в трей": "Close hides to the tray",
    "Бот продолжает играть в фоне": "The bot keeps playing in the background",
    "Запускать вместе с Windows": "Start with Windows",
    "Сразу в трей, без окна": "Straight to the tray, without the window",
    "Язык": "Language",
    "Окно, трей, страница и консоль бота": "The window, tray, bot page and console",
    "Как в системе": "Same as the system",
    "О программе": "About",
    "Версия бота": "Bot version",
    "неизвестна": "unknown",
    "Чем запущен": "Runs on",
    "Страница бота": "Bot page",
    "Папка": "Folder",
    "Графика": "Graphics",
    "DDNet / Teeworlds (data: CC-BY-SA 3.0; скины, шрифты и ассеты под своими лицензиями). В бота не входит: окно берёт её из твоей установки DDNet, а недостающие скины качает с skins.ddnet.org в runs/skincache (выключается в настройках окна). Код отрисовки частично по исходникам DDNet (zlib).":
      "DDNet / Teeworlds (data: CC-BY-SA 3.0; skins, fonts and assets under their own licenses). Not part of the bot: the window takes it from your DDNet install and downloads missing skins from skins.ddnet.org into runs/skincache (this can be turned off in the bot page's settings). Part of the drawing code follows DDNet's sources (zlib).",
    "Такое сочетание не подходит": "That key combination won't work",
    "Сочетание {key} уже занято другой программой": "The shortcut {key} is taken by another program",
    "Сочетание не подходит: {err}": "The shortcut doesn't work: {err}",

    "фильтр": "filter",
    "Скопировать весь лог": "Copy the whole log",
    "Спрятать": "Hide",
    "Лог скопирован": "Log copied",
    "Архив": "Archive",
    "Архив: {done} из {total}": "Archive: {done} of {total}",
    "Бот ещё не запущен": "The bot isn't running yet",
    "Бот снова играет": "The bot is playing again",
    "Бот на паузе: стоит на месте": "The bot is paused: it stands still",
    "Не вышло: {err}": "Didn't work: {err}",
    "Сервер другой: сохранённый пароль стёрт": "Another server: the saved password was cleared",
    "Захожу на {where}...": "Joining {where}...",
    "Не найдена папка бота": "The bot folder wasn't found",
    "не найдена папка бота": "the bot folder wasn't found",
    "Не записалось: {err}": "Couldn't save: {err}",
    "Ярлык DDNet AI на рабочем столе": "DDNet AI shortcut is on the desktop",
    "Ярлык не создался": "The shortcut wasn't created",
    "Не открылась папка: {err}": "The folder didn't open: {err}",
    "В этой папке нет start.mjs и src/bot/web.ts": "This folder has no start.mjs and src/bot/web.ts",
    "Где лежит бот (папка с start.mjs)": "Where the bot is (the folder with start.mjs)",

    "DDNet AI: окно бота": "DDNet AI: the bot's window",
    "Спрятать окно": "Hide the window",
    "Показать окно": "Show the window",
    "Мини-режим поверх окон": "Mini mode on top",
    "Открыть папку записей": "Open the clips folder",
    "Собрать отчёт об ошибке...": "Collect a bug report...",
    "Открыть папку бота": "Open the bot folder",
    "Выход": "Quit",
    "Выйти": "Quit",
    "Обновление установлено": "Update installed",
    "Бот перезапущен на версии {sha}.": "The bot restarted on version {sha}.",
    "Бот обновляется": "The bot is updating",
    "Скачана версия {sha}, перезапускаю.": "Downloaded version {sha}, restarting.",
    "Бот завершился с ошибкой ({how}). Подробности в логе.": "The bot exited with an error ({how}). Details are in the log.",
    "Бот падает при запуске раз за разом. Открой лог: там причина.": "The bot keeps crashing on start. Open the log: the reason is there.",
    "Бот падает при запуске": "The bot crashes on start",
    "Три падения подряд. Окно продолжает пробовать, причина в логе.": "Three crashes in a row. The window keeps trying; the reason is in the log.",
    "Бот отключился": "The bot disconnected",
    "Причина: {reason}. Переподключаюсь.": "Reason: {reason}. Reconnecting.",
    "Переподключаюсь.": "Reconnecting.",
    "Бот снова в игре": "The bot is back in the game",
    "Сервер {server}": "Server {server}",
    "DDNet AI работает в трее": "DDNet AI is running in the tray",
    "Бот продолжает играть. Выход: правый клик по значку в трее.": "The bot keeps playing. To quit, right-click the tray icon.",
    "Окно DDNet AI падает раз за разом.": "The DDNet AI window keeps crashing.",
    "Бот при этом работает. Можно попробовать открыть окно заново или выйти совсем.": "The bot itself is still running. You can try opening the window again, or quit.",
    "Открыть заново": "Open again",
    "Уже работает другой бот ({who}) на порту {port}.": "Another bot ({who}) is already running on port {port}.",
    "Скорее всего его запустил run-gui.vbs: он скрытый и перезапускает бота сам каждые 5 секунд. Если запустить ещё одного, на сервере будут два ти с этого компьютера.":
      "Most likely run-gui.vbs started it: it is hidden and restarts the bot every 5 seconds. Starting another one would put two tees from this computer on the server.",
    "Остановить тот и играть отсюда": "Stop that one and play from here",
    "Запустить второго": "Start a second one",
    "Отчёт об ошибке": "Bug report",
    "Собрать записи бота в один zip на рабочем столе?": "Collect the bot's records into one zip on the desktop?",
    "Войдут записи (runs/clips), итоги A/B, память фриза, лог окна и настройки без пароля. Ключ обновлений не попадёт.":
      "It takes the clips (runs/clips), the A/B results, the freeze memory, the window's log and the settings without the password. The update key is left out.",
    "Добавить демки...": "Add demos...",
    "Без демок": "Without demos",
    "Какие демки добавить": "Which demos to add",
    "Демки DDNet": "DDNet demos",
    "Собираю архив: {n} файлов...": "Collecting the archive: {n} files...",
    "Архив на рабочем столе: {file} ({mb} МБ)": "The archive is on the desktop: {file} ({mb} MB)",
    "Архив не собрался: {err}": "The archive failed: {err}",

    "ярлык в меню Пуск не создался: уведомления могут не показываться": "the Start menu shortcut wasn't created: notifications may not show",
    "ярлык в меню Пуск: {err}": "Start menu shortcut: {err}",
    "встроенный Node.js {v}": "built-in Node.js {v}",
    "Node.js {v} в {path} слишком старый, беру встроенный": "Node.js {v} at {path} is too old, using the built-in one",
    "остался бот от прошлого запуска на порту {port}, прошу его выйти": "a bot from the last run is still on port {port}, asking it to quit",
    "на порту {port} уже работает другой бот ({who}), скорее всего из run-gui.vbs": "another bot ({who}) is already on port {port}, most likely from run-gui.vbs",
    "тот бот остановлен": "that bot is stopped",
    "порт {port} всё ещё занят: запускаю на другом": "port {port} is still taken: starting on another one",
    "папка бота: {root}": "bot folder: {root}",
    "запускаю: {what}": "starting: {what}",
    "запускаю: {what} (без сети)": "starting: {what} (offline)",
    "бот запущен, pid {pid}, порт {port}": "the bot started, pid {pid}, port {port}",
    "страница бота готова: {url}": "the bot page is ready: {url}",
    "сигнал {s}": "signal {s}",
    "код {c}": "code {c}",
    "бот вышел ({how}) через {secs} с": "the bot exited ({how}) after {secs} s",
    "бот вышел ({how}) через {secs} с, перезапуск": "the bot exited ({how}) after {secs} s, restarting",
    "перезапуск через {secs} с": "restarting in {secs} s",
    "страница бота долго не поднимается, жду дальше": "the bot page is slow to come up, still waiting",
    "перезапуск по кнопке": "restart from the button",
    "окно упало ({reason}), перезагружаю": "the window crashed ({reason}), reloading",
    "окно упало ({reason}) в {n}-й раз за минуту": "the window crashed ({reason}) for the {n}th time in a minute",
    "значок в трее недоступен: {err}": "the tray icon is unavailable: {err}",
    "архив готов: {file} ({n} файлов, {mb} МБ)": "the archive is ready: {file} ({n} files, {mb} MB)",
    "не вошёл в архив: {name} (бот удалил его, пока архив собирался)": "left out of the archive: {name} (the bot deleted it while the archive was being built)",
    "настройки бота сохранены": "the bot's settings are saved",
    "сервер сменён на {addr}": "the server is now {addr}",
    "сервер сменён на {addr} ({name})": "the server is now {addr} ({name})",
    "папка бота не найдена: выбери её в окне": "the bot folder wasn't found: choose it in the window",
    "снимок: {file}": "screenshot: {file}",
    "снимки: {err}": "screenshots: {err}",

    "неизвестное действие": "unknown action",
    "запрещено": "forbidden",
    "плохой адрес": "bad address",
    "плохой пароль": "bad password",
    "плохие настройки": "bad settings",
    "плохое значение {key}": "bad value for {key}",
    "плохое действие": "bad action",
    "плохой текст": "bad text",

    "Ник не может быть пустым": "The name can't be empty",
    "Не длиннее {n} символов": "At most {n} characters",
    "Слишком длинный пароль": "The password is too long",
    "Неизвестный мозг": "Unknown brain",
    "плохой адрес сервера": "bad server address",
    "не удалось запустить бота: {err}": "couldn't start the bot: {err}",
    "ошибка процесса бота: {err}": "bot process error: {err}",
    "страница бота не поднялась: {reason}": "the bot page didn't come up: {reason}",
    "бот ещё не запущен": "the bot isn't running yet",
    "{dir}: ещё {n} старых файлов не взято": "{dir}: {n} more old files left out",
    "плохое имя в архиве: {name}": "bad name in the archive: {name}",
    "файл больше 4 ГБ: {name}": "file larger than 4 GB: {name}",
    "архив больше 4 ГБ": "archive larger than 4 GB",
    "слишком много файлов для zip без ZIP64": "too many files for a zip without ZIP64",
    "не zip: нет конца каталога": "not a zip: no end of central directory",
    "ZIP64 не поддерживается": "ZIP64 isn't supported",
    "битый центральный каталог": "broken central directory",
    "битый заголовок: {name}": "broken header: {name}",
    "метод сжатия {m} не поддерживается: {name}": "compression method {m} isn't supported: {name}",
    "контрольная сумма не сошлась: {name}": "checksum mismatch: {name}",
  };

  function makeT(dict, lang) {
    const en = lang === "en";
    const has = (s) => Object.prototype.hasOwnProperty.call(dict, s);
    const fill = (s, p) => (p === undefined ? s : s.replace(/\{(\w+)\}/g, (m, k) => (p[k] === undefined ? m : String(p[k]))));
    const t = (s, p) => fill(en && has(s) ? dict[s] : s, p);
    let pats = null;
    const tr = (s, depth = 0) => {
      if (!en || typeof s !== "string" || !/[А-Яа-яЁё]/.test(s)) return s;
      if (has(s)) return dict[s];
      if (pats === null) {
        pats = [];
        for (const k of Object.keys(dict)) {
          if (!/\{\w+\}/.test(k)) continue;
          const keys = [];
          const src = k
            .split(/(\{\w+\})/)
            .map((part) => {
              const m = /^\{(\w+)\}$/.exec(part);
              if (m !== null) {
                keys.push(m[1]);
                return "([\\s\\S]*?)";
              }
              return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            })
            .join("");
          pats.push({ re: new RegExp("^" + src + "$"), keys, out: dict[k], lit: k.replace(/\{\w+\}/g, "").length });
        }
        pats.sort((a, b) => b.lit - a.lit);
      }
      for (const p of pats) {
        const m = p.re.exec(s);
        if (m === null) continue;
        const vals = {};
        p.keys.forEach((k, i) => {
          vals[k] = depth < 2 ? tr(m[i + 1], depth + 1) : m[i + 1];
        });
        return fill(p.out, vals);
      }
      return s;
    };
    return { t, tr };
  }

  function resolveLang(pref, languages) {
    if (pref === "ru" || pref === "en") return pref;
    return (languages || []).some((l) => /^ru/i.test(String(l))) ? "ru" : "en";
  }

  function translateDom(root, t, lang) {
    if (lang !== "en") return;
    for (const el of root.querySelectorAll("[data-t]")) {
      const v = t(el.dataset.t);
      if (v !== el.dataset.t) el.innerHTML = v;
    }
    const cyr = /[А-Яа-яЁё]/;
    const code = (n) => n.parentNode && (n.parentNode.nodeName === "SCRIPT" || n.parentNode.nodeName === "STYLE");
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (code(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.nodeValue;
      if (!cyr.test(s)) continue;
      const k = s.trim();
      const v = t(k);
      if (v !== k) n.nodeValue = s.replace(k, () => v);
    }
    for (const el of root.querySelectorAll("[title],[placeholder],[aria-label]")) {
      for (const a of ["title", "placeholder", "aria-label"]) {
        const v = el.getAttribute(a);
        if (v && cyr.test(v)) {
          const x = t(v);
          if (x !== v) el.setAttribute(a, x);
        }
      }
    }
  }

  return { EN, makeT, resolveLang, translateDom };
});
