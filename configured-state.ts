import { getMqttConfiguredState } from "./src/channel-config.js";

type ConfiguredState = "configured" | "unconfigured";

function resolveConfig(input: any): any {
  return input?.cfg ?? input?.config ?? input;
}

export function getConfiguredState(input: any): ConfiguredState {
  return getMqttConfiguredState(resolveConfig(input));
}

export function isConfigured(input: any): boolean {
  return getConfiguredState(input) === "configured";
}

export const configuredState = getConfiguredState;

export default getConfiguredState;
