# Linha Um — discador paralelo assistido

Aplicação web para um único vendedor iniciar rodadas de 1 a 10 chamadas, conectar-se ao primeiro atendimento humano confirmado e cancelar as demais. O modo padrão é um simulador local completo; o adaptador Twilio fica desativado até receber credenciais.

> Uso responsável: esta aplicação não autoriza chamadas indiscriminadas. O operador deve comprovar a origem e a base legal dos contatos, respeitar solicitações de bloqueio, LGPD, regras da Anatel, horários aplicáveis e identificação legítima do número de origem. Falsificação de caller ID é proibida.

## Início rápido

Requisitos: Node.js 22.13 ou superior e pnpm.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Abra `http://localhost:3000`. O login local é fornecido pelo runtime Sites; em publicação, a identidade vem dos cabeçalhos autenticados da plataforma. O simulador não exige Twilio nem banco inicializado.

Para a demonstração de aceite:

1. mantenha os dez primeiros contatos selecionados;
2. mova “Chamadas simultâneas” para `10`;
3. clique em **Iniciar rodada** e confirme;
4. observe o stream SSE: dez chamadas entram em `Chamando`, uma fica `Conectada` e nove ficam `Cancelada`;
5. registre o resultado e, se necessário, marque **Não ligar novamente**.

O importador aceita CSV com cabeçalho `nome,telefone,cidade`, mostra uma prévia, limita a 100 linhas e rejeita números que não possam ser normalizados para E.164.

## Verificação

```bash
pnpm test
pnpm test:coverage
pnpm lint
pnpm build
```

Os testes usam somente o simulador e SQLite em memória. A suíte cobre os 14 cenários exigidos, um teste de 50 eventos de atendimento paralelos e a aplicação da migração com compare-and-set de vencedor.

## Banco e migrações

O banco é Cloudflare D1/SQLite, declarado em `.openai/hosting.json`. As tabelas cobrem usuários, contatos, consentimentos, campanhas, rodadas, tentativas, eventos da operadora, resultados, bloqueios, rate limiting e auditoria.

- `migrations/0000_initial.sql`: esquema e restrições iniciais.
- `migrations/0001_operational_indexes.sql`: índices de retenção e consultas operacionais.
- `db/schema.ts`: fonte tipada Drizzle.

O fluxo real só deve ser habilitado depois que as migrações forem aplicadas ao binding `DB` pelo ambiente Sites. O teste `banco: migração aplica...` valida a migração inicial em SQLite real.

## Configuração

Copie `.env.example` e mantenha segredos apenas no armazenamento de secrets do ambiente. Para desenvolvimento Cloudflare, use `.dev.vars` (ignorado pelo Git). Nunca versione tokens ou números reais.

Variáveis essenciais:

| Variável | Finalidade |
| --- | --- |
| `TELEPHONY_PROVIDER` | `simulator` (padrão) ou `twilio` |
| `PUBLIC_BASE_URL` | origem HTTPS pública usada nos webhooks |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | autenticação da API e assinatura de webhooks |
| `TWILIO_FROM_NUMBER` | número Twilio legítimo, em E.164 |
| `SELLER_DESTINATION` | telefone E.164 ou URI `sip:` do vendedor |
| `DATA_ENCRYPTION_KEY` | chave AES-256 em base64 para anotações |
| `PROVIDER_CONCURRENCY_LIMIT` | limite contratado, máximo efetivo 10 |
| `CALLING_START_HOUR` / `CALLING_END_HOUR` | janela local permitida |
| `RETENTION_DAYS` / `NOTES_RETENTION_DAYS` | retenção operacional e de anotações |
| `RETENTION_JOB_TOKEN` | bearer token do job de retenção |

Leia [docs/TELEPHONY.md](docs/TELEPHONY.md) antes de habilitar chamadas reais e [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) antes de publicar.

## Estrutura principal

- `app/dialer-dashboard.tsx`: painel responsivo, CSV, SSE e controles operacionais.
- `lib/domain/dialer-service.ts`: orquestração independente de operadora.
- `lib/domain/state-machine.ts`: transições permitidas.
- `lib/persistence/d1-atomic-store.ts`: compare-and-set e deduplicação persistente.
- `lib/telephony/simulator-provider.ts`: provedor determinístico para desenvolvimento/testes.
- `lib/telephony/twilio-provider.ts`: adaptador HTTP, AMD e validação HMAC-SHA1.
- `app/api/webhooks/twilio/route.ts`: vencedor atômico, ponte e cancelamento.
- `tests/`: unitários, integração, banco, concorrência e fluxo completo.

## Limitações conhecidas

- AMD pode produzir falsos positivos, falsos negativos ou resultado inconclusivo. `unknown` permanece `answered` e nunca vence sem classificação explícita.
- D1 é a fonte durável do fluxo real; o simulador SSE é deliberadamente isolado por requisição e não persiste histórico após recarregar a página.
- As métricas do endpoint `/api/metrics` são de disponibilidade/build. Contadores agregados de produção devem ser enviados a uma plataforma durável de métricas; os contadores completos existem no resultado do simulador e nos logs estruturados.
- A fila/outbox durável de criação de chamadas ainda depende do controle de idempotência da aplicação e do adaptador. Antes de grande volume, valide formalmente o comportamento de idempotência da conta Twilio e acrescente uma fila durável de outbound jobs.
- Não há gravação nem transcrição de chamadas. Isso é intencional.
- A política de horário usa o timezone do runtime. Em produção, padronize o timezone da operação e teste transições de horário de verão onde aplicável.
