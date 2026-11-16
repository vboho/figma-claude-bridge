# Claude Code Bridge для Figma

Плагин, который даёт Claude Code проектировать интерфейсы прямо в Figma. Работает на бесплатном тарифе.

```
Claude Code ⇄ (MCP, stdio) ⇄ server/server.js ⇄ (WebSocket localhost:3055) ⇄ плагин в Figma Desktop
```

## Быстрая установка: пусть Claude сделает всё сам

Откройте Claude Code и вставьте этот текст целиком:

````text
Установи мне плагин Claude Code Bridge для Figma из репозитория https://github.com/vboho/figma-claude-bridge.

1. Склонируй репозиторий в ~/figma-claude-bridge (если папка уже есть, сделай git pull).
2. Проверь, что установлен Node.js 18+. Если нет, скажи мне, как его поставить.
3. Выполни `npm install` в папке server.
4. Подключи MCP-сервер для всех моих проектов:
   claude mcp add -s user figma-bridge -- node <абсолютный путь>/server/server.js
5. Выведи абсолютный путь к файлу plugin/manifest.json.
6. Напиши мне, что сделать вручную в Figma Desktop:
   Plugins → Development → Import plugin from manifest… → выбрать этот manifest.json.
7. Скажи, что нужно полностью перезапустить Claude Code, чтобы появились инструменты figma_*.
````

Одно ручное действие всё равно останется: импорт манифеста в Figma. Claude не может сделать это за вас.

## Установка вручную

1. `git clone https://github.com/vboho/figma-claude-bridge && cd figma-claude-bridge/server && npm install`
2. Подключите мост к Claude Code (путь замените на свой):
   ```bash
   claude mcp add -s user figma-bridge -- node /ABS/PATH/figma-claude-bridge/server/server.js
   ```
3. Figma Desktop → любой файл → Plugins → Development → Import plugin from manifest… → `plugin/manifest.json`.

## Использование

1. Запустите Claude Code. Мост стартует сам.
2. В Figma: Plugins → Development → Claude Code Bridge. Статус **Active** означает, что всё подключено.
3. Попросите Claude: «Спроектируй экран логина в Figma».

Статусы: **Offline** (оранжевый), **Active** (зелёный), **Working** (голубой, кот печатает). Кнопка свёрнутого режима уменьшает окно до маленькой плашки.

## Требования

- Figma Desktop (в браузере плагины из манифеста не запускаются)
- Node.js 18+
- Claude Code

## Инструменты для Claude

| Инструмент | Что делает |
|---|---|
| `figma_build` | Строит дерево узлов из компактного JSON (самый дешёвый способ создавать UI) |
| `figma_tree` | Текстовый контур поддерева вместо скриншота |
| `figma_info` | Файл, страница, выделение |
| `figma_execute` | Произвольный JS через Plugin API |
| `figma_screenshot` | PNG узла (дорого по токенам, используйте в конце) |

## Если не подключается

- Убедитесь, что плагин запущен в Figma, а Claude Code перезапущен после `claude mcp add`.
- Порт 3055 должен быть свободен. Свой порт можно задать переменной `FIGMA_BRIDGE_PORT`, но тогда нужно поменять его и в плагине.
- Несколько сессий Claude Code работают вместе: первая становится хабом, остальные подключаются к ней.

## Безопасность

Мост слушает только `127.0.0.1` и отклоняет подключения с обычных сайтов (проверка Origin). `figma_execute` выполняет произвольный код в Figma, поэтому запускайте плагин только когда он нужен.

## Для разработчиков

Интерфейс плагина редактируется в `plugin/ui.src.html`. После правок выполните:

```bash
cd plugin && node build-ui.mjs
```

Скрипт вшивает видео и постер из `plugin/assets/` и создаёт `ui.html`. Не правьте `ui.html` вручную.
