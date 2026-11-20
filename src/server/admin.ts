import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CREDIT_USD, MILLI, PLANS } from "@/config/economy";
import { SESSION_COOKIE, userFromToken, type User } from "./auth";
import { balance, grant } from "./credits";
import { all, applyPlanOverrides, get, run, tx } from "./db";
import { ApiError, badRequest, notFound } from "./errors";
import { sameOrigin } from "./origin";
import { tregMode } from "./treg";
import { ensureWorker } from "./worker";

/**
 * The admin panel. An admin is a signed-in member whose email is listed in ADMIN_EMAILS
 * (comma separated). Nothing else grants access. Every change is written to admin_audit_log.
 */

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const isAdminEmail = (email: string | null) => !!email && adminEmails().includes(email.toLowerCase());

export function isAdmin(user: User | null): boolean {
  if (!user || user.isGuest || !user.email) return false;
  return isAdminEmail(user.email);
}

interface AdminCtx<P> {
  req: NextRequest;
  admin: User;
  params: P;
}

/** Wraps an admin API route. A non-admin gets a plain 404, so the panel is not advertised. */
export function adminRoute<P = Record<string, never>>(handler: (ctx: AdminCtx<P>) => Promise<unknown> | unknown) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const jar = await cookies();
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        throw new ApiError(403, "forbidden", "Cross-site request refused.");
      }
      ensureWorker();
      const token = jar.get(SESSION_COOKIE)?.value;
      const user = token ? userFromToken(token) : null;
      if (!user || !isAdmin(user)) throw new ApiError(404, "not_found", "Not found.");
      const result = await handler({ req, admin: user, params: await context.params });
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      console.error("[admin] unexpected error:", err instanceof Error ? err.stack ?? err.message : err);
      return NextResponse.json({ error: { code: "server_error", message: "Something went wrong on our side." } }, { status: 500 });
    }
  };
}

export function audit(adminId: string, action: string, target: string | null, detail: Record<string, unknown>) {
  run("INSERT INTO admin_audit_log (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)", adminId, action, target, JSON.stringify(detail), Date.now());
}

/* --------------------------------- reads ---------------------------------- */

const DAY = 86_400_000;
const DAYS = 14;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const count = (sql: string, ...p: (string | number)[]) => get<{ n: number }>(sql, ...p)!.n;

export function overview() {
  const now = Date.now();
  const since = now - DAYS * DAY;

  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(dayKey(now - i * DAY));
  const series = new Map(days.map((d) => [d, { day: d, signups: 0, done: 0, failed: 0, chargedCredits: 0, costUsd: 0 }]));

  for (const r of all<{ d: string; n: number }>(
    "SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) n FROM users WHERE is_guest = 0 AND created_at > ? GROUP BY d",
    since,
  )) {
    const row = series.get(r.d);
    if (row) row.signups = r.n;
  }
  for (const r of all<{ d: string; status: string; n: number; cost: number; usd: number }>(
    "SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, status, COUNT(*) n, COALESCE(SUM(cost),0) cost, COALESCE(SUM(est_usd),0) usd FROM jobs WHERE created_at > ? AND status IN ('succeeded','failed') GROUP BY d, status",
    since,
  )) {
    const row = series.get(r.d);
    if (!row) continue;
    if (r.status === "succeeded") {
      row.done = r.n;
      row.chargedCredits = r.cost / MILLI;
      row.costUsd = r.usd;
    } else row.failed = r.n;
  }

  const topModels = all<{ modelId: string; kind: string; n: number; credits: number; costUsd: number }>(
    "SELECT model_id modelId, kind, COUNT(*) n, COALESCE(SUM(cost),0)/1000.0 credits, COALESCE(SUM(est_usd),0) costUsd FROM jobs WHERE status = 'succeeded' AND created_at > ? GROUP BY model_id, kind ORDER BY n DESC LIMIT 8",
    since,
  );
  const win = get<{ cost: number; usd: number; n: number }>(
    "SELECT COALESCE(SUM(cost),0) cost, COALESCE(SUM(est_usd),0) usd, COUNT(*) n FROM jobs WHERE status = 'succeeded' AND created_at > ?",
    since,
  )!;
  const revenueUsd = (win.cost / MILLI) * CREDIT_USD;
  const last24 = all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM jobs WHERE created_at > ? GROUP BY status", now - DAY);

  return {
    mode: tregMode(),
    windowDays: DAYS,
    totals: {
      members: count("SELECT COUNT(*) n FROM users WHERE is_guest = 0"),
      guests: count("SELECT COUNT(*) n FROM users WHERE is_guest = 1"),
      suspended: count("SELECT COUNT(*) n FROM users WHERE suspended = 1"),
      paidSubscriptions: count("SELECT COUNT(*) n FROM account_subscriptions WHERE status = 'active'"),
      generations: count("SELECT COUNT(*) n FROM jobs"),
      publicPosts: count("SELECT COUNT(*) n FROM community_posts"),
      openReports: count("SELECT COUNT(*) n FROM community_reports WHERE status = 'open'"),
      creditsOutstanding: get<{ t: number }>("SELECT COALESCE(SUM(amount),0) t FROM ledger")!.t / MILLI,
    },
    last24h: Object.fromEntries(last24.map((r) => [r.status, r.n])),
    window: {
      generations: win.n,
      revenueUsd,
      costUsd: win.usd,
      marginUsd: revenueUsd - win.usd,
      marginPct: revenueUsd > 0 ? ((revenueUsd - win.usd) / revenueUsd) * 100 : 0,
    },
    series: [...series.values()],
    topModels,
  };
}

