/*
 * cancelar.js · Funcionalidad 5: Cancelar tiquete con MFA
 * Responsable: Mari (tiquetes)
 * API: POST /tickets/{id}/cancelacion            (cod-auth: manda el código al correo)
 *      POST /tickets/{id}/cancelacion/confirmar  (elimina-ticket: valida y cancela)
 */
SkyUI.encabezado("reserva");
const ses = SkyUI.sesion.requerir();
const app = document.getElementById("app");
const { esc } = SkyUI;

let ticket = null;
let paso = 1;
let vence = 0;       // epoch ms en que vence el código
let reenviarEn = 0;  // epoch ms desde el que se puede pedir otro
let reloj = null;

function barraPasos() {
  const nombres = ["Confirmar", "Código", "Listo"];
  return `<div class="pasos-flujo">${nombres.map((n, i) =>
    `<div class="${i + 1 === paso ? "activo" : i + 1 < paso ? "hecho" : ""}">${i + 1}. ${n}</div>`).join("")}</div>`;
}

function pintar() {
  clearInterval(reloj);
  let cuerpo = "";

  if (ticket.estado === "cancelado" && paso !== 3) {
    cuerpo = `<div class="alerta bad"><div>Esta reserva ya está cancelada.</div></div>
      <a class="btn borde" href="reserva.html">Volver a mi reserva</a>`;
  } else if (paso === 1) {
    cuerpo = `
      <p>Vas a cancelar el tiquete <b class="mono">${esc(ticket.id_ticket)}</b>:</p>
      <div class="item" style="margin-bottom:1rem">
        <div class="ico">${SkyUI.ICONOS.avion}</div>
        <div class="txt"><b>${esc(ticket.vuelo)} · ${esc(ticket.origen)} → ${esc(ticket.destino)}</b>
          <span>${esc(SkyUI.fecha(ticket.fecha_vuelo))} · Asiento ${esc(ticket.asiento)}</span></div>
      </div>
      <div class="alerta warn"><div><b>Esta acción es definitiva.</b> Tus maletas registradas también se cancelarán.
        Para confirmar que eres tú, te enviaremos un código de 6 dígitos a tu correo.</div></div>
      <label class="check"><input type="checkbox" id="entiendo"> Entiendo que la cancelación no se puede deshacer.</label>
      <div class="acciones">
        <button class="btn peligro" id="enviar" data-cargando="Enviando código…" disabled>Enviar código a mi correo</button>
        <a class="btn borde" href="reserva.html">No, volver</a>
      </div>`;
  } else if (paso === 2) {
    cuerpo = `
      <p id="msg-envio" class="muted"></p>
      <form id="form-otp">
        <div class="otp" id="otp">${Array.from({ length: 6 }, (_, i) =>
          `<input inputmode="numeric" maxlength="1" aria-label="Dígito ${i + 1}" autocomplete="one-time-code">`).join("")}</div>
        <p class="contador">El código vence en <b id="cuenta">10:00</b></p>
        <div class="acciones" style="justify-content:center">
          <button class="btn peligro" id="confirmar" data-cargando="Verificando…">Confirmar cancelación</button>
          <button type="button" class="btn borde" id="reenviar" data-cargando="Enviando…">Reenviar código</button>
        </div>
      </form>`;
  } else {
    cuerpo = `
      <div style="text-align:center;padding:1rem 0">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center;margin:0 auto 1rem">${SkyUI.ICONOS.check}</div>
        <h2>Tu tiquete fue cancelado</h2>
        <p class="muted">Te enviamos la confirmación a tu correo.</p>
        <div class="acciones" style="justify-content:center">
          <a class="btn" href="reserva.html">Ver mi reserva</a>
          <button class="btn borde" id="salir">Salir</button>
        </div>
      </div>`;
  }

  app.innerHTML = `
    <div class="encabezado">
      <a class="volver" href="reserva.html">${SkyUI.ICONOS.flecha} Volver a mi reserva</a>
      <h1>Cancelar tiquete</h1>
    </div>
    <div class="card centrado" style="margin-top:0;max-width:560px">${barraPasos()}${cuerpo}</div>`;

  if (paso === 1 && ticket.estado !== "cancelado") {
    const chk = document.getElementById("entiendo"), btn = document.getElementById("enviar");
    chk.onchange = () => { btn.disabled = !chk.checked; };
    btn.onclick = () => solicitar(btn);
  }
  if (paso === 2) prepararOtp();
  if (paso === 3) document.getElementById("salir").onclick = () => { SkyUI.sesion.clear(); location.href = "index.html"; };
}

