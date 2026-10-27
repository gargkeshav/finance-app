export interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookies: string;
}

function decodeAnsiQuoted(value: string): string {
  return value.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[abfnrtv\\'"])/g, (_match, escape: string) => {
    const code = escape[0];
    if (code === "x") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (code === "u") return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    const characters: Record<string, string> = {
      a: "\x07",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
    };
    return characters[code] ?? _match;
  });
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote === "'") {
      if (character === "'") quote = null;
      else token += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\" && index + 1 < text.length) {
        const next = text[index + 1];
        if (next === "\n" || next === "\r") {
          index += next === "\r" && text[index + 2] === "\n" ? 2 : 1;
        } else {
          token += next;
          index += 1;
        }
      } else {
        token += character;
      }
      continue;
    }
    if (character === "\\" && index + 1 < text.length) {
      const next = text[index + 1];
      if (next === "\n" || next === "\r") {
        index += next === "\r" && text[index + 2] === "\n" ? 2 : 1;
      } else {
        token += next;
        started = true;
        index += 1;
      }
      continue;
    }
    if (character === "$" && text[index + 1] === "'") {
      started = true;
      let raw = "";
      index += 2;
      let closed = false;
      while (index < text.length) {
        const next = text[index];
        if (next === "'" && text[index - 1] !== "\\") {
          closed = true;
          break;
        }
        raw += next;
        if (next === "\\" && index + 1 < text.length) {
          raw += text[index + 1];
          index += 1;
        }
        index += 1;
      }
      if (!closed) throw new Error("The copied cURL has an unterminated quote.");
      token += decodeAnsiQuoted(raw);
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
      continue;
    }
    token += character;
    started = true;
  }
  if (quote) throw new Error("The copied cURL has an unterminated quote.");
  if (started) tokens.push(token);
  return tokens;
}

function addCookie(current: string, value: string): string {
  const cookies = new Map<string, string>();
  for (const pair of `${current}; ${value}`.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    if (name) cookies.set(name, cookieValue);
  }
  return [...cookies].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ");
}

function readOptionValue(tokens: string[], index: number, inlineValue?: string): [string, number] {
  if (inlineValue !== undefined) return [inlineValue, index];
  const value = tokens[index + 1];
  if (value === undefined) throw new Error("The copied cURL is missing an option value.");
  return [value, index + 1];
}

export function parseCurl(text: string): ParsedCurl {
  const tokens = tokenize(text);
  if (tokens[0] !== "curl") throw new Error("Paste a request copied as cURL.");

  let method = "GET";
  let explicitMethod = false;
  let hasData = false;
  let urlText = "";
  let cookies = "";
  const headers: Record<string, string> = {};

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const equals = token.indexOf("=");
    const option = equals > 0 ? token.slice(0, equals) : token;
    const inline = equals > 0 ? token.slice(equals + 1) : undefined;
    if (option === "-H" || option === "--header" || option === "-b" || option === "--cookie" ||
        option === "-X" || option === "--request" || option === "--data" ||
        option === "--data-raw" || option === "--data-urlencode") {
      const [value, lastIndex] = readOptionValue(tokens, index, inline);
      index = lastIndex;
      if (option === "-H" || option === "--header") {
        const separator = value.indexOf(":");
        if (separator <= 0) throw new Error("The copied cURL contains an invalid header.");
        const name = value.slice(0, separator).trim();
        const headerValue = value.slice(separator + 1).trim();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(headerValue)) {
          throw new Error("The copied cURL contains an invalid header.");
        }
        if (name.toLowerCase() === "cookie") cookies = addCookie(cookies, headerValue);
        else headers[name] = headerValue;
      } else if (option === "-b" || option === "--cookie") {
        if (value.startsWith("@")) throw new Error("Cookie files are not supported; copy the request as cURL with cookies included.");
        cookies = addCookie(cookies, value);
      } else if (option === "-X" || option === "--request") {
        if (!/^[A-Za-z]+$/.test(value)) throw new Error("The copied cURL contains an invalid method.");
        method = value.toUpperCase();
        explicitMethod = true;
      } else {
        hasData = true;
        if (!explicitMethod) method = "POST";
      }
      continue;
    }
    if (option === "--url") {
      [urlText, index] = readOptionValue(tokens, index, inline);
      continue;
    }
    if (["--compressed", "--location", "-L", "--silent", "-s", "--show-error", "-S", "--globoff",
      "--http2", "--http1.1", "--insecure", "-k", "--path-as-is", "--verbose", "-v"].includes(option)) {
      continue;
    }
    if (token.startsWith("-")) throw new Error("The copied cURL contains an unsupported option.");
    if (urlText) throw new Error("The copied cURL must contain exactly one URL.");
    urlText = token;
  }

  if (!urlText) throw new Error("The copied cURL does not contain a URL.");
  const url = new URL(urlText);
  if (url.protocol !== "https:" || url.hostname !== "secure.splitwise.com" || url.port ||
      url.username || url.password) {
    throw new Error("Only requests to https://secure.splitwise.com are supported.");
  }
  if (hasData && !explicitMethod && method === "GET") method = "POST";
  return { method, url: url.toString(), headers, cookies };
}

export function headerNames(parsed: ParsedCurl): string[] {
  const names = Object.keys(parsed.headers);
  if (parsed.cookies && !names.some((name) => name.toLowerCase() === "cookie")) names.push("Cookie");
  return names;
}
