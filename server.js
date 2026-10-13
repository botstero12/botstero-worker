const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json());

// Semáforo para que Render no ejecute 2 Chromium al mismo tiempo (evita colapso por RAM)
let isProcessing = false;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', busy: isProcessing, time: new Date().toISOString() });
});

app.get('/api/get-session', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).json({ error: 'Falta el parámetro url o es inválido' });
  }

  if (isProcessing) {
    return res.status(429).json({ 
      error: 'El servicio está ocupado procesando otra sesión. Reintentá en unos segundos.' 
    });
  }

  isProcessing = true;
  let browser = null;

  // Tiempo máximo de espera en milisegundos (por defecto 120s para no exceder los límites de Render)
  const MAX_WAIT_MS = parseInt(req.query.maxWait || '120000', 10);
  const POLL_INTERVAL_MS = 2500;
  const startTime = Date.now();

  try {
    console.log(`[Queue-IT] Iniciando navegador liviano para: ${targetUrl}`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process', // Clave: evita disparar múltiples procesos en los 512MB de Render
        '--disable-extensions',
        '--disable-accelerated-2d-canvas'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Navegación con timeout prudencial
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    let acceptedCookie = null;
    let allCookies = [];

    // Bucle de espera activa hasta encontrar la cookie específica
    while (Date.now() - startTime < MAX_WAIT_MS) {
      allCookies = await context.cookies();

      // Busca específicamente la cookie QueueITAccepted o que contenga el EventId firmado
      acceptedCookie = allCookies.find(c => 
        c.name.startsWith('QueueITAccepted') || 
        (c.name.toLowerCase().includes('queueit') && c.value.includes('EventId'))
      );

      if (acceptedCookie) {
        console.log(`[Queue-IT] Cookie encontrada tras ${(Date.now() - startTime) / 1000}s`);
        break;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    const currentUrl = page.url();
    await browser.close();
    browser = null;

    if (!acceptedCookie) {
      return res.status(408).json({
        error: 'Tiempo de espera agotado sin obtener QueueITAccepted',
        waitedSeconds: (Date.now() - startTime) / 1000,
        currentUrl,
        availableCookies: allCookies.map(c => c.name)
      });
    }

    return res.json({
      success: true,
      name: acceptedCookie.name,
      value: acceptedCookie.value,
      decodedValue: decodeURIComponent(acceptedCookie.value),
      cookieHeader: `${acceptedCookie.name}=${acceptedCookie.value}`,
      fullCookieString: allCookies.map(c => `${c.name}=${c.value}`).join('; ')
    });

  } catch (error) {
    console.error('[Error Worker]', error.message);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    return res.status(500).json({ error: error.message });
  } finally {
    isProcessing = false;
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