interface UserListRow {
  id: string;
  email: string | null;
  handle: string;
  name: string;
  is_guest: number;
  plan: string;
  suspended: number;
  created_at: number;
}

export function listUsers(query: string, limit: number, filter = "all") {
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query) {
    where.push("(email LIKE ? OR handle LIKE ? OR name LIKE ?)");
    params.push(like, like, like);
  }
  if (filter === "members") where.push("is_guest = 0");
  if (filter === "guests") where.push("is_guest = 1");
  if (filter === "paid") where.push("plan <> 'free'");
  if (filter === "suspended") where.push("suspended = 1");
  const rows = all<UserListRow>(
    `SELECT id, email, handle, name, is_guest, plan, suspended, created_at FROM users ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`,
    ...params,
    limit,
  );
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    handle: u.handle,
    name: u.name,
    isGuest: u.is_guest === 1,
    plan: u.plan,
    suspended: u.suspended === 1,
    isAdmin: isAdminEmail(u.email),
    createdAt: u.created_at,
    balance: balance(u.id),
  }));
}

export function userDetail(id: string) {
  const u = get<UserListRow & { suspended_reason: string }>(
    "SELECT id, email, handle, name, is_guest, plan, suspended, suspended_reason, created_at FROM users WHERE id = ?",
    id,
  );
  if (!u) throw notFound("Essa conta não existe.");
  return {
    user: {
      id: u.id,
      email: u.email,
      handle: u.handle,
      name: u.name,
      isGuest: u.is_guest === 1,
      plan: u.plan,
      suspended: u.suspended === 1,
      suspendedReason: u.suspended_reason,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.created_at,
      balance: balance(u.id),
    },
    totals: get<{ jobs: number; done: number; spentCredits: number; costUsd: number }>(
      "SELECT COUNT(*) jobs, COALESCE(SUM(status='succeeded'),0) done, COALESCE(SUM(CASE WHEN status='succeeded' THEN cost END),0)/1000.0 spentCredits, COALESCE(SUM(CASE WHEN status='succeeded' THEN est_usd END),0) costUsd FROM jobs WHERE user_id = ?",
      id,
    ),
    subscription: get("SELECT plan_id planId, interval, status, period_end periodEnd FROM account_subscriptions WHERE user_id = ?", id) ?? null,
    jobs: all("SELECT id, kind, model_id modelId, status, prompt, cost, est_usd estUsd, created_at createdAt FROM jobs WHERE user_id = ? ORDER BY seq DESC LIMIT 10", id),
    ledger: all("SELECT id, kind, amount, note, created_at createdAt FROM ledger WHERE user_id = ? AND kind NOT IN ('hold','release') ORDER BY id DESC LIMIT 12", id),
  };
}

