# Projeto Nova Era: planejamento de upgrade

Plano para transformar o Parallax (hoje um app open source de demonstração) em um produto
comercial: painel admin, novos provedores de geração (kie.ai e Higgsfield), pagamentos em
dólar, versão completa em português com preço em real, e precificação editável pelo painel.

Data do plano: 2026-11-20. Os preços e endpoints citados vêm de pesquisa em fontes públicas
e **precisam ser confirmados** nas páginas oficiais antes de qualquer cálculo de margem.

---

## Andamento (atualizado em 2026-11-20)

**Feito e testado**
- **Fase 1, painel admin** em `/admin` (acesso por `ADMIN_EMAILS`): visão geral com gráficos, usuários
  (créditos, plano manual, suspensão), gerações, planos e preços, cupons de créditos, modelos por tipo
  de recurso (liga e desliga), moderação, configurações e auditoria.
- **Chaves de API pelo painel**, criptografadas (AES-256-GCM) no banco. Treg funciona; kie.ai e
  Higgsfield só guardam a chave, a integração ainda não existe.
- **Margem, cotação do dólar, orçamento diário e modo de geração** editáveis no painel.
- **Português (PT-BR) e inglês** com seletor de idioma. Em português os preços aparecem em reais,
  convertidos pela cotação do painel. Os planos continuam definidos em dólar.
  Traduzido: menus e rodapé, login e busca, notificações, preços e planos, conta e carteira.
- Os estúdios do cliente já listam modelos por tipo (imagem, vídeo, voz, música) e respeitam o que o
  admin desligou.

**Falta**
- Tradução dos estúdios (imagem, vídeo, áudio), home, biblioteca, comunidade, agente, cinema, anúncios,
  shorts, MCP e guia. Cada arquivo de `src/content/` precisa de um par em `src/i18n/pt/` e uma linha em
  `src/i18n/index.ts`. Também faltam os nomes dos menus em `src/content/site.ts` e os textos que ficam
  dentro de componentes.
- **Fase 2**: adaptadores do kie.ai e da Higgsfield (hoje só o Treg gera).
- **Fase 3**: Stripe. Cupom de desconto em % e cobrança em real dependem disso.
- **Fase 6**: verificação de e-mail no cadastro, backup, VPS.

---

## 1. Ponto de partida (auditoria feita em 2026-11-20)

| Item | Situação hoje |
|---|---|
| Build, typecheck, lint, registry | Passam (0 erros, 25 avisos de estilo) |
| Testes de API | Passam, mas o runner `tests/run.py` só funciona em Linux/Mac (usa `os.killpg`). Rodar no WSL ou na VPS |
| Provedor de geração | Treg (treg.to), único ponto de contato em `src/server/treg.ts`. 39 modelos em `src/registry/` |
| Painel admin | **Não existe** |
| Planos | Fixos no código (`src/config/economy.ts`) |
| Cupons | Só código de resgate que dá créditos (`account_promo_codes`). Sem tela e sem desconto em % |
| Moderação | Denúncias gravadas no banco, sem tela |
| Pagamentos | **Não existe processador.** O botão de recarga dá crédito grátis |
| Idioma | Só inglês, sem infraestrutura de i18n (`<html lang="en">` fixo) |
| Banco | SQLite em arquivo (`PARALLAX_DATA_DIR`), uma instância |
| Hospedagem | VPS da Hostinger (a Vercel não serve: disco efêmero e worker em segundo plano) |

---

## 2. Decisões já tomadas

- **Hospedagem:** VPS da Hostinger, com Nginx ou Caddy (HTTPS) e processo supervisionado.
- **Provedores:** kie.ai e Higgsfield, integrados por adaptadores. O Treg pode ficar como
  reserva para o que os outros não cobrirem.
- **Moeda:** o preço-base dos planos é em **dólar (USD)**. Na versão em português, o preço é
  exibido em **real (BRL)**, convertido por uma cotação.
- **Idioma:** português completo, mantendo o inglês.
- **Precificação:** planos, pacotes, margens e cupons editados pelo painel admin, sem mexer
  no código.

### Pontos em aberto (preciso da sua decisão)

