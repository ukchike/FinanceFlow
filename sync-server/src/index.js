// FinanceFlow sync relay: a tiny Cloudflare Worker + D1 database.
//
// Privacy model: the phones encrypt everything (AES-GCM) with a group key that only travels inside
// invite codes. This server stores ciphertext plus the minimum metadata it needs to enforce
// permissions (item id, item kind, who wrote it, member roles). It cannot read amounts,
// descriptions, names or categories.
//
// Auth model: no accounts. Each member holds a random secret token; only its SHA-256 hash is stored.
// Joining needs a single-use invite (id + secret) created by the group's owner.

const enc = new TextEncoder();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...CORS,
    },
  });
const fail = (status, error, message) => json({ ok: false, error, message }, status);

const LIMITS = {
  body: 2 * 1024 * 1024,
  meta: 8 * 1024,
  label: 1024,
  payload: 96 * 1024,
  itemsPerPush: 200,
  pullPage: 400,
  members: 12,
  activeInvites: 20,
  inviteTtl: 7 * 24 * 3600 * 1000,
  groupsTotal: 5000,
  itemsPerGroup: 20000,
};
const KINDS_OWNER_ONLY = new Set(["meta", "project", "budget"]);
const KINDS_EDITOR = new Set(["ms", "commit", "tx"]);

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const isStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const isId = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v);

async function authenticate(env, token) {
  if (!isStr(token, 120) || token.length < 20) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT m.id AS mid, m.group_id AS gid, m.role AS role, g.deleted AS deleted " +
      "FROM members m JOIN groups g ON g.id = m.group_id WHERE m.token_hash = ? AND m.revoked = 0"
  )
    .bind(hash)
    .first();
  if (!row || row.deleted) return null;
  return row;
}

