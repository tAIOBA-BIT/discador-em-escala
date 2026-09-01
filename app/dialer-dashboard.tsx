'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Headphones,
  History,
  Import,
  LayoutDashboard,
  LoaderCircle,
  Pause,
  PhoneCall,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Signal,
  Square,
  Upload,
  UserRoundCheck,
  Users,
  Wifi,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type ContactRow = {
  id: string;
  name: string;
  phone: string;
  masked: string;
  city: string;
  source: string;
  doNotCall?: boolean;
};
type AttemptView = {
  id: string;
  contactId: string;
  contactName: string;
  status: string;
  winner?: boolean;
};
type HistoryItem = {
  id: string;
  name: string;
  outcome: string;
  duration: number;
  time: string;
};

const initialContacts: ContactRow[] = [
  {
    id: '1',
    name: 'Ana Martins',
    phone: '+5511993211048',
    masked: '+55 11 9••••-1048',
    city: 'São Paulo',
    source: 'CRM · consentimento',
  },
  {
    id: '2',
    name: 'Bruno Tavares',
    phone: '+5521994567821',
    masked: '+55 21 9••••-7821',
    city: 'Rio de Janeiro',
    source: 'Evento · legítimo interesse',
  },
  {
    id: '3',
    name: 'Carla Nogueira',
    phone: '+5531991884402',
    masked: '+55 31 9••••-4402',
    city: 'Belo Horizonte',
    source: 'Formulário · consentimento',
  },
  {
    id: '4',
    name: 'Diego Freitas',
    phone: '+5541995202287',
    masked: '+55 41 9••••-2287',
    city: 'Curitiba',
    source: 'CRM · consentimento',
  },
  {
    id: '5',
    name: 'Elisa Ramos',
    phone: '+5551996229164',
    masked: '+55 51 9••••-9164',
    city: 'Porto Alegre',
    source: 'Indicação · registrado',
  },
  {
    id: '6',
    name: 'Fábio Lima',
    phone: '+5561997333055',
    masked: '+55 61 9••••-3055',
    city: 'Brasília',
    source: 'CRM · consentimento',
  },
  {
    id: '7',
    name: 'Giovana Alves',
    phone: '+5585992446680',
    masked: '+55 85 9••••-6680',
    city: 'Fortaleza',
    source: 'Webinar · consentimento',
  },
  {
    id: '8',
    name: 'Henrique Moraes',
    phone: '+5571998552041',
    masked: '+55 71 9••••-2041',
    city: 'Salvador',
    source: 'CRM · legítimo interesse',
  },
  {
    id: '9',
    name: 'Isabela Rocha',
    phone: '+5548993667192',
    masked: '+55 48 9••••-7192',
    city: 'Florianópolis',
    source: 'Formulário · consentimento',
  },
  {
    id: '10',
    name: 'João Ribeiro',
    phone: '+5581994770834',
    masked: '+55 81 9••••-0834',
    city: 'Recife',
    source: 'Evento · consentimento',
  },
  {
    id: '11',
    name: 'Kelly Souza',
    phone: '+5511990000000',
    masked: '+55 11 9••••-0000',
    city: 'São Paulo',
    source: 'Solicitação do contato',
    doNotCall: true,
  },
];

const statusLabels: Record<string, string> = {
  queued: 'Aguardando',
  starting: 'Iniciando',
  ringing: 'Chamando',
  answered: 'Atendida',
  human_confirmed: 'Humano confirmado',
  winner: 'Vencedora',
  connected: 'Conectada',
  cancelled: 'Cancelada',
  busy: 'Ocupada',
  no_answer: 'Não atendida',
  voicemail: 'Caixa postal',
  failed: 'Falha',
  completed: 'Concluída',
};

const terminalStates = new Set([
  'cancelled',
  'busy',
  'no_answer',
  'voicemail',
  'failed',
  'completed',
]);

