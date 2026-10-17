import { describe, expect, it } from "vitest";
import {
  conversationDownloadsFromManifest,
  isClaudeManifestFileName,
  parseClaudeExportManifest,
} from "./claudeExportManifest";

const SAMPLE = `{
  "version": "1.0",
  "created_at": "2026-10-16T22:06:34.617224+00:00",
  "total_files": 2,
  "data_files": [
    {
      "batch_index": 0,
      "export_url": "https://claude.ai/export/x/download/a",
      "category": "projects",
      "part": 0,
      "filename": "projects-000.zip"
    },
    {
      "batch_index": 1,
      "export_url": "https://claude.ai/export/x/download/b",
      "category": "conversations",
      "part": 0,
      "filename": "conversations-000.zip"
    },
    {
      "batch_index": 2,
      "export_url": "https://claude.ai/export/x/download/c",
      "category": "conversations",
      "part": 1,
      "filename": "conversations-001.zip"
    }
  ]
}`;

describe("claudeExportManifest", () => {
  it("parseia manifest válido", () => {
    const m = parseClaudeExportManifest(SAMPLE);
    expect(m.version).toBe("1.0");
    expect(m.data_files).toHaveLength(3);
  });

  it("extrai só conversations ordenadas por part", () => {
    const m = parseClaudeExportManifest(SAMPLE);
    const conv = conversationDownloadsFromManifest(m);
    expect(conv.map((f) => f.filename)).toEqual([
      "conversations-000.zip",
      "conversations-001.zip",
    ]);
    expect(conv[0].export_url).toContain("/download/b");
  });

  it("reconhece nome manifest-*.json", () => {
    expect(
      isClaudeManifestFileName(
        "manifest-c49d6fca-3c63-423b-a638-ac86c2799d59-1792188313-4a544b0a-2026-10-16-22-06-34.json"
      )
    ).toBe(true);
    expect(isClaudeManifestFileName("conversations-000.zip")).toBe(false);
  });

  it("rejeita JSON sem data_files", () => {
    expect(() => parseClaudeExportManifest("{}")).toThrow(/manifest/);
  });
});
