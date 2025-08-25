/**
 * [NexusDev] - NexusConverter Microservice v4.1.0
 *
 * Misión: API multi-formato para convertir archivos locales y videos de YouTube.
 * v4.1.0: Agrega overlay de marca de agua diagonal gigante (Helse) y parámetros configurables.
 * - 'sheet': ficha 800x1000 (producto arriba 800x800, logo abajo).
 * - 'overlay': foto del producto a pantalla completa con watermark al fondo.
 */

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const libre = require('libreoffice-convert');
const util = require('util');

libre.convertAsync = util.promisify(libre.convert);

// --- Configuración ---
const app = express();
const PORT = process.env.PORT || 3000;
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});
const TMP_DIR = '/tmp';

// --- Middleware ---
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[NexusConverter] ${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// =================================================================
// v4.1.0 - Imagen con marca de agua diagonal gigante configurable
// =================================================================
app.post(
  '/convert/image',
  upload.fields([
    { name: 'image', maxCount: 1 },       // imagen del producto
    { name: 'watermark', maxCount: 1 }    // logo (PNG con transparencia recomendado)
  ]),
  async (req, res) => {
    try {
      const imageFile = req.files?.image?.[0];
      const logoFile  = req.files?.watermark?.[0];
      if (!imageFile || !logoFile) {
        return res.status(400).json({ success: false, error: 'Se requieren "image" (producto) y "watermark" (logo).' });
      }

      // ---- Parámetros opcionales ----
      const targetFormat      = (req.body.format || 'jpeg').toLowerCase();         // 'jpeg' | 'png'
      const quality           = parseInt(req.body.quality, 10) || 90;
      const layout            = (req.body.layout || 'sheet').toLowerCase();        // 'sheet' | 'overlay'
      const watermarkMode     = (req.body.watermarkMode || 'diagonal').toLowerCase(); // 'diagonal' | 'center'
      const watermarkOpacity  = Math.max(0, Math.min(1, parseFloat(req.body.watermarkOpacity ?? '0.30'))); // 0..1
      const watermarkScale    = Math.max(0.1, parseFloat(req.body.watermarkScale ?? '2.5')); // relativo al ancho del lienzo
      const watermarkAngle    = parseFloat(req.body.watermarkAngle ?? '45');       // grados

      // ---- Dimensiones base ----
      const canvasWidth  = layout === 'sheet' ? 800 : 1200;
      const canvasHeight = layout === 'sheet' ? 1000 : 1200;
      const mainImageHeight = layout === 'sheet' ? 800 : canvasHeight;

      // ---- 1) Lienzo blanco con alfa ----
      const base = sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      });

      // ---- 2) Preparar logo para watermark (gigante + diagonal opcional) ----
      let logoPre = sharp(logoFile.buffer)
        .resize({ width: Math.round(canvasWidth * watermarkScale) }, { fit: 'inside' });

      if (watermarkMode === 'diagonal') {
        logoPre = logoPre.rotate(watermarkAngle, { background: { r: 255, g: 255, b: 255, alpha: 0 } });
      }

      // PNG para preservar transparencia en composite
      const logoPrepared = await logoPre.png().toBuffer();
      const logoMeta = await sharp(logoPrepared).metadata();
      const wmLeft = Math.round((canvasWidth  - (logoMeta.width  ?? canvasWidth))  / 2);
      const wmTop  = Math.round((canvasHeight - (logoMeta.height ?? canvasHeight)) / 2);

      // ---- 3) Imagen del producto ----
      const productImageBuffer = await sharp(imageFile.buffer)
        .resize(canvasWidth, mainImageHeight, { fit: 'cover', position: 'attention' })
        .png()
        .toBuffer();

      // ---- 4) Logo normal abajo (solo layout sheet) ----
      const compsBottom = [];
      if (layout === 'sheet') {
        const bottomLogo = await sharp(logoFile.buffer).resize({ width: 400 }).png().toBuffer();
        const bMeta = await sharp(bottomLogo).metadata();
        const bLeft = Math.round((canvasWidth - (bMeta.width ?? 400)) / 2);
        const bTop  = 800 + Math.round(((canvasHeight - 800) - (bMeta.height ?? 0)) / 2);
        compsBottom.push({ input: bottomLogo, left: bLeft, top: bTop });
      }

      // ---- 5) Componer: watermark al fondo -> producto -> (opcional) logo abajo ----
      const outBuffer = await base
        .composite([
          { input: logoPrepared, left: wmLeft, top: wmTop, opacity: watermarkOpacity },
          { input: productImageBuffer, left: 0, top: 0 },
          ...compsBottom
        ])
        .toFormat(targetFormat === 'png' ? 'png' : 'jpeg', { quality })
        .toBuffer();

      res.setHeader('Content-Type', `image/${targetFormat === 'png' ? 'png' : 'jpeg'}`);
      res.send(outBuffer);
    } catch (error) {
      console.error('[NexusConverter] Error en /convert/image:', error);
      res.status(500).json({ success: false, error: 'Error procesando la imagen.', details: error.message });
    }
  }
);
// =================================================================
// FIN /convert/image v4.1.0
// =================================================================


