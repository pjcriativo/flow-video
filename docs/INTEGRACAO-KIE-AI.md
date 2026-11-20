# Integração com o kie.ai: análise de ponta a ponta

Data: 2026-11-20. Objetivo: trocar o Treg pelo kie.ai como provedor principal de imagem, vídeo, voz e
música, sem perder preço exato, reembolso automático, orçamento diário e o painel admin.

**Como ler este documento.** Os fatos sobre o kie.ai (seções 1 a 3) foram lidos da documentação pública
(`docs.kie.ai`, `kie.ai/pricing`, `kie.ai/cli`) por agentes de leitura e **ainda não foram testados com
uma chave real**. Tudo que está marcado como **[VERIFICAR]** precisa de um teste real antes de virar código
definitivo (lista na seção 11). Os preços mudam; a fonte de verdade é a página de preços deles.

---

## 1. O que o kie.ai oferece (resumo verificado na documentação)

| Item | Fato |
|---|---|
| Base da API | `https://api.kie.ai`. Autenticação `Authorization: Bearer <KIE_API_KEY>` |
| Criar tarefa | `POST /api/v1/jobs/createTask` com `{ "model": "...", "callBackUrl": "(opcional)", "input": { ... } }` |
| Resposta | `{ "code": 200, "msg": "success", "data": { "taskId": "..." } }`. **Erros voltam com HTTP 200 e `code` diferente de 200.** Sempre checar o `code` |
| Consultar | `GET /api/v1/jobs/recordInfo?taskId=...`. Estados: `waiting`, `queuing`, `generating`, `success`, `fail` |
| Resultado | `data.resultJson` é um **texto JSON**: `{"resultUrls":["https://..."]}`. Também vêm `creditsConsumed`, `costTime`, `failCode`, `failMsg` |
| Callback | POST para `callBackUrl` (sucesso e falha). Assinatura opcional: `X-Webhook-Timestamp` e `X-Webhook-Signature` = base64(HMAC-SHA256(`taskId.timestamp`, chave)). A assinatura **não cobre o corpo**. Pode chegar mais de uma vez |
| Upload de arquivos | Outro host: `https://kieai.redpandaai.co` (`/api/file-stream-upload` multipart, `/api/file-base64-upload`, `/api/file-url-upload`). Grátis. **O arquivo some em 24 h** |
| Saldo | `GET /api/v1/chat/credit` devolve `{"data": 100.5}` (créditos) |
| Download de links | `POST /api/v1/common/download-url`, link válido por 20 min |
| Retenção | Arquivos gerados ficam 14 dias; registros 2 meses |
| Limites | 20 novas gerações por 10 s por conta; "100+" tarefas simultâneas. Acima disso: código 429 e **a requisição não entra na fila** |
| Cobrança | 1 crédito ≈ US$ 0,005. Tarefa que falha não consome crédito (`kie.ai/llms.txt`). Prazo de recarga: créditos não expiram |
| Códigos | 200 ok, 401 chave inválida, 402 sem créditos, 404, 408 sem resultado em 10 min, 422 validação, 429 limite, 455 manutenção, 500, 501 falha na geração, 505 recurso desativado |
| Catálogo (CLI, não documentado) | `GET /api/v1/models`, `GET /api/v1/models/{id}/schema`, `POST /client/v1/model-pricing/page` (preços, sem chave) |
| CLI e MCP | `npx skills add https://kie.ai` ou `kie-cli.mjs` (Node 18+), com `run`, `status`, `price`, `balance` e um servidor MCP |

**Pontos que diferem do Treg e mudam o desenho:**
1. Não há chave de idempotência documentada. Reenviar um pedido que já chegou **cobra duas vezes**.
2. Não existe um catálogo oficial de preço por combinação. O preço exato antes de gerar terá de ser nosso.
3. Arquivos enviados vivem 24 h (o Treg guardava 6 dias, e o código atual cacheia por 6 dias).
4. O 429 não enfileira: precisamos de um limitador no nosso lado.
5. Texto e imagem para imagem/vídeo costumam ser **modelos diferentes** (`gpt-image-2-text-to-image` e `gpt-image-2-image-to-image`), enquanto o nosso registry usa um modelo só com referências opcionais.

---

## 2. Como o app chama o provedor hoje (pontos de acoplamento)

