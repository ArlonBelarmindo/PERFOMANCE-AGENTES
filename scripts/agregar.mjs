// Agrupa as entregas da Tela 376 por AGENTE DE ENTREGA e monta o dados.json do dash.
// Usado pelo atualizar-brudam.mjs (dados completos) e pelo gerar-previa.mjs (prévia).

const NOMES_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
  "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const taxa = (s, t) => (t > 0 ? Math.round((s / t) * 10000) / 100 : null);

function novo() { return { total: 0, sucesso: 0, fora: 0 }; }
function soma(o, r) { o.total++; if (r.sucesso) o.sucesso++; else o.fora++; }
function fecha(o) { return { ...o, taxa: taxa(o.sucesso, o.total) }; }

function listaOrdenada(mapa, chaveNome, somenteFora) {
  return Object.entries(mapa)
    .map(([k, v]) => ({ [chaveNome]: k, ...fecha(v), ...(v.extra || {}) }))
    .map((x) => { delete x.extra; if (somenteFora) { x.total = null; x.sucesso = null; x.taxa = null; } return x; })
    .sort((a, b) => (somenteFora ? b.fora - a.fora : b.total - a.total || b.fora - a.fora));
}

/**
 * @param {Array} registros  [{md, agente, pagador, dest, cidade, uf, prevista: Date, status, sucesso: bool}]
 * @param {Object} op        {meta, meses: n, somenteFora: bool, resumoEmpresa: {chave: {total,sucesso,fora}}, hoje: Date}
 */
export function agregar(registros, op = {}) {
  const meta = op.meta ?? 96;
  const somenteFora = !!op.somenteFora;
  const hoje = op.hoje || new Date();
  const porMes = {};
  for (const r of registros) {
    if (!r.mes) {
      if (!(r.prevista instanceof Date) || isNaN(r.prevista)) continue;
      r.mes = `${r.prevista.getUTCFullYear()}-${String(r.prevista.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    (porMes[r.mes] ||= []).push(r);
  }
  const chaves = Object.keys(porMes).sort();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

  const meses = chaves.map((chave) => {
    const regs = porMes[chave];
    const ag = {}, ufG = {}, geral = novo();
    let semAgente = 0;
    for (const r of regs) {
      soma(geral, r);
      const nome = (r.agente || "").trim() || "SEM AGENTE INFORMADO";
      if (nome === "SEM AGENTE INFORMADO") semAgente++;
      const a = (ag[nome] ||= { ...novo(), ufs: {}, dest: {}, pag: {}, mds: [] });
      soma(a, r);
      const uf = (r.uf || "—").toUpperCase();
      soma((a.ufs[uf] ||= novo()), r);
      const dk = r.dest || "—";
      const d = (a.dest[dk] ||= { ...novo(), extra: { cidade: r.cidade || "", uf } });
      soma(d, r);
      soma((a.pag[r.pagador || "—"] ||= novo()), r);
      const g = (ufG[uf] ||= { ...novo(), _ag: new Set() });
      soma(g, r); g._ag.add(nome);
      if (!r.sucesso) a.mds.push({
        md: r.md || "", dest: r.dest || "", cidade: r.cidade || "", uf,
        data: r.prevista instanceof Date && !isNaN(r.prevista) ? r.prevista.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : (r.dataTxt || ""),
        status: r.status || "FORA DO PRAZO", pagador: r.pagador || "",
      });
    }
    const agentes = Object.entries(ag).map(([name, a]) => {
      const o = {
        name, ...fecha({ total: a.total, sucesso: a.sucesso, fora: a.fora }),
        mds_fora: a.mds.sort((x, y) => String(x.md).localeCompare(String(y.md))),
        ufs: listaOrdenada(a.ufs, "uf", somenteFora),
        dest: listaOrdenada(a.dest, "dest", somenteFora),
        pagadores: listaOrdenada(a.pag, "name", somenteFora),
      };
      if (somenteFora) { o.total = null; o.sucesso = null; o.taxa = null; }
      return o;
    });
    agentes.sort((x, y) => (somenteFora ? y.fora - x.fora : y.total - x.total || y.fora - x.fora));
    agentes.forEach((a, i) => { a.id = i + 1; a.rank = i + 1; });

    const emp = op.resumoEmpresa?.[chave];
    const resumo = emp ? fecha({ total: emp.total, sucesso: emp.sucesso, fora: emp.fora }) : fecha(geral);
    resumo.agentes = agentes.filter((a) => a.name !== "SEM AGENTE INFORMADO").length;
    resumo.sem_agente = semAgente;
    const [y, m] = chave.split("-").map(Number);
    return {
      chave, label: `${NOMES_MES[m - 1]} ${y}`, parcial: chave === mesAtual,
      resumo, agentes,
      ufs: Object.entries(ufG).map(([uf, g]) => ({ uf, ...fecha({ total: g.total, sucesso: g.sucesso, fora: g.fora }), agentes: g._ag.size }))
        .map((u) => (somenteFora ? { ...u, total: null, sucesso: null, taxa: null } : u))
        .sort((a, b) => (somenteFora ? b.fora - a.fora : b.total - a.total)),
    };
  });

  // comparação com o mês anterior
  for (let i = 1; i < meses.length; i++) {
    const ant = Object.fromEntries(meses[i - 1].agentes.map((a) => [a.name, a]));
    meses[i].resumo_prev = { total: meses[i - 1].resumo.total, sucesso: meses[i - 1].resumo.sucesso, fora: meses[i - 1].resumo.fora, taxa: meses[i - 1].resumo.taxa };
    for (const a of meses[i].agentes) {
      const p = ant[a.name];
      a.prev = p ? { total: p.total, sucesso: p.sucesso, fora: p.fora, taxa: p.taxa } : null;
    }
  }
  if (meses[0]) for (const a of meses[0].agentes) a.prev = null;

  const exibir = op.meses ? meses.slice(-op.meses) : meses;
  return {
    gerado_em: hoje.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", ""),
    fonte: somenteFora ? "previa" : "brudam",
    meta,
    meses: exibir,
  };
}
