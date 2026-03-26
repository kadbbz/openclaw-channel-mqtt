import { vi } from "vitest";
import { EventEmitter } from "events";

/**
 * Mock MQTT Client for testing
 */
export class MockMqttClient extends EventEmitter {
  connected = false;
  subscriptions: Map<string, { qos: number }> = new Map();
  published: Array<{ topic: string; message: string; opts: unknown }> = [];

  subscribe(
    topic: string,
    opts: { qos: number },
    callback?: (err: Error | null) => void
  ) {
    this.subscriptions.set(topic, opts);
    callback?.(null);
    return this;
  }

  publish(
    topic: string,
    message: string,
    opts: unknown,
    callback?: (err: Error | null) => void
  ) {
    this.published.push({ topic, message, opts });
    callback?.(null);
    return this;
  }

  end(force: boolean, opts: unknown, callback?: () => void) {
    this.connected = false;
    this.subscriptions.clear();
    callback?.();
    return this;
  }

  // Test helpers
  simulateConnect() {
    this.connected = true;
    this.emit("connect");
  }

  simulateMessage(topic: string, payload: Buffer | string) {
    const buf = typeof payload === "string" ? Buffer.from(payload) : payload;
    this.emit("message", topic, buf);
  }

  simulateError(err: Error) {
    this.emit("error", err);
  }

  simulateDisconnect() {
    this.connected = false;
    this.emit("close");
  }

  reconnect() {
    this.emit("reconnect");
    setTimeout(() => this.simulateConnect(), 10);
    return this;
  }

  simulateReconnect() {
    this.emit("reconnect");
  }
}

// Factory function that returns mock clients
const mockClients: MockMqttClient[] = [];

export function connect(url: string, opts?: unknown): MockMqttClient {
  const mockClient = new MockMqttClient();
  mockClients.push(mockClient);
  // Auto-connect after short delay to simulate async connection
  setTimeout(() => mockClient.simulateConnect(), 10);
  return mockClient;
}

// Test helper to get current mock client
export function getMockClient(index?: number): MockMqttClient | null {
  if (mockClients.length === 0) {
    return null;
  }

  if (index === undefined) {
    return mockClients[mockClients.length - 1];
  }

  return mockClients[index] ?? null;
}

export function getMockClients(): MockMqttClient[] {
  return [...mockClients];
}

// Reset between tests
export function resetMock() {
  mockClients.length = 0;
}

export default { connect, getMockClient, getMockClients, resetMock };