| Peça | Arquivo | O que faz | O que muda |
|---|---|---|---|
| Montar o pedido | `src/registry/*.ts` (`build()`) | Devolve `{ endpoint, body, query }` no formato Treg (`endpoint` = id do `treg-catalog.json`) | Novo campo `provider` e os corpos no formato do kie |
| Preço exato | `src/registry/quote.ts` + `treg-catalog.json` | Calcula o custo em US$ pelas regras publicadas pelo Treg | Tabela de preços própria para o kie |
| Validação | `src/server/jobs.ts:223` | Recusa se o endpoint não existe no catálogo do Treg | Validar contra o catálogo do provedor do modelo |
| Envio | `src/server/worker.ts` `start()` | `tregCall`, idempotência, `maxCostUsd`, `replayable()` | Despachar para o provedor certo; sem reenvio cego no kie |
| Consulta | `worker.ts` `poll()` e `treg.ts` `tregTask` | Estados definidos pelo catálogo (`success`/`failure`) | Estados fixos do kie |
| Resultado | `src/server/extract.ts` | Coleta URLs/base64 do JSON e valida pelos bytes | Já acha `resultUrls`; precisa só do adaptador do corpo |
| Arquivos de referência | `worker.ts` `publicUrl()` | `tregUploadMedia`, cache de 6 dias | Upload do kie, cache de no máximo 20 h |
| Custo real | `worker.ts` `finish()` | Usa `provider_cost_micro` do Treg para estornar a diferença | `creditsConsumed × 0,005` |
| Orçamento | `jobs.ts` `spentToday()` / `dailyBudgetUsd()` | Soma `est_usd` e `provider_cost_micro` | Igual, com o custo do kie |
| Chave e modo | `src/server/treg.ts`, `settings.ts` | `getSecret("treg_token")` | `getSecret("kie_api_key")` (já existe no painel) |

O banco guarda o id da chamada em `jobs.treg_call_id`. Dá para reaproveitar a coluna como "id da tarefa no
provedor" e acrescentar uma coluna `provider`.

---

## 3. Arquitetura proposta

```
src/server/providers/
  types.ts     interface Provider { id, submit(), poll(), upload(), balance(), price() }
  treg.ts      adaptador do que existe hoje (movido, sem mudar o comportamento)
  kie.ts       adaptador do kie.ai
  index.ts     escolhe o provedor pelo model.provider (padrão do painel)
src/registry/kie/
  image.ts  video.ts  audio.ts   modelos do kie (ModelDef com provider: "kie")
  prices.ts                      tabela de preço por modelo e combinação
src/app/api/webhooks/kie/route.ts   recebe o callback (opcional)
scripts/fake-kie-server.mjs         kie falso para testar sem gastar
```

### 3.1 Contrato do provedor

```ts
interface Provider {
  id: "treg" | "kie";
  /** Envia o pedido. Devolve o id da tarefa ou o resultado direto. Nunca reenvia por conta própria. */
  submit(job, body): Promise<{ taskId: string; costUsd?: number } | { done: Buffer[] }>;
  /** Uma consulta. */
  poll(taskId): Promise<{ state: "running" | "success" | "failed"; urls?: string[]; costUsd?: number; message?: string }>;
  upload(bytes, mime): Promise<{ url: string; expiresAt: number }>;
  balanceUsd(): Promise<number>;
}
```

O `worker.ts` passa a chamar `providerFor(job).submit/poll/upload`. Tudo que é comum (reserva de crédito,
reembolso, salvar arquivos, orçamento) continua onde está.

### 3.2 Banco

Migração `140_provider.sql`: `ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'treg'`.
Tabela `admin_model_routes (model_id, provider, enabled)` já tem equivalente em `admin_model_overrides`
(liga e desliga). O roteamento por modelo entra como campo extra.

### 3.3 Fluxo de uma geração no kie

1. **Cliente** escolhe o modelo e clica em Gerar. O preço mostrado vem da tabela de preços do kie (seção 5).
2. `submitJobs` valida, reserva os créditos e grava o job `queued` com `provider = 'kie'`.
3. **Worker** (`start`): troca `asset:<id>` por URL pública (upload no kie, seção 6), monta o corpo
   `{ model, input }`, passa pelo limitador (20 por 10 s) e chama `createTask`.
