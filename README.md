# llm-proxy-debugger

Локальный прокси-gateway для отладки LLM-агентов. Он встаёт между клиентом
(Claude Code, OpenCode и т. п.) и реальным API модели, **логирует каждый
запрос и ответ**, а затем показывает их в веб-интерфейсе. Удобно посмотреть,
какие запросы агенты для кодинга отправляют «под капотом».

## Содержание

- [Как это работает](#как-это-работает)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
- [Конфигурация](#конфигурация)
  - [Структура `config.ts`](#структура-configts)
  - [Переменные окружения](#переменные-окружения)
  - [Как передавать URL-ы](#как-передавать-url-ы)
  - [Провайдеры](#провайдеры)
  - [Ремаппинг моделей](#ремаппинг-моделей)
- [Запуск](#запуск)
  - [Прокси-сервер](#прокси-сервер)
  - [Подключение клиента](#подключение-клиента)
  - [UI-дашборд](#ui-дашборд)
- [Где хранятся логи](#где-хранятся-логи)
- [npm-скрипты](#npm-скрипты)
- [Тесты](#тесты)

## Как это работает

```
                            ┌──────────────────────────┐
  Claude Code / OpenCode     │     llm-proxy-debugger    │      Реальное API
  ─────────────────────►     │                          │   ───────────────►
  http://localhost:4344      │  1. логирует входящий     │   target.baseUrl
    /anthropic/v1/...        │     запрос               │
    /openai/v1/...           │  2. (при необходимости)   │
                             │     конвертирует формат  │
                             │  3. форвардит в upstream  │
                             │  4. логирует ответ        │
                             └──────────────────────────┘
                                          │
                                          ▼
                                  sessions/<id>/...
                                          │
                                          ▼
                             UI-дашборд (http://localhost:4380)
```

Прокси поднимает два маршрута:

| Локальный маршрут                        | Назначение                          |
| ---------------------------------------- | ----------------------------------- |
| `http://localhost:<port>/anthropic/v1`   | приём запросов в формате Anthropic  |
| `http://localhost:<port>/openai/v1`      | приём запросов в формате OpenAI     |

Каждый запрос сохраняется в `sessions/`, после чего форвардится в upstream,
указанный в конфигурации. Ответ так же логируется и возвращается клиенту.

## Требования

- Node.js 18+ (разрабатывалось на Node 22).
- npm.

## Быстрый старт

```bash
# 1. зависимости
npm install

# 2. конфигурация окружения
cp .env.example .env
#    затем впишите в .env свои API-ключи и (при необходимости) URL-ы

# 3. запуск прокси
npm run start
```

После старта в консоли появятся адреса маршрутов. Направьте на них своего
агента (см. [Подключение клиента](#подключение-клиента)).

## Конфигурация

Конфигурация состоит из двух частей:

1. **`config.ts`** — структура конфигурации (порт, маршруты, ремаппинг
   моделей). Это TypeScript-файл, а не JSON: правится напрямую.
2. **`.env`** — секреты и адреса upstream-ов (API-ключи, базовые URL-ы,
   выбор провайдера). `config.ts` подхватывает их через `dotenv`.

Принцип такой: **что меняется между окружениями (URL-ы, ключи, провайдер) —
задаётся через `.env`; структура маршрутов и таблицы ремаппинга — в
`config.ts`.**

### Структура `config.ts`

```ts
interface Config {
  proxy: {
    port: number;          // порт локального прокси
    anthropic: RouteConfig; // маршрут /anthropic/v1
    openai: RouteConfig;    // маршрут /openai/v1
  };
}

interface RouteConfig {
  local: {
    baseUrl: string;       // префикс локального маршрута, напр. 'anthropic/v1'
  };
  target: {
    baseUrl: string;       // куда форвардить (upstream)
    provider: Provider;    // 'openai-compatible' | 'anthropic'
    apiKey: string;        // API-токен для upstream
    modelsRemapping: Record<string, string>; // подмена имён моделей
  };
}
```

| Поле                    | Что задаёт                                                        |
| ----------------------- | ----------------------------------------------------------------- |
| `proxy.port`            | порт, на котором слушает прокси (`PROXY_PORT`, по умолчанию 4344). |
| `local.baseUrl`         | под каким путём маршрут доступен локально.                        |
| `target.baseUrl`        | адрес реального API, куда уходит запрос.                          |
| `target.provider`       | как общаться с upstream — см. [Провайдеры](#провайдеры).          |
| `target.apiKey`         | токен, который прокси подставляет в запрос к upstream.            |
| `target.modelsRemapping`| таблица подмены имён моделей перед отправкой в upstream.          |

### Переменные окружения

Все секреты и адреса задаются в `.env` (шаблон — `.env.example`):

| Переменная                 | Обязательная | По умолчанию                                  | Назначение                                                        |
| -------------------------- | ------------ | --------------------------------------------- | ----------------------------------------------------------------- |
| `PROXY_PORT`               | нет          | `4344`                                        | порт прокси-сервера.                                              |
| `ANTHROPIC_TARGET_PROVIDER`| нет          | `openai-compatible`                           | провайдер для маршрута `/anthropic/v1` (`openai-compatible` или `anthropic`). |
| `ANTHROPIC_TARGET_BASE_URL`| нет          | `https://api.eliza.yandex.net/openrouter/v1`  | upstream для маршрута `/anthropic/v1`.                            |
| `ANTHROPIC_API_KEY`        | **да**       | —                                             | токен для anthropic-upstream.                                    |
| `OPENAI_TARGET_BASE_URL`   | нет          | `https://api.eliza.yandex.net/raw/openai/v1`  | upstream для маршрута `/openai/v1`.                              |
| `OPENAI_API_KEY`           | **да**       | —                                             | токен для openai-upstream.                                       |

Отдельные переменные для UI-дашборда:

| Переменная           | По умолчанию               | Назначение                              |
| -------------------- | -------------------------- | --------------------------------------- |
| `UI_PORT`            | `4380`                     | порт UI-дашборда.                      |
| `PROX_SESSIONS_DIR`  | `./sessions`               | папка с логами, которую читает UI.      |
| `UI_CLIENT_DIR`      | `src/ui/client/dist`       | папка со собранным фронтендом UI.       |

> Если `ANTHROPIC_API_KEY` или `OPENAI_API_KEY` не заданы, прокси не
> стартует и сообщает, какой переменной не хватает.

### Как передавать URL-ы

Адрес upstream-а («куда проксировать») задаётся через `*_TARGET_BASE_URL`.
Запрос уходит на `target.baseUrl` + путь эндпоинта.

**Сценарий 1. OpenAI-совместимый шлюз (по умолчанию).**
Свой аналог OpenRouter, который принимает запросы в формате OpenAI Chat
Completions:

```dotenv
ANTHROPIC_TARGET_PROVIDER=openai-compatible
ANTHROPIC_TARGET_BASE_URL=https://openrouter.ai/api/v1
ANTHROPIC_API_KEY=sk-...

OPENAI_TARGET_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-...
```

Здесь запросы с маршрута `/anthropic/v1` конвертируются в формат OpenAI и
уходят на `…/v1/chat/completions`.

**Сценарий 2. Прямые запросы в Anthropic API.**
Маршрут `/anthropic/v1` ходит напрямую в Anthropic Messages API, без
конвертации формата:

```dotenv
ANTHROPIC_TARGET_PROVIDER=anthropic
ANTHROPIC_TARGET_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_API_KEY=sk-ant-...
```

> Для провайдера `anthropic` базовый URL указывается вместе с сегментом
> `/v1` — официальный SDK сам обращается к `…/v1/messages`.

### Провайдеры

`target.provider` определяет, как маршрут общается с upstream-ом:

| Провайдер           | Поведение                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `openai-compatible` | upstream принимает формат OpenAI Chat Completions. Запросы с `/anthropic/v1` конвертируются Anthropic → OpenAI, ответ — обратно OpenAI → Anthropic (включая потоковые SSE). |
| `anthropic`         | upstream — настоящий Anthropic Messages API. Запросы с `/anthropic/v1` форвардятся напрямую через официальный `@anthropic-ai/sdk`, без конвертации формата. |

Маршрут `/openai/v1` всегда работает как прозрачный pass-through к
OpenAI-совместимому upstream-у.

### Ремаппинг моделей

`target.modelsRemapping` подменяет имя модели в запросе перед отправкой в
upstream. Поддерживаются glob-шаблоны (`*` — любая подстрока):

```ts
modelsRemapping: {
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6', // точное совпадение
  '*haiku*':           'anthropic/claude-3.5-haiku',  // по шаблону
  '*':                 'anthropic/claude-sonnet-4.6', // фолбэк
}
```

Порядок разрешения: точное совпадение → шаблоны (в порядке объявления) →
имя остаётся без изменений. Для провайдера `anthropic` таблица по умолчанию
пустая — имена моделей пробрасываются как есть.

## Запуск

### Прокси-сервер

```bash
npm run start
```

Команда собирает проект (`tsup`) и запускает прокси. В консоли появится:

```
Proxy listening on http://localhost:4344
  Anthropic: http://localhost:4344/anthropic/v1
  OpenAI:    http://localhost:4344/openai/v1
```

### Подключение клиента

Направьте своего агента на локальный прокси вместо реального API:

**Anthropic-клиент (Claude Code, Anthropic SDK):**

```bash
export ANTHROPIC_BASE_URL=http://localhost:4344/anthropic
# клиент сам обращается к …/anthropic/v1/messages
```

**OpenAI-клиент (OpenCode, OpenAI SDK):**

```bash
export OPENAI_BASE_URL=http://localhost:4344/openai/v1
# клиент сам обращается к …/openai/v1/chat/completions
```

После этого все запросы агента пройдут через прокси и попадут в логи.

### UI-дашборд

Веб-интерфейс для просмотра залогированных сессий:

```bash
npm run ui       # сборка фронтенда + запуск UI на http://localhost:4380
npm run ui:dev   # режим разработки с hot-reload
```

UI читает логи из папки `sessions/` (см. `PROX_SESSIONS_DIR`).

## Где хранятся логи

Каждый запуск прокси создаёт новую нумерованную сессию. Структура:

```
sessions/
  <session-id>/
    requests/
      <request-id>/
        request.json        # запрос как его прислал клиент (нормализованный)
        raw_request.json    # запрос, ушедший в upstream
        raw_response.json   # сырой ответ upstream-а
        response.json       # ответ, отданный клиенту
        meta.json           # тайминги
```

## npm-скрипты

| Скрипт              | Что делает                                                  |
| ------------------- | ----------------------------------------------------------- |
| `npm run start`     | сборка + запуск прокси-сервера.                            |
| `npm run build`     | только сборка (`tsup` → `dist/`).                           |
| `npm run test`      | прогон тестов (`vitest`).                                   |
| `npm run test:watch`| тесты в watch-режиме.                                       |
| `npm run ui`        | сборка фронтенда + запуск UI-дашборда.                      |
| `npm run ui:dev`    | UI в режиме разработки (API + Vite, hot-reload).            |

## Тесты

```bash
npm run test
```

Тесты используют `vitest`, поднимают реальный прокси-сервер на случайном
порту и мокают исходящие HTTP-запросы к upstream-ам, так что обращений в сеть
не происходит.
