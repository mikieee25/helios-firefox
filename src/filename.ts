export interface Header {
  name: string;
  value?: string | undefined;
  binaryValue?: number[] | undefined;
}

export function filenameFromHeaders(headers: Header[] = []): string | undefined {
  const disposition = headers.find((header) => header.name.toLowerCase() === "content-disposition")?.value;
  if (!disposition) return undefined;

  const encoded = disposition.match(/(?:^|;)\s*filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim();
  const regular = disposition.match(/(?:^|;)\s*filename\s*=\s*("(?:\\.|[^"])*"|[^;]+)/i)?.[1]?.trim();
  let name: string | undefined;
  try {
    if (encoded) name = decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    else if (regular) name = regular.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
  } catch {
    return undefined;
  }
  if (!name) return undefined;
  name = name.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/g, "");
  if (!name) return undefined;
  const base = name.split(".")[0]?.toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base ?? "")) name = `_${name}`;
  return name.slice(0, 200) || undefined;
}