async function solicitar(boton) {
  try {
    const r = await SkyUI.conCarga(boton, () => SkyAPI.solicitarCancelacion(ses.id_ticket, ses.correo));
    vence = Date.now() + r.expira_en_segundos * 1000;
    reenviarEn = Date.now() + 60000;
    if (paso !== 2) { paso = 2; pintar(); }
    document.getElementById("msg-envio").innerHTML = `${esc(r.mensaje)}. Escríbelo aquí:`;
    if (r.codigo_demo) SkyUI.toast(`<b>Modo demo</b> · el código que llegaría al correo es <span class="mono">${r.codigo_demo}</span>`, "", 15000);
    else SkyUI.toast("Código enviado. Revisa tu correo (y la carpeta de spam).", "ok");
  } catch (e) {
    if (e.status === 429 && paso === 1 && e.datos.espera) {
      // Ya había un código vigente: pasar directo a escribirlo
      reenviarEn = Date.now() + e.datos.espera * 1000;
      vence = Date.now() + 9 * 60000;
      paso = 2; pintar();
      document.getElementById("msg-envio").textContent = "Ya te enviamos un código hace poco. Escríbelo aquí:";
      return;
    }
    SkyUI.error(e);
  }
}

function prepararOtp() {
  const cajas = [...document.querySelectorAll("#otp input")];
  cajas[0].focus();
  cajas.forEach((c, i) => {
    c.addEventListener("input", () => {
      c.value = c.value.replace(/\D/g, "").slice(-1);
      if (c.value && i < 5) cajas[i + 1].focus();
    });
    c.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !c.value && i > 0) cajas[i - 1].focus(); });
    c.addEventListener("paste", (e) => {
      const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!d) return;
      e.preventDefault();
      d.split("").forEach((n, j) => { cajas[j].value = n; });
      cajas[Math.min(d.length, 5)].focus();
    });
  });

  const btnReenviar = document.getElementById("reenviar");
  const tic = () => {
    const resta = Math.max(0, vence - Date.now());
    const m = Math.floor(resta / 60000), s = Math.floor((resta % 60000) / 1000);
    document.getElementById("cuenta").textContent = resta ? `${m}:${String(s).padStart(2, "0")}` : "vencido";
    const espera = Math.ceil((reenviarEn - Date.now()) / 1000);
    btnReenviar.disabled = espera > 0;
    btnReenviar.textContent = espera > 0 ? `Reenviar en ${espera}s` : "Reenviar código";
  };
  tic();
  reloj = setInterval(tic, 1000);
  btnReenviar.onclick = () => solicitar(btnReenviar);

  document.getElementById("form-otp").onsubmit = async (e) => {
    e.preventDefault();
    const codigo = cajas.map((c) => c.value).join("");
    if (codigo.length !== 6) return SkyUI.toast("Escribe los 6 dígitos", "bad");
    try {
      const r = await SkyUI.conCarga(document.getElementById("confirmar"),
        () => SkyAPI.confirmarCancelacion(ses.id_ticket, ses.correo, codigo));
      ticket = r.ticket;
      paso = 3; pintar();
    } catch (err) {
      const otp = document.getElementById("otp");
      otp.classList.remove("error"); void otp.offsetWidth; otp.classList.add("error");
      cajas.forEach((c) => { c.value = ""; });
      cajas[0].focus();
      SkyUI.error(err);
      if (err.status === 410 || err.status === 429) { vence = 0; reenviarEn = 0; }
    }
  };
}

(async () => {
  try {
    ticket = (await SkyAPI.consultarReserva(ses.id_ticket, ses.correo)).ticket;
    pintar();
  } catch (e) {
    app.innerHTML = `<div class="alerta bad"><div>${esc(e.message)}</div></div>`;
  }
})();
