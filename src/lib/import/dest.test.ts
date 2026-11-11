import { describe, expect, it } from "vitest";
import { CONVERSAS_ROOT, conversasDir, migrarCaminhoAntigo } from "./dest";

describe("migração do disco D para o C", () => {
  it("troca a raiz antiga do cofre pela nova", () => {
    expect(migrarCaminhoAntigo("D:\\2606VAULT-ClaudeConversasOF-v2")).toBe("C:\\CofreNotasMsgm\\Cofre");
    expect(migrarCaminhoAntigo("d:/2606VAULT-ClaudeConversasOF-v2/ChatGPT")).toBe(
      "C:\\CofreNotasMsgm\\Cofre\\ChatGPT"
    );
  });

  it("troca a raiz antiga dos originais", () => {
    expect(migrarCaminhoAntigo("D:\\915_CofreNotas-Conversas\\1_Chatgpt")).toBe(
      "C:\\CofreNotasMsgm\\Originais\\1_Chatgpt"
    );
  });

  it("não mexe em outros caminhos nem em nomes parecidos", () => {
    expect(migrarCaminhoAntigo("C:\\Outro\\cofre")).toBe("C:\\Outro\\cofre");
    expect(migrarCaminhoAntigo("D:\\2606VAULT-ClaudeConversasOF-v2-FINAL")).toBe(
      "D:\\2606VAULT-ClaudeConversasOF-v2-FINAL"
    );
  });
});

describe("pastas de transcrições originais", () => {
  it("usa a raiz fixa C:\\CofreNotasMsgm\\Originais", () => {
    expect(CONVERSAS_ROOT).toBe("C:\\CofreNotasMsgm\\Originais");
  });

  it("monta uma subpasta numerada por fonte", () => {
    expect(conversasDir("chatgpt")).toBe("C:\\CofreNotasMsgm\\Originais\\1_Chatgpt");
    expect(conversasDir("claudeWeb")).toBe("C:\\CofreNotasMsgm\\Originais\\2_ClaudeWeb");
    expect(conversasDir("cursor")).toBe("C:\\CofreNotasMsgm\\Originais\\3_Cursor");
  });
});