export function listJobs(limit: number, status = "all") {
  const filtered = status !== "all";
  return all<Record<string, unknown>>(
    `SELECT j.id, j.kind, j.model_id AS modelId, j.status, j.prompt, j.cost, j.est_usd AS estUsd,
            j.provider_cost_micro AS providerCostMicro, j.error_code AS errorCode, j.error_message AS errorMessage,
            j.created_at AS createdAt, j.finished_at AS finishedAt, u.email, u.handle
       FROM jobs j JOIN users u ON u.id = j.user_id ${filtered ? "WHERE j.status = ?" : ""} ORDER BY j.seq DESC LIMIT ?`,
    ...(filtered ? [status, limit] : [limit]),
  );
}

export function listAudit(limit: number) {
  return all<Record<string, unknown>>(
    "SELECT a.id, a.action, a.target, a.detail, a.created_at AS createdAt, COALESCE(u.email, a.admin_id) AS admin FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT ?",
    limit,
  );
}

export function listPlans() {
  const edited = new Set(all<{ plan_id: string }>("SELECT plan_id FROM admin_plan_overrides").map((r) => r.plan_id));
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    priceUsd: p.priceUsd,
    monthlyCredits: p.monthlyCredits,
    concurrency: p.concurrency,
    edited: edited.has(p.id),
    members: count("SELECT COUNT(*) n FROM users WHERE plan = ?", p.id),
  }));
}

export function listCoupons() {
  return all<Record<string, unknown>>(
    "SELECT code, credits/1000.0 AS credits, max_uses AS maxUses, uses, expires_at AS expiresAt, active, created_at AS createdAt FROM account_promo_codes ORDER BY created_at DESC LIMIT 200",
  );
}

export function listReports(status: string) {
  const filtered = status !== "all";
  return all<Record<string, unknown>>(
    `SELECT r.id, r.status, r.reason, r.note, r.created_at AS createdAt, r.post_id AS postId,
            p.title, p.description, p.kind, p.asset_id AS assetId, owner.handle AS ownerHandle, reporter.handle AS reporterHandle
       FROM community_reports r
       LEFT JOIN community_posts p ON p.id = r.post_id
       LEFT JOIN users owner ON owner.id = p.user_id
       LEFT JOIN users reporter ON reporter.id = r.reporter_id
       ${filtered ? "WHERE r.status = ?" : ""} ORDER BY r.created_at DESC LIMIT 100`,
    ...(filtered ? [status] : []),
  );
}

/* -------------------------------- changes --------------------------------- */

/** Adds (or, when negative, removes) whole credits on a member's balance. */
export function adjustCredits(adminId: string, userId: string, credits: unknown, note: unknown) {
  const amount = Number(credits);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000) throw badRequest("Informe um número de créditos entre -100000 e 100000.");
  const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
  return tx(() => {
    if (!get("SELECT 1 FROM users WHERE id = ?", userId)) throw notFound("Essa conta não existe.");
    grant(userId, "adjust", Math.round(amount * MILLI), text ? `Admin: ${text}` : "Admin adjustment");
    audit(adminId, "credits.adjust", userId, { credits: amount, note: text });
    return { balance: balance(userId) };
  });
}

export function setSuspended(adminId: string, userId: string, suspended: unknown, reason: unknown) {
  const u = get<{ email: string | null }>("SELECT email FROM users WHERE id = ?", userId);
  if (!u) throw notFound("Essa conta não existe.");
  if (userId === adminId || isAdminEmail(u.email)) throw badRequest("Uma conta de administrador não pode ser suspensa.");
  const on = suspended === true;
  const why = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
  tx(() => {
    run("UPDATE users SET suspended = ?, suspended_reason = ? WHERE id = ?", on ? 1 : 0, on ? why : "", userId);
    if (on) run("DELETE FROM sessions WHERE user_id = ?", userId);
    audit(adminId, on ? "user.suspend" : "user.unsuspend", userId, { reason: why });
  });
  return { suspended: on };
}

