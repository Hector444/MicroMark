/**
 * [NexusDev] - NexusConverter Microservice v2.1
 *
 * Mission: Provide a multi-format, high-performance API for converting images, videos, and documents.
 * Architecture: Modular endpoints for each file type. Uses Sharp, FFmpeg, and LibreOffice.
 * v2.1 Update: Switched to direct `soffice` command execution for document conversion to gain full control over export options and fix layout issues.
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});
const TMP_DIR = '/tmp'; // Directorio temporal para los archivos

// --- Middleware para logs ---
app.use((req, res, next) => {
    console.log(`[NexusConverter] Request received: ${req.method} ${req.path}`);
    next();
});

// --- API Endpoints ---

// Ruta de conversión de imágenes (sin cambios)
app.post('/convert/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Campo "image" requerido.' });
        const targetFormat = req.body.format || 'webp';
        const quality = parseInt(req.body.quality, 10) || 80;
        const supportedFormats = ['jpeg', 'png', 'webp', 'tiff', 'avif'];
        if (!supportedFormats.includes(targetFormat)) return res.status(400).json({ success: false, error: `Formato de imagen no soportado: '${targetFormat}'.` });
        if (isNaN(quality) || quality < 1 || quality > 100) return res.status(400).json({ success: false, error: 'La calidad debe ser un número entre 1 y 100.' });

        console.log(`[NexusConverter] Procesando imagen a formato: ${targetFormat}, calidad: ${quality}`);
        const outputBuffer = await sharp(req.file.buffer).toFormat(targetFormat, { quality }).toBuffer();
        res.setHeader('Content-Type', `image/${targetFormat}`);
        res.status(200).send(outputBuffer);
    } catch (error) {
        console.error('[NexusConverter] Error en /convert/image:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.', details: error.message });
    }
});

// Ruta de conversión de video (sin cambios)
app.post('/convert/video', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "video" requerido.' });
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join(TMP_DIR, `${uniqueSuffix}-${req.file.originalname}`);
    fs.writeFileSync(inputPath, req.file.buffer);

    const targetFormat = req.body.format || 'mp4';
    const videoBitrate = req.body.videoBitrate || '1000k';
    const audioBitrate = req.body.audioBitrate || '128k';
    const outputPath = path.join(TMP_DIR, `output-${uniqueSuffix}.${targetFormat}`);

    console.log(`[NexusConverter] Procesando video a ${targetFormat}, V-Bitrate: ${videoBitrate}, A-Bitrate: ${audioBitrate}`);
    ffmpeg(inputPath)
        .videoBitrate(videoBitrate).audioBitrate(audioBitrate).toFormat(targetFormat)
        .on('error', (err) => {
            console.error('[NexusConverter] Error en FFMPEG:', err);
            fs.unlink(inputPath, () => {}); // Cleanup
            res.status(500).json({ success: false, error: 'Fallo en la conversión de video.', details: err.message });
        })
        .on('end', () => {
            res.setHeader('Content-Type', `video/${targetFormat}`);
            res.sendFile(outputPath, (err) => {
                fs.unlink(inputPath, () => {});
                fs.unlink(outputPath, () => {});
                if (err) console.error("Error al enviar archivo de video:", err);
            });
        })
        .save(outputPath);
});

/**
 * Endpoint para conversión de documentos (MODIFICADO).
 * Ahora usa ejecución directa de 'soffice' para control total.
 * @route POST /convert/document
 */
app.post('/convert/document', upload.single('document'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Campo "document" requerido.' });

    const targetFormat = req.body.format || 'pdf';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const inputPath = path.join(TMP_DIR, `${uniqueSuffix}-${req.file.originalname}`);
    const outputPath = path.join(TMP_DIR, `output-${uniqueSuffix}.${targetFormat}`);

    fs.writeFileSync(inputPath, req.file.buffer);

    // Este es el "filtro" que le indica a Calc (el motor de hojas de cálculo de LibreOffice)
    // que debe ajustar cada hoja a una sola página, lo que fuerza el auto-escalado.
    const exportFilter = `calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}`;

    // Comando directo a la terminal
    const command = `soffice --headless --convert-to "pdf:${exportFilter}" --outdir ${TMP_DIR} ${inputPath}`;

    console.log(`[NexusConverter] Ejecutando comando directo: ${command}`);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`[NexusConverter] Error en 'soffice': ${error.message}`);
            fs.unlink(inputPath, () => {}); // Cleanup
            return res.status(500).json({ success: false, error: 'Fallo en la conversión del documento.', details: stderr });
        }

        // El nombre del archivo de salida es el mismo que el de entrada pero con la nueva extensión.
        const finalPdfPath = path.join(TMP_DIR, `${path.basename(inputPath, path.extname(inputPath))}.pdf`);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.sendFile(finalPdfPath, (err) => {
            // Cleanup
            fs.unlink(inputPath, () => {});
            fs.unlink(finalPdfPath, () => {});
            if (err) console.error("Error al enviar archivo PDF:", err);
        });
    });
});

// Ruta de Health Check (sin cambios)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', version: '2.1.0', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[NexusDev] NexusConverter service v2.1 está listo y escuchando en el puerto ${PORT}`);
});