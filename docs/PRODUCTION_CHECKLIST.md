# Checklist de produção

## Legal e operação

- [ ] Encarregado jurídico validou LGPD, Anatel, horários e base legal de cada origem.
- [ ] Processo de opt-out e bloqueio imediato foi testado ponta a ponta.
- [ ] Caller ID pertence à conta; spoofing está tecnicamente e operacionalmente proibido.
- [ ] Limites de tentativas e intervalo mínimo correspondem à política aprovada.
- [ ] Texto da espera e da mensagem tardia foi aprovado.

## Plataforma e dados

- [ ] Site privado/autenticado; autorização server-side revisada.
- [ ] Migrações `0000` e `0001` aplicadas e backup/restore testado.
- [ ] Secrets configurados; nenhum segredo aparece no bundle, logs ou repositório.
- [ ] `PUBLIC_BASE_URL` é HTTPS e coincide com a URL usada pela Twilio para assinar webhooks.
- [ ] `DATA_ENCRYPTION_KEY` tem 32 bytes, rotação e backup controlados.
- [ ] Job de retenção agendado e alertado.
- [ ] Timezone da janela de chamadas confirmado.

## Telefonia e confiabilidade

- [ ] Limite contratado é pelo menos `PROVIDER_CONCURRENCY_LIMIT` e nunca maior que 10.
- [ ] Webhook inválido retorna 401; replay/duplicata não muda vencedor.
- [ ] Duas respostas simultâneas produzem uma vencedora em teste contra D1 real.
- [ ] Cancelamento temporariamente falho é recuperado pelo retry do webhook.
- [ ] Destino do vendedor (telefone/SIP) está disponível e monitorado.
- [ ] Teste controlado de 10 chamadas confirmou uma ponte e nove cancelamentos.
- [ ] Alarmes para cancelamento esgotado, abandono e aumento de latência configurados.
- [ ] Fila/outbox durável de outbound foi adicionada ou o risco de reinício entre criação e persistência foi formalmente aceito.

## Entrega

- [ ] `pnpm test`, `pnpm lint` e `pnpm build` passam no mesmo artefato publicado.
- [ ] `/api/health` e `/api/metrics` monitorados externamente.
- [ ] Runbook de pausar, encerrar e desabilitar `TELEPHONY_PROVIDER` disponível ao plantão.
- [ ] Política explícita confirma que chamadas não são gravadas.
