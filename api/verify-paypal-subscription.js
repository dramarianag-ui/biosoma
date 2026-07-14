// api/verify-paypal-subscription.js
// Función serverless de Vercel. Verifica con PayPal que la suscripción
// realmente quedó activa antes de generar el código de acceso profesional.
// Nunca exponer PAYPAL_SECRET ni SUPABASE_SERVICE_ROLE_KEY en el navegador —
// ambas viven SOLO como variables de entorno en Vercel (ver instrucciones).

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { subscriptionID, nombre, correo, especialidad, telefono } = req.body || {};

    if (!subscriptionID || !nombre || !correo) {
      res.status(400).json({ ok: false, error: "Faltan datos (subscriptionID, nombre o correo)." });
      return;
    }

    const base =
      process.env.PAYPAL_ENV === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";

    // 1. Autenticarse con PayPal (Client ID + Secret, nunca en el navegador)
    const authRes = await fetch(base + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const authData = await authRes.json();
    if (!authData.access_token) {
      res.status(500).json({ ok: false, error: "No se pudo autenticar con PayPal." });
      return;
    }

    // 2. Consultar el estado real de la suscripción directo en PayPal
    const subRes = await fetch(base + "/v1/billing/subscriptions/" + encodeURIComponent(subscriptionID), {
      headers: { Authorization: "Bearer " + authData.access_token },
    });
    const sub = await subRes.json();

    if (!sub || (sub.status !== "ACTIVE" && sub.status !== "APPROVAL_PENDING")) {
      res
        .status(400)
        .json({ ok: false, error: "La suscripcion no quedo activa en PayPal (estado: " + (sub && sub.status) + ")." });
      return;
    }

    // 3. Generar código único
    const ini = (nombre || "").replace(/[^a-zA-Z]/g, "").substring(0, 3).toUpperCase();
    const num = Math.floor(1000 + Math.random() * 9000);
    const codigo = "BIO" + ini + num;

    // 4. Guardar el profesional en Supabase (usa la llave de servicio, no la publica)
    const sbRes = await fetch(process.env.SUPABASE_URL + "/rest/v1/profesionales", {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        codigo,
        nombre,
        correo,
        especialidad: especialidad || "",
        telefono: telefono || "",
        rol: "medico",
        activo: true,
        paypal_subscription_id: subscriptionID,
      }),
    });

    if (!sbRes.ok) {
      const errText = await sbRes.text();
      console.error("Error guardando en Supabase:", errText);
      res.status(500).json({ ok: false, error: "El pago se confirmo pero no se pudo guardar el codigo. Contacte soporte con este ID: " + subscriptionID });
      return;
    }

    res.status(200).json({ ok: true, codigo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
