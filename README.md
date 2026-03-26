# @kadbbz/mqtt-channel

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MQTT channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) — bidirectional messaging via MQTT brokers.

## Features

- 🔌 **Bidirectional messaging** — subscribe and publish to MQTT topics
- 🔁 **Robust reconnection** — recovers from broker restarts and cold starts
- 🔒 **TLS support** — secure connections to cloud brokers
- ⚡ **QoS levels** — configurable delivery guarantees (0, 1, 2)

## Installation

```bash
openclaw plugins install @kadbbz/mqtt-channel
```

## Configuration

Add to `~/.openclaw/openclaw.json`:

```json5
{
  "channels": {
    "mqtt-channel": {
      "accounts": {
        "admin": {
          "brokerUrl": "mqtts://your_server:8883",
          "username": "your_name",
          "password": "your_password",
          "topics": {
            "inbound": "openclaw/inbound-admin",
            "outbound": "openclaw/outbound-admin"
          },
          "qos": 1,
          "disableBlockStreaming": false
        },
        "lowcode": {
          "brokerUrl": "mqtts://your_server:8883",
          "username": "your_name",
          "password": "your_password",
          "topics": {
            "inbound": "openclaw/inbound-lowcode",
            "outbound": "openclaw/outbound-lowcode"
          },
          "qos": 1,
          "disableBlockStreaming": false
        }
      }
    }
  },
  "plugins": {
    "allow": [
      "mqtt-channel"
    ],
    "entries": {
      "mqtt-channel": {
        "enabled": true
      }
    }
  },
}
```

Each key under `channels["mqtt-channel"].accounts` is an OpenClaw account ID. The gateway will start one MQTT client per account and route inbound/outbound topics independently.

Legacy single-account config is still accepted and treated as `default`, but new setups should use `accounts`.

Then restart the gateway:

```bash
openclaw gateway restart
```

If " Cannot find module 'openclaw/plugin-sdk'" occurred, navigate to your OpenClaw extensions folder (often ~/.openclaw/extensions/mqtt-channel or /usr/lib/node_modules/openclaw/extensions/mqtt-channel), then run npm install inside that directory for walkround.

## Usage

### Sessions & correlation IDs (important)

- **Sessions are keyed by `senderId`** → OpenClaw uses `{senderId}` as the SessionKey, so memory and conversation history are grouped by sender.
- **`correlationId` is request‑level only** → if you include it in inbound JSON, it’s echoed back in the outbound reply for client-side matching. It does **not** create a new session or change memory.

If you want separate conversations, use distinct `senderId`s.

### Receiving messages (inbound)

Messages published to an account's `inbound` topic will be processed by OpenClaw.
You can send either plain text or JSON (recommended):

```bash
# Plain text (admin account)
mosquitto_pub -t "openclaw/inbound-admin" -m "Alert: Service down on playground"

# JSON (recommended, lowcode account)
mosquitto_pub -t "openclaw/inbound-lowcode" -m '{"senderId":"pg-cli","text":"hello","correlationId":"abc-123"}'
```

### Sending messages (outbound)

Agent replies are published to that account's `outbound` topic as JSON:

```json
{"senderId":"openclaw","text":"...","kind":"final","ts":1700000000000}
```

If you want to publish custom text via CLI, use the `message` tool:

```bash
openclaw agent --message "Send MQTT: Temperature is 23°C"
```

## Security

**Important:** Any client that can publish to the inbound topic has full access to your OpenClaw agent. Treat MQTT as a **trusted channel only** (restricted broker, auth, private network). If you need untrusted access, add a validation layer before publishing to `openclaw/inbound`.

## Development

```bash
# Clone (replace with your host)
git clone ssh://<host>/opt/git/openclaw-mqtt.git
cd openclaw-mqtt

# Install deps
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Architecture

```json
MQTT Broker (Mosquitto/EMQX)
     │
     ├─► inbound topic ──► OpenClaw Gateway ──► Agent
     │
     └─◄ outbound topic ◄── OpenClaw Gateway ◄── Agent
```

## License

MIT © kadbbz

## See Also

- [openclaw-mqtt](https://github.com/hughmadden/openclaw-mqtt) - Forked from this repo
- [OpenClaw](https://github.com/openclaw/openclaw) — The AI assistant platform
- [MQTT.js](https://github.com/mqttjs/MQTT.js) — MQTT client library
- [Mosquitto](https://mosquitto.org/) — Popular MQTT broker
