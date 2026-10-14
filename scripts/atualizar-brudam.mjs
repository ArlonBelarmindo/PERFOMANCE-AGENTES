// Busca as entregas da Tela 376 na API do Brudam e gera dados.json.
//
// Uso:
//   node scripts/atualizar-brudam.mjs                      -> chama a API (usa os Secrets)
//   node scripts/atualizar-brudam.mjs --diagnostico        -> chama a API e só mostra os campos do 1º registro
//   node scripts/atualizar-brudam.mjs --amostra resp.json  -> processa um JSON salvo (sem chamar a API)
//
// Variáveis de ambiente (Secrets do GitHub):
//   BRUDAM_TOKEN               token da API (autenticação bearer/header/query)
//   BRUDAM_USUARIO, BRUDAM_SENHA  (autenticação basic ou login)
//   BRUDAM_URL                 opcional: substitui a "url" do config
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agregar } from "./agregar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const CFG = JSON.parse(fs.readFileSync(path.join(RAIZ, "config/brudam.json"), "utf8"));
const SAIDA = valor("--saida") || path.join(RAIZ, "dados.json");
const env = process.env;

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const chaveNorm = (s) => norm(s).replace(/[^A-Z0-9]/g, "");

function fmtData(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yy = d.getUTCFullYear();
  return (CFG.formato_data || "YYYY-MM-DD").replace("DD", dd).replace("MM", mm).replace("YYYY", yy);
}
function lerData(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}
function preencher(obj, vars) {
  return JSON.parse(JSON.stringify(obj), (k, v) => (typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? "") : v));
}

