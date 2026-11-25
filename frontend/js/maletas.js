/*
 * maletas.js · Funcionalidad 1: Registrar maleta (estado "pendiente")
 * Responsable: Persona A (maletas)
 * API: POST /maletas/revisar  (maleta-revisar: revisión de peso en vivo)
 *      POST /maletas          (maleta-lambda: registrar)
 *      GET  /maletas          (maleta-lambda: listar las de la reserva)
 *      DELETE /maletas/{id}   (maleta-lambda: quitar una pendiente)
 */
SkyUI.encabezado("reserva");
const ses = SkyUI.sesion.requerir();
const app = document.getElementById("app");
const { esc, kg, cop, chip, ICONOS } = SkyUI;

const LIMITES = { cabina: 10, bodega: 23 };
const MAXIMO = 32;
let ticket = null;
let maletas = [];
let tipo = "bodega";
let revision = null;
let temporizador = null;

function pintarLista() {
  const activas = maletas.filter((m) => m.estado !== "cancelada");
  document.getElementById("contador").textContent = `${activas.length} de 3`;
  document.getElementById("lista").innerHTML = maletas.length ? maletas.map((m) => `
    <div class="item">
      <div class="ico">${m.tipo === "cabina" ? ICONOS.mochila : ICONOS.maleta}</div>
      <div class="txt"><b>${m.tipo === "cabina" ? "Cabina" : "Bodega"} · ${kg(m.peso_kg)}</b>
        <span>${esc(m.descripcion || "Sin descripción")}${m.cargo_exceso > 0 ? ` · cargo ${cop(m.cargo_exceso)}` : ""}</span></div>
      ${chip(m.estado)}
      ${m.estado === "pendiente" && ticket.estado === "reservado"
        ? `<button class="btn chico borde" data-quitar="${esc(m.id_maleta)}" title="Quitar maleta">${ICONOS.x}</button>` : ""}
    </div>`).join("") : `<div class="vacio">${ICONOS.maleta}<br>Todavía no tienes maletas registradas.</div>`;

  const total = activas.reduce((s, m) => s + Number(m.cargo_exceso || 0), 0);
  document.getElementById("total").innerHTML = total ? `Total cargos por exceso: <b>${cop(total)}</b>` : "";
  document.getElementById("registrar").disabled = activas.length >= 3;
}

function pintarMedidor() {
  const peso = Number(document.getElementById("peso").value) || 0;
  const limite = LIMITES[tipo];
  const tope = tipo === "cabina" ? 15 : MAXIMO;
  const barra = document.getElementById("barra");
  barra.querySelector("i").style.width = Math.min(100, (peso / tope) * 100) + "%";
  barra.className = "barra" + (revision && !revision.permitido ? " no" : revision && revision.exceso_kg > 0 ? " exceso" : "");
  document.getElementById("escala").innerHTML = `<span>0 kg</span><span>límite ${limite} kg</span><span>${tope} kg</span>`;

  const msg = document.getElementById("mensaje-revision");
  if (!revision) { msg.innerHTML = `<span class="muted">Escribe el peso para revisarlo.</span>`; return; }
  const color = !revision.permitido ? "var(--bad)" : revision.exceso_kg > 0 ? "var(--warn)" : "var(--ok)";
  msg.innerHTML = `<b style="color:${color}">${esc(revision.mensaje)}</b>`;
}

// Pregunta al back (maleta-revisar) mientras el usuario escribe
function revisarEnVivo() {
  clearTimeout(temporizador);
  revision = null;
  const peso = Number(document.getElementById("peso").value);
  if (!(peso > 0)) return pintarMedidor();
  pintarMedidor();
  temporizador = setTimeout(async () => {
    try {
      revision = await SkyAPI.revisarMaleta(tipo, peso);
    } catch (e) {
      revision = null;
    }
    pintarMedidor();
  }, 350);
}

