import { describe, expect, it } from 'vitest';
import { fetchNfce, isSefazUrl, parseNfceHtml, parseNfceQr } from './nfce';

// Pagina de consulta publica da NFC-e no layout padrao (recorte de um portal estadual).
const HTML = `<html><body>
<div id="u20" class="txtTopo">SUPERMERCADO BOM PRECO LTDA</div>
<table id="tabResult">
<tr id="Item + 1"><td valign="top"><span class="txtTit">CAFE PILAO TRAD 500G</span><span class="RCod">(Código: 789 )</span><br />
<span class="Rqtd"><strong>Qtde.:</strong>2</span><span class="RUN"><strong>UN: </strong>UN</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;16,99</span></td>
<td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">33,98</span></td></tr>
<tr id="Item + 2"><td valign="top"><span class="txtTit">BANANA PRATA KG</span><span class="RCod">(Código: 2 )</span><br />
<span class="Rqtd"><strong>Qtde.:</strong>1,235</span><span class="RUN"><strong>UN: </strong>KG</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>&nbsp;5,99</span></td>
<td align="right" valign="top" class="txtTit noWrap">Vl. Total<br /><span class="valor">7,40</span></td></tr>
</table>
<div id="linhaTotal" class="linhaShade"><label>Valor a pagar R$:</label><span class="totalNumb txtMax">41,38</span></div>
<li><strong>Número: </strong>1234 <strong> Série: </strong>1 <strong> Emissão: </strong>24/10/2026 10:31:22</li>
</body></html>`;
const KEY = '13261012345678000190650010000012341000012345';

describe('NFC-e', () => {
  it('chave de acesso pelo QR (URL ou so a chave)', () => {
    expect(parseNfceQr(`https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=${KEY}|2|1|1|ABCDEF`)).toEqual({
      url: `https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=${KEY}|2|1|1|ABCDEF`,
      accessKey: KEY,
    });
    expect(parseNfceQr(KEY.replace(/(\d{4})/g, '$1 ')).accessKey).toBe(KEY);
  });

  it('so consulta portais oficiais', () => {
    expect(isSefazUrl('https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=1')).toBe(true);
    expect(isSefazUrl('https://www.nfce.fazenda.sp.gov.br/qrcode?p=1')).toBe(true);
    expect(isSefazUrl('https://golpe.com/sefaz.gov.br')).toBe(false);
    expect(isSefazUrl('http://169.254.169.254/latest')).toBe(false);
  });

  it('le itens, loja, data e total da pagina oficial', () => {
    expect(parseNfceHtml(HTML)).toEqual({
      store: 'SUPERMERCADO BOM PRECO LTDA',
      date: '2026-10-24',
      totalMinor: 4_138,
      items: [
        { name: 'CAFE PILAO TRAD 500G', qty: 2, unitPriceMinor: 1_699, totalMinor: 3_398 },
        { name: 'BANANA PRATA KG', qty: 1.235, unitPriceMinor: 599, totalMinor: 740 },
      ],
    });
    expect(parseNfceHtml('<html>captcha</html>')).toBeNull();
  });

  it('busca a pagina so em host .gov.br', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => (calls.push(url), new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }))) as unknown as typeof fetch;
    expect((await fetchNfce('https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=1', fake))?.items).toHaveLength(2);
    expect(await fetchNfce('https://evil.example.com/x', fake)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