// =================================================================
// /convert/video (igual que tu versión)
// =================================================================
app.post('/convert/video', upload.single('video'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "video" requerido.' });

    const format = req.body.format || 'mp4';
    const inputPath = path.join(TMP_DIR, `input_${Date.now()}`);
    const outputPath = `${inputPath}.${format}`;

    fs.writeFileSync(inputPath, req.file.buffer);

    ffmpeg(inputPath)
      .toFormat(format)
      .on('end', () => {
        console.log('[NexusConverter] Conversión de video finalizada.');
        res.setHeader('Content-Type', `video/${format}`);
        res.sendFile(outputPath, (err) => {
          fs.unlink(inputPath, () => {});
          fs.unlink(outputPath, () => {});
          if (err) console.error("Error al enviar archivo de video:", err);
        });
      })
      .on('error', (err) => {
        console.error('[NexusConverter] Error en ffmpeg:', err);
        fs.unlink(inputPath, () => {});
        res.status(500).json({ success: false, error: 'Fallo al convertir el video.', details: err.message });
      })
      .save(outputPath);

  } catch (error) {
    console.error('[NexusConverter] Error en /convert/video:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
  }
});

// =================================================================
// /convert/document (igual que tu versión)
// =================================================================
app.post('/convert/document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "document" requerido.' });

    const format = req.body.format || 'pdf';
    const inputPath = path.join(TMP_DIR, req.file.originalname);
    const outputPath = path.join(TMP_DIR, `${path.parse(req.file.originalname).name}.${format}`);

    fs.writeFileSync(inputPath, req.file.buffer);
    console.log(`[NexusConverter] Intentando convertir ${inputPath} a ${format}`);

    const pdfBuffer = await libre.convertAsync(req.file.buffer, `.${format}`, undefined);
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`[NexusConverter] Documento convertido a ${format}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(outputPath, (err) => {
      fs.unlink(inputPath, () => {});
      fs.unlink(outputPath, () => {});
      if (err) console.error("Error al enviar archivo de documento:", err);
    });

  } catch (error) {
    console.error('[NexusConverter] Error en /convert/document:', error);
    res.status(500).json({ success: false, error: 'Fallo al convertir el documento.', details: error.message });
  }
});

// =================================================================
// /convert/youtube (igual que tu versión)
// =================================================================
app.get('/convert/youtube', async (req, res) => {
  try {
    const { url: youtubeUrl, format = 'mp4' } = req.query;
    if (!youtubeUrl) return res.status(400).json({ success: false, error: 'Parámetro "url" de YouTube es requerido.' });

    const outputPath = path.join(TMP_DIR, `youtube_video_${Date.now()}.${format}`);
    const command = `yt-dlp -f 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]' --merge-output-format mp4 "${youtubeUrl}" -o "${outputPath}"`;

    console.log(`[NexusConverter] Ejecutando yt-dlp: ${command}`);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`[NexusConverter] Error en yt-dlp: ${stderr}`);
        return res.status(500).json({ success: false, error: 'Fallo al descargar/procesar el video de YouTube.', details: stderr });
      }
      console.log('[NexusConverter] Descarga de YouTube completada.');
      res.setHeader('Content-Type', `video/${format}`);
      res.sendFile(outputPath, (err) => {
        fs.unlink(outputPath, () => {});
        if (err) console.error("Error al enviar archivo de YouTube:", err);
      });
    });

  } catch (error) {
    console.error('[NexusConverter] Error en /convert/youtube:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
  }
});

// --- Health & Arranque ---
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '4.1.0', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[NexusConverter] v4.1.0 escuchando en el puerto ${PORT}`);
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
});