4. Se `code === 200`: grava `taskId` **imediatamente** e passa a consultar.
5. **Consulta** (`poll`): `recordInfo` a cada 3 s, aumentando até 15 s. Em `success`, lê `resultJson.resultUrls`,
   baixa na hora (o link vale 14 dias, mas não confiamos nisso), salva os arquivos.
6. **Cobrança**: `creditsConsumed × US$ 0,005` vira `provider_cost_micro`. Se o real for menor que o
   cotado, estorna a diferença (mecanismo que já existe). Se for maior, registra o desvio no log do admin.
7. Em `fail`: reembolso total (já existe) e a mensagem do kie vira texto amigável.
8. **Callback** (opcional): se `PARALLAX_ORIGIN` for público, enviamos `callBackUrl`; ao receber, só
   acordamos o worker para consultar aquela tarefa já. O polling continua como garantia.

### 3.4 Tratamento de erro

| Situação | Ação |
|---|---|
| `code` 401 | Para o provedor, avisa o admin (chave inválida). Cliente vê "modelo indisponível" |
| `code` 402 | Saldo do kie acabou: pausa a geração, alerta o admin, reembolsa e não conta tentativa |
| `code` 422 | Erro nosso de parâmetro: falha o job, reembolsa, grava o motivo no log do admin |
| `code` 429 | Backoff (2, 4, 8 s), não gasta tentativa, o limitador evita repetir |
| `code` 455 / 500 / 505 | Reenfileira com backoff, até 6 tentativas, depois reembolsa |
| Timeout ou queda **antes** da resposta de `createTask` | **Não reenviar** automaticamente (risco de cobrança dupla). Marca `interrupted`, reembolsa e registra para conferência |
| Queda **antes de conectar** (DNS, recusa de conexão) | Pode reenviar com segurança |
| `state: fail` | Reembolso; o kie não cobra falha |
| Sem resposta em 10 min (408) ou 30 min de vídeo | Falha por tempo, reembolso |
| Resposta com `resultUrls` vazio | `ResultError` (já existe) |

---

## 4. Mapeamento dos modelos

Hoje o app tem 39 modelos. O kie cobre quase todos, com nomes e parâmetros diferentes. Em vez de portar 1:1,
a proposta é um **catálogo curado do kie** (só o que está confirmado), mantendo o Treg como reserva.

### 4.1 Imagem

| Nosso modelo | Modelo no kie (`model`) | Estado | Observações |
|---|---|---|---|
| Nano Banana Pro | `nano-banana-pro` | Confirmado | `image_input` (até 8), `aspect_ratio`, `resolution` 1K/2K/4K, `output_format` png/jpg. Edição no mesmo modelo |
| Nano Banana 2 | `nano-banana-2` | Confirmado | `image_input` (até 10), `resolution` 1K/2K/4K |
| Nano Banana 2 Lite | (não lido) | [VERIFICAR] | Existe `google/nano-banana-2-lite` na lista |
| GPT Image 2 | `gpt-image-2-text-to-image` e `gpt-image-2-image-to-image` | Confirmado | **Dois modelos**: usar o de edição quando houver referência. `resolution` 1K/2K/4K, `input_urls` até 16 |
| GPT Image 2.5 Flare / Sunburst | `gpt-image-2-5-flare-text-to-image` (Flare confirmado) | Parcial | Sunburst e as variantes de edição não foram lidas |
| FLUX Schnell | sem equivalente | Substituir | Usar `flux-3/klein-text-to-image` (1K/2K/4K, `num_images` 1 a 4) |
| MiniMax Image 01 | `minimax-h3/text-to-image` | Parcial | É outro modelo (H3); trocar nome e descrição |
| Extras possíveis | Seedream 5.0 Pro/Flash/5.5, Kling Image 4.0, Imagen 4, Ideogram V3, Qwen Image Edit, Recraft remover fundo, Upscalers | Confirmado | Bons candidatos a novos modelos e ferramentas (Apps) |

### 4.2 Vídeo

