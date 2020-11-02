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

## Usage
TODO
