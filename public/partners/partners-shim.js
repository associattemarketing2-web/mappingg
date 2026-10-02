/*
 * partners-shim.js
 * ----------------
 * A self-contained, Supabase-shaped client for the Mappingg partners intake
 * app (admin panel + builder submit page). The original app was built against
 * @supabase/supabase-js; this shim exposes the exact subset of that API the
 * app uses, but talks ONLY to this project's own Next.js API (backed by
 * MongoDB). It assigns window.supabase so the untouched app code keeps working.
 *
 * Implements:
 *   supabase.createClient() -> { from, rpc, storage, functions, auth }
 *   .from(table).select/insert/update/upsert/delete + eq/in/order/limit/single
 *   .rpc(name, params)
 *   .storage.from(bucket).upload/download/createSignedUrl/getPublicUrl
 *   .functions.invoke(name, { body })
 *   .auth.signInWithPassword/signOut/getSession/getUser/onAuthStateChange
 *         resetPasswordForEmail/updateUser (graceful stubs)
 *
 * No Supabase service, SDK, key or network call is involved.
 */
(function () {
  'use strict';

  var DB = '/api/partners/db';
  var RPC = '/api/partners/rpc/';
  var FN = '/api/partners/fn/';
  var STORAGE = '/api/partners/storage';

  function tokenFromUrl() {
    try {
      var t = new URLSearchParams(location.search).get('t');
      return t || location.hash.replace(/^#t=/, '') || null;
    } catch (e) { return null; }
  }

  function jsonFetch(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (body) {
        return { data: body.data, error: body.error || null, status: res.status };
      }).catch(function () {
        return { data: null, error: { message: 'Bad server response' }, status: res.status };
      });
    }).catch(function (e) {
      return { data: null, error: { message: (e && e.message) || 'Network error' }, status: 0 };
    });
  }

  // ------------------------------------------------------------ query builder
  function Builder(table) {
    this._table = table;
    this._action = 'select';
    this._columns = '*';
    this._filters = [];
    this._order = null;
    this._limit = null;
    this._single = false;
    this._returning = false;
    this._values = null;
    this._ran = null;
  }
  Builder.prototype.select = function (cols) {
    if (['insert', 'update', 'upsert', 'delete'].indexOf(this._action) >= 0) {
      this._returning = true;
      if (cols) this._columns = cols;
    } else {
      this._action = 'select';
      this._columns = cols || '*';
    }
    return this;
  };
  Builder.prototype.insert = function (v) { this._action = 'insert'; this._values = v; return this; };
  Builder.prototype.update = function (v) { this._action = 'update'; this._values = v; return this; };
  Builder.prototype.upsert = function (v) { this._action = 'upsert'; this._values = v; return this; };
  Builder.prototype.delete = function () { this._action = 'delete'; return this; };
  Builder.prototype.eq = function (c, v) { this._filters.push({ op: 'eq', col: c, val: v }); return this; };
  Builder.prototype.in = function (c, v) { this._filters.push({ op: 'in', col: c, vals: v }); return this; };
  Builder.prototype.order = function (c, o) { this._order = { col: c, ascending: o ? o.ascending !== false : true }; return this; };
  Builder.prototype.limit = function (n) { this._limit = n; return this; };
  Builder.prototype.single = function () { this._single = true; return this; };
  Builder.prototype.maybeSingle = function () { this._single = true; return this; };

  Builder.prototype._exec = function () {
    if (this._ran) return this._ran;
    var op = { table: this._table, action: this._action };
    if (this._action === 'select' || this._returning) op.columns = this._columns;
    if (this._filters.length) op.filters = this._filters;
    if (this._order) op.order = this._order;
    if (this._limit != null) op.limit = this._limit;
    if (this._single) op.single = true;
    if (this._returning) op.returning = true;
    if (this._values != null) op.values = this._values;
    this._ran = jsonFetch(DB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(op)
    });
    return this._ran;
  };
  Builder.prototype.then = function (ok, bad) { return this._exec().then(ok, bad); };
  Builder.prototype.catch = function (bad) { return this._exec().catch(bad); };

  // ---------------------------------------------------------------- storage
  function StorageBucket(bucket) { this._bucket = bucket; }
  StorageBucket.prototype.upload = function (path, file, opts) {
    var fd = new FormData();
    fd.append('bucket', this._bucket);
    fd.append('path', path);
    fd.append('file', file);
    if (opts && opts.contentType) fd.append('contentType', opts.contentType);
    var tok = tokenFromUrl();
    var url = STORAGE + (tok ? '?t=' + encodeURIComponent(tok) : '');
    return jsonFetch(url, { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return { data: r.error ? null : { path: path }, error: r.error }; });
  };
  StorageBucket.prototype.download = function (path) {
    var url = STORAGE + '?bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path);
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) return { data: null, error: { message: 'Download failed (' + res.status + ')' } };
      return res.blob().then(function (blob) { return { data: blob, error: null }; });
    }).catch(function (e) { return { data: null, error: { message: (e && e.message) || 'Network error' } }; });
  };
  StorageBucket.prototype.createSignedUrl = function (path, _expiresIn) {
    var url = STORAGE + '?bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path);
    return Promise.resolve({ data: { signedUrl: url }, error: null });
  };
  StorageBucket.prototype.getPublicUrl = function (path) {
    var url = STORAGE + '?bucket=' + encodeURIComponent(this._bucket) + '&path=' + encodeURIComponent(path) + '&public=1';
    return { data: { publicUrl: url } };
  };

  // ---------------------------------------------------------------- auth
  function Auth() { this._cbs = []; this._session = null; this._loaded = false; }
  Auth.prototype._emit = function (evt) {
    var self = this;
    this._cbs.forEach(function (cb) { try { cb(evt, self._session); } catch (e) {} });
  };
  Auth.prototype._refresh = function () {
    var self = this;
    return fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      // Only staff sessions count; buyer/developer/agent accounts are not intake admins.
      .then(function (b) {
        var s = (b && b.session) || null, r = s && s.user && s.user.role;
        self._session = (r === 'admin' || r === 'employee') ? s : null; self._loaded = true; return self._session;
      })
      .catch(function () { self._session = null; self._loaded = true; return null; });
  };
  Auth.prototype.signInWithPassword = function (creds) {
    var self = this;
    return fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ email: creds.email, password: creds.password })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.error) return { data: { user: null, session: null }, error: body.error || { message: 'Login failed' } };
        self._session = { user: body.user };
        self._emit('SIGNED_IN');
        return { data: { user: body.user, session: self._session }, error: null };
      });
    }).catch(function (e) { return { data: { user: null, session: null }, error: { message: (e && e.message) || 'Network error' } }; });
  };
  Auth.prototype.signOut = function () {
    var self = this;
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { self._session = null; self._emit('SIGNED_OUT'); return { error: null }; })
      .catch(function (e) { return { error: { message: (e && e.message) || 'Network error' } }; });
  };
  Auth.prototype.getSession = function () {
    var self = this;
    if (self._loaded) return Promise.resolve({ data: { session: self._session }, error: null });
    return self._refresh().then(function () { return { data: { session: self._session }, error: null }; });
  };
  Auth.prototype.getUser = function () {
    return this.getSession().then(function (r) {
      var s = r.data.session; return { data: { user: s ? s.user : null }, error: null };
    });
  };
  Auth.prototype.onAuthStateChange = function (cb) {
    var self = this;
    this._cbs.push(cb);
    this._refresh().then(function () { try { cb('INITIAL_SESSION', self._session); } catch (e) {} });
    return { data: { subscription: { unsubscribe: function () {
      var i = self._cbs.indexOf(cb); if (i >= 0) self._cbs.splice(i, 1);
    } } } };
  };
  // Password recovery is not wired to email in this build. Fail gracefully so
  // the "Forgot password?" button shows a helpful message instead of breaking.
  Auth.prototype.resetPasswordForEmail = function () {
    return Promise.resolve({ data: null, error: { message: 'Ask the Mappingg owner to reset your password from the admin panel.' } });
  };
  Auth.prototype.updateUser = function () {
    return Promise.resolve({ data: { user: null }, error: { message: 'Password changes are managed from the admin panel.' } });
  };

  // ---------------------------------------------------------------- client
  function Client() { this.auth = new Auth(); this.storage = { from: function (b) { return new StorageBucket(b); } }; }
  Client.prototype.from = function (t) { return new Builder(t); };
  Client.prototype.rpc = function (name, params) {
    return jsonFetch(RPC + encodeURIComponent(name), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(params || {})
    }).then(function (r) { return { data: r.data, error: r.error }; });
  };
  Client.prototype.functions = {
    invoke: function (name, opts) {
      return jsonFetch(FN + encodeURIComponent(name), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify((opts && opts.body) || {})
      }).then(function (r) { return { data: r.data, error: r.error }; });
    }
  };

  window.supabase = { createClient: function () { return new Client(); } };
})();