function pintar() {
  const bloqueada = ticket.estado !== "reservado";
  app.innerHTML = `
    <div class="encabezado">
      <a class="volver" href="reserva.html">${ICONOS.flecha} Volver a mi reserva</a>
      <h1>Mis maletas</h1>
      <p class="muted">Reserva <b class="mono">${esc(ticket.id_ticket)}</b> · ${esc(ticket.vuelo)} ${esc(ticket.origen)} → ${esc(ticket.destino)}</p>
    </div>
    ${bloqueada ? `<div class="alerta warn"><div><b>Ya no puedes agregar maletas.</b> Solo se registran antes del check-in.</div></div>` : ""}
    <div class="grid-2 parejo">
      <form class="card" id="form" novalidate ${bloqueada ? 'style="opacity:.5;pointer-events:none"' : ""}>
        <h2>Registrar una maleta</h2>
        <div class="tipos" id="tipos">
          <button type="button" class="tipo" data-tipo="cabina">${ICONOS.mochila}<b>Cabina</b><span>Hasta 10 kg · va contigo</span></button>
          <button type="button" class="tipo" data-tipo="bodega">${ICONOS.maleta}<b>Bodega</b><span>Hasta 23 kg · se factura</span></button>
        </div>
        <div class="campo">
          <label for="peso">Peso aproximado (kg)</label>
          <div class="peso-control">
            <button type="button" class="btn suave" data-delta="-0.5" aria-label="Menos">−</button>
            <input id="peso" type="number" min="0.5" max="40" step="0.5" value="18">
            <button type="button" class="btn suave" data-delta="0.5" aria-label="Más">+</button>
          </div>
          <input id="rango" type="range" min="0.5" max="35" step="0.5" value="18" aria-label="Peso">
        </div>
        <div class="medidor">
          <div id="mensaje-revision"></div>
          <div class="barra" id="barra"><i></i></div>
          <div class="escala" id="escala"></div>
        </div>
        <div class="campo">
          <label for="descripcion">Descripción <span class="muted">(opcional)</span></label>
          <input id="descripcion" maxlength="120" placeholder="Ej: maleta roja con cinta amarilla">
          <span class="ayuda">Ayuda a identificarla si se pierde.</span>
        </div>
        <button class="btn coral bloque" id="registrar" data-cargando="Registrando…">Registrar maleta</button>
        <p class="muted small" style="margin:.75rem 0 0">La maleta queda <b>pendiente</b> hasta que un agente la pese y la confirme en el counter.</p>
      </form>

      <div class="card">
        <div class="card-titulo"><h2>Registradas</h2><span class="muted small" id="contador"></span></div>
        <div class="lista" id="lista"></div>
        <p class="small" id="total" style="margin:1rem 0 0"></p>
        ${!bloqueada ? `<a class="btn bloque suave" href="checkin.html" style="margin-top:1rem">Continuar al check-in →</a>` : ""}
      </div>
    </div>`;

  const elegirTipo = (t) => {
    tipo = t;
    document.querySelectorAll(".tipo").forEach((b) => b.classList.toggle("activo", b.dataset.tipo === t));
    revisarEnVivo();
  };
  document.getElementById("tipos").onclick = (e) => { const b = e.target.closest(".tipo"); if (b) elegirTipo(b.dataset.tipo); };

  const peso = document.getElementById("peso"), rango = document.getElementById("rango");
  peso.oninput = () => { rango.value = peso.value; revisarEnVivo(); };
  rango.oninput = () => { peso.value = rango.value; revisarEnVivo(); };
  document.querySelectorAll("[data-delta]").forEach((b) => {
    b.onclick = () => {
      peso.value = Math.max(0.5, Math.round((Number(peso.value || 0) + Number(b.dataset.delta)) * 10) / 10);
      rango.value = peso.value;
      revisarEnVivo();
    };
  });

  document.getElementById("form").onsubmit = registrar;
  document.getElementById("lista").onclick = (e) => { const b = e.target.closest("[data-quitar]"); if (b) quitar(b); };

  elegirTipo(tipo);
  pintarLista();
}

async function registrar(e) {
  e.preventDefault();
  const peso = Number(document.getElementById("peso").value);
  if (!(peso > 0)) return SkyUI.toast("Escribe el peso de la maleta", "bad");
  try {
    const r = await SkyUI.conCarga(document.getElementById("registrar"), () => SkyAPI.registrarMaleta({
      id_ticket: ses.id_ticket, correo: ses.correo, tipo, peso_kg: peso,
      descripcion: document.getElementById("descripcion").value.trim(),
    }));
    maletas.push(r.maleta);
    document.getElementById("descripcion").value = "";
    SkyUI.toast(`Maleta <b class="mono">${esc(r.maleta.id_maleta)}</b> registrada como pendiente`, "ok");
    pintarLista();
  } catch (err) {
    SkyUI.error(err);
  }
}

async function quitar(boton) {
  const id = boton.dataset.quitar;
  if (!confirm("¿Quitar esta maleta de tu reserva?")) return;
  try {
    await SkyUI.conCarga(boton, () => SkyAPI.quitarMaleta(id, ses.id_ticket, ses.correo));
    maletas = maletas.filter((m) => m.id_maleta !== id);
    SkyUI.toast("Maleta eliminada", "ok");
    pintarLista();
  } catch (err) {
    SkyUI.error(err);
  }
}

(async () => {
  try {
    ticket = (await SkyAPI.consultarReserva(ses.id_ticket, ses.correo)).ticket;
    maletas = (await SkyAPI.maletasDeReserva(ses.id_ticket, ses.correo)).maletas;
    pintar();
  } catch (e) {
    app.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
  }
})();
