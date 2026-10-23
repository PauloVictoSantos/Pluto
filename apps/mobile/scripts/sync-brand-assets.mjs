// Gera os recursos de marca do app a partir do site (rode de novo quando o site ganhar logos):
//   node apps/mobile/scripts/sync-brand-assets.mjs
// - logos dos bancos: apps/web/public/banks/*.svg -> assets/banks/*.png (sharp)
// - logos de lojas colocados pelo usuario: apps/web/public/icon e public/logos -> assets/merchants
// - simbolos oficiais do simple-icons usados no site -> src/lib/brand-icons.generated.ts
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const web = path.resolve(mobile, '../web');
const requireWeb = createRequire(path.join(web, 'package.json'));
// sharp vem pelo Next (dependencia opcional dele), nao direto do site.
const sharp = createRequire(requireWeb.resolve('next/package.json'))('sharp');
const siMod = await import(pathToFileURL(requireWeb.resolve('simple-icons')).href);
const si = siMod.siVisa ? siMod : siMod.default;

// Bancos: PNG 3x para circulos de ate 40pt.
const banksOut = path.join(mobile, 'assets/banks');
fs.mkdirSync(banksOut, { recursive: true });
const banks = fs.readdirSync(path.join(web, 'public/banks')).filter((f) => f.endsWith('.svg'));
for (const f of banks) {
  const svg = fs.readFileSync(path.join(web, 'public/banks', f));
  await sharp(svg, { density: 384 }).resize(120, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toFile(path.join(banksOut, f.replace('.svg', '.png')));
}

// Logos de lojas (o nome do arquivo e a marca: "Amazon.png" -> amazon).
const merchOut = path.join(mobile, 'assets/merchants');
fs.mkdirSync(merchOut, { recursive: true });
const merchants = [];
for (const dir of ['public/icon', 'public/logos']) {
  const abs = path.join(web, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).filter((x) => /\.(png|jpe?g|webp|svg)$/i.test(x))) {
    const slug = f.replace(/\.[a-z]+$/i, '').toLowerCase();
    const out = path.join(merchOut, `${slug}.png`);
    await sharp(path.join(abs, f), { density: 384 }).resize(120, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toFile(out);
    merchants.push(slug);
  }
}

// simple-icons: so os simbolos usados (lib/merchants.tsx e CreditCard.tsx do site).
const USED = {
  uber: 'siUber', ubereats: 'siUbereats', ifood: 'siIfood', shopee: 'siShopee', aliexpress: 'siAliexpress', netflix: 'siNetflix', spotify: 'siSpotify',
  youtube: 'siYoutube', max: 'siMax', paramountplus: 'siParamountplus', crunchyroll: 'siCrunchyroll', deezer: 'siDeezer', steam: 'siSteam',
  playstation: 'siPlaystation', mcdonalds: 'siMcdonalds', burgerking: 'siBurgerking', kfc: 'siKfc', starbucks: 'siStarbucks', mercadopago: 'siMercadopago',
  visa: 'siVisa', americanexpress: 'siAmericanexpress',
};
const entries = Object.entries(USED).map(([slug, name]) => `  ${slug}: { hex: '${si[name].hex}', path: '${si[name].path}' },`);
const reqBanks = banks.map((f) => `  ${f.replace('.svg', '')}: require('../../assets/banks/${f.replace('.svg', '.png')}'),`);
const reqMerch = merchants.map((s) => `  ${JSON.stringify(s)}: require('../../assets/merchants/${s}.png'),`);
fs.writeFileSync(
  path.join(mobile, 'src/lib/brand-icons.generated.ts'),
  `/* eslint-disable */
// GERADO por scripts/sync-brand-assets.mjs a partir do site (simple-icons ${JSON.parse(fs.readFileSync(path.join(web, 'package.json'), 'utf8')).dependencies['simple-icons']}, CC0). Nao edite.

/** Simbolos oficiais das marcas (viewBox 24x24) e a cor oficial. */
export const SIMPLE_ICONS: Record<string, { hex: string; path: string }> = {
${entries.join('\n')}
};

/** Logos dos bancos (PNG gerado de apps/web/public/banks). */
export const BANK_LOGOS: Record<string, number> = {
${reqBanks.join('\n')}
};

/** Logos de lojas colocados pelo usuario em apps/web/public/icon ou public/logos. */
export const MERCHANT_FILES: Record<string, number> = {
${reqMerch.join('\n')}
};
`,
);
console.log(`bancos: ${banks.length}, lojas: ${merchants.length}, simbolos: ${entries.length}`);
