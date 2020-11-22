[![Matrix](https://img.shields.io/matrix/mx-puppet-vk:sunbutt.faith?logo=matrix&server_fqdn=gospel.sunbutt.faith)](https://matrix.to/#/#mx-puppet-vk:inex.rocks?via=inex.rocks&via=sunbutt.faith)

# mx-puppet-vk
This is a Matrix <-> VK bridge based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge) and [VK-IO](https://github.com/negezor/vk-io).

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
    - [ ] Typing notifs - [see note](#Note-on-presence-from-matrix-side)
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
    - [ ] Typing notifs
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
