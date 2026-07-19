// api/onvo-create-subscription.js
// Crea un cliente y un cargo recurrente (suscripción) en ONVO.
// No confirma el cobro aquí -- eso lo hace el widget del SDK en el navegador.
// La activación real del profesional SOLO ocurre en el webhook (onvo-webhook.js),
// nunca en este endpoint ni en el navegador.

const ONVO_API_BASE = 'https://api.onvopay.com/v1';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { nombre, correo, especialidad, telefono } = req.body || {};

    if (!nombre || !correo) {
      return res.status(400).json({ error: 'Faltan datos: nombre y correo son obligatorios' });
    }

    const { ONVO_SECRET_KEY, ONVO_PRICE_ID } = process.env;

    // DIAGNÓSTICO TEMPORAL: lista qué variables de entorno ve la función (solo nombres, no valores)
    const envKeys = Object.keys(process.env).filter(k => k.includes('ONVO'));
    console.log('DIAGNOSTICO - Variables ONVO detectadas:', envKeys);
    console.log('DIAGNOSTICO - ONVO_SECRET_KEY presente:', !!ONVO_SECRET_KEY, 'longitud:', ONVO_SECRET_KEY ? ONVO_SECRET_KEY.length : 0);
    console.log('DIAGNOSTICO - ONVO_PRICE_ID presente:', !!ONVO_PRICE_ID, 'longitud:', ONVO_PRICE_ID ? ONVO_PRICE_ID.length : 0);

    if (!ONVO_SECRET_KEY || !ONVO_PRICE_ID) {
      console.error('Faltan variables de entorno ONVO en Vercel. Detectadas:', envKeys);
      return res.status(500).json({ error: 'Configuración del servidor incompleta', debug: envKeys });
    }

    // 1) Crear el cargo recurrente. ONVO crea el cliente en la misma solicitud
    //    si le mandamos "customer" en vez de "customerId".
    const subResponse = await fetch(`${ONVO_API_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONVO_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: {
          name: nombre,
          email: correo,
          phone: telefono || undefined
        },
        paymentBehavior: 'allow_incomplete',
        description: 'Acceso Profesional BIOSOMA - Plan Mensual',
        items: [
          {
            priceId: ONVO_PRICE_ID,
            quantity: 1
          }
        ],
        metadata: {
          nombre,
          correo,
          especialidad: especialidad || '',
          telefono: telefono || ''
        }
      })
    });

    const subData = await subResponse.json();

    if (!subResponse.ok) {
      console.error('Error creando suscripción en ONVO:', subData);
      return res.status(502).json({ error: 'No se pudo crear la suscripción', detalle: subData });
    }

    // ONVO devuelve el id de la suscripción y el customerId asociado.
    return res.status(201).json({
      subscriptionId: subData.id,
      customerId: subData.customerId || (subData.customer && subData.customer.id) || null
    });

  } catch (err) {
    console.error('Error inesperado en onvo-create-subscription:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