export function DialerDashboard({
  displayName,
  authenticated,
}: {
  displayName: string;
  authenticated: boolean;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [providerMode, setProviderMode] = useState<'simulator' | 'twilio'>(
    'simulator',
  );
  const [selected, setSelected] = useState(
    () =>
      new Set(
        initialContacts
          .filter((contact) => !contact.doNotCall)
          .map((contact) => contact.id),
      ),
  );
  const [search, setSearch] = useState('');
  const [concurrency, setConcurrency] = useState(3);
  const [available, setAvailable] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pauseQueued, setPauseQueued] = useState(false);
  const [attempts, setAttempts] = useState<Record<string, AttemptView>>({});
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [currentRoundId, setCurrentRoundId] = useState<string | null>(null);
  const [conversationStart, setConversationStart] = useState<number | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmTen, setConfirmTen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ContactRow[]>([]);
  const [invalidRows, setInvalidRows] = useState(0);
  const [outcome, setOutcome] = useState('interested');
  const [notes, setNotes] = useState('');
  const [blockWinner, setBlockWinner] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const idempotencyRef = useRef<string | null>(null);
  const pauseQueuedRef = useRef(false);

  useEffect(() => {
    if (!conversationStart) return;
    const update = () =>
      setElapsed(Math.floor((Date.now() - conversationStart) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [conversationStart]);

  useEffect(() => {
    setProviderMode('simulator');
  }, []);

  const filteredContacts = useMemo(
    () =>
      contacts.filter((contact) =>
        `${contact.name} ${contact.city} ${contact.masked}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [contacts, search],
  );
  const visibleAttempts = useMemo(() => Object.values(attempts), [attempts]);
  const activeCalls = visibleAttempts.filter(
    (attempt) =>
      !terminalStates.has(attempt.status) && attempt.status !== 'connected',
  ).length;
  const winner =
    visibleAttempts.find((attempt) => attempt.id === winnerId) ?? null;
  const initials = useMemo(
    () =>
      displayName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase(),
    [displayName],
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      const eligible = filteredContacts.filter((contact) => !contact.doNotCall);
      const all = eligible.every((contact) => next.has(contact.id));
      eligible.forEach((contact) =>
        all ? next.delete(contact.id) : next.add(contact.id),
      );
      return next;
    });

  async function requestStart() {
    if (concurrency === 10) {
      setConfirmTen(true);
      return;
    }
    await startRound();
  }

  async function startRound() {
    setConfirmTen(false);
    setError(null);
    if (running || winnerId) return;
    if (!available) {
      setError('Marque o vendedor como disponível antes de iniciar.');
      return;
    }
    const chosen = contacts.filter((contact) => selected.has(contact.id));
    if (!chosen.length) {
      setError('Selecione ao menos um contato elegível.');
      return;
    }
    if (chosen.some((contact) => contact.doNotCall)) {
      setError('A seleção contém um contato da lista “não ligar”.');
      return;
    }
    setRunning(true);
    setPauseQueued(false);
    setAttempts({});
    const controller = new AbortController();
    abortRef.current = controller;
    idempotencyRef.current ??= crypto.randomUUID();
    try {
      const response = await fetch(
        '/api/simulator/run',
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyRef.current,
          },
          body: JSON.stringify({
            concurrency,
            contacts: chosen.map(({ id, name, phone, doNotCall }) => ({
              id,
              name,
              phone,
              doNotCall,
            })),
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP_${response.status}`);
      }
      if (!response.body) throw new Error('SIMULATOR_STREAM_MISSING');
      await readEventStream(response.body, handleStreamEvent);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Falha ao executar a rodada.',
        );
    } finally {
      setRunning(false);
      abortRef.current = null;
      idempotencyRef.current = null;
      if (pauseQueuedRef.current) setPaused(true);
    }
  }

  function handleStreamEvent(event: string, data: Record<string, unknown>) {
    if (event === 'round') {
      setCurrentRoundId(String(data.roundId));
      const next: Record<string, AttemptView> = {};
      for (const item of data.attempts as Array<Record<string, string>>)
        next[item.id] = {
          id: item.id,
          contactId: item.contactId,
          contactName: item.contactName,
          status: item.status,
        };
      setAttempts(next);
    }
    if (event === 'attempt')
      setAttempts((current) => ({
        ...current,
        [String(data.id)]: {
          ...current[String(data.id)],
          id: String(data.id),
          status: String(data.status),
          winner: Boolean(data.winner),
        },
      }));
    if (event === 'connected') {
      const id = String(data.winnerAttemptId);
      setWinnerId(id);
      setConversationStart(Date.now());
      setAvailable(false);
    }
    if (event === 'error')
      setError(
        typeof data.message === 'string' ? data.message : 'Falha no simulador.',
      );
  }

  function pauseOperation() {
    if (running) {
      pauseQueuedRef.current = true;
      setPauseQueued(true);
    } else setPaused(true);
  }
  function resumeOperation() {
    pauseQueuedRef.current = false;
    setPaused(false);
    setPauseQueued(false);
  }
  async function stopOperation() {
    if (providerMode === 'twilio' && currentRoundId)
      await fetch('/api/campaigns/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: currentRoundId }),
      }).catch(() => null);
    abortRef.current?.abort();
    setRunning(false);
    setPauseQueued(false);
    setWinnerId(null);
    setConversationStart(null);
    setElapsed(0);
    pauseQueuedRef.current = false;
    setCurrentRoundId(null);
    setAttempts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, attempt]) => [
          id,
          terminalStates.has(attempt.status)
            ? attempt
            : { ...attempt, status: 'cancelled' },
        ]),
      ),
    );
    setError(null);
  }
  async function finishConversation() {
    if (!winner) return;
    if (providerMode === 'twilio') {
      const response = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: winner.id,
          outcome,
          notes,
          doNotCall: blockWinner,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? 'Falha ao salvar o resultado.');
        return;
      }
      abortRef.current?.abort();
    }
    setHistory((current) => [
      {
        id: crypto.randomUUID(),
        name: winner.contactName,
        outcome,
        duration: elapsed,
        time: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
      ...current,
    ]);
    if (blockWinner)
      setContacts((current) =>
        current.map((contact) =>
          contact.id === winner.contactId
            ? { ...contact, doNotCall: true }
            : contact,
        ),
      );
    setAttempts((current) => ({
      ...current,
      [winner.id]: { ...winner, status: 'completed' },
    }));
    setWinnerId(null);
    setConversationStart(null);
    setElapsed(0);
    setAvailable(true);
    setNotes('');
    setBlockWinner(false);
    setError(null);
  }

  async function previewCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = (await file.text()).split(/\r?\n/).filter(Boolean);
    const parsed: ContactRow[] = [];
    let invalid = 0;
    rows.slice(1, 101).forEach((row, index) => {
      const [nameRaw, phoneRaw, cityRaw] = row
        .split(',')
        .map((cell) => cell?.trim());
      const digits = (phoneRaw ?? '').replace(/\D/g, '');
      if (!nameRaw || digits.length < 10 || digits.length > 15) {
        invalid += 1;
        return;
      }
      const phone = phoneRaw.startsWith('+') ? `+${digits}` : `+55${digits}`;
      parsed.push({
        id: `csv-${Date.now()}-${index}`,
        name: nameRaw.slice(0, 120),
        phone,
        masked: maskPhone(phone),
        city: cityRaw || 'Não informado',
        source: 'CSV · revisão pendente',
      });
    });
    setImportPreview(parsed);
    setInvalidRows(invalid);
    setImportOpen(true);
    event.target.value = '';
  }
  function confirmImport() {
    setContacts((current) => [...importPreview, ...current]);
    setSelected(
      (current) =>
        new Set([...current, ...importPreview.map((contact) => contact.id)]),
    );
    setImportOpen(false);
  }

  const operationLabel = winner
    ? 'Em conversa'
    : running
      ? 'Discando'
      : paused
        ? 'Pausado'
        : available
          ? 'Disponível'
          : 'Indisponível';
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur md:px-7">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <PhoneCall className="size-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">LINHA UM</p>
            <p className="text-[11px] text-muted-foreground">
              Discador assistido
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            disabled={Boolean(winner)}
            onClick={() => setAvailable((value) => !value)}
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition sm:flex ${available && !winner ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}
          >
            <span
              className={`size-1.5 rounded-full ${available && !winner ? 'status-pulse bg-emerald-500' : 'bg-slate-400'}`}
            />
            {operationLabel}
          </button>
          <div className="grid size-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {initials || 'OP'}
          </div>
          <div className="hidden sm:block">
            <p className="max-w-40 truncate text-xs font-medium">
              {displayName}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {authenticated ? 'Sessão protegida' : 'Modo simulador local'}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-64px)] border-r bg-sidebar p-3 text-sidebar-foreground md:block">
          <nav className="space-y-1 text-sm">
            <a
              className="flex items-center gap-3 rounded-xl bg-sidebar-accent px-3 py-2.5 font-medium"
              href="#top"
            >
              <LayoutDashboard className="size-4 text-sidebar-primary" />
              Operação
            </a>
            <a
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sidebar-foreground/70"
              href="#contacts"
            >
              <Users className="size-4" />
              Contatos
            </a>
            <a
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sidebar-foreground/70"
              href="#history"
            >
              <History className="size-4" />
              Histórico
            </a>
          </nav>
          <div className="mt-8 rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium">
              <ShieldCheck className="size-4 text-sidebar-primary" />
              Controles ativos
            </div>
            <p className="text-[11px] leading-5 text-sidebar-foreground/60">
              Sem restrição de horário
              <br />
              Lista “não ligar” aplicada
              <br />
              Modo simulador ativo
            </p>
          </div>
          <div className="mt-auto p-3 pt-8 text-[10px] leading-4 text-sidebar-foreground/45">
            Uso comercial legítimo. O operador é responsável pelo cumprimento da
            LGPD, regras da Anatel e demais normas aplicáveis.
          </div>
        </aside>

        <main id="top" className="min-w-0 p-4 md:p-7">
          <div className="mb-6 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-[.14em] text-primary">
                Operação ao vivo
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                Sua próxima conversa começa aqui
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Selecione contatos, confirme a disponibilidade e inicie uma
                rodada segura.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {paused ? (
                <Button variant="outline" onClick={resumeOperation}>
                  <RotateCcw />
                  Retomar
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={Boolean(winner) || pauseQueued}
                  onClick={pauseOperation}
                >
                  <Pause />
                  {pauseQueued ? 'Pausa programada' : 'Pausar'}
                </Button>
              )}
              <Button
                variant="destructive"
                disabled={!running && !winner && !visibleAttempts.length}
                onClick={stopOperation}
              >
                <Square />
                Encerrar
              </Button>
              <Button
                disabled={
                  running ||
                  paused ||
                  !available ||
                  Boolean(winner) ||
                  selected.size === 0
                }
                onClick={() => void requestStart()}
              >
                {running ? <LoaderCircle className="animate-spin" /> : <Play />}
                {running ? 'Discando…' : 'Iniciar rodada'}
              </Button>
            </div>
          </div>
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <AlertCircle className="size-4" />
              {humanizeError(error)}
            </div>
          )}

          <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Selecionados" value={selected.size} icon={Users} />
            <Stat label="Concorrência" value={concurrency} icon={Activity} />
            <Stat
              label="Chamadas ativas"
              value={activeCalls}
              icon={PhoneCall}
            />
            <Stat
              label="Conversa"
              value={formatDuration(elapsed)}
              icon={Clock3}
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.75fr)]">
            <section
              id="contacts"
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
            >
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">Contatos da rodada</h2>
                  <button
                    className="text-left text-xs text-primary hover:underline"
                    onClick={selectAllVisible}
                  >
                    {selected.size} selecionados · alternar visíveis
                  </button>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="w-full pl-8 sm:w-48"
                      placeholder="Buscar contato"
                    />
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => void previewCsv(event)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Importar CSV"
                  >
                    <Import />
                  </Button>
                </div>
              </div>
              <div className="max-h-[590px] divide-y overflow-y-auto">
                {filteredContacts.map((contact) => {
                  const attempt = visibleAttempts.find(
                    (item) => item.contactId === contact.id,
                  );
                  return (
                    <label
                      key={contact.id}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${contact.doNotCall ? 'cursor-not-allowed bg-red-50/50 opacity-65' : 'cursor-pointer hover:bg-muted/50'} ${attempt?.winner ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-200' : ''}`}
                    >
                      <Checkbox
                        checked={selected.has(contact.id)}
                        disabled={
                          contact.doNotCall || running || Boolean(winner)
                        }
                        onCheckedChange={() => toggle(contact.id)}
                      />
                      <div className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                        {contact.name
                          .split(' ')
                          .map((part) => part[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {contact.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {contact.masked} · {contact.source}
                        </p>
                      </div>
                      {attempt ? (
                        <StatusBadge status={attempt.status} />
                      ) : contact.doNotCall ? (
                        <Badge variant="destructive">Não ligar</Badge>
                      ) : (
                        <Badge variant="outline" className="hidden sm:flex">
                          {contact.city}
                        </Badge>
                      )}
                      <span
                        className={`size-2 rounded-full ${contact.doNotCall ? 'bg-red-400' : 'bg-emerald-500'}`}
                      />
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="space-y-5">
              <section
                className={`rounded-2xl border p-5 text-white shadow-sm transition ${winner ? 'border-emerald-500 bg-slate-950' : 'bg-slate-950'}`}
              >
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span
                      className={`size-2 rounded-full ${winner ? 'status-pulse bg-emerald-400' : running ? 'status-pulse bg-amber-400' : 'bg-slate-600'}`}
                    />
                    {winner
                      ? 'Conversa conectada'
                      : running
                        ? 'Aguardando atendimento humano'
                        : 'Aguardando rodada'}
                  </div>
                  {running ? (
                    <Wifi className="size-4 text-emerald-400" />
                  ) : (
                    <Headphones className="size-4 text-slate-500" />
                  )}
                </div>
                {winner ? (
                  <div>
                    <div className="mb-5 flex items-center gap-3">
                      <div className="grid size-12 place-items-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300">
                        {winner.contactName
                          .split(' ')
                          .map((part) => part[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-semibold">{winner.contactName}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-emerald-300">
                          <UserRoundCheck className="size-3.5" />
                          Vencedora · humano confirmado
                        </div>
                      </div>
                      <span className="ml-auto font-mono text-lg tabular-nums">
                        {formatDuration(elapsed)}
                      </span>
                    </div>
                    <label
                      htmlFor="call-outcome"
                      className="text-xs text-slate-400"
                    >
                      Resultado
                    </label>
                    <select
                      id="call-outcome"
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-emerald-500"
                    >
                      <option value="interested">Interessado</option>
                      <option value="callback">Retorno</option>
                      <option value="sale">Venda</option>
                      <option value="not_interested">Sem interesse</option>
                      <option value="invalid_number">Número inválido</option>
                    </select>
                    <Textarea
                      aria-label="Anotações da conversa"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      className="mt-3 border-white/10 bg-white/5 text-white placeholder:text-slate-600"
                      placeholder="Anotações da conversa (sem conteúdo sensível)"
                    />
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                      <Checkbox
                        aria-label="Não ligar novamente"
                        checked={blockWinner}
                        onCheckedChange={(checked) =>
                          setBlockWinner(Boolean(checked))
                        }
                      />
                      <span>Não ligar novamente</span>
                    </div>
                    <Button
                      className="mt-4 w-full"
                      onClick={finishConversation}
                    >
                      <CheckCircle2 />
                      Salvar resultado e liberar
                    </Button>
                  </div>
                ) : (
                  <div className="grid min-h-36 place-items-center text-center">
                    <div>
                      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-white/5">
                        {running ? (
                          <Signal className="size-5 text-amber-300" />
                        ) : (
                          <PhoneCall className="size-5 text-slate-400" />
                        )}
                      </div>
                      <p className="text-sm font-medium">
                        {running
                          ? `${activeCalls} chamadas em andamento`
                          : 'Nenhuma conversa ativa'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {running
                          ? 'Atualizações recebidas em tempo real por SSE.'
                          : 'O primeiro atendimento humano aparecerá aqui.'}
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Configuração da rodada</h2>
                    <p className="text-xs text-muted-foreground">
                      Padrão recomendado: 3
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {providerMode === 'twilio' ? 'Twilio' : 'Simulador'}
                  </Badge>
                </div>
                <label className="text-xs font-medium" htmlFor="concurrency">
                  Chamadas simultâneas
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="concurrency"
                    disabled={running || Boolean(winner)}
                    value={concurrency}
                    onChange={(event) =>
                      setConcurrency(Number(event.target.value))
                    }
                    className="w-full accent-emerald-600"
                    type="range"
                    min="1"
                    max="10"
                  />
                  <span className="grid size-9 place-items-center rounded-lg border bg-muted text-sm font-semibold">
                    {concurrency}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-[11px] leading-4 text-emerald-800">
                  <FileCheck2 className="size-4 shrink-0" />
                  Idempotência, lista “não ligar” e limite de tentativas são
                  validados antes da rodada.
                </div>
                {concurrency === 10 && (
                  <p className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-4 text-amber-800">
                    10 chamadas exigem confirmação adicional.
                  </p>
                )}
              </section>
            </div>
          </div>

          <section
            id="history"
            className="mt-5 rounded-2xl border bg-card p-5 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Histórico desta sessão</h2>
                <p className="text-xs text-muted-foreground">
                  Resultados registrados pelo vendedor
                </p>
              </div>
              <Badge variant="outline">{history.length} conversas</Badge>
            </div>
            {history.length ? (
              <div className="divide-y">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 text-sm sm:grid-cols-[1fr_140px_100px_70px]"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground">
                      {outcomeLabel(item.outcome)}
                    </span>
                    <span className="font-mono text-xs">
                      {formatDuration(item.duration)}
                    </span>
                    <span className="text-right text-xs text-muted-foreground">
                      {item.time}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-24 place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <History className="mx-auto mb-2 size-5 opacity-50" />
                  Nenhum resultado registrado nesta sessão.
                </div>
              </div>
            )}
          </section>
        </main>
      </div>

      {confirmTen && (
        <Modal
          title="Confirmar 10 chamadas simultâneas"
          description="Esta rodada usará o limite máximo. Confirme que a conta da operadora comporta 10 chamadas e que os contatos são elegíveis."
          onClose={() => setConfirmTen(false)}
        >
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            Somente uma chamada poderá vencer. As outras nove receberão
            cancelamento imediato.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmTen(false)}>
              Voltar
            </Button>
            <Button onClick={() => void startRound()}>
              <Play />
              Confirmar e iniciar
            </Button>
          </div>
        </Modal>
      )}
      {importOpen && (
        <Modal
          title="Pré-visualização do CSV"
          description="Formato esperado: nome, telefone, cidade. Telefones válidos serão normalizados para E.164."
          onClose={() => setImportOpen(false)}
        >
          <div className="max-h-64 divide-y overflow-y-auto rounded-xl border">
            {importPreview.slice(0, 8).map((contact) => (
              <div
                key={contact.id}
                className="flex justify-between gap-3 p-3 text-sm"
              >
                <span className="truncate font-medium">{contact.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {contact.masked}
                </span>
              </div>
            ))}
            {!importPreview.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma linha válida.
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {importPreview.length} válidas · {invalidRows} rejeitadas · máximo
            de 100 linhas por arquivo
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={!importPreview.length} onClick={confirmImport}>
              <Upload />
              Importar contatos
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between text-muted-foreground">
        <span className="text-xs">{label}</span>
        <Icon className="size-4" />
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const active = ['starting', 'ringing', 'answered'].includes(status);
  const winner = ['winner', 'connected'].includes(status);
  return (
    <Badge
      variant={
        winner
          ? 'default'
          : active
            ? 'secondary'
            : status === 'failed'
              ? 'destructive'
              : 'outline'
      }
      className="hidden sm:flex"
    >
      {active && (
        <span className="status-pulse size-1.5 rounded-full bg-current" />
      )}
      {statusLabels[status] ?? status}
    </Badge>
  );
}
function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} •••••-${digits.slice(-4)}`;
}
function outcomeLabel(value: string) {
  return (
    (
      {
        interested: 'Interessado',
        callback: 'Retorno',
        sale: 'Venda',
        not_interested: 'Sem interesse',
        invalid_number: 'Número inválido',
      } as Record<string, string>
    )[value] ?? value
  );
}
function humanizeError(value: string) {
  return (
    (
      {
        do_not_call_contact_selected:
          'Um contato da lista “não ligar” foi selecionado.',
        invalid_phone_number: 'Há um telefone inválido na seleção.',
        concurrency_must_be_1_to_10: 'A concorrência deve estar entre 1 e 10.',
      } as Record<string, string>
    )[value] ?? value
  );
}
function Modal({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <dialog
        open
        aria-labelledby="modal-title"
        className="relative m-0 w-full max-w-lg rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl"
      >
        <h2 id="modal-title" className="font-semibold">
          {title}
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{description}</p>
        {children}
      </dialog>
    </div>
  );
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split('\n\n');
    buffer = records.pop() ?? '';
    for (const record of records) {
      let event = 'message';
      let data = '';
      for (const line of record.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) onEvent(event, JSON.parse(data) as Record<string, unknown>);
    }
  }
}
