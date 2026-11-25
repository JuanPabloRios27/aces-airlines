/*
 * checkin.js · Funcionalidad 3: Check-in, pasabordo PDF y notificación
 * Responsable: Persona A (maletas)
 * API: POST /tickets/{id}/checkin   (ticket-lambda)
 *      -> genera el PDF en S3 y encola el correo con el pasabordo (SQS + SES)
 */
SkyUI.encabezado("reserva");
const ses = SkyUI.sesion.requerir();
const app = document.getElementById("app");
const { esc, kg, chip, ICONOS } = SkyUI;
let ticket = null;

function vistaPasabordo(recien) {
  const pdf = ticket.pasabordo_url
    ? `<a class="btn coral" href="${esc(ticket.pasabordo_url)}" target="_blank" rel="noopener">${ICONOS.pase} Descargar PDF</a>`
    : "";
  return `
    ${recien ? `<div class="alerta ok"><div><b>¡Check-in completado!</b> Te enviamos el pasabordo a <b>${esc(ticket.id_propietario)}</b>.</div></div>` : ""}
    ${SkyUI.pase(ticket)}
    <div class="acciones no-print">
      ${pdf}
      <button class="btn suave" onclick="window.print()">Imprimir</button>
      <a class="btn borde" href="reserva.html">Volver a mi reserva</a>
    </div>
    ${!ticket.pasabordo_url && SkyAPI.esDemo ? `<p class="muted small no-print">En modo demo no se genera el PDF; en AWS lo crea la lambda y lo guarda en S3.</p>` : ""}
    <p class="muted small no-print">Check-in realizado el ${esc(SkyUI.fecha(ticket.checkin_en))}. Llega a la puerta de embarque 30 minutos antes.</p>`;
}

function vistaFormulario() {
  const maletas = (ticket.maletas || []).filter((m) => m.estado !== "cancelada");
  const pendientes = maletas.filter((m) => m.estado === "pendiente").length;
  return `
    <div class="grid-2">
      <div>
        ${SkyUI.pase(ticket)}
        <div class="card" style="margin-top:1.5rem">
          <div class="card-titulo"><h2>Equipaje</h2><a href="maletas.html" class="btn chico suave">Editar maletas</a></div>
          <div class="lista">${maletas.length ? maletas.map((m) => `
            <div class="item"><div class="ico">${m.tipo === "cabina" ? ICONOS.mochila : ICONOS.maleta}</div>
              <div class="txt"><b>${m.tipo === "cabina" ? "Cabina" : "Bodega"} · ${kg(m.peso_kg)}</b><span class="mono">${esc(m.id_maleta)}</span></div>
              ${chip(m.estado)}</div>`).join("") : `<div class="vacio">Viajas sin maletas registradas.</div>`}</div>
          ${pendientes ? `<p class="muted small" style="margin:1rem 0 0">Las maletas pendientes se confirman cuando las entregues en el counter.</p>` : ""}
        </div>
      </div>
      <form class="card" id="form">
        <h2>Completar check-in</h2>
        <p class="muted small">Antes de continuar, confirma lo siguiente:</p>
        <label class="check"><input type="checkbox" required> No llevo artículos peligrosos (explosivos, inflamables, baterías de litio sueltas en bodega).</label>
        <label class="check"><input type="checkbox" required> Mis datos y mi documento <b>${esc(ticket.documento)}</b> son correctos.</label>
        <label class="check"><input type="checkbox" required> Entiendo que después del check-in no podré cambiar asiento ni agregar maletas.</label>
        <button class="btn coral bloque" id="hacer" data-cargando="Generando pasabordo…" disabled>Hacer check-in</button>
      </form>
    </div>`;
}

function pintar(recien = false) {
  let cuerpo;
  if (ticket.estado === "cancelado") cuerpo = `<div class="alerta bad"><div>Esta reserva está cancelada.</div></div>`;
  else if (ticket.estado === "checkin") cuerpo = vistaPasabordo(recien);
  else cuerpo = vistaFormulario();

  app.innerHTML = `
    <div class="encabezado">
      <a class="volver" href="reserva.html">${ICONOS.flecha} Volver a mi reserva</a>
      <h1>${ticket.estado === "checkin" ? "Tu pasabordo" : "Check-in"}</h1>
    </div>${cuerpo}`;

  const form = document.getElementById("form");
  if (form) {
    const checks = [...form.querySelectorAll("input[type=checkbox]")];
    const btn = document.getElementById("hacer");
    form.onchange = () => { btn.disabled = !checks.every((c) => c.checked); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        ticket = (await SkyUI.conCarga(btn, () => SkyAPI.hacerCheckin(ses.id_ticket, ses.correo))).ticket;
        pintar(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        SkyUI.error(err);
      }
    };
  }
}

(async () => {
  try {
    ticket = (await SkyAPI.consultarReserva(ses.id_ticket, ses.correo)).ticket;
    pintar();
  } catch (e) {
    app.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
  }
})();