1. **Cobrança em BRL:** quando o usuário está em português, o Stripe cobra em **real** (o
   cliente paga o valor mostrado) ou cobra em **dólar** e o real é só exibição? A primeira
   opção é mais clara para o cliente e permite Pix e boleto, mas exige conta Stripe com BRL e
   trata o risco de câmbio. A segunda é mais simples, mas o cartão pode mostrar valor
   diferente na fatura. **Sugestão:** cobrar em BRL no idioma português, com a tabela de
   preços em real gerada por cotação mais um spread configurável.
2. **Cotação:** manual (você define no painel) ou automática (API de câmbio, atualizada por
   dia, com trava)? **Sugestão:** automática com valor manual de segurança.
3. **Processador de pagamento:** Stripe é o padrão deste plano. Mercado Pago ou outro, se você
   preferir para o Brasil.

---

## 3. Fases

### Fase 0: Preparação (1 a 2 dias)
- Rodar a suíte de testes completa no WSL ou na VPS e registrar a base.
- Corrigir o runner para Windows (substituir `os.killpg`), ou documentar o uso do WSL.
- Criar o ambiente da VPS e uma instância de homologação.
- Definir `.env` de produção (ver seção 8).

### Fase 1: Painel admin mínimo (a base de tudo)
Sem isso nenhuma outra fase é gerenciável.

- **Papéis:** coluna `role` no usuário (`member`, `moderator`, `admin`), com o primeiro admin
  criado por variável de ambiente (`ADMIN_EMAILS`). Todo acesso `/admin` e `/api/admin/*`
  exige o papel, com checagem no servidor.
- **Área `/admin`** com layout próprio, fora do menu público.
- **Auditoria:** tabela `admin_audit_log` (quem, quando, o quê, antes e depois). Toda
  alteração do painel grava nela.
- **Telas iniciais:**
  - Dashboard: receita, custo de API, margem, gerações por dia, usuários novos.
  - Usuários: busca, ver conta, saldo, histórico, ajustar crédito manualmente, bloquear,
    redefinir, impersonar só leitura.
  - Gerações: lista de jobs, status, custo real do provedor, falhas e reembolso manual.

### Fase 2: Provedores de geração (kie.ai e Higgsfield)

**Arquitetura:** hoje `src/server/treg.ts` é o único ponto de contato. Criar uma interface
comum de provedor e três implementações.

```
src/server/providers/
  types.ts        interface Provider: submit(), status(), result(), upload(), cost()
  treg.ts         (o atual, movido)
  kie.ts          adaptador do kie.ai
  higgsfield.ts   adaptador da Higgsfield
  index.ts        escolhe o provedor de cada modelo
```

- No registry, cada modelo passa a declarar `provider` e `endpoint` (hoje só `endpoint` do
  Treg). O worker e o `jobs.ts` chamam a interface, não o Treg direto.
- **Roteamento por modelo, configurável no painel:** provedor principal, reserva, e um
  interruptor por modelo para ligar ou desligar.
- **Fallback automático:** se o provedor principal falhar ou estiver sem saldo, tenta o
  reserva (apenas para falhas do provedor, nunca para erro de entrada do usuário).
- **Preço de custo vs. preço de venda:** guardar o custo do provedor por modelo e
  combinação, e a margem aplicada. Hoje há uma tabela com preço exato para 10.029
  combinações (`check:registry`). Ela passa a ser calculada como `custo × (1 + margem)`.
  O `check:registry` continua garantindo que toda combinação tem preço.
- **Orçamento diário** (`TREG_DAILY_BUDGET_USD`) vira configuração do painel, por provedor.

**kie.ai**
- Base `https://api.kie.ai/api/v1`, autenticação Bearer, geração assíncrona (cria tarefa e
  consulta status, ou recebe callback). Créditos do kie.ai: 1 crédito ≈ US$ 0,005.
- Cobre vídeo (Veo 3.1, Kling, Seedance, Runway), imagem (Nano Banana 2 e Pro, GPT-4o Image)
  e música (Suno). Sora e voz/TTS **não confirmados**.
- Documentação: https://docs.kie.ai. Preços: https://kie.ai/pricing.
- Falhas não são cobradas pelo kie.ai, então o reembolso ao usuário deve ser automático.