const handlers = {
  async create(env, body) {
    if (!isStr(body.meta, LIMITS.meta)) return fail(400, "bad_request", "meta is required");
    if (!isStr(body.label, LIMITS.label)) return fail(400, "bad_request", "label is required");
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM groups WHERE deleted = 0").first();
    if (total && total.n >= LIMITS.groupsTotal) return fail(503, "full", "This server has reached its group limit");
    const gid = crypto.randomUUID();
    const mid = crypto.randomUUID();
    const token = randomToken();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO groups (id, meta, created_at) VALUES (?, ?, ?)").bind(gid, body.meta, now),
      env.DB.prepare(
        "INSERT INTO members (id, group_id, token_hash, role, label, created_at) VALUES (?, ?, ?, 'owner', ?, ?)"
      ).bind(mid, gid, await sha256(token), body.label, now),
      env.DB.prepare("INSERT INTO counters (group_id, seq) VALUES (?, 0)").bind(gid),
    ]);
    return json({ ok: true, gid, mid, token });
  },

  async invite(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    if (me.role !== "owner") return fail(403, "forbidden", "Only the owner can invite people");
    if (body.role !== "editor" && body.role !== "viewer") return fail(400, "bad_request", "role must be editor or viewer");
    const now = Date.now();
    await env.DB.prepare("DELETE FROM invites WHERE group_id = ? AND (expires_at < ? OR used_by IS NOT NULL)").bind(me.gid, now).run();
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE group_id = ?").bind(me.gid).first();
    if (active.n >= LIMITS.activeInvites) return fail(429, "too_many_invites", "Too many open invites. Use or wait for the existing ones to expire.");
    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND revoked = 0").bind(me.gid).first();
    if (members.n >= LIMITS.members) return fail(409, "members_full", "This space is full");
    const inviteId = crypto.randomUUID();
    const secret = randomToken(24);
    const expiresAt = now + LIMITS.inviteTtl;
    await env.DB.prepare(
      "INSERT INTO invites (id, group_id, secret_hash, role, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(inviteId, me.gid, await sha256(secret), body.role, expiresAt, me.mid)
      .run();
    return json({ ok: true, gid: me.gid, inviteId, secret, expiresAt });
  },

  async join(env, body) {
    if (!isId(body.gid) || !isId(body.inviteId) || !isStr(body.secret, 120)) return fail(400, "bad_request", "Invalid invite");
    if (!isStr(body.label, LIMITS.label)) return fail(400, "bad_request", "label is required");
    const now = Date.now();
    const inv = await env.DB.prepare(
      "SELECT secret_hash, role, expires_at, used_by FROM invites WHERE id = ? AND group_id = ?"
    )
      .bind(body.inviteId, body.gid)
      .first();
    if (!inv || !safeEqual(inv.secret_hash, await sha256(body.secret))) return fail(404, "invalid_invite", "That invite isn't valid");
    if (inv.used_by) return fail(410, "invite_used", "That invite was already used");
    if (inv.expires_at < now) return fail(410, "invite_expired", "That invite has expired");
    const group = await env.DB.prepare("SELECT meta, deleted FROM groups WHERE id = ?").bind(body.gid).first();
    if (!group || group.deleted) return fail(404, "gone", "That space no longer exists");
    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND revoked = 0").bind(body.gid).first();
    if (members.n >= LIMITS.members) return fail(409, "members_full", "This space is full");
    const mid = crypto.randomUUID();
    const token = randomToken();
    // Single-use: only one request can flip used_by from NULL.
    const claim = await env.DB.prepare("UPDATE invites SET used_by = ? WHERE id = ? AND used_by IS NULL").bind(mid, body.inviteId).run();
    if (!claim.meta || claim.meta.changes !== 1) return fail(410, "invite_used", "That invite was already used");
    await env.DB.prepare(
      "INSERT INTO members (id, group_id, token_hash, role, label, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(mid, body.gid, await sha256(token), inv.role, body.label, now)
      .run();
    return json({ ok: true, mid, token, role: inv.role, meta: group.meta });
  },

  async push(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    if (me.role === "viewer") return fail(403, "forbidden", "Viewers can't change anything");
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > LIMITS.itemsPerPush) return fail(400, "bad_request", "items must be 1-200 entries");
    const clean = [];
    const seen = new Set();
    for (const it of items) {
      if (!it || !isId(it.id) || seen.has(it.id)) return fail(400, "bad_request", "Invalid or duplicate item id");
      if (!KINDS_OWNER_ONLY.has(it.kind) && !KINDS_EDITOR.has(it.kind)) return fail(400, "bad_request", "Unknown item kind");
      if (!isStr(it.payload, LIMITS.payload)) return fail(400, "bad_request", "Item payload is missing or too large");
      seen.add(it.id);
      clean.push({ id: it.id, kind: it.kind, payload: it.payload, deleted: it.deleted ? 1 : 0 });
    }
    // Load current authors to enforce "members only change their own entries".
    const existing = new Map();
    for (let i = 0; i < clean.length; i += 80) {
      const chunk = clean.slice(i, i + 80);
      const rows = await env.DB.prepare(
        `SELECT item_id, kind, author FROM items WHERE group_id = ? AND item_id IN (${chunk.map(() => "?").join(",")})`
      )
        .bind(me.gid, ...chunk.map((c) => c.id))
        .all();
      for (const r of rows.results || []) existing.set(r.item_id, r);
    }
    const allowed = [];
    const rejected = [];
    for (const it of clean) {
      const prev = existing.get(it.id);
      if (KINDS_OWNER_ONLY.has(it.kind) && me.role !== "owner") { rejected.push(it.id); continue; }
      if (prev && prev.kind !== it.kind) { rejected.push(it.id); continue; }
      if (it.kind === "tx" && prev && prev.author !== me.mid && me.role !== "owner") { rejected.push(it.id); continue; }
      allowed.push(it);
    }
    if (!allowed.length) return json({ ok: true, seq: null, rejected });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM items WHERE group_id = ?").bind(me.gid).first();
    if (count.n + allowed.length > LIMITS.itemsPerGroup) return fail(413, "space_full", "This space has reached its size limit");
    const n = allowed.length;
    // One transaction: bump the counter, then give each item its own consecutive seq derived from it.
    const stmts = [env.DB.prepare("UPDATE counters SET seq = seq + ? WHERE group_id = ?").bind(n, me.gid)];
    allowed.forEach((it, i) => {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO items (group_id, item_id, kind, payload, deleted, seq, author) " +
            "VALUES (?, ?, ?, ?, ?, (SELECT seq FROM counters WHERE group_id = ?) - ?, ?) " +
            "ON CONFLICT (group_id, item_id) DO UPDATE SET payload = excluded.payload, deleted = excluded.deleted, " +
            "seq = excluded.seq, author = CASE WHEN items.kind = 'tx' THEN items.author ELSE excluded.author END"
        ).bind(me.gid, it.id, it.kind, it.payload, it.deleted, me.gid, n - 1 - i, me.mid)
      );
    });
    await env.DB.batch(stmts);
    const row = await env.DB.prepare("SELECT seq FROM counters WHERE group_id = ?").bind(me.gid).first();
    return json({ ok: true, seq: row.seq, rejected });
  },

  async pull(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    const rows = await env.DB.prepare(
      "SELECT item_id, kind, payload, deleted, seq, author FROM items WHERE group_id = ? AND seq > ? ORDER BY seq LIMIT ?"
    )
      .bind(me.gid, since, LIMITS.pullPage)
      .all();
    const items = (rows.results || []).map((r) => ({ id: r.item_id, kind: r.kind, payload: r.payload, deleted: !!r.deleted, seq: r.seq, author: r.author }));
    const members = await env.DB.prepare("SELECT id, role, label, revoked FROM members WHERE group_id = ? ORDER BY created_at").bind(me.gid).all();
    const group = await env.DB.prepare("SELECT meta FROM groups WHERE id = ?").bind(me.gid).first();
    const counter = await env.DB.prepare("SELECT seq FROM counters WHERE group_id = ?").bind(me.gid).first();
    const cursor = items.length ? items[items.length - 1].seq : since;
    return json({
      ok: true,
      mid: me.mid,
      role: me.role,
      meta: group ? group.meta : "",
      items,
      cursor,
      more: items.length === LIMITS.pullPage,
      maxSeq: counter ? counter.seq : 0,
      members: (members.results || []).map((m) => ({ id: m.id, role: m.role, label: m.label, revoked: !!m.revoked })),
    });
  },

  async member(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    if (me.role !== "owner") return fail(403, "forbidden", "Only the owner can manage members");
    if (!isId(body.member) || body.member === me.mid) return fail(400, "bad_request", "Invalid member");
    const target = await env.DB.prepare("SELECT id FROM members WHERE id = ? AND group_id = ?").bind(body.member, me.gid).first();
    if (!target) return fail(404, "not_found", "No such member");
    if (body.role === "revoke") {
      await env.DB.prepare("UPDATE members SET revoked = 1 WHERE id = ?").bind(body.member).run();
    } else if (body.role === "editor" || body.role === "viewer") {
      await env.DB.prepare("UPDATE members SET role = ? WHERE id = ?").bind(body.role, body.member).run();
    } else return fail(400, "bad_request", "role must be editor, viewer or revoke");
    return json({ ok: true });
  },

  async leave(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    if (me.role === "owner") return fail(400, "owner_cannot_leave", "The owner can stop sharing instead");
    await env.DB.prepare("UPDATE members SET revoked = 1 WHERE id = ?").bind(me.mid).run();
    return json({ ok: true });
  },

  async destroy(env, body) {
    const me = await authenticate(env, body.token);
    if (!me) return fail(401, "unauthorized", "Not a member of this space");
    if (me.role !== "owner") return fail(403, "forbidden", "Only the owner can stop sharing");
    await env.DB.batch([
      env.DB.prepare("UPDATE groups SET deleted = 1, meta = '' WHERE id = ?").bind(me.gid),
      env.DB.prepare("DELETE FROM items WHERE group_id = ?").bind(me.gid),
      env.DB.prepare("DELETE FROM invites WHERE group_id = ?").bind(me.gid),
      env.DB.prepare("UPDATE members SET revoked = 1 WHERE group_id = ?").bind(me.gid),
    ]);
    return json({ ok: true });
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/v1/health")) {
      return json({ ok: true, service: "financeflow-sync", version: 1 });
    }
    if (request.method !== "POST") return fail(405, "method_not_allowed", "Use POST");
    const length = Number(request.headers.get("content-length") || 0);
    if (length > LIMITS.body) return fail(413, "too_large", "Request too large");
    let body;
    try {
      body = await request.json();
    } catch {
      return fail(400, "bad_json", "Body must be JSON");
    }
    if (!body || typeof body !== "object") return fail(400, "bad_json", "Body must be a JSON object");
    const op = url.pathname.replace(/^\/v1\//, "");
    const handler = Object.hasOwn(handlers, op) ? handlers[op] : null;
    if (!handler) return fail(404, "unknown_operation", "Unknown operation");
    try {
      return await handler(env, body);
    } catch (e) {
      console.error("sync error", op, e && e.message);
      return fail(500, "server_error", "Something went wrong on the server");
    }
  },
};
