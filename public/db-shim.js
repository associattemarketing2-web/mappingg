/*
 * db-shim.js  (formerly the Supabase client)
 * ------------------------------------------
 * The app no longer uses Supabase. This is a self-contained client that exposes
 * the exact subset of the old client API the original Mappingg pages call, but
 * talks ONLY to this app's own Next.js API (backed by MongoDB). It still assigns
 * window.supabase purely so the untouched legacy page code keeps working — there
 * is no Supabase service, SDK, key or network call involved.
 *
 * It implements:
 *   supabase.createClient(url, key) -> { from, rpc, channel, auth }
 *   .from(table).select/insert/update/delete/upsert + eq/in/order/limit/single
 *   .rpc(name, params)
 *   .channel(name).on('postgres_changes', {table}, cb).subscribe()  (polling)
 *   .auth.signInWithPassword / signOut / getSession / onAuthStateChange / getUser
 *
 * No Supabase service dependency remains at runtime.
 */
(function () {
  'use strict';

  var DB_ENDPOINT = '/api/db';

  function PostgrestBuilder(table) {
    this._table = table;
    this._action = 'select';
    this._columns = '*';
    this._filters = [];
    this._order = null;
    this._limit = null;
    this._single = false;
    this._returning = false;
    this._values = null;
    this._ran = null; // cached promise
  }

  PostgrestBuilder.prototype.select = function (cols) {
    if (this._action === 'insert' || this._action === 'update' ||
        this._action === 'upsert' || this._action === 'delete') {
      this._returning = true; // e.g. .insert({...}).select().single()
    } else {
      this._action = 'select';
      this._columns = cols || '*';
    }
    return this;
  };
  PostgrestBuilder.prototype.insert = function (values) {
    this._action = 'insert'; this._values = values; return this;
  };
  PostgrestBuilder.prototype.update = function (values) {
    this._action = 'update'; this._values = values; return this;
  };
  PostgrestBuilder.prototype.upsert = function (values) {
    this._action = 'upsert'; this._values = values; return this;
  };
  PostgrestBuilder.prototype.delete = function () {
    this._action = 'delete'; return this;
  };
  PostgrestBuilder.prototype.eq = function (col, val) {
    this._filters.push({ op: 'eq', col: col, val: val }); return this;
  };
  PostgrestBuilder.prototype.in = function (col, vals) {
    this._filters.push({ op: 'in', col: col, vals: vals }); return this;
  };
  PostgrestBuilder.prototype.order = function (col, opts) {
    this._order = { col: col, ascending: opts ? opts.ascending !== false : true };
    return this;
  };
  PostgrestBuilder.prototype.limit = function (n) { this._limit = n; return this; };
  PostgrestBuilder.prototype.single = function () { this._single = true; return this; };
  PostgrestBuilder.prototype.maybeSingle = function () { this._single = true; return this; };

  PostgrestBuilder.prototype._exec = function () {
    if (this._ran) return this._ran;
    var op = { table: this._table, action: this._action };
    if (this._action === 'select') op.columns = this._columns;
    if (this._filters.length) op.filters = this._filters;
    if (this._order) op.order = this._order;
    if (this._limit != null) op.limit = this._limit;
    if (this._single) op.single = true;
    if (this._returning) op.returning = true;
    if (this._values != null) op.values = this._values;

    // Reads go over GET so the browser/CDN can cache public data; writes use
    // POST. Both share the same op shape on the server.
    var request;
    if (op.action === 'select') {
      request = fetch(DB_ENDPOINT + '?op=' + encodeURIComponent(JSON.stringify(op)), {
        method: 'GET',
        credentials: 'same-origin',
      });
    } else {
      request = fetch(DB_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(op),
      });
    }
    this._ran = request.then(function (res) {
      return res.json().then(function (body) {
        return { data: body.data, error: body.error, status: res.status };
      });
    }).catch(function (e) {
      return { data: null, error: { message: (e && e.message) || 'Network error' }, status: 0 };
    });
    return this._ran;
  };

  // Make the builder awaitable (thenable), like PostgREST's builder.
  PostgrestBuilder.prototype.then = function (onFulfilled, onRejected) {
    return this._exec().then(onFulfilled, onRejected);
  };
  PostgrestBuilder.prototype.catch = function (onRejected) {
    return this._exec().catch(onRejected);
  };

  // ---- Realtime replacement via lightweight polling ----------------------
  function RealtimeChannel(name) {
    this._name = name;
    this._listeners = [];
    this._timer = null;
    this._sigs = {};
  }
  RealtimeChannel.prototype.on = function (_type, filter, cb) {
    this._listeners.push({ table: filter && filter.table, cb: cb });
    return this;
  };
  RealtimeChannel.prototype._signature = function (table) {
    return fetch(DB_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ table: table, action: 'select', columns: 'id,updated_at' }),
    }).then(function (r) { return r.json(); }).then(function (b) {
      var rows = (b && b.data) || [];
      var max = '';
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].updated_at && rows[i].updated_at > max) max = rows[i].updated_at;
      }
      return rows.length + ':' + max;
    }).catch(function () { return null; });
  };
  RealtimeChannel.prototype.subscribe = function (cb) {
    var self = this;
    // Prime signatures without firing, then poll for changes.
    self._listeners.forEach(function (l) {
      if (l.table) self._signature(l.table).then(function (sig) { self._sigs[l.table] = sig; });
    });
    self._timer = setInterval(function () {
      self._listeners.forEach(function (l) {
        if (!l.table) return;
        self._signature(l.table).then(function (sig) {
          if (sig != null && self._sigs[l.table] != null && sig !== self._sigs[l.table]) {
            self._sigs[l.table] = sig;
            try { l.cb({ eventType: 'CHANGE', new: {}, old: {} }); } catch (e) {}
          } else if (sig != null) {
            self._sigs[l.table] = sig;
          }
        });
      });
    }, 15000);
    if (typeof cb === 'function') cb('SUBSCRIBED');
    return self;
  };
  RealtimeChannel.prototype.unsubscribe = function () {
    if (this._timer) clearInterval(this._timer);
    return Promise.resolve({ error: null });
  };

  // ---- Auth replacement ---------------------------------------------------
  function AuthClient() {
    this._callbacks = [];
    this._session = null;
    this._loaded = false;
  }
  AuthClient.prototype._emit = function (event) {
    var self = this;
    this._callbacks.forEach(function (cb) {
      try { cb(event, self._session); } catch (e) {}
    });
  };
  AuthClient.prototype._refresh = function () {
    var self = this;
    return fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (b) {
        // Only staff sessions unlock admin mode; buyer/developer/agent accounts browse as visitors.
        var s = (b && b.session) ? b.session : null;
        var r = s && s.user && s.user.role;
        self._session = (r === 'admin' || r === 'employee') ? s : null;
        self._loaded = true;
        return self._session;
      })
      .catch(function () { self._session = null; self._loaded = true; return null; });
  };
  AuthClient.prototype.signInWithPassword = function (creds) {
    var self = this;
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.error) {
          return { data: { user: null, session: null }, error: body.error || { message: 'Login failed' } };
        }
        self._session = { user: body.user };
        self._emit('SIGNED_IN');
        return { data: { user: body.user, session: self._session }, error: null };
      });
    }).catch(function (e) {
      return { data: { user: null, session: null }, error: { message: (e && e.message) || 'Network error' } };
    });
  };
  AuthClient.prototype.signOut = function () {
    var self = this;
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () {
        self._session = null;
        self._emit('SIGNED_OUT');
        return { error: null };
      })
      .catch(function (e) { return { error: { message: (e && e.message) || 'Network error' } }; });
  };
  AuthClient.prototype.getSession = function () {
    var self = this;
    if (self._loaded) return Promise.resolve({ data: { session: self._session }, error: null });
    return self._refresh().then(function () {
      return { data: { session: self._session }, error: null };
    });
  };
  AuthClient.prototype.getUser = function () {
    var self = this;
    return self.getSession().then(function (r) {
      var session = r.data.session;
      return { data: { user: session ? session.user : null }, error: null };
    });
  };
  AuthClient.prototype.onAuthStateChange = function (cb) {
    var self = this;
    this._callbacks.push(cb);
    // Fire the initial session once known (mirrors Supabase INITIAL_SESSION).
    this._refresh().then(function () {
      try { cb('INITIAL_SESSION', self._session); } catch (e) {}
    });
    return {
      data: {
        subscription: {
          unsubscribe: function () {
            var i = self._callbacks.indexOf(cb);
            if (i >= 0) self._callbacks.splice(i, 1);
          },
        },
      },
    };
  };

  function SupabaseClient() {
    this.auth = new AuthClient();
  }
  SupabaseClient.prototype.from = function (table) { return new PostgrestBuilder(table); };
  SupabaseClient.prototype.channel = function (name) { return new RealtimeChannel(name); };
  SupabaseClient.prototype.rpc = function (name, params) {
    return fetch('/api/rpc/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(params || {}),
    }).then(function (res) {
      return res.json().then(function (body) {
        return { data: body.data, error: body.error };
      });
    }).catch(function (e) {
      return { data: null, error: { message: (e && e.message) || 'Network error' } };
    });
  };

  window.supabase = {
    createClient: function () { return new SupabaseClient(); },
  };
})();
