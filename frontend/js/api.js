/*
 * api.js · Cliente de las APIs de SkyCheck (base común)
 *
 * Cada función de abajo corresponde a una ruta de API Gateway (ver main.tf).
 * Si el front está en modo demo, las peticiones las responde js/mock.js
 * con la MISMA lógica que las lambdas, así el front funciona igual.
 */
(function () {
  const cfg = window.SKYCHECK_CONFIG || {};
  const forzarDemo = new URLSearchParams(location.search).get("demo") === "1";
  const esDemo = forzarDemo || cfg.mock || !cfg.maletaApi || !cfg.ticketApi;

  class ApiError extends Error {
    constructor(status, mensaje, datos) {
      super(mensaje);
      this.status = status;
      this.datos = datos || {};
    }
  }

  async function pedir(api, metodo, path, { query, body, agente } = {}) {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")) : "";

    if (esDemo) {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 250)); // simula la red
      const r = SkyMock.manejar(metodo, path, { query: query || {}, body: body || {}, agente });
      if (r.status >= 400) throw new ApiError(r.status, r.data.error, r.data);
      return r.data;
    }

    const base = api === "maletas" ? cfg.maletaApi : cfg.ticketApi;
    const headers = { "Content-Type": "application/json" };
    if (agente) headers["x-agent-key"] = agente;
    let res;
    try {
      res = await fetch(base + path + qs, {
        method: metodo, headers, body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, "No hay conexión con el servidor. Revisa tu internet o la URL de la API.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || data.message || `Error ${res.status}`, data);
    return data;
  }

  const id = (s) => encodeURIComponent(String(s).trim().toUpperCase());

  window.SkyAPI = {
    esDemo,
    ApiError,

    // ---------------- maletas (maleta-api) · Persona A
    revisarMaleta: (tipo, peso_kg) =>
      pedir("maletas", "POST", "/maletas/revisar", { body: { tipo, peso_kg } }),
    registrarMaleta: (datos) =>
      pedir("maletas", "POST", "/maletas", { body: datos }),
    maletasDeReserva: (id_ticket, correo) =>
      pedir("maletas", "GET", "/maletas", { query: { id_ticket, correo } }),
    quitarMaleta: (id_maleta, id_ticket, correo) =>
      pedir("maletas", "DELETE", `/maletas/${encodeURIComponent(id_maleta)}`, { query: { id_ticket, correo } }),
    maletasPorEstado: (estado, agente) =>
      pedir("maletas", "GET", "/maletas", { query: { estado }, agente }),
    confirmarMaleta: (id_maleta, peso_real_kg, agente) =>
      pedir("maletas", "POST", `/maletas/${encodeURIComponent(id_maleta)}/confirmar`, { body: { peso_real_kg }, agente }),

    // ---------------- tiquetes (tickets-api) · Mari
    crearReserva: (datos, agente) =>
      pedir("tickets", "POST", "/tickets", { body: datos, agente }),
    listarReservas: (agente) =>
      pedir("tickets", "GET", "/tickets", { agente }),
    consultarReserva: (id_ticket, correo) =>
      pedir("tickets", "GET", `/tickets/${id(id_ticket)}`, { query: { correo } }),
    modificarReserva: (id_ticket, datos) =>
      pedir("tickets", "PUT", `/tickets/${id(id_ticket)}`, { body: datos }),
    hacerCheckin: (id_ticket, correo) =>
      pedir("tickets", "POST", `/tickets/${id(id_ticket)}/checkin`, { body: { correo } }),
    solicitarCancelacion: (id_ticket, correo) =>
      pedir("tickets", "POST", `/tickets/${id(id_ticket)}/cancelacion`, { body: { correo } }),
    confirmarCancelacion: (id_ticket, correo, codigo) =>
      pedir("tickets", "POST", `/tickets/${id(id_ticket)}/cancelacion/confirmar`, { body: { correo, codigo } }),
  };
})();
