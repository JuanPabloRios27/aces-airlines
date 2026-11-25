/*
 * mock.js · Back de mentiras para el MODO DEMO (base común)
 *
 * Imita las mismas rutas, validaciones y mensajes de las lambdas, pero guarda
 * todo en localStorage. Sirve para trabajar el front sin AWS y para la
 * presentación si algo falla en la nube.
 *
 * Datos demo:   SKY7Q2M4K / laura@demo.co     SKY3HW9PX / andres@demo.co
 * Clave agente: aces-agente-2026
 */
(function () {
  const CLAVE = "skycheck.mock.v1";
  const AGENT_KEY = "aces-agente-2026";
  const LIMITES = { cabina: 10, bodega: 23 };
  const MAXIMO = 32, CARGO_KG = 15000, MAX_MALETAS = 3;

  const ahora = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const id = (p) => p + Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

  function semilla() {
    const t1 = {
      id_ticket: "SKY7Q2M4K", id_propietario: "laura@demo.co", nombre: "Laura Pérez",
      documento: "1012345678", telefono: "+57 3001234567", vuelo: "AC204", origen: "BOG",
      destino: "MDE", fecha_vuelo: "2026-12-15T07:30", asiento: "12A", estado: "reservado",
      creado_en: ahora(), actualizado_en: ahora(),
    };
    const t2 = {
      id_ticket: "SKY3HW9PX", id_propietario: "andres@demo.co", nombre: "Andrés Rojas",
      documento: "80123456", telefono: "+57 3159876543", vuelo: "AC118", origen: "BOG",
      destino: "CTG", fecha_vuelo: "2026-12-20T14:10", asiento: "5C", estado: "reservado",
      creado_en: ahora(), actualizado_en: ahora(),
    };
    const m1 = {
      id_maleta: "MALR7K2PD", id_ticket: "SKY7Q2M4K", tipo: "bodega", peso_kg: 21, exceso_kg: 0,
      cargo_exceso: 0, descripcion: "Maleta azul con cinta naranja", estado: "pendiente", creado_en: ahora(),
    };
    const m2 = {
      id_maleta: "MALQ9W3TX", id_ticket: "SKY3HW9PX", tipo: "bodega", peso_kg: 25.5, exceso_kg: 2.5,
      cargo_exceso: 37500, descripcion: "Maleta negra rígida", estado: "pendiente", creado_en: ahora(),
    };
    return { tickets: { [t1.id_ticket]: t1, [t2.id_ticket]: t2 }, maletas: { [m1.id_maleta]: m1, [m2.id_maleta]: m2 }, auth: {} };
  }

  let db;
  const cargar = () => { try { db = JSON.parse(localStorage.getItem(CLAVE)); } catch { db = null; } if (!db) { db = semilla(); guardar(); } };
  const guardar = () => localStorage.setItem(CLAVE, JSON.stringify(db));

  class Err extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || {}; } }
  const r = (status, data) => ({ status, data: JSON.parse(JSON.stringify(data)) });

  // ----------------------------------------------------------- reglas
  function correoOk(c) {
    c = String(c || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) throw new Err(400, "El correo no es válido");
    return c;
  }
  function requeridos(o, ...campos) {
    const f = campos.filter((c) => o[c] == null || o[c] === "");
    if (f.length) throw new Err(400, "Faltan campos: " + f.join(", "));
  }
  function revisar(tipo, peso) {
    tipo = String(tipo || "").toLowerCase();
    if (!LIMITES[tipo]) throw new Err(400, "El tipo debe ser 'cabina' o 'bodega'");
    peso = Math.round(Number(peso) * 10) / 10;
    if (!(peso > 0)) throw new Err(400, "'peso_kg' debe ser mayor que cero");
    const limite = LIMITES[tipo];
    const exceso = Math.max(0, Math.round((peso - limite) * 10) / 10);
    const permitido = peso <= MAXIMO && !(tipo === "cabina" && exceso > 0);
    const cargo = tipo === "bodega" ? Math.round(exceso * CARGO_KG) : 0;
    let mensaje;
    if (peso > MAXIMO) mensaje = `Ninguna maleta puede superar ${MAXIMO} kg.`;
    else if (tipo === "cabina" && exceso > 0) mensaje = `El equipaje de cabina no puede superar ${limite} kg. Regístrala como bodega.`;
    else if (exceso > 0) mensaje = `Tiene ${exceso} kg de exceso. Cargo adicional: $${cargo.toLocaleString("es-CO")} COP.`;
    else mensaje = "La maleta cumple con el peso permitido.";
    return { tipo, peso_kg: peso, limite_kg: limite, exceso_kg: exceso, cargo_exceso: cargo, permitido, mensaje };
  }
  function ticketDe(idT, correo) {
    const t = db.tickets[String(idT || "").trim().toUpperCase()];
    if (!t || t.id_propietario !== correoOk(correo)) throw new Err(404, "No encontramos esa reserva");
    return t;
  }
  const maletasDe = (idT) => Object.values(db.maletas).filter((m) => m.id_ticket === idT).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  const vista = (t) => ({ ...t, maletas: maletasDe(t.id_ticket), pasabordo_url: null });
  const agente = (k) => { if (k !== AGENT_KEY) throw new Err(401, "Clave de agente inválida"); };
  const asientoOk = (a) => {
    a = String(a || "").trim().toUpperCase();
    if (!/^([1-9]|[12][0-9]|30)[A-F]$/.test(a)) throw new Err(400, "Asiento inválido (ej: 12A, filas 1-30, columnas A-F)");
    return a;
  };
  const ocupados = (vuelo, fecha, excepto) => new Set(Object.values(db.tickets)
    .filter((t) => t.vuelo === vuelo && t.fecha_vuelo === fecha && t.estado !== "cancelado" && t.id_ticket !== excepto)
    .map((t) => t.asiento));

  // ----------------------------------------------------------- rutas
  const rutas = [
    ["POST", /^\/maletas\/revisar$/, (p) => { requeridos(p.body, "tipo", "peso_kg"); return r(200, revisar(p.body.tipo, p.body.peso_kg)); }],

    ["POST", /^\/maletas$/, ({ body: b }) => {
      requeridos(b, "id_ticket", "correo", "tipo", "peso_kg");
      const t = ticketDe(b.id_ticket, b.correo);
      if (t.estado !== "reservado") throw new Err(409, "Solo puedes agregar maletas antes del check-in");
      const rev = revisar(b.tipo, b.peso_kg);
      if (!rev.permitido) throw new Err(422, rev.mensaje, { revision: rev });
      if (maletasDe(t.id_ticket).filter((m) => m.estado !== "cancelada").length >= MAX_MALETAS)
        throw new Err(409, `Máximo ${MAX_MALETAS} maletas por reserva`);
      const m = {
        id_maleta: id("MAL"), id_ticket: t.id_ticket, tipo: rev.tipo, peso_kg: rev.peso_kg,
        exceso_kg: rev.exceso_kg, cargo_exceso: rev.cargo_exceso, descripcion: String(b.descripcion || "").slice(0, 120),
        estado: "pendiente", creado_en: ahora(),
      };
      db.maletas[m.id_maleta] = m;
      return r(201, { maleta: m, revision: rev });
    }],

    ["GET", /^\/maletas$/, ({ query: q, agente: k }) => {
      if (q.estado) {
        agente(k);
        const ms = Object.values(db.maletas).filter((m) => m.estado === q.estado)
          .map((m) => { const t = db.tickets[m.id_ticket]; return { ...m, ticket: t && { nombre: t.nombre, vuelo: t.vuelo, origen: t.origen, destino: t.destino, estado: t.estado } }; });
        return r(200, { maletas: ms });
      }
      requeridos(q, "id_ticket", "correo");
      return r(200, { maletas: maletasDe(ticketDe(q.id_ticket, q.correo).id_ticket) });
    }],

    ["DELETE", /^\/maletas\/([^/]+)$/, ({ query: q }, idM) => {
      requeridos(q, "id_ticket", "correo");
      const t = ticketDe(q.id_ticket, q.correo);
      if (t.estado !== "reservado") throw new Err(409, "Ya no se pueden modificar las maletas de esta reserva");
      const m = db.maletas[idM];
      if (!m || m.id_ticket !== t.id_ticket) throw new Err(404, "Maleta no encontrada");
      if (m.estado !== "pendiente") throw new Err(409, "Solo se pueden quitar maletas pendientes");
      delete db.maletas[idM];
      return r(200, { eliminada: idM });
    }],

    ["POST", /^\/maletas\/([^/]+)\/confirmar$/, ({ body: b, agente: k }, idM) => {
      agente(k);
      const m = db.maletas[idM];
      if (!m) throw new Err(404, "Maleta no encontrada");
      if (m.estado !== "pendiente") throw new Err(409, `La maleta ya está ${m.estado}`);
      if (db.tickets[m.id_ticket]?.estado === "cancelado") throw new Err(409, "La reserva de esta maleta fue cancelada");
      if (b.peso_real_kg != null && b.peso_real_kg !== "") {
        const rev = revisar(m.tipo, b.peso_real_kg);
        if (!rev.permitido) throw new Err(422, rev.mensaje, { revision: rev });
        Object.assign(m, { peso_kg: rev.peso_kg, exceso_kg: rev.exceso_kg, cargo_exceso: rev.cargo_exceso });
      }
      Object.assign(m, { estado: "confirmada", confirmado_en: ahora() });
      return r(200, { maleta: m, comprobante_url: null });
    }],

    ["POST", /^\/tickets$/, ({ body: b, agente: k }) => {
      agente(k);
      requeridos(b, "nombre", "correo", "documento", "vuelo", "origen", "destino", "fecha_vuelo", "asiento");
      const origen = b.origen.trim().toUpperCase(), destino = b.destino.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(origen) || !/^[A-Z]{3}$/.test(destino) || origen === destino)
        throw new Err(400, "Origen y destino deben ser códigos IATA distintos (ej: BOG, MDE)");
      const vuelo = b.vuelo.trim().toUpperCase(), asiento = asientoOk(b.asiento), fecha = String(b.fecha_vuelo).trim();
      if (ocupados(vuelo, fecha).has(asiento)) throw new Err(409, `El asiento ${asiento} ya está ocupado en el vuelo ${vuelo}`);
      const t = {
        id_ticket: id("SKY"), id_propietario: correoOk(b.correo), nombre: b.nombre.trim(), documento: String(b.documento).trim(),
        telefono: String(b.telefono || "").trim(), vuelo, origen, destino, fecha_vuelo: fecha, asiento,
        estado: "reservado", creado_en: ahora(), actualizado_en: ahora(),
      };
      db.tickets[t.id_ticket] = t;
      return r(201, { ticket: t });
    }],

    ["GET", /^\/tickets$/, ({ agente: k }) => {
      agente(k);
      return r(200, { tickets: Object.values(db.tickets).sort((a, b) => b.creado_en.localeCompare(a.creado_en)) });
    }],

    ["GET", /^\/tickets\/([^/]+)$/, ({ query: q }, idT) => {
      requeridos(q, "correo");
      return r(200, { ticket: vista(ticketDe(idT, q.correo)) });
    }],

    ["PUT", /^\/tickets\/([^/]+)$/, ({ body: b }, idT) => {
      requeridos(b, "correo");
      const t = ticketDe(idT, b.correo);
      if (t.estado !== "reservado") throw new Err(409, "Solo puedes modificar la reserva antes del check-in");
      const cambios = {};
      if (b.asiento) {
        const a = asientoOk(b.asiento);
        if (a !== t.asiento) {
          if (ocupados(t.vuelo, t.fecha_vuelo, t.id_ticket).has(a)) throw new Err(409, `El asiento ${a} ya está ocupado`);
          cambios.asiento = a;
        }
      }
      if (b.telefono && String(b.telefono).trim() !== t.telefono) {
        if (!/^\+?[0-9 ]{7,20}$/.test(String(b.telefono).trim())) throw new Err(400, "Teléfono inválido");
        cambios.telefono = String(b.telefono).trim();
      }
      if (b.nombre && b.nombre.trim() !== t.nombre) cambios.nombre = b.nombre.trim();
      if (!Object.keys(cambios).length) throw new Err(400, "No hay cambios para guardar");
      Object.assign(t, cambios, { actualizado_en: ahora() });
      return r(200, { ticket: vista(t), cambios });
    }],

    ["POST", /^\/tickets\/([^/]+)\/checkin$/, ({ body: b }, idT) => {
      requeridos(b, "correo");
      const t = ticketDe(idT, b.correo);
      if (t.estado === "cancelado") throw new Err(409, "La reserva está cancelada");
      if (t.estado === "checkin") throw new Err(409, "Ya hiciste el check-in de esta reserva");
      const ms = maletasDe(t.id_ticket);
      Object.assign(t, {
        estado: "checkin", checkin_en: ahora(), actualizado_en: ahora(),
        maletas_registradas: ms.filter((m) => m.estado !== "cancelada").length,
        maletas_confirmadas: ms.filter((m) => m.estado === "confirmada").length,
      });
      return r(200, { ticket: vista(t) });
    }],

    ["POST", /^\/tickets\/([^/]+)\/cancelacion$/, ({ body: b }, idT) => {
      requeridos(b, "correo");
      const t = ticketDe(idT, b.correo);
      if (t.estado === "cancelado") throw new Err(409, "Esta reserva ya está cancelada");
      const previo = db.auth[t.id_ticket], seg = Math.floor(Date.now() / 1000);
      if (previo && seg - previo.creado < 60) {
        const espera = 60 - (seg - previo.creado);
        throw new Err(429, `Espera ${espera} segundos para pedir otro código`, { espera });
      }
      const codigo = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
      db.auth[t.id_ticket] = { codigo, intentos: 0, creado: seg, expira: seg + 600 };
      const [u, d] = t.id_propietario.split("@");
      return r(200, { mensaje: `Enviamos un código de verificación a ${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}`, expira_en_segundos: 600, codigo_demo: codigo });
    }],

    ["POST", /^\/tickets\/([^/]+)\/cancelacion\/confirmar$/, ({ body: b }, idT) => {
      requeridos(b, "correo", "codigo");
      const t = ticketDe(idT, b.correo);
      if (t.estado === "cancelado") throw new Err(409, "Esta reserva ya está cancelada");
      const a = db.auth[t.id_ticket];
      if (!a || a.expira < Date.now() / 1000) throw new Err(410, "El código expiró o no existe. Pide uno nuevo.");
      if (a.intentos >= 5) { delete db.auth[t.id_ticket]; throw new Err(429, "Demasiados intentos. Pide un código nuevo."); }
      if (String(b.codigo).trim() !== a.codigo) {
        a.intentos++;
        throw new Err(401, `Código incorrecto. Te quedan ${5 - a.intentos} intentos.`, { intentos_restantes: 5 - a.intentos });
      }
      delete db.auth[t.id_ticket];
      Object.assign(t, { estado: "cancelado", cancelado_en: ahora(), actualizado_en: ahora() });
      maletasDe(t.id_ticket).forEach((m) => { m.estado = "cancelada"; });
      return r(200, { mensaje: "Tu tiquete fue cancelado", ticket: t });
    }],
  ];

  function manejar(metodo, path, peticion) {
    cargar();
    for (const [m, re, fn] of rutas) {
      const match = m === metodo && path.match(re);
      if (match) {
        try {
          const res = fn(peticion, ...match.slice(1).map(decodeURIComponent));
          guardar();
          return res;
        } catch (e) {
          guardar(); // los intentos fallidos también cuentan
          if (e instanceof Err) return r(e.status, { error: e.message, ...e.extra });
          console.error(e);
          return r(500, { error: "Error interno (demo)" });
        }
      }
    }
    return r(404, { error: `Ruta no soportada: ${metodo} ${path}` });
  }

  window.SkyMock = { manejar, reiniciar: () => { localStorage.removeItem(CLAVE); cargar(); } };
})();
