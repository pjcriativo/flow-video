"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import useSWR, { mutate } from "swr";
import { MILLI } from "@/config/economy";
import { ApiError, api, errorMessage, fetcher } from "@/lib/api";

/* The admin panel. Plain on purpose: it is a tool for the owner, not a product screen. */

const TABS = [
  ["overview", "Visão geral"],
  ["users", "Usuários"],
  ["jobs", "Gerações"],
  ["plans", "Planos e preços"],
  ["coupons", "Cupons"],
  ["models", "Modelos"],
  ["reports", "Moderação"],
  ["system", "Configurações"],
  ["audit", "Auditoria"],
] as const;
type Tab = (typeof TABS)[number][0];

const when = (t: number) => new Date(t).toLocaleString("pt-BR");
const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const num = (n: number, digits = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const credits = (milli: number) => num(milli / MILLI, 1);
const usd = (n: number) => `US$ ${num(n, 2)}`;

const card = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
const input = "rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/40";
const btn = "rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-white/90 disabled:opacity-50";
const ghost = "rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50";
const th = "px-4 py-3 font-normal text-white/50";

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("overview");
  // The API answers 404 to anyone who is not an admin, and the page then explains why.
  const { data: me, error: meError } = useSWR("/api/admin/overview", fetcher, { shouldRetryOnError: false });
  if (meError instanceof ApiError && (meError.status === 404 || meError.status === 401)) return <NotAdmin />;
  if (!me && !meError) return <p className="p-10 text-center text-white/50">Carregando...</p>;
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-5 py-8 text-sm text-white">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Painel do administrador</h1>
          <p className="text-white/50">Gestão da plataforma</p>
        </div>
        <Link href="/" className="text-white/60 underline hover:text-white">
          Voltar ao app
        </Link>
      </header>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 ${tab === id ? "bg-white text-black" : "text-white/70 hover:bg-white/10"}`}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "overview" && <OverviewTab />}
      {tab === "users" && <UsersTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "coupons" && <CouponsTab />}
      {tab === "models" && <ModelsTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "system" && <SystemTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

/** Shown to anyone the API turned away. It says which account is signed in, so the owner can tell why. */
function NotAdmin() {
  const { data } = useSWR<{ user: { email: string | null; isGuest: boolean } | null }>("/api/auth/me", fetcher);
  const user = data?.user;
  return (
    <div className="mx-auto max-w-md p-10 text-center text-sm text-white/70">
      <h1 className="mb-2 text-lg font-semibold text-white">Sem acesso de administrador</h1>
      {!data ? (
        <p>Verificando sua conta...</p>
      ) : !user || user.isGuest ? (
        <p>
          Você não está logado com uma conta. <Link className="underline" href="/login?next=/admin">Entre</Link> com um e-mail de administrador.
        </p>
      ) : (
        <p>
          Você está logado como <b className="text-white">{user.email}</b>, que não é administrador. Os e-mails de admin ficam em <code>ADMIN_EMAILS</code>.{" "}
          <Link className="underline" href="/login?next=/admin">Trocar de conta</Link>
        </p>
      )}
    </div>
  );
}

function Failed({ error }: { error: unknown }) {
  return <p className="text-red-400">{errorMessage(error)}</p>;
}
function Loading() {
  return <p className="text-white/50">Carregando...</p>;
}
function Empty({ children, cols }: { children: ReactNode; cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-white/50">
        {children}
      </td>
    </tr>
  );
}
function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <div className={`${card} overflow-x-auto p-0`}>
      <table className="w-full text-left">
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl border border-white/15 bg-neutral-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Tag({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "red" | "amber" }) {
  const c = { gray: "bg-white/10 text-white/70", green: "bg-emerald-500/15 text-emerald-300", red: "bg-red-500/15 text-red-300", amber: "bg-amber-500/15 text-amber-300" }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{children}</span>;
}

/* -------------------------------- overview -------------------------------- */

interface Overview {
  mode: string;
  windowDays: number;
  totals: { members: number; guests: number; suspended: number; paidSubscriptions: number; generations: number; publicPosts: number; openReports: number; creditsOutstanding: number };
  last24h: Record<string, number>;
  window: { generations: number; revenueUsd: number; costUsd: number; marginUsd: number; marginPct: number };
  series: { day: string; signups: number; done: number; failed: number; chargedCredits: number; costUsd: number }[];
  topModels: { modelId: string; kind: string; n: number; credits: number; costUsd: number }[];
}

function Bars({ title, values, labels, color, format }: { title: string; values: number[]; labels: string[]; color: string; format: (n: number) => string }) {
  const max = Math.max(...values, 1);
  return (
    <div className={card}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-white/70">{title}</span>
        <span className="text-xs text-white/40">total {format(values.reduce((a, b) => a + b, 0))}</span>
      </div>
      <div className="flex h-28 items-end gap-1">
        {values.map((v, i) => (
          <div key={i} className="flex h-full flex-1 items-end" title={`${labels[i]}: ${format(v)}`}>
            <div className="w-full rounded-t" style={{ height: `${Math.max(v > 0 ? 4 : 1, (v / max) * 100)}%`, background: color, opacity: v > 0 ? 1 : 0.25 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data, error } = useSWR<Overview>("/api/admin/overview", fetcher, { refreshInterval: 10_000 });
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const t = data.totals;
  const w = data.window;
  const s = data.series;
  const labels = s.map((r) => day(r.day));
  const j = data.last24h;
  const stat = (label: string, value: string, hint?: string, tone?: string) => (
    <div className={card}>
      <div className="text-white/50">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-white/40">{hint}</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-center justify-between gap-2`}>
        <span>
          Modo de geração: <b className={data.mode === "live" ? "text-emerald-400" : "text-amber-400"}>{data.mode === "live" ? "real (cobra do provedor)" : "teste (mock, sem custo)"}</b>
        </span>
        <span className="text-white/40">Receita, custo e margem dos últimos {data.windowDays} dias</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Membros", num(t.members), `${num(t.guests)} visitantes · ${num(t.suspended)} suspensos`)}
        {stat("Assinantes ativos", num(t.paidSubscriptions), "planos pagos")}
        {stat("Gerações (24h)", num(Object.values(j).reduce((a, b) => a + b, 0)), `${j.succeeded ?? 0} ok · ${j.failed ?? 0} falhas · ${(j.queued ?? 0) + (j.running ?? 0)} em andamento`)}
        {stat("Denúncias abertas", num(t.openReports), "na aba Moderação", t.openReports > 0 ? "text-amber-400" : "")}
        {stat("Receita estimada", usd(w.revenueUsd), "créditos consumidos × valor do crédito")}
        {stat("Custo do provedor", usd(w.costUsd), "estimado")}
        {stat("Margem", usd(w.marginUsd), `${num(w.marginPct, 0)}% da receita`, w.marginUsd < 0 ? "text-red-400" : "text-emerald-400")}
        {stat("Créditos em circulação", num(t.creditsOutstanding), `${num(t.generations)} gerações no total · ${num(t.publicPosts)} posts públicos`)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Bars title="Novos cadastros por dia" values={s.map((r) => r.signups)} labels={labels} color="#a3e635" format={(n) => num(n)} />
        <Bars title="Gerações concluídas por dia" values={s.map((r) => r.done)} labels={labels} color="#38bdf8" format={(n) => num(n)} />
        <Bars title="Créditos consumidos por dia" values={s.map((r) => r.chargedCredits)} labels={labels} color="#f59e0b" format={(n) => num(n, 1)} />
        <Bars title="Custo do provedor por dia" values={s.map((r) => r.costUsd)} labels={labels} color="#f87171" format={(n) => usd(n)} />
      </div>
      <div>
        <h2 className="mb-2 text-base font-semibold">Modelos mais usados</h2>
        <Table heads={["Modelo", "Tipo", "Gerações", "Créditos cobrados", "Custo estimado"]}>
          {data.topModels.map((m) => (
            <tr key={m.modelId} className="border-t border-white/10">
              <td className="px-4 py-3">{m.modelId}</td>
              <td className="px-4 py-3 text-white/60">{m.kind}</td>
              <td className="px-4 py-3 tabular-nums">{num(m.n)}</td>
              <td className="px-4 py-3 tabular-nums">{num(m.credits, 1)}</td>
              <td className="px-4 py-3 tabular-nums">{usd(m.costUsd)}</td>
            </tr>
          ))}
          {data.topModels.length === 0 && <Empty cols={5}>Nenhuma geração concluída no período.</Empty>}
        </Table>
      </div>
    </div>
  );
}

