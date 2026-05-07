import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { mqttChannelBase } from "./src/channel-base.js";

const plugin = defineSetupPluginEntry(mqttChannelBase);

export default plugin;