| Nosso modelo | Modelo no kie | Estado | Observações |
|---|---|---|---|
| Veo 3.1 / Fast / Lite | `veo-3-1` com `input.model` = `veo3` / `veo3_fast` / `veo3_lite` | Confirmado (corpo) | `duration` 4/6/8, `resolution` 720p/1080p/4k, `generation_type`, `image_urls`. 1080p e 4K custam o 720p **mais** um adicional; 4K é uma tarefa extra (`veo/get-4k-video`). Há também um endpoint próprio do Veo na documentação antiga [VERIFICAR qual vale] |
| Seedance 2.5 | `bytedance/seedance-2-5` | Confirmado | Até 30 s, `generate_audio`, quadros inicial e final, até 30 imagens de referência |
| Seedance 2.0 (+ Fast, Mini) | `bytedance/seedance-2` | Confirmado | Fast e Mini: páginas existem, não lidas |
| Seedance 1 Lite | `bytedance/v1-lite-text-to-video` / `-image-to-video` | Parcial | Não lido |
| Kling 3.0 Pro / Standard | `kling-3.0/video` com `mode` = `pro` / `std` (e `4K`) | Confirmado | `sound` (muda o preço), `duration` "3" a "15" como **texto**, multi-planos, `kling_elements` |
| Kling 3.0 Turbo | `kling/v3-turbo-text-to-video` | Confirmado | Áudio sempre ligado |
| Kling O1 | não localizado | [VERIFICAR] | Pode ter virado Kling Omni |
| Wan 3.0 / Prime | `wan/3-0-video`, `wan/3-0-video-prime` | Confirmado (3.0) | `resolution` em **maiúsculas** (480P/720P/1080P), `audio` |
| Wan 2.7 / 2.6 | `wan/2-7-text-to-video`, `wan/2-6-text-to-video` | Confirmado | 2.7 usa `ratio` (não `aspect_ratio`); 2.6 usa `duration` em texto |
| Hailuo 2.3 / 02 | `hailuo/2-3-image-to-video-pro`, `hailuo/02-*` | Parcial | Só imagem para vídeo foi lido; `duration` "6"/"10" em texto |
| Hailuo H3 / H3 Max | `minimax-h3/text-to-video` | Confirmado (H3) | 768P ou 2K, 4 a 15 s |
| HappyHorse 1.1 / 1.0 | `happyhorse-1-1/text-to-video` | Confirmado (1.1) | 3 a 15 s |
| Runway Gen-4.5 | `runway` | Parcial | O modelo documentado é `runway` (5 ou 10 s, 720p/1080p). Gen-4.5 não aparece |
| Runway Aleph 2 | descontinuado no kie | Remover | A página diz "Discontinued" |
| Sora 2 Pro | **não existe no kie** | Remover ou manter no Treg | Fora do catálogo |
| FLUX 3 Video | **não existe no kie** | Remover ou manter no Treg | Só há FLUX de imagem |
| HeyGen Avatar IV | **não existe no kie** | Substituir | Alternativas: OmniHuman 1.5/2.0, Kling AI Avatar, InfiniTalk |
| Extras possíveis | Grok Imagine (`grok-imagine/text-to-video`), Vidu Q4, LTX 2.5 Pro/Fast, PixVerse V6, Kling 3.0 Motion Control, Veo Extend | Confirmado | Entram como novos modelos |

### 4.3 Voz e música

| Nosso modelo | Modelo no kie | Estado |
|---|---|---|
| Gemini TTS | `google/gemini-3-8-flash-tts` | Confirmado. Saída WAV; 70 vozes; falas e diálogos com 1 ou 2 vozes; sem lista oficial além da página |
| Gemini TTS Lite | `google/gemini-3-8-flash-lite-tts` | Existe, não lido |
| MiniMax Speech HD / Turbo | **não encontrado** | Substituir por ElevenLabs |
| Fish Audio S2.1 Pro | **não encontrado** | Substituir por ElevenLabs |
| (novo) ElevenLabs TTS | `elevenlabs/text-to-speech-multilingual-v2` | Confirmado. 83 vozes, até 5000 caracteres, estabilidade, velocidade. US$ 0,03 por 1000 caracteres |
| (novo) Suno fala | `ai-music-api/speech` | Confirmado, mas **não é voz fixa** (tom e emoção por descrição) |
| Lyria 3.5 / Clip | **não encontrado** | Substituir por Suno |
| (novo) Suno música | `ai-music-api/generate` (V6, V6_MINI, V6_WILD) | Confirmado. Modo simples ou personalizado, até 360 s, estilos, letra, `persona_id`. Também estender, capa, separar vocais |
| (novo) Transcrição | `nvidia/nemotron-3-5-transcribe` | Confirmado. Útil para uma ferramenta nova |