/* --------------------------------- users ---------------------------------- */

interface AdminUser {
  id: string;
  email: string | null;
  handle: string;
  name: string;
  isGuest: boolean;
  plan: string;
  suspended: boolean;
  isAdmin: boolean;
  createdAt: number;
  balance: number;
}

const FILTERS = [
  ["all", "Todos"],
  ["members", "Membros"],
  ["guests", "Visitantes"],
  ["paid", "Planos pagos"],
  ["suspended", "Suspensos"],
] as const;

function UsersTab() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const key = `/api/admin/users?q=${encodeURIComponent(applied)}&filter=${filter}&limit=100`;
  const { data, error } = useSWR<{ users: AdminUser[] }>(key, fetcher);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
          className="flex gap-2"
        >
          <input className={`${input} w-72`} placeholder="Buscar por e-mail, usuário ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className={btn}>Buscar</button>
        </form>
        <div className="flex gap-1">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`rounded-lg px-3 py-1.5 ${filter === id ? "bg-white/15" : "text-white/60 hover:bg-white/10"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <Failed error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Table heads={["Conta", "Plano", "Créditos", "Cadastro", ""]}>
          {data.users.map((u) => (
            <tr key={u.id} className="border-t border-white/10">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {u.isGuest ? "Visitante" : u.email}
                  {u.isAdmin && <Tag tone="amber">admin</Tag>}
                  {u.suspended && <Tag tone="red">suspenso</Tag>}
                </div>
                <div className="text-xs text-white/40">
                  @{u.handle} · {u.name}
                </div>
              </td>
              <td className="px-4 py-3">{u.plan}</td>
              <td className="px-4 py-3 tabular-nums">{credits(u.balance)}</td>
              <td className="px-4 py-3 text-white/60">{when(u.createdAt)}</td>
              <td className="px-4 py-3 text-right">
                <button className={ghost} onClick={() => setOpen(u.id)}>
                  Gerenciar
                </button>
              </td>
            </tr>
          ))}
          {data.users.length === 0 && <Empty cols={5}>Nenhuma conta encontrada.</Empty>}
        </Table>
      )}
      {open && <UserModal id={open} onClose={() => setOpen(null)} refresh={() => mutate(key)} />}
    </div>
  );
}

interface UserDetail {
  user: AdminUser & { suspendedReason: string };
  totals: { jobs: number; done: number; spentCredits: number; costUsd: number };
  subscription: { planId: string; interval: string; status: string; periodEnd: number } | null;
  jobs: { id: string; kind: string; modelId: string; status: string; prompt: string; cost: number; estUsd: number; createdAt: number }[];
  ledger: { id: number; kind: string; amount: number; note: string | null; createdAt: number }[];
}

function UserModal({ id, onClose, refresh }: { id: string; onClose: () => void; refresh: () => void }) {
  const dkey = `/api/admin/users/${id}`;
  const { data, error } = useSWR<UserDetail>(dkey, fetcher);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/action", { method: "POST", body });
      setAmount("");
      setNote("");
      await mutate(dkey);
      mutate("/api/admin/audit?limit=100");
      refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Gerenciar conta" onClose={onClose}>
      {error && <Failed error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div>
            <div className="text-base">{data.user.isGuest ? "Visitante" : data.user.email}</div>
            <div className="text-white/50">
              @{data.user.handle} · plano {data.user.plan} · saldo <b className="text-white">{credits(data.user.balance)}</b> créditos
            </div>
            <div className="text-white/50">
              {num(data.totals.jobs)} gerações ({num(data.totals.done)} ok) · {num(data.totals.spentCredits, 1)} créditos gastos · custo {usd(data.totals.costUsd)}
            </div>
            {data.subscription && (
              <div className="text-white/50">
                Assinatura: {data.subscription.planId} ({data.subscription.interval}), {data.subscription.status}, até {when(data.subscription.periodEnd)}
              </div>
            )}
          </div>

          <form
            className="space-y-2 rounded-xl border border-white/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              act({ action: "credits.adjust", userId: id, credits: Number(amount), note });
            }}
          >
            <div className="font-medium">Ajustar créditos</div>
            <div className="flex gap-2">
              <input className={`${input} w-40`} type="number" step="any" placeholder="Ex.: 50 ou -20" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className={`${input} min-w-0 flex-1`} placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className={btn} disabled={busy || !amount}>
                Aplicar
              </button>
            </div>
          </form>

          <PlanAssign userId={id} current={data.user.plan} disabled={data.user.isGuest} onDone={() => { mutate(dkey); mutate("/api/admin/audit?limit=100"); refresh(); }} />

          {!data.user.isAdmin && (
            <div className="space-y-2 rounded-xl border border-white/10 p-3">
              <div className="font-medium">{data.user.suspended ? "Conta suspensa" : "Suspender conta"}</div>
              {data.user.suspended ? (
                <>
                  <p className="text-white/50">Motivo: {data.user.suspendedReason || "não informado"}</p>
                  <button className={ghost} disabled={busy} onClick={() => act({ action: "user.suspend", userId: id, suspended: false })}>
                    Reativar conta
                  </button>
                </>
              ) : (
                <div className="flex gap-2">
                  <input className={`${input} min-w-0 flex-1`} placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button
                    className="rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => act({ action: "user.suspend", userId: id, suspended: true, reason })}
                  >
                    Suspender
                  </button>
                </div>
              )}
              <p className="text-xs text-white/40">Ao suspender, a pessoa é desconectada e não consegue entrar de novo.</p>
            </div>
          )}
          {err && <p className="text-red-400">{err}</p>}

          <div>
            <div className="mb-1 font-medium">Últimas gerações</div>
            <ul className="space-y-1 text-white/70">
              {data.jobs.map((j) => (
                <li key={j.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {j.modelId} · {j.status} · {j.prompt.slice(0, 50)}
                  </span>
                  <span className="shrink-0 text-white/40">{credits(j.cost)} cr</span>
                </li>
              ))}
              {data.jobs.length === 0 && <li className="text-white/40">Nenhuma.</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium">Movimentação de créditos</div>
            <ul className="space-y-1 text-white/70">
              {data.ledger.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {l.kind} · {l.note ?? ""}
                  </span>
                  <span className={`shrink-0 tabular-nums ${l.amount < 0 ? "text-red-300" : "text-emerald-300"}`}>{credits(l.amount)}</span>
                </li>
              ))}
              {data.ledger.length === 0 && <li className="text-white/40">Nenhuma.</li>}
            </ul>
          </div>
        </>
      )}
    </Modal>
  );
}


function PlanAssign({ userId, current, disabled, onDone }: { userId: string; current: string; disabled: boolean; onDone: () => void }) {
  const { data } = useSWR<{ plans: AdminPlan[] }>("/api/admin/data?section=plans", fetcher);
  const [planId, setPlanId] = useState(current);
  const [months, setMonths] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function apply() {
    setBusy(true);
    setMsg("");
    try {
      await api("/api/admin/action", { method: "POST", body: { action: "user.plan", userId, planId, months: Number(months) } });
      setMsg("Plano aplicado.");
      onDone();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <div className="font-medium">Plano da conta</div>
      {disabled ? (
        <p className="text-white/50">Visitantes não têm plano. A pessoa precisa criar uma conta.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${input} w-40`} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {(data?.plans ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.priceUsd ? `(US$ ${p.priceUsd})` : ""}
                </option>
              ))}
            </select>
            {planId !== "free" && (
              <label className="flex items-center gap-2 text-white/60">
                por
                <input className={`${input} w-20`} type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} />
                mês(es)
              </label>
            )}
            <button className={btn} disabled={busy || planId === current && planId === "free"} onClick={apply}>
              Aplicar plano
            </button>
          </div>
          <p className="text-xs text-white/40">Concede o plano e os créditos do mês sem cobrança (cortesia ou venda manual). Ele termina sozinho no fim do período. Escolher Free encerra o plano.</p>
          {msg && <p className={msg === "Plano aplicado." ? "text-emerald-400" : "text-red-400"}>{msg}</p>}
        </>
      )}
    </div>
  );
}

