// Lê os CSVs do Brudam (Tela 376 - Relatório de Entregas, filtro Data Prev. Entrega)
// e gera o dados.json do dash de agentes, com uma linha por entrega (o dash filtra por período).
//
// Uso: node scripts/processar-csv.mjs <pasta-ou-arquivos...> [--saida dados.json] [--meta 96] [--de 20260101 --ate 20261231]
//
// Regras (iguais ao Performance Hub):
//  - data de referência = DATA DE AGENDAMENTO, quando informada; se em branco, PREV. ENTREGA DATA
//  - base = STATUS do Brudam, que vai para o dash sem ser reescrito:
//    sucesso = ENTREGUE NO PRAZO e tudo que tem "(IN.CLIENTE)"; fora = ENTREGUE FORA DO PRAZO e FORA DO PRAZO
//  - regras PortoEX (pedido do Arlon em 28/10), aplicadas só com campos do próprio CSV do Brudam:
//    1) ocorrência de ineficiência do cliente preenchida (OCORRÊNCIA INEF. ou DATA DA OCORRÊNCIA INEF.) → no prazo
//    2) status ENTREGUE FORA DO PRAZO com ENTREGA = PREV. ENTREGA DATA (entregue no dia, após o horário) → no prazo
//    a linha leva o código da regra usada (campo "regra": 0 nenhuma, 1 ocorrência inef., 2 entregue no dia)
//  - --sem-regras desliga as duas regras e usa só o status do Brudam
//  - pendentes ainda dentro do prazo (NO PRAZO, NO PRAZO (IN.CLIENTE), agendado) não entram na conta
//  - AZ (azportoex) e PEX (pexlogistica) entram juntos; a MD é identificada por sistema + número
//  - se a mesma MD do mesmo sistema aparece em mais de um arquivo, vale o arquivo gerado por último
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const SAIDA = opt("--saida", "dados.json");
const REGRAS_PORTOEX = (() => { const i = args.indexOf("--sem-regras"); if (i < 0) return true; args.splice(i, 1); return false; })();
const META = Number(opt("--meta", "96"));
// limita o período (AAAAMMDD) para descartar datas digitadas erradas no Brudam (ex.: 2029)
const DE = Number(opt("--de", "0")), ATE = Number(opt("--ate", "99999999"));

// nomes possíveis da coluna de data de agendamento (o 376 padrão não traz; entra se vier no CSV)
const COLS_AGENDAMENTO = ["DATA AGENDAMENTO", "AGENDAMENTO DATA", "DATA DE AGENDAMENTO", "AGENDAMENTO", "DT AGENDAMENTO", "DATA AGENDADA"];

let arquivos = [], cadastros = [];
for (const a of args) {
  if (fs.statSync(a).isDirectory()) {
    arquivos.push(...fs.readdirSync(a).filter((f) => /_entregas_.*\.csv$/i.test(f)).map((f) => path.join(a, f)));
    cadastros.push(...fs.readdirSync(a).filter((f) => /^agentes_.*\.csv$/i.test(f)).map((f) => path.join(a, f)));
  } else if (/^agentes_/i.test(path.basename(a))) cadastros.push(a);
  else arquivos.push(a);
}
if (!arquivos.length) { console.error("Nenhum CSV de entregas encontrado."); process.exit(1); }
// ordem = data de geração no nome; "_ULTIMA" (arquivo do dia, sobrescrito a cada atualização) vence os horários do mesmo dia
const carimbo = (f) => (path.basename(f).match(/(\d{4}_\d{2}_\d{2}(?:_\d{2}_\d{2}_\d{2}|_ULTIMA)?)/) || [, "0"])[1];
arquivos.sort((a, b) => carimbo(a).localeCompare(carimbo(b)));

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
function dataNum(s) { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? +(m[3] + m[2] + m[1]) : 0; }