**Higgsfield**
- API paga por uso, em dólar, separada dos planos do consumidor. Documentação oficial em
  docs.higgsfield.ai (não consegui abrir: confirmar). Exemplo de rota citado por fonte
  secundária: `https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video`.
- **Divergências a resolver antes de codar:** o host da API (`api.higgsfield.ai` ou
  `cloud.higgsfield.ai`), o formato de autenticação, a lista de modelos e os preços, que não
  parecem públicos por endpoint.
- Passo 1 do trabalho: ler a documentação oficial com a sua conta e validar com uma chave de
  teste.

**Pré-requisitos seus:** chaves de teste (`KIE_API_KEY`, `HIGGSFIELD_API_KEY`) e a lista de
modelos que você quer oferecer.

### Fase 3: Pagamentos
- **Stripe:** assinaturas (planos mensais e anuais), compra avulsa de pacotes de créditos,
  webhooks (pagamento aprovado, falhou, cancelado, reembolso), portal do cliente.
- Fechar a recarga gratuita: manter `PARALLAX_DEMO_BILLING` desligado em produção.
- Nota fiscal e impostos: definir com seu contador (no Brasil, exigências para venda
  recorrente de serviço digital). Fora do escopo técnico, mas precisa estar resolvido antes
  de vender.
- Estornos e disputas: reflexo no saldo de créditos e bloqueio de abuso.

### Fase 4: Precificação, planos e cupons pelo painel
Mover o que hoje está fixo no código para o banco, editável no admin.

- **Planos:** nome, preço-base em USD, ciclo (mensal e anual), créditos incluídos, limites
  (gerações simultâneas, resolução máxima, modelos liberados), ativo ou não. Editar um plano
  não altera quem já assina: a mudança vale a partir da próxima renovação (campo de versão
  do plano).
- **Pacotes de créditos avulsos:** preço, quantidade de créditos, bônus.
- **Margem por modelo ou por categoria** (imagem, vídeo, áudio, música), com margem padrão
  global. Visualização do custo, preço de venda e lucro de cada modelo.
- **Cupons e promoções:**
  - Código de desconto em % ou valor fixo, em planos e pacotes.
  - Códigos de créditos grátis (já existe o resgate, falta a tela).
  - Regras: validade, limite de usos total e por usuário, apenas primeira compra, planos
    elegíveis, combinação com outros cupons.
  - Promoções automáticas por período (faixa de oferta e selo de desconto: hoje isso é
    `promo` e `pricingBadge` em `src/content/site.ts`, desligados).
  - Links de indicação (hoje fixos em 50 créditos, vira configuração).
- **Cotação USD→BRL** (decisão 2 acima), spread, regra de arredondamento (por exemplo
  terminar em ,90) e histórico das cotações usadas.

### Fase 5: Português completo (PT-BR e EN)
- Adotar uma biblioteca de i18n (sugestão: `next-intl`) com rota por idioma (`/pt/...` e
  `/en/...` ou prefixo só para PT), detecção pelo navegador e seletor de idioma no
  cabeçalho. Atualizar `<html lang>` conforme o idioma. SEO com `hreflang`.
- **Extração de textos:** os arquivos `src/content/*.ts` (27 arquivos, cerca de 4.500 linhas)
  viram dicionários por idioma. Há texto fixo em componentes e nos rótulos e dicas dos
  controles de `src/registry/` que também precisam ser extraídos.
- **Traduzir:** o site, os estúdios, os controles dos modelos, e-mails, mensagens de erro da
  API e o guia. Termos de uso e política de privacidade em PT precisam de revisão
  jurídica.
- **Moeda:** no português, os preços aparecem em R$ conforme a Fase 4. Formatação local
  (`R$ 1.234,56`).
- **Painel admin:** fica em um idioma só (a sua escolha), no início.
- Prompts dos usuários não são traduzidos. Um aviso informa que alguns modelos entendem
  melhor prompts em inglês.

### Fase 6: Produção e segurança
- VPS: Node 22.13 ou mais novo, Nginx ou Caddy com HTTPS, systemd ou pm2, firewall.
- **Backup** diário do `PARALLAX_DATA_DIR` (banco e arquivos) com cópia externa e teste de
  restauração.
