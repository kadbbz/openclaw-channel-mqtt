import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetMock, getMockClient, getMockClients } from "./__mocks__/mqtt.js";

// Mock the mqtt module
vi.mock("mqtt", () => import("./__mocks__/mqtt.js"));

// Import after mocking
import { mqttPlugin } from "./channel.js";
import { setMqttRuntime } from "./runtime.js";

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("mqttPlugin", () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockDispatchReply = vi.fn(async ({ dispatcherOptions }: any) => {
    if (dispatcherOptions?.deliver) {
      await dispatcherOptions.deliver({ text: "test reply" }, { kind: "final" });
    }
  });
  const mockFinalizeInboundContext = vi.fn((payload: any) => payload);
  const mockResolveStorePath = vi.fn(
    (_store: unknown, { agentId }: { agentId?: string } = {}) => `/sessions/${agentId ?? "main"}.json`
  );
  const mockRecordInboundSession = vi.fn(async () => undefined);
  const mockResolveAgentRoute = vi.fn(
    ({ accountId, peer }: { accountId: string; peer: { id: string } }) => ({
      agentId: accountId,
      accountId,
      sessionKey: `agent:${accountId}:mqtt:${peer.id}`,
      mainSessionKey: `agent:${accountId}:main`,
    })
  );

  const mockRuntime = {
    channel: {
      routing: {
        resolveAgentRoute: mockResolveAgentRoute,
      },
      reply: {
        finalizeInboundContext: mockFinalizeInboundContext,
        dispatchReplyWithBufferedBlockDispatcher: mockDispatchReply,
      },
      session: {
        resolveStorePath: mockResolveStorePath,
        recordInboundSession: mockRecordInboundSession,
      },
    },
  };

  const defaultCfg = {
    channels: {
      "mqtt-channel": {
        accounts: {
          default: {
            brokerUrl: "mqtt://localhost:1883",
            topics: {
              inbound: "openclaw/inbound",
              outbound: "openclaw/outbound",
            },
            qos: 1 as const,
          },
        },
      },
    },
  };

  const startAccount = async (cfg: any = defaultCfg, accountId = "default") => {
    const controller = new AbortController();
    const startPromise = mqttPlugin.gateway?.startAccount?.({
      cfg,
      accountId,
      log: mockLogger,
      abortSignal: controller.signal,
    } as any);

    // Wait for async connect
    await new Promise((r) => setTimeout(r, 50));

    return { controller, startPromise };
  };

  beforeEach(() => {
    resetMock();
    vi.clearAllMocks();
    setMqttRuntime(mockRuntime as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("meta", () => {
    it("should have correct id and label", () => {
      expect(mqttPlugin.id).toBe("mqtt-channel");
      expect(mqttPlugin.meta.label).toBe("MQTT Channel");
      expect(mqttPlugin.meta.aliases).toContain("mosquitto");
    });
  });

  describe("capabilities", () => {
    it("should support direct chat only", () => {
      expect(mqttPlugin.capabilities.chatTypes).toContain("direct");
      expect(mqttPlugin.capabilities.supportsMedia).toBe(false);
      expect(mqttPlugin.capabilities.supportsReactions).toBe(false);
    });
  });

  describe("config", () => {
    it("should list account IDs when configured", () => {
      const ids = mqttPlugin.config.listAccountIds(defaultCfg as any);
      expect(ids).toContain("default");
    });

    it("should return empty when not configured", () => {
      const ids = mqttPlugin.config.listAccountIds({} as any);
      expect(ids).toEqual([]);
    });

    it("should list multiple configured accounts", () => {
      const ids = mqttPlugin.config.listAccountIds({
        channels: {
          "mqtt-channel": {
            accounts: {
              admin: { brokerUrl: "mqtt://admin:1883" },
              lowcode: { brokerUrl: "mqtt://lowcode:1883" },
            },
          },
        },
      } as any);

      expect(ids).toEqual(["admin", "lowcode"]);
    });

    it("should resolve default account ID for multi-account config", () => {
      const accountId = mqttPlugin.config.defaultAccountId?.({
        channels: {
          "mqtt-channel": {
            accounts: {
              admin: { brokerUrl: "mqtt://admin:1883" },
              lowcode: { brokerUrl: "mqtt://lowcode:1883" },
            },
          },
        },
      } as any);

      expect(accountId).toBe("admin");
    });

    it("should prefer default account ID when present", () => {
      const accountId = mqttPlugin.config.defaultAccountId?.({
        channels: {
          "mqtt-channel": {
            accounts: {
              lowcode: { brokerUrl: "mqtt://lowcode:1883" },
              default: { brokerUrl: "mqtt://default:1883" },
            },
          },
        },
      } as any);

      expect(accountId).toBe("default");
    });

    it("should resolve account with broker URL", () => {
      const account = mqttPlugin.config.resolveAccount(defaultCfg as any, "default");
      expect(account.brokerUrl).toBe("mqtt://localhost:1883");
    });

    it("should resolve legacy single-account config as default", () => {
      const account = mqttPlugin.config.resolveAccount(
        {
          channels: {
            "mqtt-channel": {
              brokerUrl: "mqtt://legacy:1883",
            },
          },
        } as any,
        "default"
      );

      expect(account.accountId).toBe("default");
      expect(account.brokerUrl).toBe("mqtt://legacy:1883");
    });
  });

  describe("gateway.startAccount", () => {
    it("should skip if not configured", async () => {
      await mqttPlugin.gateway?.startAccount?.({
        cfg: {} as any,
        accountId: "default",
        log: mockLogger,
        abortSignal: new AbortController().signal,
      } as any);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "MQTT channel not configured, skipping"
      );
    });

    it("should connect and subscribe when configured", async () => {
      const { controller, startPromise } = await startAccount();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("starting MQTT provider")
      );

      const mock = getMockClient();
      expect(mock?.subscriptions.has("openclaw/inbound")).toBe(true);

      controller.abort();
      await startPromise;
    });

    it("should process inbound MQTT messages", async () => {
      const { controller, startPromise } = await startAccount();

      const mock = getMockClient();
      mock?.simulateMessage("openclaw/inbound", "Alert: Service down");
      await flushAsync();

      expect(mockDispatchReply).toHaveBeenCalled();
      const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.ctx?.Body).toBe("Alert: Service down");
      expect(lastCall?.ctx?.SessionKey).toBe("agent:default:mqtt:openclaw-inbound");
      expect(lastCall?.ctx?.AccountId).toBe("default");
      expect(lastCall?.ctx?.AgentId).toBe("default");
      expect(mockResolveStorePath).toHaveBeenCalledWith(undefined, { agentId: "default" });
      expect(mockRecordInboundSession).toHaveBeenCalledWith(
        expect.objectContaining({
          storePath: "/sessions/default.json",
          sessionKey: "agent:default:mqtt:openclaw-inbound",
          updateLastRoute: {
            sessionKey: "agent:default:main",
            channel: "mqtt-channel",
            to: "mqtt:default",
            accountId: "default",
            threadId: undefined,
          },
        })
      );

      controller.abort();
      await startPromise;
    });

    it("should parse senderId, text, and sessionId from JSON", async () => {
      const { controller, startPromise } = await startAccount();

      const mock = getMockClient();
      mock?.simulateMessage(
        "openclaw/inbound",
        JSON.stringify({
          text: "Server CPU high",
          senderId: "uptime-kuma",
          sessionId: "sess-123",
        })
      );
      await flushAsync();

      expect(mockDispatchReply).toHaveBeenCalled();
      const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.ctx?.Body).toBe("Server CPU high");
      expect(lastCall?.ctx?.SenderId).toBe("uptime-kuma");
      expect(lastCall?.ctx?.ReplyToId).toBeUndefined();
      expect(lastCall?.ctx?.MessageThreadId).toBe("sess-123");

      controller.abort();
      await startPromise;
    });

    it("should echo sessionId in outbound replies", async () => {
      const { controller, startPromise } = await startAccount();

      const mock = getMockClient();
      mock?.simulateMessage(
        "openclaw/inbound",
        JSON.stringify({
          text: "ping",
          senderId: "pg-test",
          sessionId: "sess-123",
        })
      );
      await flushAsync();

      const published = mock?.published ?? [];
      expect(published.length).toBeGreaterThan(0);
      const last = published[published.length - 1];
      const data = JSON.parse(last.message as string);
      expect(data.sessionId).toBe("sess-123");
      const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.ctx?.ReplyToId).toBeUndefined();
      expect(lastCall?.ctx?.MessageThreadId).toBe("sess-123");
      expect(mockRecordInboundSession).toHaveBeenCalledWith(
        expect.objectContaining({
          updateLastRoute: expect.objectContaining({
            threadId: "sess-123",
          }),
        })
      );

      controller.abort();
      await startPromise;
    });

    it("should stringify numeric sessionId values", async () => {
      const { controller, startPromise } = await startAccount();

      const mock = getMockClient();
      mock?.simulateMessage(
        "openclaw/inbound",
        JSON.stringify({
          text: "ping",
          senderId: "pg-test",
          sessionId: 1,
        })
      );
      await flushAsync();

      const published = mock?.published ?? [];
      expect(published.length).toBeGreaterThan(0);
      const last = published[published.length - 1];
      const data = JSON.parse(last.message as string);
      expect(data.sessionId).toBe("1");

      controller.abort();
      await startPromise;
    });

    it("should return default sessionId when inbound JSON omits it", async () => {
      const { controller, startPromise } = await startAccount();

      const mock = getMockClient();
      mock?.simulateMessage(
        "openclaw/inbound",
        JSON.stringify({
          text: "ping",
          senderId: "pg-test",
        })
      );
      await flushAsync();

      const published = mock?.published ?? [];
      expect(published.length).toBeGreaterThan(0);
      const last = published[published.length - 1];
      const data = JSON.parse(last.message as string);
      expect(data.sessionId).toBe("-1");

      controller.abort();
      await startPromise;
    });

    it("should start separate MQTT clients for separate accounts", async () => {
      const cfg = {
        channels: {
          "mqtt-channel": {
            accounts: {
              admin: {
                brokerUrl: "mqtt://localhost:1883",
                topics: {
                  inbound: "openclaw/inbound-admin",
                  outbound: "openclaw/outbound-admin",
                },
                qos: 1 as const,
              },
              lowcode: {
                brokerUrl: "mqtt://localhost:1884",
                topics: {
                  inbound: "openclaw/inbound-lowcode",
                  outbound: "openclaw/outbound-lowcode",
                },
                qos: 1 as const,
              },
            },
          },
        },
      };

      const admin = await startAccount(cfg, "admin");
      const lowcode = await startAccount(cfg, "lowcode");

      const clients = getMockClients();
      expect(clients).toHaveLength(2);
      expect(clients[0]?.subscriptions.has("openclaw/inbound-admin")).toBe(true);
      expect(clients[1]?.subscriptions.has("openclaw/inbound-lowcode")).toBe(true);

      lowcode.controller.abort();
      admin.controller.abort();
      await Promise.all([lowcode.startPromise, admin.startPromise]);
    });

    it("should resolve inbound route from the selected MQTT account", async () => {
      const cfg = {
        channels: {
          "mqtt-channel": {
            accounts: {
              admin: {
                brokerUrl: "mqtt://localhost:1883",
                topics: {
                  inbound: "openclaw/inbound-admin",
                  outbound: "openclaw/outbound-admin",
                },
                qos: 1 as const,
              },
              lowcode: {
                brokerUrl: "mqtt://localhost:1884",
                topics: {
                  inbound: "openclaw/inbound-lowcode",
                  outbound: "openclaw/outbound-lowcode",
                },
                qos: 1 as const,
              },
            },
          },
        },
      };

      const { controller, startPromise } = await startAccount(cfg, "lowcode");

      const mock = getMockClient();
      mock?.simulateMessage(
        "openclaw/inbound-lowcode",
        JSON.stringify({
          senderId: "pg-cli",
          text: "hello",
        })
      );
      await flushAsync();

      expect(mockResolveAgentRoute).toHaveBeenCalledWith({
        cfg,
        channel: "mqtt-channel",
        accountId: "lowcode",
        peer: {
          kind: "dm",
          id: "pg-cli",
        },
      });

      const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
      expect(lastCall?.ctx?.SessionKey).toBe("agent:lowcode:mqtt:pg-cli");
      expect(lastCall?.ctx?.AccountId).toBe("lowcode");
      expect(lastCall?.ctx?.To).toBe("mqtt:lowcode");
      expect(lastCall?.ctx?.AgentId).toBe("lowcode");
      expect(mockResolveStorePath).toHaveBeenCalledWith(undefined, { agentId: "lowcode" });
      expect(mockRecordInboundSession).toHaveBeenCalledWith(
        expect.objectContaining({
          storePath: "/sessions/lowcode.json",
          sessionKey: "agent:lowcode:mqtt:pg-cli",
          updateLastRoute: {
            sessionKey: "agent:lowcode:main",
            channel: "mqtt-channel",
            to: "mqtt:lowcode",
            accountId: "lowcode",
            threadId: undefined,
          },
        })
      );

      controller.abort();
      await startPromise;
    });
  });

  describe("gateway.abort", () => {
    it("should disconnect cleanly", async () => {
      const { controller, startPromise } = await startAccount();

      controller.abort();
      await startPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("MQTT channel stopping")
      );
    });
  });

  describe("outbound.sendText", () => {
    it("should publish to outbound topic", async () => {
      const { controller, startPromise } = await startAccount();

      const result = await mqttPlugin.outbound.sendText({
        text: "Hello from OpenClaw",
        cfg: defaultCfg as any,
        accountId: "default",
      } as any);

      expect(result.ok).toBe(true);

      const mock = getMockClient();
      const published = mock?.published.find((entry) => entry.topic === "openclaw/outbound");
      expect(published).toBeTruthy();
      const payload = JSON.parse(String(published?.message));
      expect(payload.senderId).toBe("openclaw");
      expect(payload.text).toBe("Hello from OpenClaw");
      expect(payload.kind).toBe("final");
      expect(typeof payload.ts).toBe("number");

      controller.abort();
      await startPromise;
    });

    it("should return default sessionId when threadId is absent", async () => {
      const { controller, startPromise } = await startAccount();

      const result = await mqttPlugin.outbound.sendText({
        text: "Hello from OpenClaw",
        cfg: defaultCfg as any,
        accountId: "default",
        replyToId: "corr-123",
      } as any);

      expect(result.ok).toBe(true);

      const mock = getMockClient();
      const published = mock?.published.find((entry) => entry.topic === "openclaw/outbound");
      expect(published).toBeTruthy();
      const payload = JSON.parse(String(published?.message));
      expect(payload.sessionId).toBe("-1");

      controller.abort();
      await startPromise;
    });

    it("should include sessionId from threadId in outbound envelope", async () => {
      const { controller, startPromise } = await startAccount();

      const result = await mqttPlugin.outbound.sendText({
        text: "Hello from OpenClaw",
        cfg: defaultCfg as any,
        accountId: "default",
        threadId: 7,
      } as any);

      expect(result.ok).toBe(true);

      const mock = getMockClient();
      const published = mock?.published.find((entry) => entry.topic === "openclaw/outbound");
      expect(published).toBeTruthy();
      const payload = JSON.parse(String(published?.message));
      expect(payload.sessionId).toBe("7");

      controller.abort();
      await startPromise;
    });

    it("should publish using the selected account outbound topic", async () => {
      const cfg = {
        channels: {
          "mqtt-channel": {
            accounts: {
              admin: {
                brokerUrl: "mqtt://localhost:1883",
                topics: {
                  inbound: "openclaw/inbound-admin",
                  outbound: "openclaw/outbound-admin",
                },
                qos: 1 as const,
              },
              lowcode: {
                brokerUrl: "mqtt://localhost:1884",
                topics: {
                  inbound: "openclaw/inbound-lowcode",
                  outbound: "openclaw/outbound-lowcode",
                },
                qos: 1 as const,
              },
            },
          },
        },
      };

      const { controller, startPromise } = await startAccount(cfg, "lowcode");

      const result = await mqttPlugin.outbound.sendText({
        text: "Hello lowcode",
        cfg,
        accountId: "lowcode",
      } as any);

      expect(result.ok).toBe(true);
      const published = getMockClient()?.published.find(
        (entry) => entry.topic === "openclaw/outbound-lowcode"
      );
      expect(published).toBeTruthy();
      const payload = JSON.parse(String(published?.message));
      expect(payload.senderId).toBe("openclaw");
      expect(payload.text).toBe("Hello lowcode");
      expect(payload.kind).toBe("final");
      expect(typeof payload.ts).toBe("number");

      controller.abort();
      await startPromise;
    });

    it("should fail if not configured", async () => {
      const result = await mqttPlugin.outbound.sendText({
        text: "Hello",
        cfg: {} as any,
      } as any);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("MQTT not configured");
    });

    it("should fail if not connected", async () => {
      const result = await mqttPlugin.outbound.sendText({
        text: "Hello",
        cfg: defaultCfg as any,
      } as any);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("MQTT not connected");
    });
  });
});