async function autenticar() {
  const h = { Accept: "application/json" };
  const q = {};
  const tipo = CFG.autenticacao;
  if (tipo === "bearer") h.Authorization = `Bearer ${exigir("BRUDAM_TOKEN")}`;
  else if (tipo === "header") h[CFG.nome_header || "token"] = exigir("BRUDAM_TOKEN");
  else if (tipo === "query") q[CFG.nome_param || "token"] = exigir("BRUDAM_TOKEN");
  else if (tipo === "basic") h.Authorization = "Basic " + Buffer.from(`${exigir("BRUDAM_USUARIO")}:${exigir("BRUDAM_SENHA")}`).toString("base64");
  else if (tipo === "login") {
    const corpo = preencher(CFG.login.corpo, { usuario: exigir("BRUDAM_USUARIO"), senha: exigir("BRUDAM_SENHA") });
    const r = await fetch(CFG.login.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error(`Login no Brudam falhou: HTTP ${r.status}. Confira BRUDAM_USUARIO, BRUDAM_SENHA e login.url.`);
    const j = await r.json();
    const tok = pegar(j, CFG.login.campo_token) ?? j.token ?? j.access_token ?? j.data?.access_key;
    if (!tok) throw new Error(`Login respondeu, mas sem token no campo "${CFG.login.campo_token}". Campos recebidos: ${Object.keys(j).join(", ")}`);
    h.Authorization = `Bearer ${tok}`;
  }
  return { h, q };
}
function exigir(n) {
  if (!env[n]) throw new Error(`Falta a variável ${n}. Cadastre em GitHub → Settings → Secrets and variables → Actions.`);
  return env[n];
}
function pegar(o, caminho) { if (!caminho) return undefined; return caminho.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function acharLista(j) {
  if (CFG.caminho_lista) return pegar(j, CFG.caminho_lista) || [];
  if (Array.isArray(j)) return j;
  for (const k of ["data", "dados", "registros", "result", "results", "items", "itens", "rows"]) if (Array.isArray(j?.[k])) return j[k];
  for (const v of Object.values(j || {})) if (Array.isArray(v) && typeof v[0] === "object") return v;
  for (const v of Object.values(j || {})) if (v && typeof v === "object") { const l = acharLista(v); if (l.length) return l; }
  return [];
}

async function buscarPeriodo(inicio, fim, auth) {
  const url0 = env.BRUDAM_URL || CFG.url;
  const params = preencher(CFG.parametros || {}, { inicio: fmtData(inicio), fim: fmtData(fim) });
  const pag = CFG.paginacao || {};
  const todos = [];
  for (let p = pag.primeira ?? 1, n = 0; n < (pag.ativa ? pag.max_paginas || 200 : 1); p++, n++) {
    const u = new URL(url0);
    for (const [k, v] of Object.entries(auth.q)) u.searchParams.set(k, v);
    const corpo = { ...params };
    if (pag.ativa) corpo[pag.param_pagina] = p;
    let r;
    if ((CFG.metodo || "GET").toUpperCase() === "GET") {
      for (const [k, v] of Object.entries(corpo)) u.searchParams.set(k, v);
      r = await fetch(u, { headers: auth.h });
    } else {
      r = await fetch(u, { method: CFG.metodo, headers: { ...auth.h, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    }
    if (!r.ok) throw new Error(`API Brudam respondeu HTTP ${r.status} (${fmtData(inicio)} a ${fmtData(fim)}): ${(await r.text()).slice(0, 300)}`);
    const lista = acharLista(await r.json());
    todos.push(...lista);
    if (!pag.ativa || lista.length === 0) break;
  }
  return todos;
}

// Mapeia um registro do Brudam para o formato do dash, usando config.campos
function criarMapeador(exemplo) {
  const chaves = Object.keys(exemplo || {});
  const idx = Object.fromEntries(chaves.map((k) => [chaveNorm(k), k]));
  const mapa = {};
  for (const [campo, nomes] of Object.entries(CFG.campos)) {
    mapa[campo] = nomes.map((n) => idx[chaveNorm(n)]).find(Boolean) || null;
  }
  return mapa;
}

function classificar(rec, mapa, hoje) {
  const st = norm(rec[mapa.status]);
  const prevista = lerData(rec[mapa.data_prevista]);
  const entrega = lerData(rec[mapa.data_entrega]);
  const S = (l) => (l || []).map(norm);
  if (st && S(CFG.status_ignorar).includes(st)) return null;
  let sucesso;
  if (st && S(CFG.status_sucesso).includes(st)) sucesso = true;
  else if (st && S(CFG.status_fora).includes(st)) sucesso = false;
  else if (prevista) {
    if (entrega) sucesso = entrega <= prevista;
    else if (prevista < hoje) sucesso = false; // não entregue e já venceu
    else return null; // ainda dentro do prazo, não conta
  } else return null;
  return {
    md: rec[mapa.md] ?? "", agente: rec[mapa.agente] ?? "", pagador: rec[mapa.pagador] ?? "",
    dest: rec[mapa.destinatario] ?? "", cidade: rec[mapa.cidade] ?? "", uf: rec[mapa.uf] ?? "",
    prevista, dataTxt: rec[mapa.data_prevista] ?? "",
    status: st || (sucesso ? "NO PRAZO" : entrega ? "ENTREGUE FORA DO PRAZO" : "FORA DO PRAZO"),
    sucesso,
  };
}

async function main() {
  const hoje = new Date();
  const hojeUTC = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
  const nMeses = CFG.meses || 3;
  let brutos = [];

  if (valor("--amostra")) {
    brutos = acharLista(JSON.parse(fs.readFileSync(valor("--amostra"), "utf8")));
  } else {
    const auth = await autenticar();
    // um mês a mais para calcular o "vs mês anterior" do primeiro mês exibido
    for (let i = nMeses; i >= 0; i--) {
      const ini = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i, 1));
      const fim = i === 0 ? hojeUTC : new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i + 1, 0));
      const lote = await buscarPeriodo(ini, fim, auth);
      console.log(`${fmtData(ini)} a ${fmtData(fim)}: ${lote.length} registros`);
      brutos.push(...lote);
      if (flag("--diagnostico") && lote.length) break;
    }
  }
  if (!brutos.length) throw new Error("A API não retornou nenhum registro. Confira url, parametros e formato_data no config/brudam.json.");

  const mapa = criarMapeador(brutos[0]);
  console.log("Campos encontrados no Brudam:", Object.keys(brutos[0]).join(", "));
  console.log("Mapeamento usado:", JSON.stringify(mapa));
  if (flag("--diagnostico")) { console.log("Exemplo de registro:", JSON.stringify(brutos[0], null, 2).slice(0, 2000)); return; }
  const faltando = ["agente", "data_prevista"].filter((c) => !mapa[c]);
  if (faltando.length) throw new Error(`Não achei os campos: ${faltando.join(", ")}. Adicione o nome usado pelo Brudam em "campos" no config/brudam.json.`);

  const vistos = new Set();
  const regs = [];
  for (const b of brutos) {
    const r = classificar(b, mapa, hojeUTC);
    if (!r) continue;
    const k = `${r.md}|${r.agente}|${r.dataTxt}`;
    if (r.md && vistos.has(k)) continue;
    vistos.add(k);
    regs.push(r);
  }
  const dados = agregar(regs, { meta: CFG.meta || 96, meses: nMeses, hoje });
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(dados));
  console.log(`OK: ${regs.length} entregas → ${SAIDA}`);
  for (const m of dados.meses) console.log(`  ${m.label}: ${m.resumo.total} entregas, taxa ${m.resumo.taxa}%, ${m.resumo.agentes} agentes`);
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
