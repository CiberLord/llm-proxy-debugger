import { describe, it, expect } from "vitest";
import { anthropicToOpenAIRequest } from "../../src/server/converter/anthropic-to-openai";

describe("anthropicToOpenAIRequest", () => {
  it("converts simple string content", () => {
    const out = anthropicToOpenAIRequest({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out).toEqual({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hello" }],
      max_completion_tokens: 128,
    });
  });

  it("prepends system message as string", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("joins array-form system", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      system: [
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.messages[0]).toEqual({
      role: "system",
      content: "part1\n\npart2",
    });
  });

  it("unwraps single text block to plain string", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "single" }],
        },
      ],
    });
    expect(out.messages[0]).toEqual({ role: "user", content: "single" });
  });

  it("converts images to image_url parts", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "AAAA",
              },
            },
          ],
        },
      ],
    });
    expect(out.messages[0].content).toEqual([
      { type: "text", text: "what is this?" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,AAAA" },
      },
    ]);
  });

  it("converts assistant tool_use into OpenAI tool_calls", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "Almaty" },
            },
          ],
        },
      ],
    });
    const assistantMsg = out.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Let me check.");
    expect(assistantMsg.tool_calls).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ city: "Almaty" }),
        },
      },
    ]);
  });

  it("converts user tool_result into OpenAI role:tool message", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "sunny, 25C",
            },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "toolu_1", content: "sunny, 25C" },
    ]);
  });

  it("flattens array tool_result content to string", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "text", text: "part-a" },
                { type: "text", text: "part-b" },
              ],
            },
          ],
        },
      ],
    });
    expect(out.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "toolu_1",
      content: "part-apart-b",
    });
  });

  it("maps tools and tool_choice variants", () => {
    const baseReq = {
      model: "m",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    };

    const auto = anthropicToOpenAIRequest({
      ...baseReq,
      tool_choice: { type: "auto" },
    });
    expect(auto.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      },
    ]);
    expect(auto.tool_choice).toBe("auto");

    const any = anthropicToOpenAIRequest({
      ...baseReq,
      tool_choice: { type: "any" },
    });
    expect(any.tool_choice).toBe("required");

    const none = anthropicToOpenAIRequest({
      ...baseReq,
      tool_choice: { type: "none" },
    });
    expect(none.tool_choice).toBe("none");

    const specific = anthropicToOpenAIRequest({
      ...baseReq,
      tool_choice: { type: "tool", name: "get_weather" },
    });
    expect(specific.tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("passes stream + stream_options when stream:true", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("maps stop_sequences to stop", () => {
    const out = anthropicToOpenAIRequest({
      model: "m",
      stop_sequences: ["\n\nHuman:", "END"],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.stop).toEqual(["\n\nHuman:", "END"]);
  });
});