/* ---------------------------------- jobs ---------------------------------- */

interface AdminJob {
  id: string;
  kind: string;
  modelId: string;
  status: string;
  prompt: string;
  cost: number;
  estUsd: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  email: string | null;
  handle: string;
}

const JOB_FILTERS: [string, string][] = [
  ["all", "Todas"],
  ["succeeded", "Concluídas"],
  ["failed", "Falhas"],
  ["running", "Rodando"],
  ["queued", "Na fila"],
];

function JobsTab() {
  const [status, setStatus] = useState("all");
  const { data, error } = useSWR<{ jobs: AdminJob[] }>(`/api/admin/jobs?limit=100&status=${status}`, fetcher, { refreshInterval: 5000 });
  const tone: Record<string, "green" | "red" | "amber" | "gray"> = { succeeded: "green", failed: "red", running: "amber", queued: "gray" };
  const names: Record<string, string> = { succeeded: "concluída", failed: "falhou", running: "rodando", queued: "na fila", canceled: "cancelada" };
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {JOB_FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setStatus(id)} className={`rounded-lg px-3 py-1.5 ${status === id ? "bg-white/15" : "text-white/60 hover:bg-white/10"}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <Failed error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Table heads={["Quando", "Quem", "Modelo", "Status", "Cobrado", "Custo est.", "Prompt / erro"]}>
          {data.jobs.map((j) => (
            <tr key={j.id} className="border-t border-white/10 align-top">
              <td className="whitespace-nowrap px-4 py-3 text-white/60">{when(j.createdAt)}</td>
              <td className="px-4 py-3">{j.email ?? `@${j.handle}`}</td>
              <td className="px-4 py-3">
                {j.modelId}
                <div className="text-xs text-white/40">{j.kind}</div>
              </td>
              <td className="px-4 py-3">
                <Tag tone={tone[j.status] ?? "gray"}>{names[j.status] ?? j.status}</Tag>
              </td>
              <td className="px-4 py-3 tabular-nums">{credits(j.cost)}</td>
              <td className="px-4 py-3 tabular-nums">{usd(j.estUsd)}</td>
              <td className="max-w-xs px-4 py-3 text-white/70">
                <div className="line-clamp-2">{j.prompt}</div>
                {j.errorMessage && (
                  <div className="mt-1 text-xs text-red-400">
                    {j.errorCode}: {j.errorMessage}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {data.jobs.length === 0 && <Empty cols={7}>Nenhuma geração.</Empty>}
        </Table>
      )}
    </div>
  );
}

/* --------------------------------- plans ---------------------------------- */

interface AdminPlan {
  id: string;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
  concurrency: number;
  edited: boolean;
  members: number;
}

function PlansTab() {
  const { data, error } = useSWR<{ plans: AdminPlan[] }>("/api/admin/data?section=plans", fetcher);
  const [edit, setEdit] = useState<AdminPlan | null>(null);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <p className="text-white/50">
        Os preços dos planos são sempre em dólar. A alteração vale para novas assinaturas e para a página de preços; quem já assina mantém o período atual. Se algum número
        aparecer antigo em um menu do app, recarregue a página.
      </p>
      <Table heads={["Plano", "Preço / mês", "Créditos / mês", "Gerações simultâneas", "Membros", ""]}>
        {data.plans.map((p) => (
          <tr key={p.id} className="border-t border-white/10">
            <td className="px-4 py-3">
              {p.name} <span className="text-xs text-white/40">({p.id})</span> {p.edited && <Tag tone="amber">editado</Tag>}
            </td>
            <td className="px-4 py-3 tabular-nums">{usd(p.priceUsd)}</td>
            <td className="px-4 py-3 tabular-nums">{num(p.monthlyCredits)}</td>
            <td className="px-4 py-3 tabular-nums">{p.concurrency}</td>
            <td className="px-4 py-3 tabular-nums">{p.members}</td>
            <td className="px-4 py-3 text-right">
              <button className={ghost} onClick={() => setEdit(p)}>
                Editar
              </button>
            </td>
          </tr>
        ))}
      </Table>
      {edit && <PlanModal plan={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PlanModal({ plan, onClose }: { plan: AdminPlan; onClose: () => void }) {
  const [f, setF] = useState({ name: plan.name, priceUsd: String(plan.priceUsd), monthlyCredits: String(plan.monthlyCredits), concurrency: String(plan.concurrency) });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const field = (label: string, k: keyof typeof f, type = "text") => (
    <label className="block">
      <span className="mb-1 block text-white/60">{label}</span>
      <input className={`${input} w-full`} type={type} step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/action", { method: "POST", body: { action: "plan.update", planId: plan.id, ...f } });
      await mutate("/api/admin/data?section=plans");
      mutate("/api/admin/audit?limit=100");
      onClose();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Editar plano ${plan.name}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        {field("Nome", "name")}
        {field("Preço por mês (US$)", "priceUsd", "number")}
        {field("Créditos por mês", "monthlyCredits", "number")}
        {field("Gerações simultâneas", "concurrency", "number")}
        {err && <p className="text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghost} onClick={onClose}>
            Cancelar
          </button>
          <button className={btn} disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------- coupons --------------------------------- */

interface Coupon {
  code: string;
  credits: number;
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  active: number;
}

function CouponsTab() {
  const key = "/api/admin/data?section=coupons";
  const { data, error } = useSWR<{ coupons: Coupon[] }>(key, fetcher);
  const [f, setF] = useState({ code: "", credits: "", maxUses: "", expiresAt: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/action", { method: "POST", body });
      await mutate(key);
      mutate("/api/admin/audit?limit=100");
      return true;
    } catch (e) {
      setErr(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (await post({ action: "coupon.create", ...f })) setF({ code: "", credits: "", maxUses: "", expiresAt: "" });
  }
  return (
    <div className="space-y-4">
      <p className="text-white/50">
        Cupons de créditos grátis: quem resgata o código ganha os créditos, uma vez por conta. Cupons de desconto em % nos planos ficam para quando o pagamento (Stripe) estiver
        ligado.
      </p>
      <form onSubmit={create} className={`${card} flex flex-wrap items-end gap-2`}>
        <label>
          <span className="mb-1 block text-white/60">Código</span>
          <input className={`${input} w-40 uppercase`} placeholder="BEMVINDO50" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-white/60">Créditos</span>
          <input className={`${input} w-28`} type="number" step="any" value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-white/60">Limite de usos</span>
          <input className={`${input} w-32`} type="number" placeholder="sem limite" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />
        </label>
        <label>
          <span className="mb-1 block text-white/60">Validade</span>
          <input className={`${input} w-40`} type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        </label>
        <button className={btn} disabled={busy || !f.code || !f.credits}>
          Criar cupom
        </button>
      </form>
      {err && <p className="text-red-400">{err}</p>}
      {error && <Failed error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Table heads={["Código", "Créditos", "Usos", "Validade", "Status", ""]}>
          {data.coupons.map((c) => {
            const expired = c.expiresAt !== null && c.expiresAt <= now;
            const used = c.maxUses !== null && c.uses >= c.maxUses;
            return (
              <tr key={c.code} className="border-t border-white/10">
                <td className="px-4 py-3 font-mono">{c.code}</td>
                <td className="px-4 py-3 tabular-nums">{num(c.credits, 1)}</td>
                <td className="px-4 py-3 tabular-nums">
                  {c.uses}
                  {c.maxUses !== null ? ` / ${c.maxUses}` : ""}
                </td>
                <td className="px-4 py-3 text-white/60">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("pt-BR") : "sem validade"}</td>
                <td className="px-4 py-3">
                  {!c.active ? <Tag>desativado</Tag> : expired ? <Tag tone="red">expirado</Tag> : used ? <Tag tone="amber">esgotado</Tag> : <Tag tone="green">ativo</Tag>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button className={ghost} disabled={busy} onClick={() => post({ action: "coupon.toggle", code: c.code, active: !c.active })}>
                    {c.active ? "Desativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            );
          })}
          {data.coupons.length === 0 && <Empty cols={6}>Nenhum cupom criado.</Empty>}
        </Table>
      )}
    </div>
  );
}

/* -------------------------------- reports --------------------------------- */

interface Report {
  id: string;
  status: string;
  reason: string;
  note: string;
  createdAt: number;
  postId: string;
  title: string | null;
  kind: string | null;
  assetId: string | null;
  ownerHandle: string | null;
  reporterHandle: string | null;
}

const REPORT_FILTERS: [string, string][] = [
  ["open", "Abertas"],
  ["dismissed", "Dispensadas"],
  ["all", "Todas"],
];

function ReportsTab() {
  const [status, setStatus] = useState("open");
  const key = `/api/admin/data?section=reports&status=${status}`;
  const { data, error } = useSWR<{ reports: Report[] }>(key, fetcher);
  const [err, setErr] = useState("");
  async function decide(reportId: string, decision: "dismiss" | "remove") {
    if (decision === "remove" && !confirm("Remover este post da comunidade? O arquivo volta a ser privado.")) return;
    setErr("");
    try {
      await api("/api/admin/action", { method: "POST", body: { action: "report.resolve", reportId, decision } });
      await mutate(key);
      mutate("/api/admin/audit?limit=100");
    } catch (e) {
      setErr(errorMessage(e));
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {REPORT_FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setStatus(id)} className={`rounded-lg px-3 py-1.5 ${status === id ? "bg-white/15" : "text-white/60 hover:bg-white/10"}`}>
            {label}
          </button>
        ))}
      </div>
      {err && <p className="text-red-400">{err}</p>}
      {error && <Failed error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Table heads={["Post", "Autor", "Motivo", "Denunciado por", "Quando", ""]}>
          {data.reports.map((r) => (
            <tr key={r.id} className="border-t border-white/10 align-top">
              <td className="px-4 py-3">
                {r.assetId && r.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/assets/${r.assetId}/file`} alt="" className="mb-1 h-16 w-16 rounded object-cover" />
                ) : null}
                <Link className="underline" href={`/community/post/${r.postId}`} target="_blank">
                  {r.title || "(sem título)"}
                </Link>
                <div className="text-xs text-white/40">{r.kind}</div>
              </td>
              <td className="px-4 py-3">@{r.ownerHandle ?? "?"}</td>
              <td className="max-w-xs px-4 py-3">
                {r.reason}
                {r.note && <div className="text-xs text-white/50">{r.note}</div>}
              </td>
              <td className="px-4 py-3">@{r.reporterHandle ?? "?"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-white/60">{when(r.createdAt)}</td>
              <td className="px-4 py-3 text-right">
                {r.status === "open" ? (
                  <div className="flex justify-end gap-2">
                    <button className={ghost} onClick={() => decide(r.id, "dismiss")}>
                      Dispensar
                    </button>
                    <button className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium hover:bg-red-400" onClick={() => decide(r.id, "remove")}>
                      Remover post
                    </button>
                  </div>
                ) : (
                  <Tag>{r.status === "dismissed" ? "dispensada" : r.status}</Tag>
                )}
              </td>
            </tr>
          ))}
          {data.reports.length === 0 && <Empty cols={6}>Nenhuma denúncia.</Empty>}
        </Table>
      )}
    </div>
  );
}