export function updatePlan(adminId: string, input: Record<string, unknown>) {
  const id = String(input.planId ?? "");
  if (!PLANS[id]) throw notFound("Esse plano não existe.");
  const name = String(input.name ?? "").trim().slice(0, 40);
  const priceUsd = Number(input.priceUsd);
  const monthlyCredits = Math.floor(Number(input.monthlyCredits));
  const concurrency = Math.floor(Number(input.concurrency));
  if (!name) throw badRequest("Informe o nome do plano.");
  if (!Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 10_000) throw badRequest("Preço inválido (0 a 10000).");
  if (!Number.isFinite(monthlyCredits) || monthlyCredits < 0 || monthlyCredits > 1_000_000) throw badRequest("Créditos mensais inválidos.");
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 100) throw badRequest("Gerações simultâneas deve ser de 1 a 100.");
  if (id === "free" && priceUsd !== 0) throw badRequest("O plano Free deve custar 0.");
  const before = { ...PLANS[id] };
  run(
    "INSERT INTO admin_plan_overrides (plan_id, name, price_usd, monthly_credits, concurrency, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(plan_id) DO UPDATE SET name = excluded.name, price_usd = excluded.price_usd, monthly_credits = excluded.monthly_credits, concurrency = excluded.concurrency, updated_at = excluded.updated_at",
    id,
    name,
    priceUsd,
    monthlyCredits,
    concurrency,
    Date.now(),
  );
  applyPlanOverrides();
  audit(adminId, "plan.update", id, { before, after: { name, priceUsd, monthlyCredits, concurrency } });
  return { ok: true };
}

export function createCoupon(adminId: string, input: Record<string, unknown>) {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) throw badRequest("O código deve ter de 3 a 40 caracteres: letras, números e hífen.");
  const credits = Number(input.credits);
  if (!Number.isFinite(credits) || credits <= 0 || credits > 100_000) throw badRequest("Informe os créditos do cupom (maior que 0).");
  const maxUses = input.maxUses === "" || input.maxUses == null ? null : Math.floor(Number(input.maxUses));
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) throw badRequest("Limite de usos inválido.");
  let expiresAt: number | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(`${String(input.expiresAt)}T23:59:59`).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw badRequest("A validade deve ser uma data futura.");
  }
  if (get("SELECT 1 FROM account_promo_codes WHERE code = ?", code)) throw new ApiError(409, "exists", "Já existe um cupom com esse código.");
  run(
    "INSERT INTO account_promo_codes (code, credits, max_uses, uses, expires_at, active, created_at) VALUES (?, ?, ?, 0, ?, 1, ?)",
    code,
    Math.round(credits * MILLI),
    maxUses,
    expiresAt,
    Date.now(),
  );
  audit(adminId, "coupon.create", code, { credits, maxUses, expiresAt });
  return { code };
}

export function toggleCoupon(adminId: string, codeRaw: unknown, active: unknown) {
  const code = String(codeRaw ?? "").toUpperCase();
  const r = run("UPDATE account_promo_codes SET active = ? WHERE code = ?", active === true ? 1 : 0, code);
  if (!r.changes) throw notFound("Cupom não encontrado.");
  audit(adminId, active === true ? "coupon.enable" : "coupon.disable", code, {});
  return { ok: true };
}

export function resolveReport(adminId: string, reportId: unknown, decision: unknown) {
  const r = get<{ id: string; post_id: string; asset_id: string | null }>(
    "SELECT r.id, r.post_id, p.asset_id FROM community_reports r LEFT JOIN community_posts p ON p.id = r.post_id WHERE r.id = ?",
    String(reportId ?? ""),
  );
  if (!r) throw notFound("Denúncia não encontrada.");
  tx(() => {
    if (decision === "remove") {
      // Unpublish: the file goes private and the post (with its reports) is removed.
      if (r.asset_id) run("UPDATE assets SET is_public = 0, published_at = NULL WHERE id = ?", r.asset_id);
      run("DELETE FROM community_posts WHERE id = ?", r.post_id);
      audit(adminId, "report.remove_post", r.post_id, { reportId: r.id });
    } else if (decision === "dismiss") {
      run("UPDATE community_reports SET status = 'dismissed' WHERE id = ?", r.id);
      audit(adminId, "report.dismiss", r.post_id, { reportId: r.id });
    } else throw badRequest("Decisão inválida.");
  });
  return { ok: true };
}
