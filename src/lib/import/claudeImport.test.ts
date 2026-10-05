import { describe, it, expect } from "vitest";
import { extractMessageText, conversationToMarkdown } from "./claudeImport";

describe("extractMessageText", () => {
  it("usa só os blocos text (descarta memória injetada, thinking e ferramentas)", () => {
    const txt = extractMessageText({
      sender: "human",
      text: "fallback não usado",
      content: [
        { type: "injected_prompt_block", text: undefined },
        { type: "thinking" },
        { type: "tool_use" },
        { type: "tool_result" },
        { type: "text", text: "primeiro" },
        { type: "text", text: "segundo" },
      ],
    });
    expect(txt).toBe("primeiro\n\nsegundo");
  });

  it("mensagem só com memória injetada fica vazia (e some da nota)", () => {
    const md = conversationToMarkdown({
      uuid: "u",
      name: "t",
      created_at: "2026-09-23T10:00:00Z",
      chat_messages: [
        { sender: "human", text: "", content: [{ type: "injected_prompt_block" }] },
        { sender: "assistant", content: [{ type: "text", text: "resposta" }] },
      ],
    });
    expect(md?.content).not.toContain("👤 You");
    expect(md?.content).toContain("resposta");
  });

  it("sem content cai no campo text", () => {
    expect(extractMessageText({ text: "  só texto  " })).toBe("só texto");
  });
});
