/*
 * agente-maletas.js · Funcionalidad 2: Confirmar maleta en el check-in (counter)
 * Responsable: Persona A (maletas)
 * API: GET  /maletas?estado=pendiente      (maleta-lambda, con x-agent-key)
 *      POST /maletas/{id}/confirmar        (maleta-confirmacion: estado -> confirmada,
 *                                           comprobante en S3, correo por SQS + SES)
 */
const AgenteMaletas = (() => {
  const { esc, kg, cop, chip } = SkyUI;
  let cont = null;

  async function pintar(el) {
    cont = el;
    cont.innerHTML = `<div class="cargando">Cargando maletas…</div>`;
    try {
      const [pend, conf] = await Promise.all([
        SkyAPI.maletasPorEstado("pendiente", Agente.clave()),
        SkyAPI.maletasPorEstado("confirmada", Agente.clave()),
      ]);
      dibujar(pend.maletas, conf.maletas);
    } catch (e) {
      Agente.manejarError(e);
      cont.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
    }
  }

  function dibujar(pendientes, confirmadas) {
    const kilos = confirmadas.reduce((s, m) => s + Number(m.peso_kg), 0);
    const cargos = confirmadas.reduce((s, m) => s + Number(m.cargo_exceso || 0), 0);
    cont.innerHTML = `
      <div class="kpis">
        <div class="kpi"><small>Pendientes</small><b>${pendientes.length}</b></div>
        <div class="kpi"><small>Confirmadas</small><b>${confirmadas.length}</b></div>
        <div class="kpi"><small>Kg facturados</small><b>${kilos.toLocaleString("es-CO", { maximumFractionDigits: 1 })}</b></div>
        <div class="kpi"><small>Cargos por exceso</small><b>${cop(cargos).replace(" COP", "")}</b></div>
      </div>
      <div class="card">
        <div class="card-titulo"><h2>Maletas por confirmar</h2><button class="btn chico borde" id="refrescar">Actualizar</button></div>
        ${pendientes.length ? `<div class="tabla-scroll"><table class="tabla">
          <thead><tr><th>Maleta</th><th>Pasajero / vuelo</th><th>Tipo</th><th>Declarado</th><th>Peso real (kg)</th><th></th></tr></thead>
          <tbody>${pendientes.map((m) => `
            <tr data-id="${esc(m.id_maleta)}">
              <td><b class="mono">${esc(m.id_maleta)}</b><br><span class="muted small">${esc(m.descripcion || "")}</span></td>
              <td>${esc(m.ticket?.nombre || "—")}<br><span class="muted small">${esc(m.ticket?.vuelo || "")} ${esc(m.ticket?.origen || "")}→${esc(m.ticket?.destino || "")} · <span class="mono">${esc(m.id_ticket)}</span></span></td>
              <td>${m.tipo === "cabina" ? "Cabina" : "Bodega"}</td>
              <td>${kg(m.peso_kg)}${m.cargo_exceso > 0 ? `<br><span class="small" style="color:var(--warn)">${cop(m.cargo_exceso)}</span>` : ""}</td>
              <td><input type="number" step="0.1" min="0.1" placeholder="${Number(m.peso_kg)}" aria-label="Peso real"></td>
              <td><button class="btn chico" data-cargando="…">Confirmar</button></td>
            </tr>`).join("")}</tbody></table></div>`
          : `<div class="vacio">No hay maletas pendientes. ✈</div>`}
      </div>
      <div class="card">
        <h2>Confirmadas recientemente</h2>
        ${confirmadas.length ? `<div class="lista">${confirmadas.slice(-8).reverse().map((m) => `
          <div class="item"><div class="ico">${SkyUI.ICONOS.check}</div>
            <div class="txt"><b>${esc(m.ticket?.nombre || m.id_ticket)} · ${kg(m.peso_kg)}</b>
            <span class="mono">${esc(m.id_maleta)}</span> <span>· ${esc(SkyUI.fecha(m.confirmado_en))}</span></div>${chip(m.estado)}</div>`).join("")}</div>`
          : `<div class="vacio">Aún no hay maletas confirmadas.</div>`}
      </div>`;

    document.getElementById("refrescar").onclick = () => pintar(cont);
    cont.querySelectorAll("tr[data-id] button").forEach((b) => { b.onclick = () => confirmar(b); });
  }

  async function confirmar(boton) {
    const fila = boton.closest("tr");
    const input = fila.querySelector("input");
    const peso = input.value === "" ? null : Number(input.value);
    try {
      const r = await SkyUI.conCarga(boton, () => SkyAPI.confirmarMaleta(fila.dataset.id, peso, Agente.clave()));
      const link = r.comprobante_url ? ` · <a href="${esc(r.comprobante_url)}" target="_blank" style="color:#fff">ver comprobante</a>` : "";
      const cargo = r.maleta.cargo_exceso > 0 ? `<br>Cobrar exceso: <b>${cop(r.maleta.cargo_exceso)}</b>` : "";
      SkyUI.toast(`Maleta <b class="mono">${esc(r.maleta.id_maleta)}</b> confirmada${link}${cargo}`, "ok", 8000);
      pintar(cont);
    } catch (e) {
      Agente.manejarError(e);
    }
  }

  return { pintar };
})();
