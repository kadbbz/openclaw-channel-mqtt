import type { CoreConfig } from "openclaw/plugin-sdk";
import type { MqttChannelConfig as MqttChannelSettings } from "./config-schema.js";

export interface MqttGatewayConfig {
  channels?: {
    "mqtt-channel"?: MqttChannelSettings;
  };
}

export type MqttCoreConfig = CoreConfig & MqttGatewayConfig;

export interface MqttInboundMessage {
  topic: string;
  payload: string | Buffer;
  qos: 0 | 1 | 2;
  retain: boolean;
  timestamp: number;
}

export interface MqttOutboundMessage {
  topic?: string; // uses config default if not specified
  payload: string;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}
