import type { ChannelPlugin } from "openclaw/plugin-sdk";

import { mqttChannelConfigJsonSchema } from "./config-schema.js";
import type { MqttCoreConfig } from "./types.js";
import { mqttOnboardingAdapter } from "./onboarding.js";
import {
  listMqttAccountIds,
  resolveDefaultMqttAccountId,
  resolveMqttAccount,
} from "./channel-config.js";

function normalizeMqttAccountId(accountId?: string | null): string {
  const trimmed = accountId?.trim() ?? "";
  return trimmed || "default";
}

export const mqttChannelBase: Partial<ChannelPlugin<MqttCoreConfig>> = {
  id: "mqtt-channel",

  meta: {
    id: "mqtt-channel",
    label: "MQTT Channel",
    selectionLabel: "MQTT Channel (IoT/Home Automation)",
    docsPath: "/channels/mqtt-channel",
    blurb: "Bidirectional messaging via MQTT brokers",
    aliases: ["mosquitto"],
  },

  capabilities: {
    chatTypes: ["direct"],
    supportsMedia: false,
    supportsReactions: false,
    supportsThreads: false,
  },

  configSchema: mqttChannelConfigJsonSchema,

  config: {
    listAccountIds: (cfg: any) => {
      return listMqttAccountIds(cfg);
    },

    resolveAccount: (cfg: any, accountId: any) => {
      return resolveMqttAccount(cfg, accountId);
    },

    defaultAccountId: (cfg: any) => {
      return resolveDefaultMqttAccountId(cfg);
    },

    isEnabled: (account: any) => account.enabled !== false,
    isConfigured: (account: any) => Boolean(account.brokerUrl),
  },

  onboarding: mqttOnboardingAdapter,

  setup: {
    resolveAccountId: ({ accountId }: { accountId?: string | null }) =>
      normalizeMqttAccountId(accountId),
  },
};
