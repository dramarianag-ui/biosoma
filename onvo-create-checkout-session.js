// api/onvo-create-checkout-session.js
// Reemplaza al flujo del widget embebido (onvo.pay()), que fallaba en el paso de
// verificación 3DS. En su lugar, generamos una sesión de Checkout Hospedado a partir
// de un link de pago recurrente ya creado en el dashboard de ONVO, le asignamos los
// datos del médico (nombre, correo, teléfono), y devolvemos la URL a la que el
// navegador debe redirigir.
//
// Flujo:
// 1) GET /v1/checkout/sessions/link/:paymentLinkId  -> crea la sesión, devuelve {id, url, ...}
// 2) PATCH /v1/checkout/sessions/:id/customer        -> le asigna nombre/correo/teléfono
// 3) Devolvemos { url } al frontend para que redirija (window.location.href)

const ONVO_API_BASE_URL = 'https://api.onvopay.com/v1';

// ID del link de pago recurrente ($39/mes) creado en el dashboard de ONVO (modo Live).
// Si algún día se recrea el link, solo hay que actualizar este valor.
const PAYMENT_LINK_ID = 'live_343gcs7fwPhl2TZN9JJ0Yu8DLHo';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { ONVO_SECRET_KEY } = process.env;
    if (!ONVO_SECRET_KEY) {
      console.error('Falta ONVO_SECRET_KEY en Vercel');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    const { nombre, correo, telefono } = req.body || {};

    if (!nombre || !correo) {
      return res.status(400).json({ error: 'Nombre y correo son requeridos.' });
    }

    // 1) Crear la sesión de checkout a partir del link de pago recurrente
    const sesionResp = await fetch(
      `${ONVO_API_BASE_URL}/checkout/sessions/link/${encodeURIComponent(PAYMENT_LINK_ID)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${ONVO_SECRET_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    const sesion = await sesionResp.json();

    if (!sesionResp.ok || !sesion.id || !sesion.url) {
      console.error('No se pudo crear la sesión de checkout:', sesion);
      return res.status(502).json({ error: 'No se pudo iniciar el pago. Intente de nuevo.' });
    }

    // 2) Asignar los datos del médico a esa sesión, para que el webhook sepa
    //    a quién activar cuando el pago se confirme.
    const actualizarResp = await fetch(
      `${ONVO_API_BASE_URL}/checkout/sessions/${encodeURIComponent(sesion.id)}/customer`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${ONVO_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          customerName: nombre,
          customerEmail: correo,
          ...(telefono ? { customerPhone: telefono } : {})
        })
      }
    );

    if (!actualizarResp.ok) {
      const errBody = await actualizarResp.text();
      console.error('No se pudo asignar el cliente a la sesión:', errBody);
      // No es fatal: seguimos adelante igual, el webhook puede recuperar el correo
      // desde el evento de pago de ONVO si este paso llegara a fallar.
    }

    return res.status(200).json({ url: sesion.url, sessionId: sesion.id });

  } catch (err) {
    console.error('Error inesperado en onvo-create-checkout-session:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
};
