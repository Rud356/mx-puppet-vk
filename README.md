[![Matrix](https://img.shields.io/matrix/mx-puppet-vk:sunbutt.faith?logo=matrix&server_fqdn=gospel.sunbutt.faith)](https://matrix.to/#/#mx-puppet-vk:inex.rocks?via=inex.rocks&via=sunbutt.faith)

# mx-puppet-vk
This is a Matrix <-> VK bridge based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge) and [VK-IO](https://github.com/negezor/vk-io).

Это мост между Matrix и Вконтакте, основанный на [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge) и [VK-IO](https://github.com/negezor/vk-io).

[Документация на русском ниже.](#Docs-in-Russian)

It is in early development. Right now it logs message data when log level includes "info" level.

Relay mode works too, but we don't recommend it.

## Installation
```bash
git pull https://github.com/innereq/mx-puppet-vk
npm install
npm run build
```
Next copy the `sample.config.yaml` to `config.yaml`, edit it and then run `npm run start -- -r` to generate a registration file.
Register that one with synapse and start the bridge with `npm run start`.

## Features and roadmap
- Matrix -> VK
    - [x] Text content
    - [x] Image content
    - [x] Audio/Video content
    - [x] Other files
    - [x] Replies
    - [x] Typing notifs - [see note](#Note-on-presence-from-matrix-side)
    - [ ] Presence - ~~not possible yet~~
    - [ ] Read notifications - ~~not possible yet~~
    - [x] Message edits
    - [x] Message redacts - works as edit, real redact unavailable without being admin in chat
    - [ ] Initiate rooms from the matrix side
- VK -> Matrix
    - [x] Text content
    - [x] Forwards
    - [x] Image content
    - [x] Audio content
    - [ ] Video content
    - [x] Stickers
    - [x] Other files
    - [ ] Presence - not effective to track
    - [x] Typing notifs
    - [x] User profiles
    - [ ] Read notifications - not effective to track
    - [x] Message edits
    - [ ] Message redacts - doesn't work
    - [ ] Autopopulate rooms with users
- Edge cases to work around
    - [ ] Access token revoked on VK side
    - [ ] Bot is kicked out on VK side
    - Probably more, send an issue!

## Usage

[Video demonstration by Coma Grayce](https://youtu.be/nBRBUA9beXs)

1. Get VK community token (Just open the "Manage community" tab, go to "API usage" tab and click "Create token")
2. Activate Bots Long Poll API ("Manage community" → "API usage" → "Bots Long Poll API") and choose the latest API version. Make sure that under event types all message-realted events are turned on.
3. Activate an option to message your community. To allow group chats, activate it under bot capabilities.
4. On matrix, contact `@_vk_puppet_bot:your.domain` and type `link <vk token>`
5. Now, if someone contacts your community, you will be invited to the corresponding room on Matrix.

Plese note: when community is invited to the group chat as a bot, make sure it has message access. Only chat admins can change bot permissions.

Bridge doesn't handle being kicked from chat yet.

### Relay usage

See [mx-puppet-bridge docs](https://github.com/Sorunome/mx-puppet-bridge#relay-mode)

### Note on presence from matrix side

For presence bridging from Matrix side (including typing) your Synapse server has to be on 1.22.0 or later.

Also, make sure your registration file contains this:

```
de.sorunome.msc2409.push_ephemeral: true
```

## Using a user token instead of group bot

This is experimental and is not the main goal of this bridge.

To get a user token, use something like this:

```
https://oauth.vk.com/authorize?client_id=<CLIENT_ID>&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=friends,messages,offline,docs,photos,video'&response_type=token&v=5.126
```

- Matrix -> VK (AS A USER)
    - [x] Text content
    - [x] Image content
    - [x] Audio/Video content
    - [x] Other files
    - [x] Replies
    - [x] Typing notifs
    - [ ] Presence
    - [ ] Read notifications
    - [x] Message edits
    - [x] Message redacts - in 24 hours
    - [ ] Initiate rooms from the matrix side
- VK (AS A USER) -> Matrix
    - [x] Auth as a user instead of group
    - [x] Text content
    - [x] Forwards
    - [ ] Image content
    - [ ] Audio content
    - [ ] Video content
    - [ ] Stickers
    - [ ] Other files
    - [ ] Presence
    - [x] Typing notifs
    - [x] User profiles
    - [ ] Read notifications
    - [x] Message edits
    - [ ] Message redacts
    - [ ] Autopopulate rooms with users

To avoid imposture, do **not** use relay mode with user tokens!

# Docs in Russian

Это мост между Matrix и Вконтакте, основанный на [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge) и [VK-IO](https://github.com/negezor/vk-io).

Находится в ранней разработке. Содержание сообщений выводится в логи, если уровень логов включает в себя уровень "info".

Режим релея работает, но мы его не рекоммендуем.

## Установка
```bash
git pull https://github.com/innereq/mx-puppet-vk
npm install
npm run build
```
Затем скопируйте `sample.config.yaml` в `config.yaml`, отредактируйте его, и затем запустите `npm run start -- -r` чтобы сгенерировать регистрационный файл.
Зарегистрируйте его на вашем сервере Synapse и запустите мост коммандой `npm run start`.

## Реализованные функции и план разработки
- Matrix -> Вконтакте
    - [x] Текстовые сообщения
    - [x] Изображения
    - [x] Аудио и видео
    - [x] Прочие файлы
    - [x] Ответы
    - [x] Индикатор печати - [смотрите примечание](#Примечание-о-эфемерных-событиях)
    - [ ] Индикатор "в сети"
    - [ ] Индикаторы прочтения
    - [x] Редактирование сообщений
    - [x] Удаление сообщений - работает как редактирование
    - [ ] Инициация чатов со стороны Matrix
- Вконтакте -> Matrix
    - [x] Текстовые сообщения
    - [x] Пересланные сообщения
    - [x] Изображения
    - [x] Аудио
    - [ ] Видео
    - [x] Стикеры
    - [x] Прочие файлы
    - [ ] Индикатор "в сети" - Не эффективно отслеживать
    - [x] Индикатор печати
    - [x] Имена и аватарки пользователей
    - [ ] Индикаторы прочтения - Не эффективно отслеживать
    - [x] Редактирование сообщений
    - [ ] Удаление сообщений - не работает
    - [ ] Автоматическое заполнение комнаты пользователями
- Крайние случаи, которые надо проработать
    - [ ] Токен доступа отозван со стороны Вконтакте
    - [ ] Бот выгнан из чата со стороны Вконтакте
    - Возможно больше, открывайте issue!

## Использование

[Видео демонстрация от Coma Grayce](https://youtu.be/nBRBUA9beXs)

1. Получите токен сообщества Вконтакте. Откройте раздел «Управление сообществом» («Управление страницей», если у Вас публичная страница), выберите вкладку «Работа с API» и нажмите «Создать ключ доступа». Не забудьте предоставить доступ к сообщениям.
2. Активируйте Long Poll API (откройте раздел «Управление сообществом», на вкладке «Работа с API» → «Long Poll API» выберите «Включён») и выберите самую актуальную версию API, так как по умолчанию выбрана устаревшая, с ней не работает. Убедитесь, что во вкладке типов событий выбраны все события в категории сообщений.
3. Во вкладке сообщений, активируйте сообщения сообщества. Чтобы позволить добавлять сообщества в групповые чаты, активируйте это во вкладке возможностей ботов.
4. В matrix, напишите боту `@_vk_puppet_bot:ваш.домен` и напишите `link <токен вк>`
5. Теперь, если кто-то напишет вашему сообществу, со стороны Matrix вас пригласят в соответствующую комнату.

Обратите внимание: когда сообщество приглашено в групповой чат как бот, убедитесь что у бота есть права на чтение сообщений. Только администраторы чата могут менять права ботов.

### Использование в качестве релея

Смотрите [документацию mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge#relay-mode) (на английском)

### Примечание о эфемерных событиях

Для пересылки эфемерных событий со стороны Matrix (включая индикаторы печати), ваш сервер Synapse должен быть версии 1.22.0 или выше.

Также, ваш файл регистрации должен включать в себя эту строку:

```
de.sorunome.msc2409.push_ephemeral: true
```

## Использования токена пользователя вместо сообщества

Это экспериментально и не является оригинальной целью моста.

Чтобы получить токен пользователя, можете использовать сервис [vkhost.github.io](https://vkhost.github.io) или вручную выполнить запрос как этот:

```
https://oauth.vk.com/authorize?client_id=<CLIENT_ID>&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=friends,messages,offline,docs,photos,video'&response_type=token&v=5.126
```

- Matrix -> Вконтакте (как пользователь)
    - [x] Текстовые сообщения
    - [x] Изображения
    - [x] Аудио и видео
    - [x] Прочие файлы
    - [x] Ответы
    - [x] Индикатор печати
    - [ ] Индикатор "в сети"
    - [ ] Индикаторы прочтения
    - [x] Редактирование сообщений
    - [x] Удаление сообщений - в течении 24 часов
    - [ ] Инициация чатов со стороны Matrix
- Вконтакте (как пользователь) -> Matrix
    - [x] Текстовые сообщения
    - [x] Пересланные сообщения
    - [ ] Изображения
    - [ ] Аудио
    - [ ] Видео
    - [ ] Стикеры
    - [ ] Прочие файлы
    - [ ] Индикатор "в сети"
    - [x] Индикатор печати
    - [x] Имена и аватарки пользователей
    - [ ] Индикаторы прочтения
    - [x] Редактирование сообщений
    - [ ] Удаление сообщений
    - [ ] Автоматическое заполнение комнаты пользователями

Чтобы избежать самозванства, **не** используйте режим релея с токенами пользователя!
