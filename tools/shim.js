/* Seller Network – bản web (GitHub Pages + Supabase).
 * Giả lập runtime claude.use(...) của Claude artifact để chạy nguyên code SN:
 *   db        → bảng public.sn_docs (Supabase, realtime + phân quyền RLS)
 *   mcp       → "Google Drive" qua Edge Function sn-drive → Apps Script chạy dưới tên chủ
 *   downloads → tải file bằng trình duyệt;  assets → Supabase Storage (bucket sn-assets)
 *   sample / permissions → không có (tính năng AI chỉ dùng trong bản Claude). */
(function () {
  "use strict";
  const SB_URL = "https://tmbkwlsjtcqkisyzqfzd.supabase.co";
  const SB_KEY = "sb_publishable_3vF6xPESJpa6s1c2nsV-HQ_KqQM16Iw";
  const sb = window.supabase.createClient(SB_URL, SB_KEY);
  window.__sb = sb;
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const err = (e, fb) => { const m = (e && (e.message || e.code)) || fb || "lỗi";
    const code = e && (e.code === "42501" || /row-level security|permission/i.test(m)) ? "permission_denied" : (e && e.code) || "unknown";
    const x = new Error(m); x.code = code; return x; };

  /* ---------- đăng nhập ---------- */
  function gate(html, btn) {
    let g = document.getElementById("snGate");
    if (!g) { g = document.createElement("div"); g.id = "snGate"; document.body.appendChild(g); }
    g.innerHTML = `<div class="sng-card"><div class="sng-logo">SN</div><h2>Seller Network</h2><p>${html}</p>${btn ? `<button id="snGBtn">${btn}</button>` : ""}</div>`;
    const b = document.getElementById("snGBtn");
    if (b) b.onclick = async () => { b.disabled = true; await sb.auth.signOut();
      sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } }); };
  }
  const style = document.createElement("style");
  style.textContent = `#snGate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#f6f7f9);padding:16px;font-family:inherit}
  .sng-card{max-width:380px;width:100%;text-align:center;background:var(--surface,#fff);border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:28px}
  .sng-logo{width:48px;height:48px;border-radius:12px;margin:0 auto 10px;display:grid;place-items:center;font-weight:700;color:#fff;background:var(--accent,#1f6feb)}
  .sng-card h2{margin:0 0 6px}.sng-card p{color:var(--muted,#6b7280);margin:0 0 16px}
  #snGBtn{width:100%;padding:11px;border:0;border-radius:10px;background:var(--accent,#1f6feb);color:#fff;font:inherit;font-weight:600;cursor:pointer}
  #snWho{font-size:11px;color:var(--muted);padding:4px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  body.sn-lim .snav[data-tab=staff],body.sn-lim .snav[data-tab=svc],body.sn-lim .snav[data-tab=svcpack],body.sn-lim .snav[data-tab=tree],body.sn-lim #setBtn{display:none!important}`;
  document.head.appendChild(style);

  let ME = null;
  const ready = (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { gate("Đăng nhập bằng Gmail đã được cấp quyền.", "Đăng nhập với Google"); return new Promise(() => {}); }
    const { data, error } = await sb.rpc("sn_whoami");
    if (error || !data || !data.level) {
      gate(`Gmail <b>${(session.user.email || "").replace(/</g, "&lt;")}</b> chưa được cấp quyền Seller Network. Nhờ admin thêm bạn ở mục Nhân sự.`, "Đăng nhập bằng Gmail khác");
      return new Promise(() => {});
    }
    ME = data; window.__snMe = data;
    if (data.level !== "admin") document.body.classList.add("sn-lim");
    const g = document.getElementById("snGate"); if (g) g.remove();
    const bottom = document.querySelector(".side-bottom");
    if (bottom) {
      const w = document.createElement("div"); w.id = "snWho"; w.title = data.email;
      w.textContent = data.email + " · " + ({ admin: "Admin", lead: "Trưởng nhóm", staff: "Nhân viên" }[data.level] || "");
      const out = document.createElement("button"); out.className = "snav"; out.title = "Đăng xuất";
      out.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg><span class="lbl">Đăng xuất</span>';
      out.onclick = async () => { await sb.auth.signOut(); location.reload(); };
      bottom.prepend(out); bottom.prepend(w);
    }
    return data;
  })();
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && ME) location.reload(); });

  /* ---------- db: kho tài liệu kiểu Firestore trên bảng sn_docs ---------- */
  const T = "sn_docs";
  const subs = {};   // coll → {rows:Map, listeners:Set, ch, loading}
  async function fetchColl(c) {
    const { data, error } = await sb.from(T).select("id,data").eq("coll", c);
    if (error) throw err(error);
    return data;
  }
  function emit(c) {
    const s = subs[c]; if (!s) return;
    const rows = [...s.rows.values()];
    s.listeners.forEach((l) => { try { l(rows); } catch (e) { console.error(e); } });
  }
  async function refresh(c) {
    const s = subs[c]; if (!s) return;
    try { const rows = await fetchColl(c); s.rows = new Map(rows.map((r) => [r.id, r])); s.ok = true; emit(c); }
    catch (e) { s.errs.forEach((f) => f(e)); }
  }
  const pend = {};
  function soon(c) { clearTimeout(pend[c]); pend[c] = setTimeout(() => refresh(c), 120); }
  function watch(c, l, onErr) {
    let s = subs[c];
    if (!s) {
      s = subs[c] = { rows: new Map(), listeners: new Set(), errs: new Set(), ok: false };
      s.ch = sb.channel("sn-" + c).on("postgres_changes", { event: "*", schema: "public", table: T, filter: "coll=eq." + c }, () => soon(c)).subscribe();
      refresh(c);
    } else if (s.ok) setTimeout(() => l([...s.rows.values()]), 0);
    s.listeners.add(l); if (onErr) s.errs.add(onErr);
    return () => { s.listeners.delete(l); if (onErr) s.errs.delete(onErr); };
  }
  setInterval(() => { if (!document.hidden) Object.keys(subs).forEach(soon); }, 60000); // phòng khi mất realtime
  document.addEventListener("visibilitychange", () => { if (!document.hidden) Object.keys(subs).forEach(soon); });

  const docSnap = (id, r) => ({ id, exists: !!r, data: () => (r ? clone(r.data) : undefined) });
  class Doc {
    constructor(c, id) { this.c = c; this.id = String(id); this.p = c + "/" + this.id; }
    async get() {
      const { data, error } = await sb.from(T).select("id,data").eq("path", this.p).maybeSingle();
      if (error) throw err(error); return docSnap(this.id, data);
    }
    async set(d) {
      const row = { path: this.p, coll: this.c, id: this.id, data: clone(d) || {}, updated_at: new Date().toISOString(), updated_by: ME && ME.email };
      const up = await sb.from(T).update({ data: row.data, updated_at: row.updated_at, updated_by: row.updated_by }).eq("path", this.p).select("path");
      if (up.error) throw err(up.error);
      if (!up.data || !up.data.length) { const ins = await sb.from(T).insert(row); if (ins.error) throw err(ins.error); }
      soon(this.c);
    }
    async update(patch) {
      const cur = await this.get();
      if (!cur.exists) { const e = new Error("Không tìm thấy tài liệu"); e.code = "not_found"; throw e; }
      const next = Object.assign(cur.data() || {}, clone(patch));
      Object.keys(next).forEach((k) => { if (next[k] && next[k].__delete__ === true) delete next[k]; });
      const { data, error } = await sb.from(T).update({ data: next, updated_at: new Date().toISOString(), updated_by: ME && ME.email }).eq("path", this.p).select("path");
      if (error) throw err(error);
      if (!data || !data.length) { const e = new Error("Không có quyền sửa"); e.code = "permission_denied"; throw e; }
      const s = subs[this.c]; if (s) { s.rows.set(this.id, { id: this.id, data: next }); emit(this.c); }
      soon(this.c);
    }
    async delete() {
      const { error } = await sb.from(T).delete().eq("path", this.p);
      if (error) throw err(error);
      const s = subs[this.c]; if (s) { s.rows.delete(this.id); emit(this.c); }
      soon(this.c);
    }
    onSnapshot(cb, onErr) {
      return watch(this.c, (rows) => cb(docSnap(this.id, rows.find((r) => r.id === this.id))), onErr);
    }
  }
  class Coll {
    constructor(c) { this.c = c; }
    doc(id) { return new Doc(this.c, id); }
    onSnapshot(cb, onErr) {
      return watch(this.c, (rows) => cb({ docs: rows.map((r) => docSnap(r.id, r)), size: rows.length, empty: !rows.length }), onErr);
    }
  }
  const db = { collection: (c) => new Coll(c), doc: (p) => { const i = p.lastIndexOf("/"); return new Doc(p.slice(0, i), p.slice(i + 1)); } };

  /* ---------- Google Drive qua Edge Function ---------- */
  const mcp = {
    async callTool(server, tool, args) {
      if (server !== "Google Drive") { const e = new Error("no_mcp"); e.code = "no_mcp"; throw e; }
      const { data: { session } } = await sb.auth.getSession();
      let r, j;
      try {
        r = await fetch(SB_URL + "/functions/v1/sn-drive", { method: "POST",
          headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session && session.access_token) },
          body: JSON.stringify({ tool, args: args || {} }) });
        j = await r.json();
      } catch (e) { const x = new Error("Không kết nối được Google Drive"); x.code = "tool_error"; throw x; }
      if (!j || !j.ok) { const x = new Error((j && j.message) || "Lỗi Google Drive"); x.code = (j && j.code) === "forbidden" ? "not_granted" : "tool_error";
        x.result = { content: [{ text: x.message }] }; throw x; }
      return { payload: j.payload };
    },
  };

  /* ---------- tải file & lưu ảnh ---------- */
  const dl = { async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename || "file";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } };
  const assets = { async upload(file) {
    const ext = ((file.name || "").match(/\.[a-z0-9]{1,5}$/i) || [""])[0].toLowerCase();
    const id = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Date.now())) + ext;
    const { error } = await sb.storage.from("sn-assets").upload(id, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw err(error, "Tải file lỗi");
    return { id, url: SB_URL + "/storage/v1/object/public/sn-assets/" + id };
  } };
  window.SN_BLOB = SB_URL + "/storage/v1/object/public/sn-assets/";

  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return db;
      if (name === "mcp") return mcp;
      if (name === "downloads") return dl;
      if (name === "assets") return assets;
      throw Object.assign(new Error("unavailable"), { code: "unavailable" });
    },
  };
})();
