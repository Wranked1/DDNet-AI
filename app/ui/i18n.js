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
    "Официальный канал: t.me/aiddnet": "The official channel: t.me/aiddnet",
    "Оригинал и обновления: github.com/Wranked1/DDNet-AI": "The original and its updates: github.com/Wranked1/DDNet-AI",
    "Сайт бота": "The bot's website",
    "Официально только здесь:": "Official downloads only at:",
    "DDNet AI by Wranked1. Официально только здесь:": "DDNet AI by Wranked1. Official downloads only at:",
    "DDNet AI by Wranked1, бесплатно и с открытым кодом. Купил или скачал в другом месте? Оригинал:": "DDNet AI by Wranked1, free and open source. Bought it or got it elsewhere? The original:",
    "без сети: список серверов не загружается": "offline: the server list is not loaded",
    "сайт": "website",
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
    "обновилось само окно, перезапускаю его": "the window itself was updated, restarting it",
    "Рисовать видеокартой": "Draw with the graphics card",
    "Меньше нагрузки на процессор. Мусор или чёрный экран в окне: выключи. Работает после перезапуска окна": "Less load on the CPU. Garbage or a black screen in the window: turn it off. Takes effect after the window restarts",
    "Применится после перезапуска окна": "Takes effect after the window restarts",
    "Второй бот (дамми)": "Second bot (dummy)",
    "на тот же сервер, в тиме с первым": "on the same server, on the first one's team",
    "включить": "on",
    "ник второго бота, пусто: ник + 2": "the second bot's nick, empty: nick + 2",
    "Ник второго бота должен отличаться": "The second bot needs a different nick",
    "Режим для слабого ПК": "Mode for a weak PC",
    "Сильный режим": "Strong mode",
    "для мощного ПК": "for a strong PC",
    "В 3 раза больше вариантов в расчёте на ВБ, до 30 мс на решение: держит ВБ сильнее, но грузит процессор. Сам не включается, со слабым ПК не совмещается.": "Three times as many candidates in the search on the WB, up to 30 ms a decision: it holds the WB better but loads the CPU. Never turns on by itself, and not together with the weak PC mode.",
    "сильный режим": "strong mode",
    "пинг 1000 и бот стоит: включи": "ping 1000 and the bot stands still: turn it on",
    "Короче расчёт, новый план раз в два снимка: играет слабее, но успевает за сервером. Сам не включается.": "A shorter search, a new plan every two snapshots: it plays weaker but keeps up with the server. Never turns on by itself.",
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
    "Пинг": "Ping",
    "не ответил": "no answer",
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
    "Запуск: сервер, ник, второй бот, слабый ПК": "Launch: server, name, second bot, weak PC",
    "второй бот {name}": "second bot {name}",
    "вкл": "on",
    "режим для слабого ПК": "mode for a weak PC",
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
    "DDNet / Teeworlds (data: CC-BY-SA 3.0; скины, шрифты и ассеты под своими лицензиями). В бота не входит: окно берёт её из твоей установки DDNet, а недостающие скины качает с skins.ddnet.org в runs/skincache (выключается в «Настройки» > «В игре»). Код отрисовки частично по исходникам DDNet (zlib).":
      "DDNet / Teeworlds (data: CC-BY-SA 3.0; skins, fonts and assets under their own licenses). Not part of the bot: the window takes it from your DDNet install and downloads missing skins from skins.ddnet.org into runs/skincache (this can be turned off in Settings > In game). Part of the drawing code follows DDNet's sources (zlib).",
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
    "Причина: {reason}.": "Reason: {reason}.",
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

    "Игра": "Game",
    "Главная": "Home",
    "Что нового": "What's new",
    "Стоп": "Stop",
    "Мини": "Mini",
    "Остановить бота и вернуться на главную": "Stop the bot and go back to the home screen",
    "Остановить бота и закрыть программу": "Stop the bot and close the app",
    "Закрыть программу": "Close the app",
    "Закрыть DDNet AI?": "Close DDNet AI?",
    "бот остановлен кнопкой": "the bot was stopped from the button",
    "Нажми на ник, клан или скин, чтобы поменять": "Click the nick, clan or skin to change it",
    "Включено": "Enabled",
    "Пасфайндер": "Pathfinder",
    "пути по карте": "paths over the map",
    "Предвводы": "Pre-inputs",
    "ход соперника раньше": "the rival's move earlier",
    "Как человек": "Like a human",
    "курсор, эмоции": "cursor, emotes",
    "Второй бот": "Second bot",
    "дамми в тиме": "a dummy on your team",
    "Слабый ПК": "Weak PC",
    "если бот лагает": "if the bot lags",
    "мощный ПК": "a powerful PC",
    "все изменения →": "all changes →",
    "Новое в {version}": "New in {version}",
    "Записей нет": "No entries",
    "ИГРАТЬ": "PLAY",
    "К ИГРЕ": "TO THE GAME",
    "Введи ник, и можно играть": "Type a nick and you can play",
    "Запуск отменён": "Start cancelled",
    "отмена": "cancel",
    "введи ник": "type a nick",
    "нет клана": "no clan",
    "без клана": "no clan",
    "пусто: ник + 2": "empty: nick + 2",
    "пусто: как у первого": "empty: same as the first",
    "Ник второго бота": "The second bot's nick",
    "Клан второго бота": "The second bot's clan",
    "Поменять ник": "Change the nick",
    "Поменять клан": "Change the clan",
    "Не длиннее {n} байт": "At most {n} bytes",
    "Такое имя скина DDNet не принимает": "DDNet does not accept this skin name",
    "Найти скин": "Find a skin",
    "Такого скина нет": "No such skin",
    "взять «{name}»": "use \"{name}\"",
    "Показано {n} из {total}: уточни поиск": "Showing {n} of {total}: narrow the search",
    "Скины берутся из твоей установки DDNet, а её не нашлось: ти пока серые. Папку DDNet можно указать в «Настройки» > «В игре».":
      "Skins come from your DDNet install, and it was not found: the tees are grey for now. The DDNet folder can be set in Settings > In game.",
    "Применится при следующем запуске": "Takes effect on the next start",
    "применится через {n} с": "takes effect in {n} s",
    "Другой сервер": "Another server",
    "Сервер выберется сам": "The server will pick itself",
    "самый живой блок-сервер на момент запуска": "the liveliest block server at the moment of start",
    "{n} мс": "{n} ms",
    "не отвечает: возможно, выключен": "not answering: maybe it is down",
    "не отвечает": "not answering",
    "список серверов недоступен": "the server list is unavailable",
    "Избранные и недавние": "Favorites and recent",
    "самый живой блок": "the liveliest block",
    "Подключаюсь к серверу...": "Connecting to the server...",
    "Сервер не отвечает: {reason}": "The server is not answering: {reason}",
    "Сервер не отвечает, пробую снова": "The server is not answering, trying again",
    "в игре · {name}": "playing · {name}",
    "пинг {n}": "ping {n}",
    "Выбрать": "Choose",
    "Профиль": "Profile",
    "Запуск": "Launch",
    "Окно": "Window",
    "Ник, клан и скин можно менять и во время игры: сервер принимает смену раз в 5 секунд. Пока играет второй бот, ник и клан сменятся при следующем запуске.": "The nick, clan and skin can be changed while playing too: the server takes a change once every 5 seconds. While the second bot plays, the nick and clan change at the next start.",
    "так тебя увидят в игре": "how you will look in the game",
    "Открыть сервера": "Open the servers",
    "Пароль": "Password",
    "не нужен": "not needed",
    "Пароль сохранён": "Password saved",
    "Пароль стёрт": "Password cleared",
    "Адрес и пароль применятся при следующем запуске бота. Пароль принадлежит серверу: при другом адресе старый сотрётся.": "The address and password take effect on the bot's next start. The password belongs to its server: with another address the old one is cleared.",
    "Запускать сразу": "Start at once",
    "Бот начнёт играть сам, как откроется окно. Выключено: ждёт кнопку ИГРАТЬ.": "The bot starts playing by itself as soon as the window opens. Off: it waits for the PLAY button.",
    "Отсчёт": "Countdown",
    "с, 0: сразу": "s, 0: at once",
    "Отметка тиков": "Tick stamping",
    "Каждый ввод называет тик сервера, для которого он. Выключено по умолчанию.": "Every input names the server tick it is for. Off by default.",
    "Тестовые функции": "Test features",
    "Проверены меньше, чем то, что включено по умолчанию. Дуэль и пробные настройки планировщика, пока бот играет: «В игре».": "Tested less than what is on by default. The duel mode and the planner's trial settings, while the bot plays: \"In game\".",
    "Где проверен": "Where checked",
    "Только где быстрее": "Only where faster",
    "Выкл": "Off",
    "тест": "test",
    "Что можно поменять на лету, меняется сразу. Остальное применится при следующем запуске.": "What can change on the fly changes at once. The rest takes effect on the next start.",
    "Тема": "Theme",
    "Светлая": "Light",
    "Тёмная": "Dark",
    "все…": "all…",
    "Шрифты": "Fonts",
    "Unbounded, Golos Text и JetBrains Mono под SIL Open Font License, тексты лицензий лежат в ui/fonts.": "Unbounded, Golos Text and JetBrains Mono are under the SIL Open Font License; the license texts are in ui/fonts.",

    "Записи": "Clips",
    "Записи бота": "The bot's clips",
    "В игре": "In game",
    "Настройки бота в игре": "The bot's settings in game",
    "Записи и дуэли появятся, когда бот играет. Нажми ИГРАТЬ на главной.": "Clips and duels show up once the bot plays. Press PLAY on the home screen.",
    "Автоматический чат, приказы в чате, графика DDNet и настройки поиска появятся, когда бот играет. Нажми ИГРАТЬ на главной.": "The automatic chat, the chat orders, DDNet graphics and the search settings show up once the bot plays. Press PLAY on the home screen.",
    "поиск": "search",
    "ничего не нашлось": "nothing found",
    "Меньше": "Less",
    "Больше": "More",
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
