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

    if (!ONVO_SECRET_KEY || !ONVO_PRICE_ID) {
      console.error('Faltan variables de entorno ONVO en Vercel');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    // 1) Crear el cliente primero. La API de suscripciones de ONVO NO acepta
    //    un objeto "customer" inline -- exige un customerId ya existente.
    const customerResponse = await fetch(`${ONVO_API_BASE}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONVO_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: nombre,
        email: correo,
        phone: telefono || undefined
      })
    });

    const customerData = await customerResponse.json();

    if (!customerResponse.ok) {
      console.error('Error creando cliente en ONVO:', customerData);
      return res.status(502).json({ error: 'No se pudo crear el cliente', detalle: customerData });
    }

    const customerId = customerData.id;

    // 2) Crear la suscripción en modo "allow_incomplete": queda pendiente de
    //    confirmación hasta que el widget onvo.pay() del navegador capture la
    //    tarjeta y la confirme (paso que hace el propio SDK del cliente).
    const subResponse = await fetch(`${ONVO_API_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ONVO_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerId: customerId,
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

    // ONVO devuelve el id de la suscripción.
    return res.status(201).json({
      subscriptionId: subData.id,
      customerId: customerId
    });

  } catch (err) {
    console.error('Error inesperado en onvo-create-subscription:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
};
