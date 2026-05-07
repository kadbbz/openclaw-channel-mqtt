import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { mqttPlugin } from "./src/channel.js";
import { setMqttRuntime } from "./src/runtime.js";
import { mqttChannelConfigJsonSchema } from "./src/config-schema.js";

const plugin = defineChannelPluginEntry({
  id: "mqtt-channel",
  name: "MQTT Channel",
  description: "MQTT channel plugin for IoT and home automation integration.",
  plugin: mqttPlugin,
  configSchema: mqttChannelConfigJsonSchema,
  setRuntime: setMqttRuntime,
});

export default plugin;