/* --------------------------------- models --------------------------------- */

interface AdminModel {
  id: string;
  name: string;
  vendor: string;
  kind: string;
  surfaces: string[];
  badges: string[];
  provider: string;
  status: string;
  enabled: boolean;
}

const KIND_LABEL: Record<string, string> = { image: "Imagem", video: "Vídeo", audio: "Voz e áudio", music: "Música" };

function ModelsTab() {
  const key = "/api/admin/data?section=models";
  const { data, error } = useSWR<{ models: AdminModel[] }>(key, fetcher);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  async function toggle(m: AdminModel) {
    setBusy(m.id);
    setErr("");
    try {
      await api("/api/admin/action", { method: "POST", body: { action: "model.toggle", modelId: m.id, enabled: !m.enabled } });
      await mutate(key);
      mutate("/api/admin/audit?limit=100");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  const kinds = ["image", "video", "audio", "music"];
  return (
    <div className="space-y-6">
      <p className="text-white/50">
        Escolha quais modelos os clientes podem usar em cada tipo de recurso. Um modelo desligado aparece como indisponível nos estúdios e o servidor recusa pedidos para ele. Desligue
        os que o seu provedor ainda não atende.
      </p>
      {err && <p className="text-red-400">{err}</p>}
      {kinds.map((k) => {
        const list = data.models.filter((m) => m.kind === k);
        const on = list.filter((m) => m.enabled).length;
        return (
          <div key={k}>
            <h2 className="mb-2 text-base font-semibold">
              {KIND_LABEL[k]} <span className="text-sm font-normal text-white/40">{on} de {list.length} ligados</span>
            </h2>
            <Table heads={["Modelo", "Fabricante", "Provedor", "Situação", ""]}>
              {list.map((m) => (
                <tr key={m.id} className="border-t border-white/10">
                  <td className="px-4 py-3">
                    {m.name} <span className="text-xs text-white/40">({m.id})</span>
                  </td>
                  <td className="px-4 py-3 text-white/60">{m.vendor}</td>
                  <td className="px-4 py-3 text-white/60">{m.provider === "kie" ? "kie.ai" : "Treg"}</td>
                  <td className="px-4 py-3">
                    {!m.enabled ? <Tag tone="red">desligado</Tag> : m.status === "available" ? <Tag tone="green">disponível</Tag> : <Tag tone="amber">{m.status === "soon" ? "em breve" : "fora do ar"}</Tag>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className={ghost} disabled={busy === m.id} onClick={() => toggle(m)}>
                      {m.enabled ? "Desligar" : "Ligar"}
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- settings -------------------------------- */

interface SecretStatus {
  name: string;
  label: string;
  connected: boolean;
  set: boolean;
  source: "panel" | "env" | "none";
  last4: string;
}
interface KieAccount {
  configured: boolean;
  credits: number | null;
  usd: number | null;
  error: string;
}
interface SystemInfo {
  kie: KieAccount;
  mode: string;
  modeSetting: string;
  secrets: SecretStatus[];
  dailyBudgetUsd: number;
  agentMode: string;
  demoBilling: string;
  cookieSecure: boolean;
  origin: string;
  admins: string[];
  creditUsd: number;
  marginPct: number;
  usdBrl: number;
  dataDir: string;
  dbMegabytes: number;
  node: string;
  uptimeMinutes: number;
}

const SYSTEM_KEY = "/api/admin/data?section=system";

function SystemTab() {
  const { data, error } = useSWR<SystemInfo>(SYSTEM_KEY, fetcher);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  const row = (label: string, value: ReactNode, hint?: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-white/10 px-4 py-3 first:border-t-0">
      <div>
        <div>{label}</div>
        {hint && <div className="text-xs text-white/40">{hint}</div>}
      </div>
      <div className="text-right text-white/80">{value}</div>
    </div>
  );
  return (
    <div className="space-y-6">
      <KeysCard secrets={data.secrets} kie={data.kie} />
      <ModeAndPricing data={data} />
      <div>
        <h2 className="mb-2 text-base font-semibold">Estado do servidor</h2>
        <div className={`${card} p-0`}>
          {row("Agente de chat", data.agentMode, "AGENT_MODE no .env.local")}
          {row("Recarga grátis (demo)", data.demoBilling, "Deve ficar desligada em produção")}
          {row("Cookie seguro (HTTPS)", data.cookieSecure ? <Tag tone="green">sim</Tag> : <Tag tone="amber">não</Tag>, "COOKIE_SECURE=1 quando estiver em HTTPS")}
          {row("Endereço público", data.origin || "(não definido)", "PARALLAX_ORIGIN")}
          {row("Valor de 1 crédito", usd(data.creditUsd), "src/config/economy.ts")}
          {row("Administradores", data.admins.join(", ") || "(nenhum)", "ADMIN_EMAILS no .env.local")}
          {row("Banco de dados", `${num(data.dbMegabytes, 1)} MB`, data.dataDir)}
          {row("Servidor", `Node ${data.node} · no ar há ${num(data.uptimeMinutes)} min`)}
        </div>
      </div>
    </div>
  );
}

function KeysCard({ secrets, kie }: { secrets: SecretStatus[]; kie: KieAccount }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ name: string; text: string; ok: boolean } | null>(null);
  async function run(name: string, body: Record<string, unknown>, done: string) {
    setBusy(name);
    setMsg(null);
    try {
      await api("/api/admin/action", { method: "POST", body });
      setValues((v) => ({ ...v, [name]: "" }));
      await mutate(SYSTEM_KEY);
      mutate("/api/admin/audit?limit=100");
      setMsg({ name, text: done, ok: true });
    } catch (e) {
      setMsg({ name, text: errorMessage(e), ok: false });
    } finally {
      setBusy("");
    }
  }
  return (
    <div>
      <h2 className="mb-1 text-base font-semibold">Chaves de API</h2>
      <p className="mb-3 text-white/50">
        As chaves ficam criptografadas no banco e nunca são mostradas de volta (só os 4 últimos caracteres). Uma chave salva aqui vale mais que a do arquivo <code>.env.local</code>.
      </p>
      {kie.configured && (
        <div className={`${card} mb-3 flex flex-wrap items-center justify-between gap-2`}>
          <div>
            <div className="font-medium">Saldo no kie.ai</div>
            {kie.credits === null ? (
              <div className="text-red-400">{kie.error || "Não foi possível ler o saldo."}</div>
            ) : (
              <div className="text-white/70">
                <b className="text-white tabular-nums">{num(kie.credits, 1)}</b> créditos · <b className="text-white tabular-nums">{usd(kie.usd ?? 0)}</b>
              </div>
            )}
          </div>
          <button className={ghost} onClick={() => mutate(SYSTEM_KEY, fetcher(SYSTEM_KEY + "&refresh=1"), { revalidate: false })}>
            Atualizar / testar conexão
          </button>
        </div>
      )}
      <div className={`${card} space-y-4`}>
        {secrets.map((k) => (
          <div key={k.name} className="space-y-2 border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{k.label}</span>
              {k.set ? <Tag tone="green">definida {k.source === "env" ? "no .env.local" : "no painel"} · …{k.last4}</Tag> : <Tag tone="red">não definida</Tag>}
              {!k.connected && <Tag tone="amber">integração ainda não conectada</Tag>}
            </div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(k.name, { action: "secret.set", name: k.name, value: values[k.name] ?? "" }, "Chave salva.");
              }}
            >
              <input
                className={`${input} min-w-0 flex-1`}
                type="password"
                autoComplete="off"
                placeholder={k.set ? "Cole uma nova chave para substituir" : "Cole a chave aqui"}
                value={values[k.name] ?? ""}
                onChange={(e) => setValues({ ...values, [k.name]: e.target.value })}
              />
              <button className={btn} disabled={busy === k.name || !(values[k.name] ?? "").trim()}>
                Salvar
              </button>
              {k.source === "panel" && (
                <button type="button" className={ghost} disabled={busy === k.name} onClick={() => run(k.name, { action: "secret.clear", name: k.name }, "Chave removida.")}>
                  Remover
                </button>
              )}
            </form>
            {msg?.name === k.name && <p className={msg.ok ? "text-emerald-400" : "text-red-400"}>{msg.text}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ModeAndPricing({ data }: { data: SystemInfo }) {
  const [mode, setMode] = useState(data.modeSetting);
  const [margin, setMargin] = useState(String(data.marginPct));
  const [fx, setFx] = useState(String(data.usdBrl));
  const [budget, setBudget] = useState(String(data.dailyBudgetUsd));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/action", { method: "POST", body: { action: "settings.update", mode, marginPct: margin, usdBrl: fx, dailyBudgetUsd: budget } });
      await mutate(SYSTEM_KEY);
      mutate("/api/admin/audit?limit=100");
      mutate("/api/auth/me");
      setMsg({ text: "Configurações salvas.", ok: true });
    } catch (err) {
      setMsg({ text: errorMessage(err), ok: false });
    } finally {
      setBusy(false);
    }
  }
  const field = (label: string, hint: string, el: ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-white/70">{label}</span>
      {el}
      <span className="mt-1 block text-xs text-white/40">{hint}</span>
    </label>
  );
  return (
    <form onSubmit={save} className="space-y-3">
      <h2 className="text-base font-semibold">Modo e preços</h2>
      <div className={`${card} grid gap-4 sm:grid-cols-2`}>
        {field(
          "Modo de geração",
          `Agora: ${data.mode === "live" ? "real" : "teste"}. Real exige a chave do provedor e cobra de verdade.`,
          <select className={`${input} w-full`} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Automático (real se houver chave)</option>
            <option value="mock">Teste (arquivos de exemplo, sem custo)</option>
            <option value="live">Real (chama o provedor)</option>
          </select>,
        )}
        {field("Orçamento diário do provedor (US$)", "O app para de gastar quando atingir este valor em 24 horas.", <input className={`${input} w-full`} type="number" step="any" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />)}
        {field("Margem sobre o custo (%)", "40 significa preço = custo do provedor × 1,40. Vale para todos os modelos.", <input className={`${input} w-full`} type="number" step="any" min={0} value={margin} onChange={(e) => setMargin(e.target.value)} />)}
        {field("Cotação do dólar (R$)", "Usada para mostrar os preços em reais. Os planos são sempre definidos em dólar.", <input className={`${input} w-full`} type="number" step="any" min={0} value={fx} onChange={(e) => setFx(e.target.value)} />)}
      </div>
      {msg && <p className={msg.ok ? "text-emerald-400" : "text-red-400"}>{msg.text}</p>}
      <button className={btn} disabled={busy}>
        Salvar configurações
      </button>
    </form>
  );
}

/* --------------------------------- audit ---------------------------------- */

function AuditTab() {
  const { data, error } = useSWR<{ entries: { id: number; admin: string; action: string; target: string | null; detail: string; createdAt: number }[] }>("/api/admin/audit?limit=100", fetcher);
  if (error) return <Failed error={error} />;
  if (!data) return <Loading />;
  return (
    <Table heads={["Quando", "Admin", "Ação", "Alvo", "Detalhe"]}>
      {data.entries.map((e) => (
        <tr key={e.id} className="border-t border-white/10 align-top">
          <td className="whitespace-nowrap px-4 py-3 text-white/60">{when(e.createdAt)}</td>
          <td className="px-4 py-3">{e.admin}</td>
          <td className="px-4 py-3">{e.action}</td>
          <td className="px-4 py-3 text-white/60">{e.target}</td>
          <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-white/60">{e.detail}</td>
        </tr>
      ))}
      {data.entries.length === 0 && <Empty cols={5}>Nada foi alterado ainda.</Empty>}
    </Table>
  );
}
