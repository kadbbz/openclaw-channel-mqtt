import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { mqttChannelBase } from "./src/channel-base.js";

const plugin = {
  id: "mqtt-channel",
  name: "MQTT Channel",
  description: "MQTT channel plugin for IoT and home automation integration.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: mqttChannelBase });
  },
};

export default plugin;
