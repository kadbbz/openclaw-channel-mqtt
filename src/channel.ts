import type { ChannelPlugin } from "openclaw/plugin-sdk";

import type { MqttCoreConfig } from "./types.js";
import { mqttChannelBase } from "./channel-base.js";
import { mqttChannelRuntime } from "./channel-runtime.js";

/**
 * MQTT Channel Plugin for OpenClaw
 *
 * Provides bidirectional messaging via MQTT brokers (Mosquitto, EMQX, etc.)
 * Useful for IoT integration, home automation alerts, and service monitoring.
 */
export const mqttPlugin: ChannelPlugin<MqttCoreConfig> = {
  ...mqttChannelBase,
  ...mqttChannelRuntime,
} as ChannelPlugin<MqttCoreConfig>;