**Conclusão do mapeamento:** é possível lançar os 4 tipos de recurso só com o kie. Perde-se Sora, FLUX Video,
HeyGen, Lyria, MiniMax Speech e Fish; ganha-se Suno, ElevenLabs e vários vídeos novos (Grok, Vidu, LTX,
PixVerse, Kling 4.0). Os **controles** (durações, resoluções, proporções, áudio) de cada modelo precisam ser
reescritos a partir das páginas do kie, porque os valores permitidos são diferentes dos do Treg.

---

## 5. Preço: o ponto mais delicado

O app mostra o preço exato antes de gerar e reserva esse valor. Com o Treg isso vinha do catálogo deles. No
kie **não há API oficial de preço por combinação** na documentação. Opções:

| Opção | Prós | Contras |
|---|---|---|
| **A. Tabela própria em código** (recomendada) | Exata, rápida, testável, sem dependência | Precisa ser mantida quando o kie mudar preço |
| B. Ler o endpoint de preços do CLI | Sempre atual | Não documentado, pode quebrar; as linhas só trazem o preço "a partir de" |
| C. Estimar e acertar depois | Simples | O cliente vê um preço e paga outro. Inaceitável |

**Recomendação: A, com três proteções.**
1. `src/registry/kie/prices.ts` com função `priceUsd(modelo, parâmetros)` por modelo (por segundo, por imagem,
   por 1000 caracteres, por resolução, com ou sem som).
2. **Calibração automática:** depois de cada geração, comparar `creditsConsumed × 0,005` com o preço cotado e
   guardar o desvio. O painel mostra "modelos com preço divergente" para você corrigir.
3. Script `scripts/check-kie-prices.mjs` que compara a tabela com a página de preços do kie e lista diferenças.

**O que já se sabe (US$, "a partir de", da página de preços; confirmar por combinação):**

| Modelo | Preço |
|---|---|
| Nano Banana Pro | 1K e 2K: 18 créditos (US$ 0,09); 4K: 24 (US$ 0,12) |
| Nano Banana 2 | 1K 8 / 2K 12 / 4K 18 créditos (US$ 0,04 / 0,06 / 0,09) |
| GPT Image 2 e 2.5 | 1K 6 / 2K 10 / 4K 16 créditos (US$ 0,03 / 0,05 / 0,08) |
| Seedream 5.0 Pro | 1K 7 / 2K 14 créditos |
| FLUX 3 Klein | 1K 1,6 / 2K 2,5 / 4K 6,5 créditos por imagem |
| Seedance 2.0 / 2.5 | US$ 0,057 / 0,085 por segundo (a partir de) |
| Kling 3.0 / Turbo | US$ 0,0755 / 0,101 por segundo (a partir de); com som custa mais |
| Wan 3.0 / Prime / 2.7 | US$ 0,04 / 0,0612 / 0,08 por segundo |
| Veo 3.1 | a partir de US$ 0,025 por vídeo (29 combinações); 1080p/4K somam adicional |
| Grok Imagine, Vidu Q4, LTX Pro | US$ 0,012 / 0,036 / 0,072 por segundo |
| ElevenLabs TTS | US$ 0,03 por 1000 caracteres |
| Suno | a partir de US$ 0,002 por pedido (21 opções) |
| Gemini 3.8 Flash TTS | a partir de US$ 0,35 por milhão de tokens |

Os valores "a partir de" são o piso, não o preço fixo. A tabela completa (por resolução, duração e som)
precisa ser extraída das páginas de cada modelo; o item 11 lista como.

**Margem:** continua `custo × (1 + margem)`, editável no painel. Com o kie, o custo é o preço da tabela.

---

## 6. Arquivos de referência (imagem inicial, áudio, vídeo de entrada)

- Hoje: `publicUrl()` envia ao Treg, guarda `remote_url` e reaproveita por 6 dias.
- No kie: enviar para `https://kieai.redpandaai.co/api/file-stream-upload` (multipart: `file`, `uploadPath`,
  `fileName`), usar o `downloadUrl` devolvido e **reaproveitar por no máximo 20 h** (o arquivo é apagado em 24 h).
- Alternativa sem upload: nosso servidor expõe o arquivo por uma URL pública. Só funciona com domínio público;
  no desenvolvimento local o upload do kie é obrigatório.
- Limites úteis: base64 até 10 MB, stream/URL até cerca de 100 MB (recomendado); vários modelos limitam o
  tipo e o tamanho (por exemplo Nano Banana Pro: até 8 imagens, 30 MB cada).

