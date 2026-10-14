// Gera um dados.json de PRÉVIA a partir do site atual (Top 30 pagadores).
// O site atual só traz o agente nas entregas FORA DO PRAZO, então a prévia
// mostra apenas atrasos por agente. Os dados completos vêm do atualizar-brudam.mjs.
// Uso: node scripts/gerar-previa.mjs <index.html do PortoEX> <saida.json>
import fs from "node:fs";
import { agregar } from "./agregar.mjs";

const [, , origem, saida = "dados.json"] = process.argv;
const h = fs.readFileSync(origem, "utf8");
const s = h.slice(h.indexOf("<script>") + 8, h.lastIndexOf("</script>"));
const linhas = s.split("\n").filter((l) => /^var (CL_MAR|CL_ABR|CL_MAI|GERAL_POR_MES)=/.test(l)).map((l) => l.split(";\n")[0]);
const ctx = {};
new Function("ctx", linhas.join("\n") + ";ctx.M={mar:CL_MAR,abr:CL_ABR,mai:CL_MAI};ctx.G=GERAL_POR_MES;")(ctx);

const MES = { mar: "2026-08", abr: "2026-09", mai: "2026-10" };
const regs = [];
for (const k in ctx.M) for (const c of ctx.M[k]) for (const m of c.mds_fora || [])
  regs.push({ mes: MES[k], md: m.md, agente: m.resp, pagador: c.name, dest: m.dest, cidade: m.cidade, uf: m.uf, dataTxt: m.data, status: m.status, sucesso: false });

const resumoEmpresa = {};
for (const k in MES) if (ctx.G[k]) resumoEmpresa[MES[k]] = ctx.G[k];
const dados = agregar(regs, { somenteFora: true, resumoEmpresa, meta: 96 });
fs.writeFileSync(saida, JSON.stringify(dados));
console.log("Prévia gerada:", saida, dados.meses.map((m) => `${m.label}: ${m.agentes.length} agentes, ${m.agentes.reduce((a, b) => a + b.fora, 0)} MDs fora`).join(" | "));