function parseCsv(txt) {
  txt = txt.replace(/^﻿/, "");
  const linhas = []; let campo = "", linha = [], aspas = false;
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
function classificar(status, temOcorrenciaInef) {
  const s = norm(status);
  if (!s) return null;
  const inef = temOcorrenciaInef || s.includes("IN.CLIENTE") || s.includes("INEFICIENCIA");
  if (s.startsWith("ENTREGUE NO PRAZO")) return 1;
  if (s.includes("FORA DO PRAZO")) return inef ? 1 : 0;
  return null;
}

// cadastro de agentes (Brudam > Cadastro > Agentes, AZ e PEX): nome -> CNPJ (14 dígitos) ou CPF (11 dígitos)
const cadastro = new Map();
for (const f of cadastros) {
  const ls = parseCsv(fs.readFileSync(f, "utf8"));
  const cab = ls[0].map(norm);
  const iDoc = cab.findIndex((h) => h.replace(/[^A-Z]/g, "") === "CNPJ" || h.includes("CPF"));
  const iNomes = ["FANTASIA", "RAZAO SOCIAL", "NOME"].map((h) => cab.indexOf(h)).filter((i) => i >= 0);
  for (const l of ls.slice(1)) {
    const doc = (l[iDoc] || "").replace(/\D/g, "");
    const tipo = doc.length === 14 ? "CNPJ" : doc.length === 11 ? "CPF" : "OUTRO";
    for (const i of iNomes) { const k = norm(l[i]); if (k && (!cadastro.has(k) || (tipo === "CNPJ" && cadastro.get(k).tipo !== "CNPJ"))) cadastro.set(k, { tipo, doc: (l[iDoc] || "").trim() }); }
  }
}

const porMd = new Map();
let colunasCorrigidas = 0;
let lidas = 0, mesmoDia = 0, ocorrInef = 0, comAgendamento = 0, colAgendaAchada = null;
// sistema de origem pelo nome do arquivo: azportoex_entregas_... → AZ, pexlogistica_entregas_... → PEX
const SISTEMAS = { azportoex: "AZ", pexlogistica: "PEX" };
const sistemaDe = (f) => { const m = path.basename(f).match(/([a-z0-9]+)_entregas_/i); const k = m ? m[1].toLowerCase() : "az"; return SISTEMAS[k] || k.toUpperCase(); };
const porSistema = {};
for (const f of arquivos) {
  const sistema = sistemaDe(f);
  const linhas = parseCsv(fs.readFileSync(f, "utf8"));
  const cab = linhas[0].map(norm);
  const col = (nome) => cab.indexOf(norm(nome));
  const c = {
    md: col("MD"), cliente: col("CLIENTE"), dest: col("DESTINATARIO"), cidade: col("CIDADE DESTINO"), uf: col("UF DESTINO"),
    agente: col("RESP ENTREGA"), prev: col("PREV. ENTREGA DATA"), entrega: col("ENTREGA"), status: col("STATUS"),
    ocInef: col("OCORRENCIA INEF."), dtInef: col("DATA DA OCORRENCIA INEF."),
    agenda: COLS_AGENDAMENTO.map(col).find((x) => x >= 0) ?? -1,
  };
  if (c.agenda >= 0) colAgendaAchada = linhas[0][c.agenda].trim();
  for (const k of ["md", "agente", "prev", "status"]) if (c[k] < 0) throw new Error(`${path.basename(f)}: coluna ${k} não encontrada`);
  for (let l of linhas.slice(1)) {
    const md = (l[c.md] || "").trim();
    if (!/^\d+$/.test(md)) continue;
    lidas++;
    // o Brudam exporta "&" de nomes como "AMP;" (ex.: "S&L" vira "SAMP;L"), e esse ";" a mais empurra as colunas
    // seguintes uma casa para a direita. Junta de volta o pedaço dentro do campo de texto (cliente/remetente/destinatário).
    const sobra = l.length - cab.length;
    if (sobra > 0) {
      const i = l.findIndex((v, k) => k >= c.cliente && k < c.cidade + sobra && /AMP$/.test(v));
      if (i >= 0) { l = l.slice(); l.splice(i, sobra + 1, l.slice(i, i + sobra + 1).join(";").replace(/AMP;/g, "&")); colunasCorrigidas++; }
    }
    const temOcInef = (c.ocInef >= 0 && !!(l[c.ocInef] || "").trim()) || (c.dtInef >= 0 && !!(l[c.dtInef] || "").trim());
    const agenda = c.agenda >= 0 ? dataNum(l[c.agenda]) : 0;
    porSistema[sistema] = (porSistema[sistema] || 0) + 1;
    porMd.set(sistema + "|" + md, {
      md, sistema, agente: (l[c.agente] || "").trim() || "SEM AGENTE INFORMADO", pagador: (l[c.cliente] || "").trim(),
      dest: (l[c.dest] || "").trim(), cidade: (l[c.cidade] || "").trim(), uf: (l[c.uf] || "").trim().toUpperCase() || "—",
      prev: dataNum(l[c.prev]), agenda, entrega: dataNum(l[c.entrega]), status: (l[c.status] || "").trim(),
      sucesso: classificar(l[c.status], false), temOcInef,
    });
  }
}

// dicionários para deixar o arquivo pequeno
const dic = { ag: [], pag: [], dest: [], cid: [], st: [], sis: [] };
const idx = {}; for (const k in dic) idx[k] = new Map();
const id = (k, v) => { let i = idx[k].get(v); if (i === undefined) { i = dic[k].length; dic[k].push(v); idx[k].set(v, i); } return i; };

const linhas = [];
for (const r of porMd.values()) {
  if (r.sucesso === null) continue;
  const ref = r.agenda || r.prev;
  if (!ref || ref < DE || ref > ATE) continue;
  // regra PortoEX: entregue no mesmo dia da previsão, mesmo após o horário limite, conta como no prazo
  let regra = 0;
  if (REGRAS_PORTOEX && r.sucesso === 0) {
    if (r.temOcInef) { r.sucesso = 1; regra = 1; ocorrInef++; }
    else if (r.entrega && r.prev && r.entrega === r.prev && norm(r.status).startsWith("ENTREGUE")) { r.sucesso = 1; regra = 2; mesmoDia++; }
  }
  if (r.agenda) comAgendamento++;
  // [md, data_ref(AAAAMMDD), agendado(0/1), sucesso(0/1), agente, pagador, destinatario, cidade, uf, status Brudam, entrega(AAAAMMDD), sistema, regra(0/1/2)]
  linhas.push([r.md, ref, r.agenda ? 1 : 0, r.sucesso, id("ag", r.agente), id("pag", r.pagador), id("dest", r.dest), id("cid", r.cidade), r.uf, id("st", r.status), r.entrega, id("sis", r.sistema), regra]);
}
linhas.sort((a, b) => a[1] - b[1]);
// tipo de documento de cada agente (paralelo a dic.ag)
dic.agTipo = dic.ag.map((n) => (cadastro.get(norm(n)) || {}).tipo || "");
// só o CNPJ vai para o arquivo; CPF de pessoa física não é publicado
dic.agDoc = dic.ag.map((n) => { const c = cadastro.get(norm(n)) || {}; return c.tipo === "CNPJ" ? c.doc : ""; });

const agora = new Date();
const dados = {
  versao: 2, fonte: "brudam", meta: META,
  gerado_em: agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", ""),
  hoje: +agora.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).replaceAll("-", ""),
  coluna_agendamento: colAgendaAchada,
  arquivos: arquivos.map((f) => path.basename(f)),
  cadastros: cadastros.map((f) => path.basename(f)),
  campos: ["md", "data_ref", "agendado", "sucesso", "agente", "pagador", "dest", "cidade", "uf", "status", "entrega", "sistema", "regra"],
  dic, linhas,
};
fs.writeFileSync(SAIDA, JSON.stringify(dados));
const min = linhas[0]?.[1], max = linhas.at(-1)?.[1];
console.log(`${arquivos.length} arquivo(s), ${lidas} linhas, ${porMd.size} MDs, ${linhas.length} entregas na conta (${min} a ${max}) → ${SAIDA}`);
console.log(colAgendaAchada ? `Data de agendamento: coluna "${colAgendaAchada}", usada em ${comAgendamento} entregas.` : "Data de agendamento: coluna não encontrada no CSV; usando Prev. Entrega em todas.");
console.log(REGRAS_PORTOEX ? `Regras PortoEX: ${ocorrInef} com ocorrência inef. no Brudam e ${mesmoDia} entregues no dia previsto após o horário passaram a contar no prazo (status do Brudam mantido)` : "Só status do Brudam (--sem-regras)");
{ const c = { CNPJ: 0, CPF: 0, OUTRO: 0, "": 0 }; dic.agTipo.forEach((t) => c[t]++); console.log(`Cadastro: ${cadastros.length} arquivo(s), ${cadastro.size} nomes · agentes nas entregas: ${c.CNPJ} com CNPJ, ${c.CPF} com CPF, ${c.OUTRO} doc inválido, ${c[""]} sem cadastro`); }
console.log("Linhas lidas por sistema:", JSON.stringify(porSistema));
if (colunasCorrigidas) console.log(`Linhas com "&" no nome (colunas realinhadas): ${colunasCorrigidas}`);
console.log(`Tamanho: ${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB · ${dic.ag.length} agentes · ${dic.dest.length} destinatários`);
