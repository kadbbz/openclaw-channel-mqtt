import type { MqttAccountConfig, MqttChannelConfig } from "./config-schema.js";

const ACCOUNT_KEYS = [
  "enabled",
  "brokerUrl",
  "username",
  "password",
  "clientId",
  "topics",
  "qos",
  "disableBlockStreaming",
  "tls",
] as const;

type RawMqttChannelConfig = Partial<MqttChannelConfig> &
  Partial<MqttAccountConfig> & {
    accounts?: Record<string, Partial<MqttAccountConfig>>;
  };

export interface ResolvedMqttAccount {
  accountId: string;
  enabled: boolean;
  brokerUrl?: string;
  config?: Partial<MqttAccountConfig>;
}

export function getRawMqttChannelConfig(cfg: any): RawMqttChannelConfig | undefined {
  return cfg?.channels?.["mqtt-channel"];
}

export function listMqttAccountIds(cfg: any): string[] {
  return Object.entries(getMqttAccounts(cfg))
    .filter(([, account]) => Boolean(account?.brokerUrl))
    .map(([accountId]) => accountId);
}

export function resolveMqttAccount(cfg: any, requestedAccountId?: string): ResolvedMqttAccount {
  const accounts = getMqttAccounts(cfg);
  const fallbackAccountId = requestedAccountId ?? resolveDefaultMqttAccountId(cfg);
  const accountConfig = accounts[fallbackAccountId];
  const channelConfig = getRawMqttChannelConfig(cfg);
  const channelEnabled = channelConfig?.enabled !== false;

  if (!accountConfig) {
    return {
      accountId: fallbackAccountId,
      enabled: false,
    };
  }

  return {
    accountId: fallbackAccountId,
    enabled: channelEnabled && accountConfig.enabled !== false,
    brokerUrl: accountConfig.brokerUrl,
    config: accountConfig,
  };
}

export function resolveDefaultMqttAccountId(cfg: any): string {
  const accounts = getMqttAccounts(cfg);
  return Object.prototype.hasOwnProperty.call(accounts, "default")
    ? "default"
    : Object.keys(accounts)[0] ?? "default";
}

export function getMqttAccounts(cfg: any): Record<string, Partial<MqttAccountConfig>> {
  const channelConfig = getRawMqttChannelConfig(cfg);
  const accounts = channelConfig?.accounts;

  if (accounts && Object.keys(accounts).length > 0) {
    return accounts;
  }

  const legacyConfig = extractLegacyAccountConfig(channelConfig);
  return legacyConfig ? { default: legacyConfig } : {};
}

function extractLegacyAccountConfig(
  channelConfig: RawMqttChannelConfig | undefined
): Partial<MqttAccountConfig> | undefined {
  if (!channelConfig || !hasLegacyAccountConfig(channelConfig)) {
    return undefined;
  }

  const legacyConfig: Partial<MqttAccountConfig> = {};
  for (const key of ACCOUNT_KEYS) {
    const value = channelConfig[key];
    if (value !== undefined) {
      legacyConfig[key] = value as never;
    }
  }
  return legacyConfig;
}

function hasLegacyAccountConfig(channelConfig: RawMqttChannelConfig): boolean {
  return ACCOUNT_KEYS.some((key) => channelConfig[key] !== undefined);
}
