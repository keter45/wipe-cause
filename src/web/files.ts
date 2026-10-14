// Logs abertos no site. O navegador não dá caminho de arquivo: o "caminho" é o nome do arquivo
// (o mesmo log reaberto cai na mesma entrada do histórico) e o `File` fica guardado enquanto a
// página está aberta, para reanalisar e para o replay.

const opened = new Map<string, File>();

export function rememberFile(file: File): string {
  opened.set(file.name, file);
  return file.name;
}

export const openedFile = (path: string) => opened.get(path) ?? null;

/** Diálogo de abrir arquivo do navegador. */
export function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