---

## 7. Callbacks (opcional) e segurança

- Só funcionam com endereço público (`PARALLAX_ORIGIN` em HTTPS). No desenvolvimento local usamos só polling.
- Rota `POST /api/webhooks/kie`: validar `HMAC-SHA256(taskId + "." + timestamp)` com `webhookHmacKey`
  (guardada criptografada no painel, como as outras chaves), comparar em tempo constante, rejeitar
  timestamps com mais de 5 minutos, **deduplicar por `taskId`** (o kie pode reenviar) e responder 200.
- Como a assinatura não cobre o corpo, o callback **não é fonte de verdade**: ele só aciona uma consulta
  (`recordInfo`) da tarefa, e o resultado vem dessa consulta.

---

## 8. Painel admin: o que muda

| Tela | Mudança |
|---|---|
| Configurações > chaves | Já guarda `kie_api_key`; marcar a integração como conectada. Adicionar `webhookHmacKey` |
| Configurações | Botão **Testar conexão** (chama `/api/v1/chat/credit`), mostra o **saldo do kie** em créditos e em US$ |
| Configurações | Alerta e pausa automática quando o saldo do kie ficar abaixo de um valor definido por você |
| Modelos | Coluna **Provedor** (kie ou treg) por modelo, além de ligar e desligar |
| Modelos | Coluna **Preço de custo** (da tabela) e **preço de venda** (com a margem) por combinação |
| Visão geral | Custo real (de `creditsConsumed`) separado do estimado; **desvio de preço** por modelo |
| Gerações | Mostrar o `taskId` do kie, os créditos consumidos e o código de falha |
| Auditoria | Registrar troca de provedor, de chave e de limite de saldo |

---

## 9. Plano de implementação

| Fase | O que entrega | Como se prova que funciona |
|---|---|---|
| **K0. Validação com chave real** (meio dia) | Roda os experimentos da seção 11 com US$ 1 a US$ 2 de crédito e anota as respostas reais | Documento com as respostas reais e a lista de [VERIFICAR] resolvidos |
| **K1. Camada de provedor** (1 dia) | `providers/` com o Treg movido sem mudança de comportamento; coluna `provider` | Os 95 testes atuais (admin e e-mail) continuam passando em modo teste |
| **K2. Adaptador kie + kie falso** (1 a 2 dias) | `kie.ts` (envio, consulta, upload, saldo, limitador, erros), `fake-kie-server.mjs` | Testes ponta a ponta contra o kie falso: sucesso, falha, 402, 429, queda de rede, reembolso, orçamento |
| **K3. Catálogo e preços** (2 a 3 dias) | `registry/kie/*` com os modelos confirmados e `prices.ts` | `check:registry` estendido (todo preço definido, nenhum abaixo do custo); tabela conferida com a página do kie |
| **K4. Painel** (1 dia) | Itens da seção 8 | Teste no navegador e na API |
| **K5. Teste real** (meio dia) | 1 imagem, 1 vídeo curto, 1 voz e 1 música, em cada modelo do lançamento | Custo real batendo com o cotado (desvio abaixo de 5%) |
| **K6. Callbacks** (opcional, 1 dia) | Rota assinada | Teste com túnel público |

Total aproximado: **7 a 10 dias de trabalho**, sendo K0 e K5 os que dependem da sua chave e do seu saldo.

### Risco principal e como se controla

| Risco | Controle |
|---|---|
| Cobrança dupla por reenvio sem idempotência | Nunca reenviar depois de uma queda ambígua; gravar o `taskId` na hora; botão de conferência no painel |
| Preço da tabela diferente do real | Calibração automática por `creditsConsumed` e script de conferência |
| Saldo do kie acabar e o cliente já ter pago créditos | Monitor de saldo, pausa automática, reembolso integral de job que falhar |
| Limite de 20 pedidos por 10 s | Limitador no worker (fila interna) |
| Modelo sai do ar no kie | Chave liga/desliga por modelo; reserva no Treg por modelo |
| Documentação diferente da realidade | Fase K0 antes de escrever o código definitivo |
| Arquivo de referência expirar | Reaproveitar por no máximo 20 h e reenviar quando vencer |

---

## 10. Decisões que preciso de você

