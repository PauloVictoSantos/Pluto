import { describe, expect, it } from 'vitest';
import { feed, type LineState } from './prompt';

const fresh = (): LineState => ({ value: '', afterCR: false });

describe('feed (leitura de terminal)', () => {
  it('Enter do Windows (\\r\\n) nao vaza para a proxima linha', () => {
    const s = fresh();
    expect(feed(s, 'Paulo\r\n', false)).toMatchObject({ kind: 'line', value: 'Paulo' });
    // O \n pode chegar num pedaco separado logo depois do \r.
    const s2 = fresh();
    expect(feed(s2, 'abc\r', true)).toMatchObject({ kind: 'line', value: 'abc' });
    expect(feed(s2, '\nsenha', true)).toMatchObject({ kind: 'more' });
    expect(feed(s2, '\r', true)).toMatchObject({ kind: 'line', value: 'senha' });
  });

  it('\\n atrasado no inicio da proxima pergunta nao vira resposta vazia', () => {
    const first = fresh();
    feed(first, 'abc\r', false);
    const next: LineState = { value: '', afterCR: first.afterCR };
    expect(feed(next, '\n', true)).toMatchObject({ kind: 'more' });
    expect(feed(next, 'senha\r', true)).toMatchObject({ kind: 'line', value: 'senha' });
  });

  it('modo oculto nunca ecoa o texto', () => {
    const r = feed(fresh(), 'Segredo@123', true);
    expect(r).toEqual({ kind: 'more', echo: '•••••••••••' });
  });

  it('backspace apaga o ultimo caractere', () => {
    const s = fresh();
    feed(s, 'abcx', true);
    expect(feed(s, '\u007f', true).kind).toBe('more');
    expect(feed(s, '\b', true).kind).toBe('more');
    expect(feed(s, 'd\r', true)).toMatchObject({ kind: 'line', value: 'abd' });
  });

  it('ignora setas e teclas de controle; Ctrl+C aborta', () => {
    const s = fresh();
    expect(feed(s, '\u001b[Dok\r', false)).toMatchObject({ kind: 'line', value: 'ok' });
    expect(feed(s, 'a\u001b[3~b\r', false)).toMatchObject({ kind: 'line', value: 'ab' });
    expect(feed(fresh(), '\u0003', false)).toEqual({ kind: 'abort' });
  });

  it('a mesma senha digitada duas vezes da o mesmo valor', () => {
    const s = fresh();
    const a = feed(s, 'Paulo@2026xyz\r\n', true);
    const b = feed(s, 'Paulo@2026xyz\r\n', true);
    expect(a.kind === 'line' && b.kind === 'line' && a.value === b.value).toBe(true);
  });
});
