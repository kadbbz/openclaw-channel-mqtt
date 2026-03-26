/**
 * MQTT Channel Onboarding Adapter
 * Provides interactive setup via `openclaw configure channels`
 */
import { getMqttAccounts, listMqttAccountIds } from "./channel-config.js";

const channel = "mqtt-channel";

interface MqttConfig {
  channels?: {
    "mqtt-channel"?: {
      enabled?: boolean;
      accounts?: Record<
        string,
        {
          enabled?: boolean;
          brokerUrl?: string;
          username?: string;
          password?: string;
          disableBlockStreaming?: boolean;
          topics?: {
            inbound?: string;
            outbound?: string;
          };
          tls?: {
            enabled?: boolean;
            rejectUnauthorized?: boolean;
          };
          qos?: 0 | 1 | 2;
        }
      >;
      brokerUrl?: string;
      username?: string;
      password?: string;
      disableBlockStreaming?: boolean;
      topics?: {
        inbound?: string;
        outbound?: string;
      };
      tls?: {
        enabled?: boolean;
        rejectUnauthorized?: boolean;
      };
      qos?: 0 | 1 | 2;
    };
  };
}

interface Prompter {
  text(opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string | undefined) => string | undefined;
  }): Promise<string>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;
  select<T>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
  }): Promise<T>;
  note(message: string, title?: string): Promise<void>;
}

interface OnboardingStatus {
  channel: string;
  configured: boolean;
  statusLines: string[];
  selectionHint: string;
  quickstartScore: number;
}

interface ConfigureParams {
  cfg: MqttConfig;
  prompter: Prompter;
  accountOverrides?: Record<string, string>;
  shouldPromptAccountIds?: boolean;
  forceAllowFrom?: boolean;
}

interface ConfigureResult {
  cfg: MqttConfig;
  accountId: string;
}

export const mqttOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }: { cfg: MqttConfig }): Promise<OnboardingStatus> => {
    const mqtt = cfg.channels?.["mqtt-channel"];
    const accountIds = listMqttAccountIds(cfg);
    const configured = accountIds.length > 0 && mqtt?.enabled !== false;
    const brokerUrls = accountIds
      .map((accountId) => getMqttAccounts(cfg)[accountId]?.brokerUrl)
      .filter((url): url is string => Boolean(url));

    return {
      channel,
      configured,
      statusLines: [
        configured
          ? `MQTT: configured (${accountIds.length} account${accountIds.length === 1 ? "" : "s"}${brokerUrls[0] ? `, first: ${brokerUrls[0]}` : ""})`
          : "MQTT: not configured",
      ],
      selectionHint: configured
        ? "configured"
        : "IoT / home automation integration",
      quickstartScore: configured ? 1 : 50, // Lower priority than chat channels
    };
  },

  configure: async ({
    cfg,
    prompter,
  }: ConfigureParams): Promise<ConfigureResult> => {
    let next = { ...cfg };

    // Show help note
    await prompter.note(
      [
        "MQTT connects OpenClaw to IoT devices and home automation systems.",
        "",
        "Common brokers:",
        "  • Mosquitto: mqtt://localhost:1883",
        "  • EMQX: mqtt://localhost:1883",
        "  • HiveMQ Cloud: mqtts://broker.hivemq.com:8883",
        "",
        "You can also use environment variables:",
        "  MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD",
      ].join("\n"),
      "MQTT Setup"
    );

    // Prompt for broker URL
    const existingAccount = getMqttAccounts(cfg).default;
    const existingUrl = existingAccount?.brokerUrl;
    const brokerUrl = String(
      await prompter.text({
        message: "MQTT broker URL",
        placeholder: "mqtt://localhost:1883",
        initialValue: existingUrl || process.env.MQTT_BROKER_URL || "",
        validate: (value) => {
          if (!value?.trim()) return "Required";
          if (!/^mqtts?:\/\/.+/.test(value.trim())) {
            return "Must start with mqtt:// or mqtts://";
          }
          return undefined;
        },
      })
    ).trim();

    // Check if auth is needed
    const needsAuth = await prompter.confirm({
      message: "Does your broker require authentication?",
      initialValue: Boolean(
        existingAccount?.username || process.env.MQTT_USERNAME
      ),
    });

    let username: string | undefined;
    let password: string | undefined;

    if (needsAuth) {
      username = String(
        await prompter.text({
          message: "MQTT username",
          initialValue: existingAccount?.username || process.env.MQTT_USERNAME || "",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        })
      ).trim();

      password = String(
        await prompter.text({
          message: "MQTT password",
          initialValue: existingAccount?.password || "",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        })
      ).trim();
    }

    // TLS settings for mqtts://
    let tls: { enabled: boolean; rejectUnauthorized: boolean } | undefined;
    if (brokerUrl.startsWith("mqtts://")) {
      const rejectUnauthorized = await prompter.confirm({
        message: "Verify TLS certificate? (disable for self-signed certs)",
        initialValue: true,
      });
      tls = { enabled: true, rejectUnauthorized };
    }

    // Topics
    await prompter.note(
      [
        "Topics define where OpenClaw listens and publishes:",
        "",
        "  • Inbound: messages TO OpenClaw (e.g., alerts, commands)",
        "  • Outbound: messages FROM OpenClaw (e.g., responses)",
        "",
        "Wildcards supported: + (single level), # (multi level)",
        "Example: home/+/alerts, sensors/#",
      ].join("\n"),
      "MQTT Topics"
    );

    const inboundTopic = String(
      await prompter.text({
        message: "Inbound topic (messages to OpenClaw)",
        placeholder: "openclaw/inbound",
        initialValue: existingAccount?.topics?.inbound || "openclaw/inbound",
      })
    ).trim();

    const outboundTopic = String(
      await prompter.text({
        message: "Outbound topic (messages from OpenClaw)",
        placeholder: "openclaw/outbound",
        initialValue: existingAccount?.topics?.outbound || "openclaw/outbound",
      })
    ).trim();

    // QoS level
    const qos = (await prompter.select({
      message: "QoS level",
      options: [
        { value: 0, label: "0 - At most once", hint: "fire and forget" },
        { value: 1, label: "1 - At least once", hint: "recommended" },
        { value: 2, label: "2 - Exactly once", hint: "highest overhead" },
      ],
      initialValue: existingAccount?.qos ?? 1,
    })) as 0 | 1 | 2;

    // Build config
    next = {
      ...next,
      channels: {
        ...next.channels,
        "mqtt-channel": {
          ...cfg.channels?.["mqtt-channel"],
          enabled: true,
          accounts: {
            ...cfg.channels?.["mqtt-channel"]?.accounts,
            default: {
              enabled: true,
              brokerUrl,
              ...(username && { username }),
              ...(password && { password }),
              ...(tls && { tls }),
              topics: {
                inbound: inboundTopic,
                outbound: outboundTopic,
              },
              qos,
            },
          },
        },
      },
    };

    return { cfg: next, accountId: "default" };
  },

  disable: (cfg: MqttConfig): MqttConfig => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      "mqtt-channel": { ...cfg.channels?.["mqtt-channel"], enabled: false },
    },
  }),
};