- **Escala:** o SQLite em arquivo único serve para começar. Planejar a migração para
  PostgreSQL e armazenamento de objetos (S3 ou R2) se o volume crescer ou se for preciso
  mais de uma instância.
- Monitoramento (uptime, erros, saldo dos provedores com alerta de saldo baixo), limites de
  taxa, proteção anti-abuso (cada conta nova ganha créditos grátis: ver
  `PARALLAX_GUESTS_PER_HOUR` e `PARALLAX_SIGNUPS_PER_HOUR`).
- Ler `SECURITY.md`, resolver as 7 vulnerabilidades moderadas do `npm audit` e fazer revisão
  de segurança antes do lançamento.
- Moderação de conteúdo: fila no painel (Fase 1 estendida) para as denúncias já gravadas.
  Política de uso, direitos de imagem e conteúdo gerado.
- Termos de uso, política de privacidade, LGPD (consentimento, exportação e exclusão de
  dados: a exclusão de conta já existe).

---

## 4. Modelo de dados novo (resumo)

```
users.role                      member | moderator | admin
admin_audit_log                 quem, ação, entidade, antes, depois, data
providers                       id, nome, ativo, orçamento diário, saldo conhecido
model_routes                    modelo, provedor principal, reserva, ativo
model_costs                     modelo, combinação, custo USD do provedor
pricing_rules                   escopo (global, categoria, modelo), margem
plans / plan_versions           preço USD, ciclo, créditos, limites, ativo
credit_packs                    preço USD, créditos, bônus
coupons / coupon_redemptions    tipo, valor, regras, validade, usos
fx_rates                        par, taxa, spread, origem, data
payments / subscriptions        espelho do Stripe
```

As migrações seguem o padrão atual (`migrations/NNN_nome.sql`, aplicadas na primeira
subida).

---

## 5. Riscos

| Risco | Mitigação |
|---|---|
| Preços e modelos dos provedores mudam | Tabela de custo no banco, alerta de divergência, sincronização por script |
| Margem negativa por erro de preço | Teste automático: nenhum preço de venda abaixo do custo; `check:registry` estendido |
| Higgsfield com documentação ou API incompleta | Validar com chave de teste antes de comprometer prazo |
| Cartão em BRL e risco de câmbio | Spread na cotação, atualização diária, trava manual |
| Abuso de créditos grátis | Limites de cadastro, verificação de e-mail, créditos bônus só após pagamento |
| SQLite em instância única | Backup automático e plano de migração para Postgres |
| Conteúdo ilegal ou direitos de imagem | Moderação, termos de uso, denúncia, bloqueio de usuários |
| Projeto não auditado (aviso do próprio README) | Revisão de segurança antes de abrir ao público |

---

## 6. Ordem recomendada

1. Fase 0 (preparação) e Fase 1 (admin mínimo).
2. Fase 2 (kie.ai primeiro, depois Higgsfield): já dá para gerar de verdade.
3. Fase 4 (precificação) em paralelo com a Fase 3 (Stripe).
4. Fase 5 (português).
5. Fase 6 (produção) e lançamento fechado (beta) antes do público.

## 7. O que preciso de você

- Decisões 1, 2 e 3 da seção 2 (cobrança em BRL, cotação, processador).
- Chaves de teste do kie.ai e da Higgsfield, e acesso à documentação da Higgsfield.
- A lista dos modelos que você quer vender e a margem desejada.
- Nome do produto e domínio (hoje o app se chama "Parallax").

## 8. Variáveis de ambiente de produção (previstas)

```
PARALLAX_DATA_DIR=/var/lib/app/data
PARALLAX_ORIGIN=https://seu-dominio.com
COOKIE_SECURE=1
ADMIN_EMAILS=voce@exemplo.com
KIE_API_KEY=
HIGGSFIELD_API_KEY=
TREG_TOKEN=            (opcional, reserva)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PARALLAX_DEMO_BILLING=off
```

## Fontes consultadas

- kie.ai: https://kie.ai/pricing e https://docs.kie.ai
- Higgsfield API: https://higgsfield.ai/higgsfield-api e
  https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api
