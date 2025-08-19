/**
 * [NexusDev] - NexusConverter Microservice
 *
 * Mission: Provide a focused, high-performance API endpoint for image conversion.
 * Architecture: Node.js, Express, Sharp. Containerized for Coolify deployment.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const storage = multer.memoryStorage(); // Almacenar el archivo en memoria para procesarlo
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50 MB por archivo
});

// --- API Endpoint ---
app.post('/convert/image', upload.single('image'), async (req, res) => {
  try {
    // 1. Validar la entrada
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se ha proporcionado ningún archivo de imagen en el campo "image".' });
    }

    // 2. Extraer parámetros con valores por defecto
    const targetFormat = req.body.format || 'webp';
    const quality = parseInt(req.body.quality, 10) || 80;
    const supportedFormats = ['jpeg', 'png', 'webp', 'tiff', 'avif'];

    if (!supportedFormats.includes(targetFormat)) {
        return res.status(400).json({ success: false, error: `Formato no soportado: '${targetFormat}'. Soportados: ${supportedFormats.join(', ')}` });
    }
    if (isNaN(quality) || quality < 1 || quality > 100) {
        return res.status(400).json({ success: false, error: 'La calidad debe ser un número entre 1 y 100.' });
    }

    // 3. Procesamiento con Sharp
    console.log(`[NexusConverter] Procesando imagen a formato: ${targetFormat}, calidad: ${quality}`);
    const outputBuffer = await sharp(req.file.buffer)
      .toFormat(targetFormat, { quality })
      .toBuffer();

    // 4. Enviar respuesta exitosa
    res.setHeader('Content-Type', `image/${targetFormat}`);
    res.status(200).send(outputBuffer);

  } catch (error) {
    console.error('[NexusConverter] Error durante el procesamiento:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor al procesar la imagen.', details: error.message });
  }
});

// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});


// --- Server Initialization ---
app.listen(PORT, () => {
  console.log(`[NexusDev] NexusConverter service está listo y escuchando en el puerto ${PORT}`);
});