import { open } from "@tauri-apps/plugin-dialog";
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join, tempDir } from "@tauri-apps/api/path";
import { isTauriRuntime } from "../fileSystem.tauri";

/** Nome registrado no escopo `shell:allow-execute` da capability do Tauri. */
const SHELL_SCOPE = "piloto-memoria";

const SCRIPT_FILENAME = "260828_0753_mem0_producao_cplus_final.ps1";

export type PilotoLine = {
  id: number;
  text: string;
  stream: "out" | "err";
};

export type PilotoHandle = {
  /** Encerra o processo do PowerShell em andamento. */
  cancel: () => Promise<void>;
};

export type RunPilotoOptions = {
  scriptPath: string;
  files: string[];
  onLine: (line: string, stream: "out" | "err") => void;
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
};

/** Caminho sugerido do script — o usuário pode trocar no popup. */
export async function defaultScriptPath(): Promise<string> {
  return join(await homeDir(), "Downloads", SCRIPT_FILENAME);
}

/**
 * Abre a janela "Abrir arquivos" nativa do Windows, já filtrada em .md,
 * com seleção múltipla (Ctrl+clique). Retorna [] se o usuário cancelar.
 */
export async function pickConversationFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "Selecione as conversas (.md) para o piloto",
    filters: [{ name: "Conversas Markdown", extensions: ["md"] }],
  });

  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/**
 * Grava a lista escolhida num JSON temporário e dispara o PowerShell,
 * transmitindo cada linha de saída conforme ela sai do processo.
 *
 * A lista vai por arquivo — e não como argumentos soltos — porque caminhos
 * com espaço, vírgula ou acento quebram o binding de array do PowerShell.
 */
export async function runPiloto(
  opts: RunPilotoOptions
): Promise<PilotoHandle> {
  if (!isTauriRuntime()) {
    throw new Error("A execução só é possível no app desktop.");
  }

  const listPath = await join(
    await tempDir(),
    `cofre-piloto-${Date.now()}.json`
  );

  await writeTextFile(listPath, JSON.stringify(opts.files, null, 2));

  const command = Command.create(SHELL_SCOPE, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    opts.scriptPath,
    "-ListaArquivos",
    listPath,
  ]);

  command.stdout.on("data", (line: string) => opts.onLine(line, "out"));
  command.stderr.on("data", (line: string) => opts.onLine(line, "err"));
  command.on("close", ({ code }: { code: number | null }) =>
    opts.onExit(code)
  );
  command.on("error", (message: string) => opts.onError(String(message)));

  const child: Child = await command.spawn();

  return {
    cancel: async () => {
      try {
        await child.kill();
      } catch {
        // processo já encerrado — nada a fazer
      }
    },
  };
}

/**
 * Comando equivalente para colar no PowerShell (usado fora do desktop).
 * Precisa ser `pwsh` (PowerShell 7): o script declara `#requires -Version 7.0`
 * e o `powershell` do Windows é 5.1.
 */
export function manualCommand(scriptPath: string, files: string[]): string {
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
  return `pwsh -NoProfile -ExecutionPolicy Bypass -File '${scriptPath.replace(
    /'/g,
    "''"
  )}' -Arquivos @(${list})`;
}
