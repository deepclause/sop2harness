import type {
  LLMBackend,
  LLMBackendMessage,
  LLMBackendRequest,
  LLMBackendResponse,
} from "deepclause-sdk";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, AssistantMessage, Message, Model, Usage } from "@earendil-works/pi-ai";

const models = builtinModels();

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function toPiMessages(messages: LLMBackendMessage[], model: Model<Api>): Message[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message): Message => {
      if (message.role === "assistant" && message.providerData) {
        return message.providerData as AssistantMessage;
      }
      if (message.role === "user") {
        return { role: "user", content: message.content, timestamp: Date.now() };
      }
      if (message.role === "tool") {
        return {
          role: "toolResult",
          toolCallId: message.toolCallId ?? "unknown",
          toolName: message.toolName ?? "unknown",
          content: [{ type: "text", text: message.content }],
          isError: false,
          timestamp: Date.now(),
        };
      }
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: "toolCall" as const,
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          })),
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: emptyUsage(),
        stopReason: message.toolCalls?.length ? ("toolUse" as const) : ("stop" as const),
        timestamp: Date.now(),
      };
    });
}

function resolveModel(): Model<Api> {
  const provider = process.env.S2H_LLM_PROVIDER?.trim();
  const id = process.env.S2H_LLM_MODEL?.trim();
  if (provider && id) {
    const model = models.getModel(provider, id);
    if (model) return model;
    throw new Error(`Model not found: ${provider}/${id}`);
  }
  if (id) {
    const byId = models.getModels().find((model) => model.id === id);
    if (byId) return byId;
  }
  const fallback = models.getModel("openai", "gpt-4o-mini");
  if (fallback) return fallback;
  throw new Error("No model resolved; set S2H_LLM_PROVIDER and S2H_LLM_MODEL");
}

function toResponse(response: AssistantMessage): LLMBackendResponse {
  const text = response.content
    .filter((content): content is Extract<AssistantMessage["content"][number], { type: "text" }> => content.type === "text")
    .map((content) => content.text)
    .join("");
  return {
    text,
    toolCalls: response.content
      .filter((content): content is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => content.type === "toolCall")
      .map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    usage: {
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
      totalTokens: response.usage.totalTokens,
      cacheReadTokens: response.usage.cacheRead,
      cacheWriteTokens: response.usage.cacheWrite,
      reasoningTokens: response.usage.reasoning,
    },
    finishReason:
      response.stopReason === "toolUse" ? "tool_use" : response.stopReason === "length" ? "length" : response.stopReason === "stop" ? "stop" : undefined,
    providerData: response,
  };
}

function createPiBackend(): LLMBackend {
  const model = resolveModel();
  return {
    async complete(request: LLMBackendRequest): Promise<LLMBackendResponse> {
      const systemPrompt = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");

      const response = await models.completeSimple(
        model,
        {
          systemPrompt: systemPrompt || undefined,
          messages: toPiMessages(request.messages, model),
          tools: request.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as never,
          })),
        },
        {
          signal: request.signal,
          maxTokens: request.maxTokens ?? 4096,
          cacheRetention: "none",
        },
      );

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(response.errorMessage || `Pi model request ${response.stopReason}`);
      }

      const result = toResponse(response);
      if (result.text) request.onText?.(result.text);
      return result;
    },
  };
}

function createMockBackend(): LLMBackend {
  return {
    async complete(request: LLMBackendRequest): Promise<LLMBackendResponse> {
      request.onText?.("mock");
      return {
        text: "mock",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
}

export function createBackend(kind: string): LLMBackend {
  if (kind === "mock") return createMockBackend();
  return createPiBackend();
}
