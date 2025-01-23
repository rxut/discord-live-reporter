# UT99 Discord Reporter Bot

This bot will relay information from a UT99 server onto Discord.

You need to generate your Token in the [Discord Developer Portal](https://discord.com/developers/applications)

Also, ensure the ports you're assigning are open and that the passwords match what you configured on the UT Server Actor.

This version supports multiple UT Servers through different ports, and it also supports auto-reconnecting in case you reset the bot.


## Installation

Node.js v6.x or newer is required.

Install dependencies using `npm install`.

```bash
npm install
npm run build
npm run start
```

Or `npm run serve` to start the bot while monitoring for changes (handy while developing).

## Configuration

Create a config.json that looks like this:

```json
{
  "token":  "",
  "prefix": ".",
  "debug": false,
  "servers": [
    {
      "name": "Server 1",
      "port": 5000,
      "password": "password",
      "channel": "1111111111111111111"
    },
    {
      "name": "Server 2",
      "port": 5001,
      "password": "password",
      "channel": "1111111111111111111"
    },
    {
      "name": "Server 3",
      "port": 5002,
      "password": "password",
      "channel": "1111111111111111111"
    }
  ]
}
```

## Contributions

This bot was originally created by sn3p https://github.com/sn3p/discord-reporter
