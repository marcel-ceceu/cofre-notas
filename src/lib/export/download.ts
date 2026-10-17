/** Dispara download de bytes no navegador (PWA). */
export function triggerDownload(filename: string, data: Uint8Array): void {
  const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
