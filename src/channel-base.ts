import type { ChannelPlugin } from "openclaw/plugin-sdk";

import { mqttChannelConfigJsonSchema } from "./config-schema.js";
import { mqttOnboardingAdapter } from "./onboarding.js";
import {
  listMqttAccountIds,
  type ResolvedMqttAccount,
  resolveDefaultMqttAccountId,
  resolveMqttAccount,
} from "./channel-config.js";
import { applyMqttSetupAccountConfig, normalizeMqttAccountId } from "./setup-config.js";

export const mqttChannelBase: Partial<ChannelPlugin<ResolvedMqttAccount>> = {
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
    media: false,
    reactions: false,
    threads: false,
    supportsMedia: false,
    supportsReactions: false,
    supportsThreads: false,
  } as any,

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

  setupWizard: mqttOnboardingAdapter as any,

  setup: {
    resolveAccountId: ({ accountId }: { accountId?: string | null }) => normalizeMqttAccountId(accountId),
    applyAccountConfig: ({ cfg, accountId, input }: { cfg: any; accountId: string; input: Record<string, unknown> }) =>
      applyMqttSetupAccountConfig({ cfg, accountId, input }),
  },
};
