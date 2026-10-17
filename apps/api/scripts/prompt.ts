import { createInterface } from 'node:readline';

// Leitura de terminal sem readline: cada tecla e tratada aqui, com ou sem eco.
// Motivo: no Windows, misturar readline com modo raw deixa caracteres de uma linha na proxima
// (o Enter chega como "\r\n") e o eco da senha vaza na tela.

export interface LineState {
  value: string;
  /** Ultimo caractere foi "\r": um "\n" logo em seguida faz parte do mesmo Enter. */
  afterCR: boolean;
  /** Dentro de uma sequencia de escape (setas, Home, End...): descarta ate a letra final. */
  inEscape?: boolean;
}

export type KeyResult = { kind: 'line'; value: string; echo: string } | { kind: 'more'; echo: string } | { kind: 'abort' };

/** Processa um pedaco de entrada. Pura (testavel); `hidden` define o que ecoar. */
export function feed(state: LineState, chunk: string, hidden: boolean): KeyResult {
  let echo = '';
  for (const ch of chunk) {
    if (state.inEscape) {
      if (/[A-Za-z~]/.test(ch)) state.inEscape = false;
      continue;
    }
    if (ch === '\u001b') {
      state.inEscape = true;
      continue;
    }
    if (ch === '\n' && state.afterCR) {
      state.afterCR = false;
      continue;
    }
    state.afterCR = ch === '\r';
    if (ch === '\r' || ch === '\n') {
      const value = state.value;
      state.value = '';
      return { kind: 'line', value, echo: echo + '\n' };
    }
    if (ch === '\u0003' || ch === '\u0004') return { kind: 'abort' }; // Ctrl+C / Ctrl+D
    if (ch === '\u007f' || ch === '\b') {
      if (state.value) {
        state.value = [...state.value].slice(0, -1).join('');
        echo += '\b \b';
      }
      continue;
    }
    if (ch < ' ') continue; // demais teclas de controle
    state.value += ch;
    echo += hidden ? '•' : ch;
  }
  return { kind: 'more', echo };
}

let lastEndedWithCR = false;
let piped: AsyncIterator<string> | null = null;
async function nextPipedLine(): Promise<string> {
  piped ??= createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
  const r = await piped.next();
  return r.done ? '' : r.value;
}

/** Le uma linha do terminal. `hidden`: mostra • no lugar de cada caractere. */
export function ask(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  if (!stdin.isTTY) {
    // Entrada redirecionada (sem terminal): sem eco para esconder, readline resolve bem.
    return nextPipedLine().then((v) => {
      process.stdout.write('\n');
      return opts.hidden ? v : v.trim();
    });
  }
  return new Promise((resolve) => {
    // Herda o "\r" da pergunta anterior: um "\n" atrasado nao vira resposta vazia.
    const state: LineState = { value: '', afterCR: lastEndedWithCR };
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf: Buffer) => {
      const r = feed(state, buf.toString('utf8'), !!opts.hidden);
      if (r.kind === 'abort') {
        stdin.setRawMode(false);
        process.stdout.write('\nCancelado.\n');
        process.exit(130);
      }
      process.stdout.write(r.echo);
      if (r.kind === 'line') {
        lastEndedWithCR = state.afterCR;
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        // Senha: exatamente o que foi digitado. Demais campos: sem espacos nas pontas.
        resolve(opts.hidden ? r.value : r.value.trim());
      }
    };
    stdin.on('data', onData);
  });
}
