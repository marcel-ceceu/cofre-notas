import { describe, expect, it } from "vitest";
import { CONVERSAS_ROOT, conversasDir } from "./dest";

describe("pastas de transcrições originais", () => {
  it("usa a raiz fixa D:\\915_CofreNotas-Conversas", () => {
    expect(CONVERSAS_ROOT).toBe("D:\\915_CofreNotas-Conversas");
  });

  it("monta uma subpasta numerada por fonte", () => {
    expect(conversasDir("chatgpt")).toBe("D:\\915_CofreNotas-Conversas\\1_Chatgpt");
    expect(conversasDir("claudeWeb")).toBe("D:\\915_CofreNotas-Conversas\\2_ClaudeWeb");
    expect(conversasDir("cursor")).toBe("D:\\915_CofreNotas-Conversas\\3_Cursor");
  });
});
