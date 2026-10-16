// Lê os CSVs do Brudam (Tela 376 - Relatório de Entregas, filtro Data Prev. Entrega)
// e gera o dados.json do dash de agentes.
//
// Uso: node scripts/processar-csv.mjs <pasta-ou-arquivos...> [--saida dados.json] [--meses 3]
//
// Regras (iguais ao Performance Hub):
//  - mês = PREV. ENTREGA DATA
//  - sucesso = ENTREGUE NO PRAZO, e tudo que tem "(IN.CLIENTE)" vencido/entregue (ineficiência do cliente)
//  - fora    = ENTREGUE FORA DO PRAZO, FORA DO PRAZO (sem ineficiência do cliente)
//  - pendentes ainda dentro do prazo (NO PRAZO, NO PRAZO (IN.CLIENTE), agendado) não entram na conta
//  - se a mesma MD aparece em mais de um arquivo, vale o arquivo gerado por último
import fs from "node:fs";
import path from "node:path";
import { agregar } from "./agregar.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const SAIDA = opt("--saida", "dados.json");
const MESES = Number(opt("--meses", "3"));
const META = Number(opt("--meta", "96"));

let arquivos = [];
for (const a of args) {
  if (fs.statSync(a).isDirectory()) arquivos.push(...fs.readdirSync(a).filter((f) => /_entregas_.*\.csv$/i.test(f)).map((f) => path.join(a, f)));
  else arquivos.push(a);
}
if (!arquivos.length) { console.error("Nenhum CSV de entregas encontrado."); process.exit(1); }
// ordena pela data de geração no nome (azportoex_entregas_AAAA_MM_DD_HH_MM_SS.csv)
const carimbo = (f) => (path.basename(f).match(/(\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2})/) || [, "0"])[1];
arquivos.sort((a, b) => carimbo(a).localeCompare(carimbo(b)));

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
function lerData(s) { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; }

function parseCsv(txt) {
  txt = txt.replace(/^﻿/, "");
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) { if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === ";") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo.replace(/\r$/, "")); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function classificar(status) {
  const s = norm(status);
  if (!s) return null;
  const inef = s.includes("IN.CLIENTE") || s.includes("INEFICIENCIA");
  if (s.startsWith("ENTREGUE NO PRAZO")) return true;
  if (s.includes("FORA DO PRAZO")) return inef ? true : false;
  return null; // NO PRAZO / agendado / outros: ainda em aberto dentro do prazo
}

const porMd = new Map();
let lidas = 0;
for (const f of arquivos) {
  const linhas = parseCsv(fs.readFileSync(f, "utf8"));
  const cab = linhas[0].map((h) => norm(h));
  const col = (nome) => cab.indexOf(norm(nome));
  const c = {
    md: col("MD"), cliente: col("CLIENTE"), dest: col("DESTINATARIO"), cidade: col("CIDADE DESTINO"), uf: col("UF DESTINO"),
    agente: col("RESP ENTREGA"), prev: col("PREV. ENTREGA DATA"), entrega: col("ENTREGA"), status: col("STATUS"),
  };
  for (const k of ["md", "agente", "prev", "status"]) if (c[k] < 0) throw new Error(`${path.basename(f)}: coluna ${k} não encontrada`);
  for (const l of linhas.slice(1)) {
    if (!/^\d+$/.test((l[c.md] || "").trim())) continue;
    lidas++;
    porMd.set(l[c.md].trim(), {
      md: l[c.md].trim(), pagador: l[c.cliente] || "", dest: l[c.dest] || "", cidade: l[c.cidade] || "", uf: l[c.uf] || "",
      agente: (l[c.agente] || "").trim(), prevista: lerData(l[c.prev]), dataTxt: l[c.prev] || "",
      status: (l[c.status] || "").trim(), sucesso: classificar(l[c.status]),
    });
  }
}

const regs = [...porMd.values()].filter((r) => r.sucesso !== null && r.prevista);
const dados = agregar(regs, { meta: META, meses: MESES });
dados.fonte = "brudam";
dados.arquivos = arquivos.map((f) => path.basename(f));
fs.writeFileSync(SAIDA, JSON.stringify(dados));
console.log(`${arquivos.length} arquivo(s), ${lidas} linhas, ${porMd.size} MDs únicas, ${regs.length} entregas na conta → ${SAIDA}`);
for (const m of dados.meses) console.log(`  ${m.label}${m.parcial ? " (parcial)" : ""}: ${m.resumo.total} entregas · no prazo ${m.resumo.sucesso} · fora ${m.resumo.fora} · taxa ${m.resumo.taxa}% · ${m.resumo.agentes} agentes · ${m.resumo.sem_agente} sem agente`);
