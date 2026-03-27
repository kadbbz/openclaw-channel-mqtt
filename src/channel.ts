import type { ChannelPlugin } from "openclaw/plugin-sdk";
import type { MqttCoreConfig } from "./types.js";
import { createMqttClient, MqttClientManager } from "./client.js";
import { mqttOnboardingAdapter } from "./onboarding.js";
import { getMqttRuntime } from "./runtime.js";
import {
  listMqttAccountIds,
  resolveDefaultMqttAccountId,
  resolveMqttAccount,
} from "./channel-config.js";

// One MQTT client per configured account.
const mqttClients = new Map<string, MqttClientManager>();
const DEFAULT_SESSION_ID = "-1";

function normalizeMqttAccountId(accountId?: string | null): string {
  const trimmed = accountId?.trim() ?? "";
  return trimmed || "default";
}

function normalizeSessionId(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized =
    typeof value === "string" ? value.trim() : String(value).trim();
  return normalized || undefined;
}

function buildOutboundEnvelope(params: {
  text: string;
  kind?: string;
  sessionId: string;
}): string {
  const { text, kind = "final", sessionId } = params;
  return JSON.stringify({
    senderId: "openclaw",
    text,
    kind,
    ts: Date.now(),
    sessionId,
  });
}

/**
 * MQTT Channel Plugin for OpenClaw
 *
 * Provides bidirectional messaging via MQTT brokers (Mosquitto, EMQX, etc.)
 * Useful for IoT integration, home automation alerts, and service monitoring.
 */
export const mqttPlugin: ChannelPlugin<MqttCoreConfig> = {
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

  outbound: {
    deliveryMode: "direct",

    async sendText({
      text,
      cfg,
      accountId,
      account,
      threadId,
    }: {
      text: string;
      cfg: any;
      accountId?: string;
      account?: any;
      threadId?: string | number | null;
    }) {
      const resolved =
        account?.config && account?.brokerUrl
          ? {
              accountId: accountId ?? account.accountId ?? "default",
              enabled: account.enabled !== false,
              brokerUrl: account.brokerUrl,
              config: account.config,
            }
          : resolveMqttAccount(cfg, accountId ?? account?.accountId);

      const mqtt = resolved.config;
      if (!mqtt?.brokerUrl) {
        return { ok: false, error: "MQTT not configured" };
      }

      const mqttClient = mqttClients.get(resolved.accountId);
      if (!mqttClient || !mqttClient.isConnected()) {
        return { ok: false, error: "MQTT not connected" };
      }

      try {
        const topic = mqtt.topics?.outbound ?? "openclaw/outbound";
        const sessionId = normalizeSessionId(threadId) ?? DEFAULT_SESSION_ID;
        await mqttClient.publish(
          topic,
          buildOutboundEnvelope({ text, sessionId }),
          mqtt.qos
        );
        return { ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { ok: false, error };
      }
    },
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const { cfg, account, accountId, abortSignal, log } = ctx;
      const resolved = account?.config ? account : resolveMqttAccount(cfg, accountId);
      const mqtt = resolved.config;
      if (!mqtt?.brokerUrl) {
        log?.debug?.("MQTT channel not configured, skipping");
        return;
      }
      if (resolved.enabled === false) {
        log?.debug?.(`[${resolved.accountId}] MQTT channel disabled, skipping`);
        return;
      }

      const runtime = getMqttRuntime();
      const resolvedAccountId = resolved.accountId ?? accountId ?? "default";

      log?.info?.(`[${resolvedAccountId}] starting MQTT provider (${mqtt.brokerUrl})`);

      const existingClient = mqttClients.get(resolvedAccountId);
      if (existingClient) {
        await existingClient.disconnect().catch((err) => {
          log?.warn?.(`[${resolvedAccountId}] failed to reset MQTT client: ${err}`);
        });
      }

      // Create and connect client
      const mqttClient = createMqttClient(mqtt, {
        debug: (msg: string) => log?.debug?.(`[MQTT] ${msg}`),
        info: (msg: string) => log?.info?.(`[MQTT] ${msg}`),
        warn: (msg: string) => log?.warn?.(`[MQTT] ${msg}`),
        error: (msg: string) => log?.error?.(`[MQTT] ${msg}`),
      });
      mqttClients.set(resolvedAccountId, mqttClient);

      try {
        await mqttClient.connect();
      } catch (err) {
        log?.error?.(`MQTT connection failed (will keep retrying): ${err}`);
      }

      // Subscribe to inbound topic
      const inboundTopic = mqtt.topics?.inbound ?? "openclaw/inbound";
      const outboundTopic = mqtt.topics?.outbound ?? "openclaw/outbound";
      
      mqttClient.subscribe(inboundTopic, async (topic: string, payload: Buffer) => {
        await handleInboundMessage({
          topic,
          payload,
          runtime,
          cfg,
          accountId: resolvedAccountId,
          log,
          outboundTopic,
          qos: mqtt.qos,
          disableBlockStreaming: mqtt.disableBlockStreaming,
          mqttClient,
        });
      });

      log?.info?.(`[${resolvedAccountId}] MQTT channel ready, subscribed to ${inboundTopic}`);

      // Return a promise that resolves when aborted
      return new Promise<void>((resolve) => {
        const cleanup = () => {
          const activeClient = mqttClients.get(resolvedAccountId);
          if (activeClient === mqttClient) {
            log?.info?.(`[${resolvedAccountId}] MQTT channel stopping`);
            mqttClient.disconnect().finally(() => {
              if (mqttClients.get(resolvedAccountId) === mqttClient) {
                mqttClients.delete(resolvedAccountId);
              }
              resolve();
            });
          } else {
            resolve();
          }
        };

        if (abortSignal) {
          abortSignal.addEventListener("abort", cleanup, { once: true });
        }
      });
    },
  },

  onboarding: mqttOnboardingAdapter,

  setup: {
    resolveAccountId: ({ accountId }: { accountId?: string | null }) =>
      normalizeMqttAccountId(accountId),
  },
};