describe("inbound message parsing", () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const mockDispatchReply = vi.fn(async ({ dispatcherOptions }: any) => {
    if (dispatcherOptions?.deliver) {
      await dispatcherOptions.deliver({ text: "test reply" }, { kind: "final" });
    }
  });
  const mockFinalizeInboundContext = vi.fn((payload: any) => payload);
  const mockResolveStorePath = vi.fn(
    (_store: unknown, { agentId }: { agentId?: string } = {}) => `/sessions/${agentId ?? "main"}.json`
  );
  const mockRecordInboundSession = vi.fn(async () => undefined);
  const mockResolveAgentRoute = vi.fn(
    ({ accountId, peer }: { accountId: string; peer: { id: string } }) => ({
      agentId: accountId,
      accountId,
      sessionKey: `agent:${accountId}:mqtt:${peer.id}`,
      mainSessionKey: `agent:${accountId}:main`,
    })
  );

  const mockRuntime = {
    channel: {
      routing: {
        resolveAgentRoute: mockResolveAgentRoute,
      },
      reply: {
        finalizeInboundContext: mockFinalizeInboundContext,
        dispatchReplyWithBufferedBlockDispatcher: mockDispatchReply,
      },
      session: {
        resolveStorePath: mockResolveStorePath,
        recordInboundSession: mockRecordInboundSession,
      },
    },
  };

  const cfg = {
    channels: {
      "mqtt-channel": {
        accounts: {
          default: {
            brokerUrl: "mqtt://localhost:1883",
            topics: { inbound: "test/in", outbound: "test/out" },
            qos: 1 as const,
          },
        },
      },
    },
  };

  const startAccount = async () => {
    const controller = new AbortController();
    const startPromise = mqttPlugin.gateway?.startAccount?.({
      cfg: cfg as any,
      accountId: "default",
      log: mockLogger,
      abortSignal: controller.signal,
    } as any);

    await new Promise((r) => setTimeout(r, 50));

    return { controller, startPromise };
  };

  beforeEach(() => {
    resetMock();
    vi.clearAllMocks();
    setMqttRuntime(mockRuntime as any);
  });

  it("should handle plain text messages", async () => {
    const { controller, startPromise } = await startAccount();

    getMockClient()?.simulateMessage("test/in", "Plain text alert");
    await flushAsync();

    expect(mockDispatchReply).toHaveBeenCalled();
    const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
    expect(lastCall?.ctx?.Body).toBe("Plain text alert");
    expect(lastCall?.ctx?.SenderId).toBe("test-in");

    controller.abort();
    await startPromise;
  });

  it("should use text from JSON payload", async () => {
    const { controller, startPromise } = await startAccount();

    getMockClient()?.simulateMessage(
      "test/in",
      JSON.stringify({ text: "msg2", senderId: "src1", sessionId: "s-1" })
    );
    await flushAsync();

    const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
    expect(lastCall?.ctx?.Body).toBe("msg2");
    expect(lastCall?.ctx?.MessageThreadId).toBe("s-1");

    controller.abort();
    await startPromise;
  });

  it("should extract senderId from JSON", async () => {
    const { controller, startPromise } = await startAccount();

    getMockClient()?.simulateMessage(
      "test/in",
      JSON.stringify({ text: "x", senderId: "src1" })
    );
    await flushAsync();

    const lastCall = mockDispatchReply.mock.calls.at(-1)?.[0];
    expect(lastCall?.ctx?.SenderId).toBe("src1");
    expect(lastCall?.ctx?.ReplyToId).toBeUndefined();

    controller.abort();
    await startPromise;
  });
});
