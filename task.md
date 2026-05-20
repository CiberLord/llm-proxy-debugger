# Прокси gateway для ллм c логированием запросов

Нужно написать проксю которая будет логировать все запросы к апи ИИ моделей. Потом я посмотрю как работает каждый вызов.
Прокся должна подниматься на localhost

## Для чего

Хочу посмотреть как работают ИИ-агента для кодинга под капотом, какие запросы отправяют для доклада в IT-конференции
Буду тестировать:
- Claude Code
- OpenCode

## Что вообще ожидаю?

Когда будет подинматься сервер:
```
npm run start
```

Бдуте подниматься прокси сервер, который будет торчать наружу так:

```
http://localhost:<proxy_port>/anthropic/v1
```

Для openai будет такой:
```
http://localhost:<proxy_port>/openai/v1
```

Далее когда запрос прилетает по этому урлу. Нужно залогировать именно тот запрос который прилетел в наш сервер.

И далее отправиь весь запрос целиком уже в апи endpoint-ы натсоящих ЛЛМ моделей.

Но эндпонитны тоже устроены хитро.
Нужно реализовать механизм конвертации anthropic в openai-compatible. Условно у нас развернут свой аналог Openrouter
который проксирует также запросы.
Обьязательно сделай конфигурацию в json, где я смогу указать куда проксировать:
```
anthropic/v1 -> <real our proxy gateway>
openai/v1 -> <real our proxy gateway>
```

Также в конфигурации должна быть возможность указать ключ(API Token) который можно задать.

ожидаю такой конфиг как пример(можно сразу в ts если так будет проще):
```ts
{
    proxy: {
        port: 4344,

        anthropic: {
            local: {
                baseUrl: 'anthropic/v1',
            },
            target: {
                baseUrl: 'https://openrouter.ai/api/v1',
                provider: 'openai-compatible', // вот тут говорим что реальный провайдер отдает openai compatible
                apiKey: '...',

                modelsRemapping: { // вот эта карта маппинга моделей это важно для антропика. Условно claude code работает ж  только с anthropic моделями, а мне нужно потом коррекно их смаппить на нужные модели:
                    "claude-sonnet-4-5": "openai/gpt-5.2",
                    "claude-sonnet-4-6": "openai/gpt-5.2",
                    "*": "openai/codex", // <- это пример если ни одна модель не сматчилась, то отправляем на модель по умолчанию
                }
            }
        },

        openai: {
            local: {
                baseUrl: 'openai/v1',
            },

            target: {
                baseUrl: 'https://openrouter.ai/api/v1',
                apiKey: '...',

                provider: 'openai-compatible'

                modelsRemapping: { // для openai тоже нужен ремаппинг.
                    "glm-4.7": "openai/gpt-4.1",
                    '*': 'openai/gpt-turbo-1'
                }
            }
        }
    }
}
```

## Процесс логирования

И так нужно логировать именно то что приходит клиентов(ИИ-агентов)
И то что уходит приходит в реальные хосты тоже нужно логировать.
И смотри давай срауз логи должны человекчитаемыми и в json.
Каждый запуск сервер не должен удалять историю предыдущих записей.
Поэтому при запуске создается папка sessions и в уже подпапки с сессиями каждая сессия это тоже папка с номером.
```
sessions/
    1/
        raw_request.json
        raw_response.json
        request.json
        response.json
    2/
        raw_request.json
        raw_response.json
        request.json
        response.json
    3/
        raw_request.json
        raw_response.json
        request.json
        response.json
```

raw_request.json - то что ушло в реальный эндпоинт - тут логируем все и загаловки и методы и body
raw_response.json - логируем весь ответ все ошибки все все.
request.json - логиуем только body (ведь правда все полезное только в body?) + request_url
response.json - логируем только body (и не успешные ответы там 400, 404, 429  тоже логироват ьесли есть body иначе null)
важно в боди мне увидеть количество потраченных токенов(ну вроде оно там есть)

Формат json сразу в pretty. Чтобы было удобно читать.

## Как тестировать.

Во время реализации, после реализации можешь дергать апи opnerouter, я разершаю
Скидываю хосты и креды
```sh

baseUrl: https://openrouter.ai/api/v1
apiKey: <OPENROUTER_API_KEY>
model: anthropic/claude-sonnet-4.6
"Authorization": "Bearer <OPENROUTER_API_KEY>",
```

## архитектура

Проект частично настроен
 - typescript
 - сборка tsup
 - нужные пакеты которые в помощь для походов по апи. Может есть готовые конвертеры по ищи в npm