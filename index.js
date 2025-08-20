/**
 * [NexusDev] - NexusConverter Microservice v2.0
 *
 * Mission: Provide a multi-format, high-performance API for converting images, videos, and documents.
 * Architecture: Modular endpoints for each file type. Uses Sharp, FFmpeg, and LibreOffice.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const libre = require('libreoffice-convert');

const libreConvertAsync = promisify(libre.convert);

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // Límite de 500 MB por archivo
});

// --- Middleware para logs ---
app.use((req, res, next) => {
    console.log(`[NexusConverter] Request received: ${req.method} ${req.path}`);
    next();
});

// --- API Endpoints ---

/**
 * Endpoint para conversión de imágenes.
 * @route POST /convert/image
 */
app.post('/convert/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo "image" requerido.' });

        const targetFormat = req.body.format || 'webp';
        const quality = parseInt(req.body.quality, 10) || 80;
        const supportedFormats = ['jpeg', 'png', 'webp', 'tiff', 'avif'];

        if (!supportedFormats.includes(targetFormat)) {
            return res.status(400).json({ success: false, error: `Formato de imagen no soportado: '${targetFormat}'.` });
        }
        if (isNaN(quality) || quality < 1 || quality > 100) {
            return res.status(400).json({ success: false, error: 'La calidad debe ser un número entre 1 y 100.' });
        }

        console.log(`[NexusConverter] Procesando imagen a formato: ${targetFormat}, calidad: ${quality}`);
        const outputBuffer = await sharp(req.file.buffer)
            .toFormat(targetFormat, { quality })
            .toBuffer();

        res.setHeader('Content-Type', `image/${targetFormat}`);
        res.status(200).send(outputBuffer);

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/image:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
    }
});

/**
 * Endpoint para conversión de video.
 * @route POST /convert/video
 */
app.post('/convert/video', upload.single('video'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "video" requerido.' });

    const inputPath = path.join('/tmp', req.file.originalname);
    fs.writeFileSync(inputPath, req.file.buffer);

    const targetFormat = req.body.format || 'mp4';
    const videoBitrate = req.body.videoBitrate || '1000k'; // e.g., '1000k', '2M'
    const audioBitrate = req.body.audioBitrate || '128k';
    const outputPath = path.join('/tmp', `output.${targetFormat}`);

    console.log(`[NexusConverter] Procesando video a ${targetFormat}, V-Bitrate: ${videoBitrate}, A-Bitrate: ${audioBitrate}`);

    ffmpeg(inputPath)
        .videoBitrate(videoBitrate)
        .audioBitrate(audioBitrate)
        .toFormat(targetFormat)
        .on('error', (err) => {
            console.error('[NexusConverter] Error en FFMPEG:', err);
            fs.unlinkSync(inputPath); // Cleanup
            return res.status(500).json({ success: false, error: 'Fallo en la conversión de video.', details: err.message });
        })
        .on('end', () => {
            res.setHeader('Content-Type', `video/${targetFormat}`);
            res.sendFile(outputPath, (err) => {
                // Cleanup files after sending
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
                if (err) console.error("Error al enviar archivo de video:", err);
            });
        })
        .save(outputPath);
});

/**
 * Endpoint para conversión de documentos.
 * @route POST /convert/document
 */
app.post('/convert/document', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo "document" requerido.' });

        const targetFormat = req.body.format || 'pdf'; // Principalmente para PDF
        console.log(`[NexusConverter] Procesando documento a ${targetFormat}`);

        const outputBuffer = await libreConvertAsync(req.file.buffer, `.${targetFormat}`, undefined);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.status(200).send(outputBuffer);

    } catch (error) {
        console.error('[NexusConverter] Error en /convert/document:', error);
        res.status(500).json({ success: false, error: 'Error interno en conversión de documento.', details: error.message });
    }
});


// --- Health Check Endpoint ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// --- Server Initialization ---
app.listen(PORT, () => {
  console.log(`[NexusDev] NexusConverter v2.0 está listo y escuchando en el puerto ${PORT}`);
});