/**
 * Handle inbound MQTT message - process through OpenClaw agent and deliver reply
 */
async function handleInboundMessage(opts: {
  topic: string;
  payload: Buffer;
  runtime: any;
  cfg: any;
  accountId: string;
  log: any;
  outboundTopic: string;
  qos?: 0 | 1 | 2;
  disableBlockStreaming?: boolean;
  mqttClient: MqttClientManager;
}) {
  const {
    topic,
    payload,
    runtime,
    cfg,
    accountId,
    log,
    outboundTopic,
    qos,
    disableBlockStreaming,
    mqttClient,
  } = opts;

  try {
    const text = payload.toString("utf-8");
    log?.info?.(`Inbound MQTT message on ${topic}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);

    // Parse JSON if possible to extract structured data
    let parsedPayload: Record<string, unknown> | null = null;
    try {
      parsedPayload = JSON.parse(text);
    } catch {
      parsedPayload = null;
    }

    // Extract message body and sender from payload
    let messageBody: string;
    let senderId: string;
    let sessionId: string | undefined;

    if (parsedPayload && typeof parsedPayload === "object") {
      messageBody = (parsedPayload.text as string) ?? text;

      senderId = (parsedPayload.senderId as string) ?? topic.replace(/\//g, "-");

      sessionId = normalizeSessionId(parsedPayload.sessionId) ?? undefined;
    } else {
      messageBody = text;
      senderId = topic.replace(/\//g, "-");
    }

    const route = runtime.channel.routing.resolveAgentRoute({
      cfg,
      channel: "mqtt-channel",
      accountId,
      peer: {
        kind: "dm",
        id: senderId,
      },
    });
    log?.info?.(
      `MQTT route resolved topic=${topic} inboundAccount=${accountId} routeAccount=${route.accountId} agent=${route.agentId} session=${route.sessionKey}`
    );

    // Build the inbound context using OpenClaw's standard format
    const ctxPayload = runtime.channel.reply.finalizeInboundContext({
      Body: messageBody,
      RawBody: text,
      CommandBody: messageBody,
      CommandAuthorized: true,
      From: `mqtt:${senderId}`,
      To: `mqtt:${route.accountId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      AgentId: route.agentId,
      ChatType: "direct",
      ConversationLabel: `mqtt:${senderId}`,
      SenderName: senderId,
      SenderId: senderId,
      MessageThreadId: sessionId,
      Provider: "mqtt",
      Surface: "mqtt",
      MessageSid: `mqtt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      Timestamp: Date.now(),
      OriginatingChannel: "mqtt-channel",
      OriginatingTo: `mqtt:${route.accountId}`,
    });

    const storePath = runtime.channel.session?.resolveStorePath?.(cfg.session?.store, {
      agentId: route.agentId,
    });

    if (storePath && runtime.channel.session?.recordInboundSession) {
      await runtime.channel.session.recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        ctx: ctxPayload,
        updateLastRoute: route.mainSessionKey
          ? {
              sessionKey: route.mainSessionKey,
              channel: "mqtt-channel",
              to: ctxPayload.To ?? `mqtt:${route.accountId}`,
              accountId: route.accountId,
              threadId: sessionId,
            }
          : undefined,
        onRecordError: (err: unknown) => {
          log?.error?.(`MQTT: failed updating session meta: ${String(err)}`);
        },
      });
    } else if (storePath && runtime.channel.session?.recordSessionMetaFromInbound) {
      void runtime.channel.session
        .recordSessionMetaFromInbound({
          storePath,
          sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
          ctx: ctxPayload,
        })
        .catch((err: unknown) => {
          log?.error?.(`MQTT: failed updating session meta: ${String(err)}`);
        });
    }

    // inbound context logging removed

    // Dispatch through OpenClaw's reply system and publish replies
    await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: { text?: string; media?: any }, info: { kind: string }) => {
          if (!payload.text) {
            log?.debug?.(`MQTT: skipping empty ${info.kind} reply`);
            return;
          }

          log?.info?.(`MQTT reply (${info.kind}) [${payload.text.length} chars]`);

          if (mqttClient.isConnected()) {
            try {
              const outboundSessionId = sessionId ?? DEFAULT_SESSION_ID;
              const outboundPayload = buildOutboundEnvelope({
                text: payload.text,
                kind: info.kind,
                sessionId: outboundSessionId,
              });
              log?.info?.(
                `MQTT publishing reply kind=${info.kind} sessionId=${outboundSessionId} topic=${outboundTopic}`
              );
              await mqttClient.publish(outboundTopic, outboundPayload, qos as 0 | 1 | 2);
              log?.info?.(
                `MQTT: sent reply to ${outboundTopic} kind=${info.kind} sessionId=${outboundSessionId}`
              );
            } catch (err) {
              log?.error?.(`MQTT: failed to send reply: ${err}`);
            }
          } else {
            log?.warn?.(`MQTT: not connected, cannot send reply`);
          }
        },
        onSkip: (_payload: any, info: { reason: string }) => {
          log?.debug?.(`MQTT: skipped reply (${info.reason})`);
        },
        onError: (err: Error, info: { kind: string }) => {
          log?.error?.(`MQTT: ${info.kind} reply error: ${err}`);
        },
      },
      replyOptions: {
        disableBlockStreaming: disableBlockStreaming ?? false,
      },
    });

    // dispatch complete

    log?.info?.(`MQTT message processed from ${senderId}`);
  } catch (err) {
    log?.error?.(`Failed to process MQTT message: ${err}`);
  }
}