1. **Lista de lançamento:** quais modelos entram na primeira versão? Sugestão enxuta e confirmada na doc:
   - Imagem: Nano Banana Pro, Nano Banana 2, GPT Image 2, Seedream 5.0 Pro, FLUX 3 Klein.
   - Vídeo: Veo 3.1 (Fast e Quality), Seedance 2.5, Kling 3.0 (Std e Pro), Wan 3.0, Hailuo H3, Grok Imagine.
   - Voz: ElevenLabs TTS e Gemini 3.8 Flash TTS.
   - Música: Suno V6.
2. **Treg:** manter como reserva (mais código, mais custo de manutenção) ou desligar de vez?
3. **Domínio público:** os callbacks dependem disso; sem eles o sistema funciona só com polling.
4. **Saldo inicial do kie** e o limite de alerta (por exemplo avisar abaixo de US$ 20).
5. **Margem por tipo:** uma margem única (hoje 40%) ou diferente para vídeo e imagem?
6. **Chave de teste:** uma `KIE_API_KEY` com cerca de US$ 2 para a fase K0 e K5.

---

## 11. Experimentos da fase K0 (resolvem os [VERIFICAR])

Fazer com um script único, anotando a resposta bruta de cada passo:

1. `GET /api/v1/chat/credit`: confirmar o formato do saldo.
2. `POST /api/v1/jobs/createTask` com `nano-banana-2` 1K (a imagem mais barata): confirmar `taskId`, o corpo
   exato do `recordInfo`, o formato de `resultJson`, `creditsConsumed` e o tempo.
3. Um 422 proposital (parâmetro inválido): confirmar que o HTTP é 200 e o `code` é 422, e a mensagem.
4. Repetir o mesmo `createTask` duas vezes seguidas: confirmar que **não há** idempotência (duas tarefas, duas cobranças).
5. `veo-3-1` com `veo3_lite` 4 s 720p: confirmar o corpo (`model` no topo e `input.model`), o endpoint (Market ou o
   dedicado do Veo), o campo de resultado e o custo. Depois um Veo 1080p para ver o adicional.
6. `kling-3.0/video` std 3 s sem som e com som: confirmar a diferença de preço e `duration` como texto.
7. `seedance-2-5` 4 s 480p com `draft`: confirmar custo e `lastFrameUrl`.
8. `elevenlabs/text-to-speech-multilingual-v2`: confirmar `resultUrls` (mp3) e o custo por 1000 caracteres.
9. `google/gemini-3-8-flash-tts`: confirmar o WAV e a cobrança por tokens.
10. `ai-music-api/generate` V6_MINI: confirmar as etapas, quantas faixas voltam (costuma ser 2) e o custo.
11. Upload `file-stream-upload` de uma imagem pequena e uso dela em `nano-banana-pro` (`image_input`).
12. Depois de gerar, consultar o mesmo `taskId` vários dias depois e abrir a URL: confirmar a retenção de 14 dias.
13. Callback com um túnel público: confirmar o corpo, os cabeçalhos e a assinatura.
14. `POST /client/v1/model-pricing/page`: ver se dá para tirar uma tabela completa por combinação.
15. Disparar 25 pedidos em 10 s com `nano-banana` para ver o 429 e se algum é aceito parcialmente.

---

## 12. Fontes lidas (2026-11-20)

- Documentação geral: https://docs.kie.ai/ , https://docs.kie.ai/llms.txt , https://kie.ai/llms.txt
- API de mercado: https://docs.kie.ai/market/quickstart , https://docs.kie.ai/market/common/get-task-detail
- Webhook: https://docs.kie.ai/common-api/webhook-verification
- Upload: https://docs.kie.ai/file-upload-api/quickstart
- Saldo: https://docs.kie.ai/common-api/get-account-credits
- Veo: https://docs.kie.ai/veo3-api/generate-veo-3-video.md
- Kling 3.0: https://docs.kie.ai/market/kling/kling-3-0.md
- Seedance: https://docs.kie.ai/market/bytedance/seedance-2-5.md
- Wan 3.0: https://docs.kie.ai/market/wan/3-0-video.md
- Imagem: https://docs.kie.ai/market/google/pro-image-to-image.md , https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image.md
- Áudio: https://docs.kie.ai/market/elevenlabs/text-to-speech-multilingual-v2.md , https://docs.kie.ai/suno-api/generate-music.md
- Preços: https://kie.ai/pricing
- CLI e MCP: https://kie.ai/cli
