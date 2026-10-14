# Dash de Agentes de Entrega — ligação com o Brudam (Tela 376)

## O que tem neste pacote

| Arquivo | Para que serve |
|---|---|
| `index.html` | O dash, com o mesmo layout do Performance Hub e agentes no lugar dos pagadores |
| `dados.json` | Os dados que o dash lê. Hoje é uma prévia, que a API vai substituir |
| `config/brudam.json` | Endereço da API, parâmetros e nomes dos campos da Tela 376 |
| `scripts/atualizar-brudam.mjs` | Chama a API, agrupa por agente e grava o `dados.json` |
| `scripts/agregar.mjs` | Cálculo de total, no prazo, fora, taxa, UF, destinatários e pagadores |
| `.github/workflows/atualizar-agentes.yml` | Roda o script sozinho às 07h e 16h (seg a sáb) e publica |

Regra de cálculo (igual ao site de pagadores):
- O mês é definido pela **Data Prev. Entrega**.
- **Sucesso** = No Prazo + Ineficiência do Cliente.
- A **meta** é 96%.
- Entregas não realizadas com previsão já vencida contam como fora do prazo.
- Entregas ainda dentro do prazo não entram na conta.

---

## Passo 1 — Pegar os dados da API com o Brudam

Peça ao suporte do Brudam (ou procure no manual da API que eles enviaram):
1. **A URL** do endpoint que devolve a Tela 376 (ou o relatório de prazos de entrega)
2. **Como autentica**: token fixo, token no cabeçalho, ou login com usuário e senha que devolve um token
3. **Os parâmetros de período**: os nomes (ex.: `data_inicial` / `data_final`) e o formato da data (`DD/MM/YYYY` ou `YYYY-MM-DD`)
4. **Se a resposta é paginada** e qual é o parâmetro de página
5. **Um exemplo da resposta** em JSON

## Passo 2 — Ativar o site (GitHub Pages)

No repositório, vá em **Settings → Pages**. Em *Branch*, escolha **main** e **/ (root)** e clique em **Save**.
O dash fica em: `https://arlonbelarmindo.github.io/PERFOMANCE-AGENTES/`

## Passo 3 — Ajustar o `config/brudam.json`

Edite pelo próprio GitHub (ícone de lápis):
- `url`: a URL do endpoint da Tela 376.
- `metodo`: `GET` ou `POST`.
- `autenticacao`: escolha uma das opções abaixo.
  - `bearer`: o token vai como `Authorization: Bearer ...`
  - `header`: o token vai num cabeçalho com outro nome. Coloque esse nome em `nome_header`.
  - `query`: o token vai na URL. Coloque o nome do parâmetro em `nome_param`.
  - `basic`: usuário e senha.
  - `login`: o script primeiro chama `login.url` com usuário e senha e pega o token no campo `login.campo_token`.
- `parametros` e `formato_data`: os nomes dos campos de período, exatamente como o Brudam pede.
- `campos`: o nome de cada coluna como vem do Brudam. Já existem vários nomes comuns cadastrados. Se algum não bater, acrescente o nome certo na lista daquele campo.
- `status_sucesso`, `status_fora` e `status_ignorar`: os textos de status que a Tela 376 usa.

## Passo 4 — Cadastrar a senha/token (Secrets)

No repositório, vá em **Settings → Secrets and variables → Actions → New repository secret** e crie:

| Nome | Quando usar |
|---|---|
| `BRUDAM_TOKEN` | autenticação `bearer`, `header` ou `query` |
| `BRUDAM_USUARIO` e `BRUDAM_SENHA` | autenticação `basic` ou `login` |
| `BRUDAM_URL` | opcional, se preferir não deixar a URL visível no config |

Os Secrets ficam criptografados e **não aparecem no site**. Nunca coloque o token direto no `config/brudam.json`.

## Passo 5 — Rodar a primeira vez

1. Vá em **Actions → Atualizar dash de agentes (Brudam) → Run workflow**.
2. Abra a execução e veja o passo "Buscar Tela 376". O log mostra:
   - quantos registros vieram por mês;
   - **Campos encontrados no Brudam**, que são os nomes reais das colunas;
   - **Mapeamento usado**, que mostra qual coluna foi usada para cada campo. Se algum aparecer `null`, ajuste `campos` no config.
3. Se der certo, o `dados.json` é atualizado sozinho e o dash mostra o horário em "Atualizado em".

Depois disso o dash se atualiza sozinho às **07h e 16h, de segunda a sábado**. Para mudar o horário, edite as linhas `cron` do `.yml`, que usam horário UTC (Brasília + 3h).

## Problemas comuns

| Mensagem no log | O que fazer |
|---|---|
| `Falta a variável BRUDAM_TOKEN` | Cadastre o Secret (passo 4) |
| `HTTP 401` ou `403` | Token errado/expirado, ou tipo de `autenticacao` errado |
| `HTTP 404` | URL do endpoint errada |
| `A API não retornou nenhum registro` | Nome ou formato dos parâmetros de data errado |
| `Não achei os campos: agente` | Acrescente o nome da coluna do agente em `campos.agente` |
| Brudam bloqueia o IP do GitHub | Peça ao Brudam para liberar o acesso, ou rode o script num servidor da PortoEX (`node scripts/atualizar-brudam.mjs`) |

## Testar sem a API

Salve uma resposta da API num arquivo e rode:

```
node scripts/atualizar-brudam.mjs --amostra resposta.json
```
