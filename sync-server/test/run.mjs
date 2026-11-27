// Integration test: run against a local `wrangler dev` (default http://127.0.0.1:8787).
const BASE = process.env.SYNC_URL || "http://127.0.0.1:8787";
let pass = 0, failn = 0;
const post = async (op, body) => {
  const r = await fetch(`${BASE}/v1/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};
const ok = (cond, name, extra) => { if (cond) pass++; else { failn++; console.log("FAIL:", name, extra ?? ""); } };

const c = await post("create", { meta: "META", label: "owner-label" });
ok(c.ok && c.token && c.gid, "create");
const bad = await post("create", { meta: "", label: "x" });
ok(bad.status === 400, "create validates");

const inv = await post("invite", { token: c.token, role: "editor" });
ok(inv.ok && inv.secret, "invite");
ok((await post("invite", { token: "x".repeat(30), role: "editor" })).status === 401, "invite bad token");
ok((await post("invite", { token: c.token, role: "owner" })).status === 400, "invite bad role");

const j = await post("join", { gid: inv.gid, inviteId: inv.inviteId, secret: inv.secret, label: "wife" });
ok(j.ok && j.role === "editor" && j.meta === "META", "join", JSON.stringify(j));
ok((await post("join", { gid: inv.gid, inviteId: inv.inviteId, secret: inv.secret, label: "evil" })).status === 410, "invite single-use");
ok((await post("join", { gid: inv.gid, inviteId: inv.inviteId, secret: "wrongwrongwrong", label: "evil" })).status === 404, "wrong secret");

const inv2 = await post("invite", { token: c.token, role: "viewer" });
const v = await post("join", { gid: inv2.gid, inviteId: inv2.inviteId, secret: inv2.secret, label: "kid" });
ok(v.ok && v.role === "viewer", "viewer join");

// Pushes
let p = await post("push", { token: c.token, items: [
  { id: "proj1", kind: "project", payload: "P1" },
  { id: "bud1", kind: "budget", payload: "B1" } ] });
ok(p.ok && p.seq === 2 && p.rejected.length === 0, "owner pushes project/budget", JSON.stringify(p));
p = await post("push", { token: j.token, items: [
  { id: "tx1", kind: "tx", payload: "T1" },
  { id: "tx2", kind: "tx", payload: "T2" },
  { id: "proj2", kind: "project", payload: "NOPE" } ] });
ok(p.ok && p.seq === 4 && p.rejected.join() === "proj2", "editor tx ok, project rejected", JSON.stringify(p));
p = await post("push", { token: v.token, items: [{ id: "tx9", kind: "tx", payload: "T" }] });
ok(p.status === 403, "viewer cannot push");
p = await post("push", { token: c.token, items: [{ id: "tx1", kind: "tx", payload: "OWNER-EDIT" }] });
ok(p.ok && p.rejected.length === 0, "owner may edit others' tx");
p = await post("push", { token: j.token, items: [{ id: "tx1", kind: "tx", payload: "T1b" }] });
ok(p.ok && p.rejected.length === 0, "author edits own tx (even after owner edit)", JSON.stringify(p));

// second editor cannot overwrite wife's tx
const inv3 = await post("invite", { token: c.token, role: "editor" });
const e2 = await post("join", { gid: inv3.gid, inviteId: inv3.inviteId, secret: inv3.secret, label: "bro" });
p = await post("push", { token: e2.token, items: [{ id: "tx2", kind: "tx", payload: "HIJACK" }] });
ok(p.ok && p.rejected.join() === "tx2", "editor cannot overwrite another's tx", JSON.stringify(p));
p = await post("push", { token: e2.token, items: [{ id: "tx2", kind: "ms", payload: "X" }] });
ok(p.rejected.join() === "tx2", "kind change rejected");
p = await post("push", { token: e2.token, items: [{ id: "a", kind: "tx", payload: "1" }, { id: "a", kind: "tx", payload: "2" }] });
ok(p.status === 400, "duplicate ids rejected");
p = await post("push", { token: e2.token, items: [{ id: "a b", kind: "tx", payload: "1" }] });
ok(p.status === 400, "bad id rejected");
p = await post("push", { token: e2.token, items: [{ id: "big", kind: "tx", payload: "x".repeat(100 * 1024) }] });
ok(p.status === 400, "oversize payload rejected");

// Pull
let pl = await post("pull", { token: v.token, since: 0 });
ok(pl.ok && pl.role === "viewer" && pl.items.length >= 4, "viewer can pull", JSON.stringify(pl).slice(0, 200));
const seqs = pl.items.map((i) => i.seq);
ok(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), "seq strictly increasing", seqs.join());
ok(new Set(seqs).size === seqs.length, "seq unique");
const t1 = pl.items.find((i) => i.id === "tx1");
ok(t1.payload === "T1b" && t1.author === j.mid, "tx author preserved", JSON.stringify(t1));
ok(pl.members.length === 4, "members listed", String(pl.members.length));
const inc = await post("pull", { token: v.token, since: pl.cursor });
ok(inc.ok && inc.items.length === 0, "incremental pull empty");
await post("push", { token: j.token, items: [{ id: "tx2", kind: "tx", payload: "T2", deleted: true }] });
const inc2 = await post("pull", { token: v.token, since: pl.cursor });
ok(inc2.items.length === 1 && inc2.items[0].deleted === true, "tombstone syncs");

// Members
ok((await post("member", { token: j.token, member: v.mid, role: "revoke" })).status === 403, "editor cannot manage");
ok((await post("member", { token: c.token, member: v.mid, role: "editor" })).ok, "promote viewer");
p = await post("push", { token: v.token, items: [{ id: "tx5", kind: "tx", payload: "T" }] });
ok(p.ok, "promoted viewer can push");
ok((await post("member", { token: c.token, member: e2.mid, role: "revoke" })).ok, "revoke");
ok((await post("pull", { token: e2.token, since: 0 })).status === 401, "revoked member locked out");
ok((await post("leave", { token: j.token })).ok, "leave");
ok((await post("pull", { token: j.token, since: 0 })).status === 401, "left member locked out");
ok((await post("leave", { token: c.token })).status === 400, "owner cannot leave");

// Destroy
ok((await post("destroy", { token: v.token })).status === 403, "non-owner cannot destroy");
ok((await post("destroy", { token: c.token })).ok, "destroy");
ok((await post("pull", { token: c.token, since: 0 })).status === 401, "destroyed space gone");
ok((await post("nope", {})).status === 404, "unknown op");
const g = await fetch(`${BASE}/v1/pull`);
ok(g.status === 405, "GET rejected");

console.log(`${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
