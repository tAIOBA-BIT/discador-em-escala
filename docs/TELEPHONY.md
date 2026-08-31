# Telefonia e configuração de webhooks

## Fluxo real (Twilio)

1. `POST /api/campaigns/start` valida identidade, origem, horário, rate limit, lista de bloqueio, E.164 e concorrência.
2. Cada chamada começa em `/api/twilio/twiml/wait`; isso impede conexão prematura de contatos ao vendedor.
3. A Twilio executa AMD assíncrono e chama `/api/webhooks/twilio`.
4. Caixa postal é marcada `voicemail` e encerrada. `unknown` não vence.
5. Um humano tenta o compare-and-set no D1.
6. O vencedor é atualizado para `/api/twilio/twiml/bridge`, que disca `SELLER_DESTINATION`.
7. As demais chamadas são canceladas. Uma segunda pessoa que atenda recebe `/api/twilio/twiml/late-answer` antes do encerramento.
8. O painel acompanha D1 por SSE em `/api/events`.

## Preparação da conta

1. Compre ou valide um número Twilio permitido para a região e use-o em `TWILIO_FROM_NUMBER`. Nunca informe um número que não pertença à conta.
2. Verifique se a conta permite o país de destino e pelo menos a concorrência configurada.
3. Defina `SELLER_DESTINATION` como telefone E.164 ou ramal `sip:` alcançável.
4. Publique em HTTPS e defina `PUBLIC_BASE_URL` exatamente com a origem pública. A validação de assinatura depende da URL exata.
5. Armazene SID, token, chave de criptografia e token de retenção como secrets, não como variáveis públicas nem arquivos versionados.
6. Aplique as migrações D1 e depois mude `TELEPHONY_PROVIDER=twilio`.

O adaptador configura `StatusCallback`, `AsyncAmdStatusCallback` e as URLs TwiML em cada chamada; não é necessário cadastrar manualmente uma URL global para chamadas outbound. Se a conta exigir configuração de Voice URL no número, use uma rota separada para inbound — esta aplicação não implementa inbound.

## Teste gradual

Comece com números controlados e concorrência `1`, depois `2`, `3` e somente então `10`. Meça `answer_to_connect_ms`, abandonos e cancelamentos. Não use contatos reais até validar AMD, caller ID, destinos SIP/telefone, limites contratados e mensagem tardia.

## Retenção

Agende `POST /api/internal/retention` com `Authorization: Bearer <RETENTION_JOB_TOKEN>`. O job remove eventos e auditoria vencidos e limpa anotações cifradas no prazo específico. Mantenha a trilha mínima exigida por lei e pela política interna.
