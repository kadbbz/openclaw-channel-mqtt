import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";

import {
  DEFAULT_DISABLE_BLOCK_STREAMING,
  DEFAULT_INBOUND_TOPIC,
  DEFAULT_OUTBOUND_TOPIC,
  DEFAULT_QOS,
} from "./config-schema.js";

export interface MqttSetupInput {
  brokerUrl?: unknown;
  username?: unknown;
  password?: unknown;
  clientId?: unknown;
  inboundTopic?: unknown;
  inbound?: unknown;
  outboundTopic?: unknown;
  outbound?: unknown;
  qos?: unknown;
  disableBlockStreaming?: unknown;
  tlsEnabled?: unknown;
  rejectUnauthorized?: unknown;
  ca?: unknown;
}

export function normalizeMqttAccountId(accountId?: string | null): string {
  const trimmed = accountId?.trim() ?? "";
  return trimmed || "default";
}

export function buildMqttAccountConfig(input: MqttSetupInput) {
  const brokerUrl = String(input.brokerUrl ?? "").trim();
  const username = String(input.username ?? "").trim();
  const password = input.password;
  const clientId = String(input.clientId ?? "").trim();
  const inbound = String(input.inboundTopic ?? input.inbound ?? DEFAULT_INBOUND_TOPIC).trim();
  const outbound = String(input.outboundTopic ?? input.outbound ?? DEFAULT_OUTBOUND_TOPIC).trim();
  const qosValue = Number(input.qos);
  const qos = qosValue === 0 || qosValue === 2 ? qosValue : DEFAULT_QOS;
  const disableBlockStreaming = input.disableBlockStreaming === true;
  const tlsEnabled = input.tlsEnabled === true || brokerUrl.startsWith("mqtts://");
  const rejectUnauthorized = input.rejectUnauthorized !== false;
  const ca = String(input.ca ?? "").trim();

  return {
    enabled: true,
    brokerUrl,
    ...(username ? { username } : {}),
    ...(typeof password === "string" && password.length > 0 ? { password } : {}),
    ...(clientId ? { clientId } : {}),
    topics: {
      inbound,
      outbound,
    },
    qos,
    disableBlockStreaming: disableBlockStreaming ?? DEFAULT_DISABLE_BLOCK_STREAMING,
    ...(tlsEnabled
      ? {
          tls: {
            enabled: true,
            rejectUnauthorized,
            ...(ca ? { ca } : {}),
          },
        }
      : {}),
  };
}

export function applyMqttSetupAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  input: MqttSetupInput;
}): OpenClawConfig {
  const { cfg, accountId, input } = params;
  const resolvedAccountId = normalizeMqttAccountId(accountId);

  return {
    ...cfg,
    channels: {
      ...cfg?.channels,
      "mqtt-channel": {
        ...cfg?.channels?.["mqtt-channel"],
        enabled: true,
        accounts: {
          ...cfg?.channels?.["mqtt-channel"]?.accounts,
          [resolvedAccountId]: buildMqttAccountConfig(input),
        },
      },
    },
  };
}
