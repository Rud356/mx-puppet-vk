# mx-puppet-vk
This is a Matrix <-> VK bridge based on [mx-puppet-bridge](https://github.com/Sorunome/mx-puppet-bridge).

It is it early development and should be considered as proof-of-concept.

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
    - [ ] Typing notifs - not possible yet
    - [ ] Presence - not possible yet
    - [ ] Read notifications - not possible yet
    - [x] Message edits
    - [ ] Message redacts
- VK -> Matrix
    - [x] Text content
    - [x] Image content
    - [x] Audio content
    - [ ] Video content
    - [x] Stickers
    - [ ] Other files
    - [ ] Presence - not effective to track
    - [x] Typing notifs
    - [x] User profiles
    - [ ] Read notifications - not effective to track
    - [x] Message edits
    - [ ] Message redacts

## Usage
1. Get VK community token (Just open the "Manage community" tab, go to "API usage" tab and click "Create token")
2. Activate Bots Long Poll API ("Manage community" → "API usage" → "Bots Long Poll API") and choose the latest API version. Make sure that under event types all message-realted events are turned on.
3. Activate an option to message your community. To allow group chats, activate it under bot capabilities.
4. On matrix, contact `@_vk_puppet_bot:your.domain` and type `link <vk token>`
5. Now, if someone contacts your community, you will be invited to the corresponding room on Matrix.

Plese note: when community is invited to the group chat as a bot, make sure it has message access. Only chat admins can change bot permissions.
